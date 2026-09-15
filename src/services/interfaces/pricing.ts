import type { PricingMode, PricingSettings } from '../settings.js';

/**
 * PricingEngine seam (P0 item 9, sections 15/16/38).
 *
 * The mock ({@link ../mock/mockPricingEngine.ts}) derives everything from
 * seeded PriceSnapshots plus deterministic math. A REAL price feed (eBay
 * Terapeak, TCGplayer, PriceCharting, ...) can implement this exact interface
 * and drop in with ZERO UI changes: the Card Detail price panel, the Pricing
 * dashboard, and the JSON API all consume only the shapes defined here. The
 * only rule a real implementation must honor is the mode ordering contract
 * documented on {@link PricingEngine.priceCard}.
 */

/** Aggregated market data for a card at a point in time. */
export interface MarketData {
  /** Current market price (typical sold/asking midpoint). */
  marketPrice: number;
  /** Low of the current asking range. */
  low: number;
  /** High of the current asking range. */
  high: number;
  /** Low of recent completed sales. */
  recentSoldLow: number;
  /** High of recent completed sales. */
  recentSoldHigh: number;
  /** Number of comparable active listings (competition). */
  competitionCount: number;
  /** The lowest comparable active listing price. */
  lowestComparable: number;
  /** Where the data came from (e.g. 'mock-market', 'ebay-terapeak'). */
  source: string;
  /** ISO-ish timestamp the data was captured. */
  capturedAt: string;
}

/** Inputs for pricing a specific card in a specific condition + mode. */
export interface PriceCardInput {
  cardId: string;
  /** Condition code (e.g. 'NM', 'LP'); affects the suggested price. */
  condition?: string;
  /** Pricing strategy; defaults to the caller's settings. */
  mode?: PricingMode;
}

/** The full priced result surfaced on the Card Detail + Pricing pages. */
export interface PriceResult {
  /** Resolved market price used as the basis. */
  marketPrice: number;
  /** Recommended listing price, adjusted by mode + condition. */
  suggestedPrice: number;
  /** Estimated marketplace fees at the suggested price. */
  estimatedFees: number;
  /** Estimated shipping cost the seller pays. */
  estimatedShipping: number;
  /** Estimated net proceeds = suggested - fees - shipping - packaging. */
  estimatedNet: number;
  /** The mode actually used. */
  mode: PricingMode;
  /** Human-readable explanation of how the price was derived. */
  rationale: string;
}

export interface PricingEngine {
  /**
   * Aggregated market data for a card, or null if the card is unknown / has no
   * derivable data. A real feed returns live data; the mock uses seeded
   * snapshots or a deterministic fallback keyed off rarity/holo.
   */
  getMarketData(cardId: string): MarketData | null;

  /**
   * Price a card for listing. `settings` supplies fee %, fixed fee, shipping
   * and packaging so the net math is user-specific.
   *
   * Mode ordering contract (verified by tests): for the SAME card + condition,
   * suggestedPrice(fast_sale) <= suggestedPrice(balanced) <= suggestedPrice(max_profit).
   */
  priceCard(input: PriceCardInput, settings: PricingSettings): PriceResult | null;
}
