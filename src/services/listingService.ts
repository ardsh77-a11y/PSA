import { getDb } from '../db/connection.js';
import { listingsRepository, type ListingRow } from '../repositories/listingsRepository.js';
import { inventoryRepository } from '../repositories/inventoryRepository.js';
import { mockMarketplacePublisher } from './mock/mockMarketplacePublisher.js';
import type { MarketplacePublisher, PublishableListing } from './interfaces/marketplace.js';

/**
 * Listing lifecycle orchestration (section 18, 20).
 *
 * This service is the single seam between the API/UI and the pluggable
 * {@link MarketplacePublisher}: routes never call a publisher directly. It also
 * keeps the linked inventory row's status in sync:
 *   - publishing a listing flips its inventory to 'Listed' + records date_listed,
 *   - returning/ending a listing restores the inventory to a sellable status.
 */

function parseSpecifics(json: string | null | undefined): Record<string, string> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, string>;
  } catch {
    /* ignore */
  }
  return {};
}

function toPublishable(listing: ListingRow): PublishableListing {
  return {
    id: listing.id,
    title: listing.title,
    description: listing.description,
    price: listing.price,
    condition: listing.condition,
    sku: listing.sku,
    quantity: listing.quantity,
    marketplace: listing.marketplace,
    itemSpecifics: parseSpecifics(listing.item_specifics_json),
  };
}

export interface PublishOutcome {
  listing: ListingRow;
  externalId: string;
  publishedAt: string;
}

export function createListingService(publisher: MarketplacePublisher = mockMarketplacePublisher) {
  return {
    /**
     * Publish a listing via the {@link MarketplacePublisher}. Sets the listing
     * status to 'listed' with the returned external id + published_at, and
     * flips the linked inventory row to 'Listed' (recording date_listed).
     * Returns null if the listing does not belong to the user.
     */
    async publish(userId: string, listingId: string): Promise<PublishOutcome | null> {
      const listing = listingsRepository.getById(userId, listingId);
      if (!listing) return null;

      const result = await publisher.publish(toPublishable(listing));

      // Store the external id inside item specifics (no schema change needed)
      // and flip status -> listed.
      const specifics = parseSpecifics(listing.item_specifics_json);
      specifics.__externalId = result.externalId;

      const updated = listingsRepository.update(userId, listingId, {
        status: 'listed',
        marketplace: result.marketplace,
        published_at: result.publishedAt,
        item_specifics_json: JSON.stringify(specifics),
      })!;

      if (listing.inventory_id) {
        inventoryRepository.update(userId, listing.inventory_id, {
          status: 'Listed',
          marketplace: result.marketplace,
        });
        // date_listed is not in UpdateInventoryInput; set it directly.
        setInventoryDateListed(userId, listing.inventory_id, result.publishedAt);
      }

      return { listing: updated, externalId: result.externalId, publishedAt: result.publishedAt };
    },

    /**
     * Return a listing to inventory: unpublish (if it was live), set the listing
     * back to 'draft', and restore the inventory row to 'Ready to List'.
     */
    async returnToInventory(userId: string, listingId: string): Promise<ListingRow | null> {
      const listing = listingsRepository.getById(userId, listingId);
      if (!listing) return null;

      if (listing.status === 'listed') {
        const externalId = parseSpecifics(listing.item_specifics_json).__externalId ?? listing.id;
        await publisher.unpublish(toPublishable(listing), externalId);
      }

      const updated = listingsRepository.update(userId, listingId, {
        status: 'draft',
        published_at: null,
      })!;

      if (listing.inventory_id) {
        inventoryRepository.update(userId, listing.inventory_id, { status: 'Ready to List' });
        clearInventoryDateListed(userId, listing.inventory_id);
      }
      return updated;
    },

    /** End a listing (pull it from the marketplace) without returning inventory. */
    async end(userId: string, listingId: string): Promise<ListingRow | null> {
      const listing = listingsRepository.getById(userId, listingId);
      if (!listing) return null;
      if (listing.status === 'listed') {
        const externalId = parseSpecifics(listing.item_specifics_json).__externalId ?? listing.id;
        await publisher.unpublish(toPublishable(listing), externalId);
      }
      return listingsRepository.update(userId, listingId, { status: 'ended' })!;
    },
  };
}

/** Set inventory.date_listed directly (not covered by UpdateInventoryInput). */
function setInventoryDateListed(userId: string, inventoryId: string, when: string): void {
  getDb()
    .prepare("UPDATE inventory SET date_listed = ?, updated_at = datetime('now') WHERE user_id = ? AND id = ?")
    .run(when, userId, inventoryId);
}

function clearInventoryDateListed(userId: string, inventoryId: string): void {
  getDb()
    .prepare("UPDATE inventory SET date_listed = NULL, updated_at = datetime('now') WHERE user_id = ? AND id = ?")
    .run(userId, inventoryId);
}

/** Default service wired to the mock publisher. */
export const listingService = createListingService();
