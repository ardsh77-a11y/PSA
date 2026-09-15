import type { PricingSettings } from '../settings.js';
import type {
  ClassificationService,
  ClassificationInput,
  ClassificationResult,
  ClassificationDecision,
} from '../interfaces/classification.js';
import type { MarketData } from '../interfaces/pricing.js';

/**
 * Deterministic multi-factor single-vs-bulk classifier (section 10).
 *
 * We build a 0..100 score from four normalized factors, each weighted by the
 * seller's settings:
 *   - net:         expected net after fees/shipping (the dominant signal)
 *   - value:       raw market value
 *   - demand:      recent sold volume proxy (sold range width) + inverse competition
 *   - competition: fewer comparable listings is better
 *
 * The decision compares the weighted score to the seller's sell/bulk
 * thresholds. Crucially this is NOT a lone price cutoff: a $5 card whose net is
 * wiped out by fees/shipping scores low on the (heavily weighted) net factor
 * and can still be BULK, while a cheaper card with strong demand + low
 * competition can clear the SELL threshold.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Saturating normalizer: maps x>=0 to [0,1], reaching ~1 near `scale`. */
function saturate(x: number, scale: number): number {
  if (x <= 0) return 0;
  return x / (x + scale);
}

interface Factors {
  net: number; // 0..1
  value: number; // 0..1
  demand: number; // 0..1
  competition: number; // 0..1
}

/** Pure factor computation, exported for tests. */
export function computeFactors(
  marketData: MarketData | null,
  estimatedNet: number,
  marketPrice: number,
  settings: PricingSettings,
): Factors {
  // Net after fees/shipping. Negative net -> 0.
  const net = saturate(Math.max(0, estimatedNet), 4);
  // Raw market value.
  const value = saturate(Math.max(0, marketPrice), 6);

  let demand = 0.4; // neutral default when we have no market data
  let competition = 0.4;
  if (marketData) {
    // Demand proxy: width of the recent-sold band (activity) relative to price,
    // plus an inverse-competition contribution.
    const soldSpread = Math.max(0, marketData.recentSoldHigh - marketData.recentSoldLow);
    const activity = saturate(soldSpread, Math.max(0.5, marketPrice * 0.3));
    const invComp = 1 - saturate(marketData.competitionCount, 25);
    demand = round2(0.5 * activity + 0.5 * invComp);
    competition = round2(invComp);
  }
  return { net, value, demand, competition };
}

/** Pure score computation (0..100), exported for tests. */
export function scoreFactors(factors: Factors, settings: PricingSettings): number {
  const w = settings.weights;
  const weightTotal = w.net + w.value + w.demand + w.competition || 1;
  const weighted =
    factors.net * w.net +
    factors.value * w.value +
    factors.demand * w.demand +
    factors.competition * w.competition;
  return round2((weighted / weightTotal) * 100);
}

function decisionReason(
  decision: ClassificationDecision,
  factors: Factors,
  estimatedNet: number,
  settings: PricingSettings,
): string {
  const thinNet = estimatedNet <= settings.bulkValueCutoff;
  if (decision === 'BULK') {
    if (thinNet) {
      return 'Thin margin after fees and shipping makes single listing uneconomical.';
    }
    if (factors.competition < 0.35) {
      return 'Heavy competition and low relative value favor bulking.';
    }
    return 'Low value and weak demand favor selling as bulk.';
  }
  if (decision === 'SELL_INDIVIDUALLY') {
    if (factors.demand >= 0.6 && factors.competition >= 0.6) {
      return 'Strong demand and relatively low competition.';
    }
    if (factors.competition >= 0.6) {
      return 'Healthy net profit with limited competition.';
    }
    return 'Solid net profit justifies an individual listing.';
  }
  return 'Borderline economics; review before listing or bulking.';
}

export const mockClassificationService: ClassificationService = {
  classify(input: ClassificationInput): ClassificationResult {
    const { marketData, pricing, settings } = input;
    const factors = computeFactors(marketData, pricing.estimatedNet, pricing.marketPrice, settings);
    const score = scoreFactors(factors, settings);

    let decision: ClassificationDecision;
    // A wiped-out net always drops to BULK regardless of headline value: the
    // heavily-weighted net factor pulls the score down, but we also guard
    // explicitly so a high-value/low-net card is never mislabeled.
    if (pricing.estimatedNet <= 0) {
      decision = 'BULK';
    } else if (score >= settings.sellThreshold) {
      decision = 'SELL_INDIVIDUALLY';
    } else if (score <= settings.bulkThreshold) {
      decision = 'BULK';
    } else {
      decision = 'REVIEW';
    }

    const reason = decisionReason(decision, factors, pricing.estimatedNet, settings);
    const recommendedPrice = round2(pricing.suggestedPrice);
    const estimatedNet = round2(pricing.estimatedNet);

    const explanation =
      `Estimated market value: $${pricing.marketPrice.toFixed(2)} / ` +
      `Expected net after fees/shipping: $${estimatedNet.toFixed(2)} / ` +
      `Recommended listing price: $${recommendedPrice.toFixed(2)} / ` +
      `Reason: ${reason}`;

    return {
      decision,
      estimatedNet,
      recommendedPrice,
      reason: explanation,
      score,
    };
  },
};
