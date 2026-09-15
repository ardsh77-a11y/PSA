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

// The listing-generation seam lives in ./listingGenerator.ts (it carries the
// full draft shape). Re-exported here so callers can keep importing from
// services/interfaces.
export type {
  ListingGenerator,
  GeneratedListingDraft,
  GenerateOptions,
} from './listingGenerator.js';

// The marketplace-publishing seam lives in ./marketplace.ts. Re-exported here.
export type {
  MarketplacePublisher,
  PublishableListing,
  PublishResult,
  UnpublishResult,
} from './marketplace.js';

// The seller-assistant seam lives in ./sellerAssistant.ts. It answers a user's
// natural-language questions from their real data; a real LLM implements the
// same interface with no UI change. Re-exported here.
export type {
  SellerAssistant,
  AssistantAnswer,
  AssistantData,
} from './sellerAssistant.js';
