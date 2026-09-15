/**
 * Service interfaces for PokeOps' pluggable capabilities. Real external
 * integrations (computer vision, price feeds, marketplace APIs, LLM assistant)
 * are NOT reachable in this environment, so each capability is defined as an
 * interface here and implemented with a deterministic mock under
 * ../mock/. Later features flesh out the mock behavior; this file establishes
 * the seams so those implementations slot in without touching callers.
 */

// The recognition seam lives in ./recognizer.ts (it carries a richer input +
// result shape). Re-exported here so callers can keep importing from
// services/interfaces.
export type {
  Recognizer,
  RecognitionResult,
  RecognizeInput,
} from './recognizer.js';

// The pricing + single-vs-bulk classification seams live in their own modules
// (they carry richer types driven by user settings). Re-exported here so
// callers can keep importing from services/interfaces.
export type {
  PricingEngine,
  MarketData,
  PriceCardInput,
  PriceResult,
} from './pricing.js';
export type {
  ClassificationService,
  ClassificationDecision,
  ClassificationInput,
  ClassificationResult,
} from './classification.js';

export interface GeneratedListing {
  title: string;
  description: string;
  price: number;
  itemSpecifics: Record<string, string>;
}

/** Generates marketplace-ready listing content. */
export interface ListingGenerator {
  generate(inventoryId: string): Promise<GeneratedListing>;
}

export interface PublishResult {
  externalId: string;
  status: 'listed' | 'error';
}

/** Publishes a listing to a marketplace (mock just marks it Listed). */
export interface MarketplacePublisher {
  publish(listingId: string): Promise<PublishResult>;
}

/** Answers seller questions / suggests actions (mock returns canned help). */
export interface SellerAssistant {
  ask(prompt: string): Promise<string>;
}
