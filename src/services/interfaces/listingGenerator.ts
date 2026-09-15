import type { PricingMode } from '../settings.js';

/**
 * ListingGenerator seam (P0 item 11, sections 17, 18).
 *
 * Turns an inventory row into a marketplace-ready listing DRAFT: a
 * search-optimized title, description, condition, category, item specifics,
 * price + shipping (from the {@link PricingEngine}), a generated SKU and a
 * quantity. The concrete implementation lives in
 * {@link ../listingGenerator.ts}. Callers depend only on this interface so a
 * smarter generator (LLM-assisted titles, richer specifics) can replace it
 * without touching routes, the API or the UI.
 */

/** The generated draft, before persistence (or reflecting a persisted row). */
export interface GeneratedListingDraft {
  inventoryId: string;
  marketplace: string;
  title: string;
  description: string;
  condition: string | null;
  /** Marketplace category / leaf label (e.g. 'Pokemon TCG Individual Cards'). */
  category: string;
  itemSpecifics: Record<string, string>;
  price: number;
  shippingCost: number;
  sku: string;
  quantity: number;
  /** The pricing mode used to derive the price. */
  mode: PricingMode;
}

export interface GenerateOptions {
  /** Pricing mode override; defaults to the user's generation setting. */
  mode?: PricingMode;
  /** Marketplace override; defaults to the user's default marketplace. */
  marketplace?: string;
}

export interface ListingGenerator {
  /**
   * Build (but do not persist) a listing draft for one of a user's inventory
   * rows. Returns null if the row is missing or not linked to a card.
   */
  buildDraft(userId: string, inventoryId: string, opts?: GenerateOptions): GeneratedListingDraft | null;

  /**
   * Build a draft AND persist it as a `draft` listing, generating/assigning a
   * SKU on the inventory row as needed. Returns the created listing id, or null
   * if the row is missing / not linked to a card.
   */
  generateForInventory(userId: string, inventoryId: string, opts?: GenerateOptions): string | null;
}
