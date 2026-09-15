import type { PricingSettings } from '../settings.js';
import type { MarketData, PriceResult } from './pricing.js';

/**
 * ClassificationService seam (P0 item 10, section 10).
 *
 * Decides whether a card is worth selling INDIVIDUALLY, should go to BULK, or
 * needs human REVIEW. This is explicitly a MULTI-FACTOR scoring model, NOT a
 * lone fixed price threshold: value, net-after-fees, demand (recent sold
 * volume + inverse competition), competition and the seller's own weights and
 * thresholds all combine into a score. A high-value card can still land in
 * BULK if fees/shipping destroy its net; a modest card with strong demand and
 * low competition can be a SELL_INDIVIDUALLY.
 *
 * The mock is deterministic and pure. A real classifier (ML model, richer
 * demand signals) can implement the same interface without any UI change.
 */

export type ClassificationDecision = 'SELL_INDIVIDUALLY' | 'BULK' | 'REVIEW';

export interface ClassificationInput {
  /** Aggregated market data (or null when unknown). */
  marketData: MarketData | null;
  /** The priced result (suggested price + net). */
  pricing: PriceResult;
  /** Seller preferences: weights, thresholds, cutoffs. */
  settings: PricingSettings;
}

export interface ClassificationResult {
  decision: ClassificationDecision;
  /** Expected net proceeds after fees + shipping (mirrors pricing.estimatedNet). */
  estimatedNet: number;
  /** The recommended listing price if sold individually. */
  recommendedPrice: number;
  /**
   * Human-readable explanation in the section-10 format, e.g.:
   * 'Estimated market value: $11.80 / Expected net after fees/shipping: $9.31 /
   *  Recommended listing price: $12.99 / Reason: Strong demand and relatively
   *  low competition.'
   */
  reason: string;
  /** The raw multi-factor score (0-100), exposed for the UI + tests. */
  score: number;
}

export interface ClassificationService {
  classify(input: ClassificationInput): ClassificationResult;
}
