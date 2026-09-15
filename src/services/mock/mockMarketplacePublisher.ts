import { createHash } from 'node:crypto';
import type {
  MarketplacePublisher,
  PublishableListing,
  PublishResult,
  UnpublishResult,
} from '../interfaces/marketplace.js';

/**
 * Deterministic, offline {@link MarketplacePublisher} (sections 20, 42).
 *
 * This mock stands in for a real eBay/TCGplayer/Whatnot/Mercari/Shopify client.
 * It performs NO network I/O and holds NO credentials, so it is safe to run in
 * this sandbox. It fabricates a stable external id derived from the listing id
 * + marketplace (so republishing the same listing yields the same id), and a
 * timestamp. A real publisher implementing the same interface drops in with no
 * changes to routes, the API, or the UI.
 *
 * A single default instance publishes to whatever `listing.marketplace` says;
 * {@link mockMarketplacePublisher} is that instance. `createMockPublisher(name)`
 * makes a per-marketplace instance if a caller wants to pin one.
 */

/** Stable pseudo external id from the listing id + marketplace. */
function fakeExternalId(marketplace: string, listingId: string): string {
  const digest = createHash('sha256').update(`${marketplace}:${listingId}`).digest('hex');
  // A short, marketplace-prefixed, human-recognizable id.
  const prefix = marketplace.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || 'MKT';
  return `${prefix}-${digest.slice(0, 12).toUpperCase()}`;
}

export function createMockPublisher(defaultName = 'mock'): MarketplacePublisher {
  return {
    name: defaultName,

    async publish(listing: PublishableListing): Promise<PublishResult> {
      const marketplace = (listing.marketplace && listing.marketplace.trim()) || defaultName;
      return {
        externalId: fakeExternalId(marketplace, listing.id),
        // Deterministic-ish timestamp: real time, but the id is stable.
        publishedAt: new Date().toISOString(),
        marketplace,
      };
    },

    async unpublish(listing: PublishableListing, externalId: string): Promise<UnpublishResult> {
      return {
        externalId,
        unpublishedAt: new Date().toISOString(),
      };
    },
  };
}

/** The default in-process mock publisher used across the app. */
export const mockMarketplacePublisher: MarketplacePublisher = createMockPublisher('mock');
