/**
 * MarketplacePublisher seam (sections 20, 42).
 *
 * Publishing a listing to an external marketplace (eBay, TCGplayer, Whatnot,
 * Mercari, Shopify, ...) is defined ENTIRELY behind this interface. The app
 * (routes, API, views) only ever talks to a `MarketplacePublisher`; it never
 * imports a concrete marketplace client. That guarantees a real integration can
 * drop in later with ZERO UI changes:
 *
 *   - The mock ({@link ../mock/mockMarketplacePublisher.ts}) assigns a
 *     deterministic fake external id + timestamp and touches NO network.
 *   - A real implementation would hold OAuth credentials/tokens SERVER-SIDE and
 *     make the marketplace API calls. Credentials are NEVER exposed to the
 *     frontend (section 42): the browser only ever sees the returned
 *     externalId/publishedAt, never a token or secret.
 *
 * The listing lifecycle the publisher participates in is
 *   draft -> ready -> listed (published) -> ended/sold
 * with `unpublish` reversing a `publish` (listed -> back to draft/ready) so a
 * listing can be pulled from the marketplace and, optionally, returned to
 * inventory.
 */

/** The minimal listing shape a publisher needs. */
export interface PublishableListing {
  id: string;
  title: string;
  description?: string | null;
  price: number;
  condition?: string | null;
  sku?: string | null;
  quantity: number;
  marketplace?: string | null;
  itemSpecifics?: Record<string, string>;
}

/** The result of publishing a listing to a marketplace. */
export interface PublishResult {
  /** The marketplace-assigned external listing id. */
  externalId: string;
  /** ISO timestamp the listing went live. */
  publishedAt: string;
  /** Which marketplace it was published to. */
  marketplace: string;
}

/** The result of unpublishing (ending) a marketplace listing. */
export interface UnpublishResult {
  externalId: string;
  unpublishedAt: string;
}

export interface MarketplacePublisher {
  /** The marketplace this publisher targets (e.g. 'eBay', or 'mock'). */
  readonly name: string;
  /**
   * Publish a listing. Resolves with the external id + timestamp. A real
   * implementation performs the marketplace API call using server-side
   * credentials; the mock fabricates a deterministic id offline.
   */
  publish(listing: PublishableListing): Promise<PublishResult>;
  /**
   * Remove/end a published listing on the marketplace. Used when a listing is
   * ended or returned to inventory.
   */
  unpublish(listing: PublishableListing, externalId: string): Promise<UnpublishResult>;
}
