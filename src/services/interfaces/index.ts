/**
 * Service interfaces for PokeOps' pluggable capabilities. Real external
 * integrations (computer vision, price feeds, marketplace APIs, LLM assistant)
 * are NOT reachable in this environment, so each capability is defined as an
 * interface here and implemented with a deterministic mock under
 * ../mock/. Later features flesh out the mock behavior; this file establishes
 * the seams so those implementations slot in without touching callers.
 */

export interface RecognizedCard {
  pokemonName?: string;
  cardName?: string;
  setName?: string;
  setAbbreviation?: string;
  cardNumber?: string;
  rarity?: string;
  cardType?: string;
  language?: string;
  isHolo?: boolean;
  isReverseHolo?: boolean;
  estimatedCondition?: string;
  confidence: number;
}

/** Identifies cards from an uploaded image (mock keys off filename/seed). */
export interface Recognizer {
  recognize(imageRef: string): Promise<RecognizedCard[]>;
}

export interface PriceQuote {
  marketPrice: number;
  low: number;
  high: number;
  recentSoldLow: number;
  recentSoldHigh: number;
  competitionCount: number;
  source: string;
}

/** Produces price quotes for a card (mock uses seeded snapshots + math). */
export interface PricingEngine {
  quote(cardId: string): Promise<PriceQuote>;
}

export type Classification = 'single' | 'bulk';

/** Decides whether a card should be sold as a single or as bulk. */
export interface ClassificationService {
  classify(input: { marketPrice: number; rarity?: string }): Classification;
}

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
