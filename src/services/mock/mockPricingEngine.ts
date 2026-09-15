import { priceSnapshotsRepository } from '../../repositories/priceSnapshotsRepository.js';
import { cardsRepository } from '../../repositories/cardsRepository.js';
import { pokemonStrategy, strategyFor } from '../../domain/tcg.js';
import type { PricingSettings, PricingMode } from '../settings.js';
import type {
  PricingEngine,
  MarketData,
  PriceCardInput,
  PriceResult,
} from '../interfaces/pricing.js';

/**
 * Deterministic mock PricingEngine.
 *
 * - getMarketData: prefers the latest seeded PriceSnapshot for the card. If
 *   none exists it derives a STABLE pseudo-market value from the card's rarity
 *   rank + holo/reverse flags via the TCG strategy (seeded by the card id so
 *   the same card always yields the same numbers).
 * - priceCard: applies a condition multiplier and a pricing-mode multiplier to
 *   the market price, then computes fees/shipping/net from the user's settings.
 *
 * All the math lives in exported pure helpers so tests can assert on them
 * without a database.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Deterministic 0..1 pseudo-random keyed off a string (FNV-1a based). */
export function seededUnit(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Map to [0,1).
  return ((h >>> 0) % 100000) / 100000;
}

/** Condition multipliers applied to market price (NM is the baseline 1.0). */
export const CONDITION_MULTIPLIER: Record<string, number> = {
  M: 1.1,
  NM: 1.0,
  LP: 0.85,
  MP: 0.7,
  HP: 0.5,
  DMG: 0.3,
  GRADED: 1.4,
};

/** Pricing-mode multipliers applied to the market price for the suggestion. */
export const MODE_MULTIPLIER: Record<PricingMode, number> = {
  fast_sale: 0.92,
  balanced: 1.0,
  max_profit: 1.12,
};

export function conditionMultiplier(condition: string | undefined | null): number {
  if (!condition) return 1.0;
  return CONDITION_MULTIPLIER[condition] ?? 1.0;
}

/**
 * Derive a stable pseudo-market value from a card's rarity + holo flags. Used
 * only when no snapshot exists. Deterministic given the card id.
 */
export function deriveMarketValue(input: {
  id: string;
  rarity?: string | null;
  is_holo?: number | boolean | null;
  is_reverse_holo?: number | boolean | null;
  game?: string | null;
}): number {
  const strategy = strategyFor(input.game) ?? pokemonStrategy;
  const rank = strategy.rarityRank(input.rarity ?? null); // 0..9
  // Base grows roughly geometrically with rarity rank.
  const base = 0.15 * Math.pow(1.9, rank);
  const holoBoost = input.is_holo ? 1.35 : input.is_reverse_holo ? 1.15 : 1.0;
  // Stable per-card jitter in [0.85, 1.15].
  const jitter = 0.85 + seededUnit(input.id) * 0.3;
  return round2(Math.max(0.1, base * holoBoost * jitter));
}

/**
 * Compose full MarketData around a market price. Deterministic ranges keyed
 * off the card id so the same card always yields the same competition/spread.
 */
export function synthMarketData(cardId: string, marketPrice: number, source: string): MarketData {
  const u = seededUnit(cardId + ':md');
  const competitionCount = Math.max(1, Math.round(1 + u * 60));
  return {
    marketPrice: round2(marketPrice),
    low: round2(marketPrice * 0.8),
    high: round2(marketPrice * 1.25),
    recentSoldLow: round2(marketPrice * 0.85),
    recentSoldHigh: round2(marketPrice * 1.15),
    competitionCount,
    lowestComparable: round2(marketPrice * 0.82),
    source,
    capturedAt: new Date(0).toISOString(),
  };
}

/** Pure fee/net computation from a sale price + settings. */
export function computeFeesAndNet(
  salePrice: number,
  settings: PricingSettings,
): { estimatedFees: number; estimatedShipping: number; estimatedNet: number } {
  const estimatedFees = round2(salePrice * settings.feePct + settings.fixedFee);
  const estimatedShipping = round2(settings.shippingCost);
  const estimatedNet = round2(salePrice - estimatedFees - estimatedShipping - settings.packagingCost);
  return { estimatedFees, estimatedShipping, estimatedNet };
}

/**
 * Pure suggested-price computation: market price adjusted by condition + mode.
 * Fast Sale nudges toward the lowest comparable; Maximum Profit sits above
 * market. Guarantees the fast <= balanced <= max ordering for a fixed card.
 */
export function computeSuggestedPrice(
  marketPrice: number,
  lowestComparable: number,
  condition: string | undefined,
  mode: PricingMode,
): number {
  const conditioned = marketPrice * conditionMultiplier(condition);
  let suggested = conditioned * MODE_MULTIPLIER[mode];
  if (mode === 'fast_sale') {
    // Undercut toward the lowest comparable (scaled by condition) but never
    // below it after conditioning, so the ordering contract still holds.
    const target = Math.min(conditioned * MODE_MULTIPLIER.fast_sale, lowestComparable * conditionMultiplier(condition));
    suggested = Math.min(suggested, target);
  }
  return round2(Math.max(0.1, suggested));
}

export const mockPricingEngine: PricingEngine = {
  getMarketData(cardId: string): MarketData | null {
    const snap = priceSnapshotsRepository.latestForCard(cardId);
    if (snap && typeof snap.market_price === 'number') {
      const marketPrice = snap.market_price;
      return {
        marketPrice: round2(marketPrice),
        low: round2(snap.low ?? marketPrice * 0.8),
        high: round2(snap.high ?? marketPrice * 1.25),
        recentSoldLow: round2(snap.recent_sold_low ?? marketPrice * 0.85),
        recentSoldHigh: round2(snap.recent_sold_high ?? marketPrice * 1.15),
        competitionCount: snap.competition_count ?? synthMarketData(cardId, marketPrice, '').competitionCount,
        lowestComparable: round2(snap.low ?? marketPrice * 0.82),
        source: snap.source ?? 'mock-market',
        capturedAt: snap.captured_at,
      };
    }

    // No snapshot: derive deterministically from the card definition.
    const card = cardsRepository.getById(cardId);
    if (!card) return null;
    const derived = deriveMarketValue({
      id: card.id,
      rarity: card.rarity,
      is_holo: card.is_holo,
      is_reverse_holo: card.is_reverse_holo,
      game: card.game,
    });
    return synthMarketData(cardId, derived, 'mock-derived');
  },

  priceCard(input: PriceCardInput, settings: PricingSettings): PriceResult | null {
    const market = this.getMarketData(input.cardId);
    if (!market) return null;
    const mode = input.mode ?? settings.pricingMode;

    const suggestedPrice = computeSuggestedPrice(
      market.marketPrice,
      market.lowestComparable,
      input.condition,
      mode,
    );
    const { estimatedFees, estimatedShipping, estimatedNet } = computeFeesAndNet(suggestedPrice, settings);

    const modeLabel =
      mode === 'fast_sale' ? 'Fast Sale (undercut for a quick sale)'
        : mode === 'max_profit' ? 'Maximum Profit (priced above market)'
          : 'Balanced (at market)';
    const rationale =
      `Market $${market.marketPrice.toFixed(2)} · condition ${input.condition ?? 'NM'} · ${modeLabel}. ` +
      `Suggested $${suggestedPrice.toFixed(2)}; after fees/shipping/packaging net $${estimatedNet.toFixed(2)}.`;

    return {
      marketPrice: market.marketPrice,
      suggestedPrice,
      estimatedFees,
      estimatedShipping,
      estimatedNet,
      mode,
      rationale,
    };
  },
};
