import { getDb } from '../db/connection.js';
import { settingsService } from './settings.js';
import { mockPricingEngine } from './mock/mockPricingEngine.js';
import { priceSnapshotsRepository } from '../repositories/priceSnapshotsRepository.js';

/**
 * "List These Next" recommendation engine (FEAT-008, section 5B).
 *
 * Ranks a user's UNLISTED inventory (not Listed, not Sold) by a priority score
 * that blends several signals, so the seller always knows the highest-leverage
 * cards to list next:
 *
 *   - estimated value      (higher market value ranks higher)
 *   - profit potential     (net after fees/shipping from the pricing engine)
 *   - demand proxy         (inverse competition + recent sold volume)
 *   - low competition      (fewer comparable listings ranks higher)
 *   - time sitting         (older date_acquired ranks higher — stop the bleed)
 *
 * All the pricing/market inputs come from the pluggable pricing engine, so a
 * real price feed changes the ranking with zero code edits.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Clamp a value into [0,1]. */
function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export interface Recommendation {
  inventoryId: string;
  cardId: string | null;
  cardName: string;
  setName: string | null;
  condition: string;
  marketValue: number;
  suggestedPrice: number;
  estimatedNet: number;
  competition: number;
  daysSitting: number;
  score: number;
  /** Human-readable explanation of why this card ranks where it does. */
  rationale: string;
}

interface Candidate {
  id: string;
  card_id: string | null;
  condition: string;
  market_value: number | null;
  date_acquired: string | null;
  card_name: string | null;
  set_name: string | null;
}

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 0;
  const t = Date.parse(dateStr.replace(' ', 'T'));
  if (!Number.isFinite(t)) return 0;
  const days = (Date.now() - t) / 86400000;
  return days > 0 ? Math.floor(days) : 0;
}

export const recommendationService = {
  /**
   * Return the top-N unlisted cards to list next, ranked by priority score.
   * The scoring weights reuse the user's pricing settings weights so it stays
   * consistent with the single-vs-bulk classifier.
   */
  listTheseNext(userId: string, limit = 5): Recommendation[] {
    const db = getDb();
    const settings = settingsService.getPricingSettings(userId);

    const candidates = db
      .prepare(
        `SELECT i.id, i.card_id, i.condition, i.market_value, i.date_acquired,
                c.name AS card_name, s.name AS set_name
         FROM inventory i
         LEFT JOIN cards c ON c.id = i.card_id
         LEFT JOIN sets s ON s.id = c.set_id
         WHERE i.user_id = ?
           AND i.status NOT IN ('Listed', 'Sold')
           AND (i.classification IS NULL OR LOWER(i.classification) <> 'bulk')
           AND i.card_id IS NOT NULL`,
      )
      .all(userId) as Candidate[];

    if (candidates.length === 0) return [];

    interface Scored extends Recommendation {}
    const rows: Scored[] = [];

    // First pass: gather raw signals so we can normalize across the candidate
    // pool before combining them into a score.
    interface Raw {
      cand: Candidate;
      marketValue: number;
      suggestedPrice: number;
      estimatedNet: number;
      competition: number;
      soldVolume: number;
      daysSitting: number;
    }
    const raws: Raw[] = [];
    let maxValue = 0;
    let maxNet = 0;
    let maxComp = 1;
    let maxSold = 1;
    let maxDays = 1;

    for (const cand of candidates) {
      const market = cand.card_id ? mockPricingEngine.getMarketData(cand.card_id) : null;
      const priced = cand.card_id
        ? mockPricingEngine.priceCard(
            { cardId: cand.card_id, condition: cand.condition ?? 'NM', mode: settings.pricingMode },
            settings,
          )
        : null;
      const marketValue = round2(cand.market_value ?? market?.marketPrice ?? 0);
      const suggestedPrice = round2(priced?.suggestedPrice ?? marketValue);
      const estimatedNet = round2(priced?.estimatedNet ?? 0);
      const competition = market?.competitionCount ?? 0;
      const snap = cand.card_id ? priceSnapshotsRepository.latestForCard(cand.card_id) : undefined;
      const soldVolume =
        snap && snap.recent_sold_high != null && snap.recent_sold_low != null
          ? Math.max(0, snap.recent_sold_high - snap.recent_sold_low)
          : 0;
      const daysSitting = daysSince(cand.date_acquired);

      maxValue = Math.max(maxValue, marketValue);
      maxNet = Math.max(maxNet, estimatedNet);
      maxComp = Math.max(maxComp, competition);
      maxSold = Math.max(maxSold, soldVolume);
      maxDays = Math.max(maxDays, daysSitting);

      raws.push({ cand, marketValue, suggestedPrice, estimatedNet, competition, soldVolume, daysSitting });
    }

    const w = settings.weights;
    // Time factor gets a modest fixed weight so old stock bubbles up.
    const wTime = 0.5;

    for (const r of raws) {
      const valueScore = clamp01(r.marketValue / maxValue);
      const netScore = clamp01(r.estimatedNet / maxNet);
      // Demand: more recent sold spread = more demand; low competition helps.
      const demandScore = clamp01(r.soldVolume / maxSold);
      const competitionScore = 1 - clamp01(r.competition / maxComp);
      const timeScore = clamp01(r.daysSitting / maxDays);

      const score =
        w.value * valueScore +
        w.net * netScore +
        w.demand * demandScore +
        w.competition * competitionScore +
        wTime * timeScore;

      const bits: string[] = [];
      bits.push(`$${r.marketValue.toFixed(2)} market`);
      bits.push(`$${r.estimatedNet.toFixed(2)} net`);
      if (r.competition > 0) bits.push(`${r.competition} competing`);
      if (r.daysSitting > 0) bits.push(`sitting ${r.daysSitting}d`);

      rows.push({
        inventoryId: r.cand.id,
        cardId: r.cand.card_id,
        cardName: r.cand.card_name ?? 'Unknown card',
        setName: r.cand.set_name,
        condition: r.cand.condition ?? 'NM',
        marketValue: r.marketValue,
        suggestedPrice: r.suggestedPrice,
        estimatedNet: r.estimatedNet,
        competition: r.competition,
        daysSitting: r.daysSitting,
        score: round2(score),
        rationale: bits.join(' · '),
      });
    }

    rows.sort((a, b) => b.score - a.score || b.marketValue - a.marketValue);
    return rows.slice(0, Math.max(0, limit));
  },
};
