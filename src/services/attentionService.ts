import { getDb } from '../db/connection.js';
import { settingsService } from './settings.js';
import { mockPricingEngine } from './mock/mockPricingEngine.js';
import { bulkService } from './bulkService.js';

/**
 * "What Needs Your Attention?" service (FEAT-008, sections 5A + 45).
 *
 * Turns the user's data into a short list of concrete, actionable items, each
 * with a count, a plain-language message and a link to the filtered page that
 * resolves it. Every screen should be able to answer "here's what to do next".
 *
 * The items surfaced:
 *  - valuable cards still unlisted (value at/above a threshold, not Listed/Sold)
 *  - listings priced away from the pricing engine's suggestion (under/over)
 *  - orders needing fulfillment (New / Picking / Packed)
 *  - bulk cards ready to package into lots
 *  - cards missing a storage location
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function money(n: number): string {
  return `$${round2(n).toFixed(2)}`;
}

/** Severity drives the visual tone of the attention card. */
export type AttentionTone = 'danger' | 'warning' | 'info' | 'success';

export interface AttentionItem {
  key: string;
  count: number;
  title: string;
  message: string;
  href: string;
  linkLabel: string;
  tone: AttentionTone;
}

export interface AttentionOptions {
  /** Cards at/above this market value are "valuable" (default $5). */
  valuableThreshold?: number;
  /**
   * Fraction a listing price must diverge from the suggestion to flag it
   * (default 0.15 = 15%).
   */
  priceTolerance?: number;
}

export const attentionService = {
  /** Build the prioritized attention list for a user (most urgent first). */
  getAttentionItems(userId: string, opts: AttentionOptions = {}): AttentionItem[] {
    const db = getDb();
    const valuableThreshold = opts.valuableThreshold ?? 5;
    const tolerance = opts.priceTolerance ?? 0.15;
    const settings = settingsService.getPricingSettings(userId);
    const items: AttentionItem[] = [];

    // 1) Orders needing fulfillment (New / Picking / Packed).
    const fulfill = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM orders
           WHERE user_id = ? AND status IN ('New', 'Picking', 'Packed')`,
        )
        .get(userId) as { c: number }
    ).c;
    if (fulfill > 0) {
      items.push({
        key: 'orders_to_fulfill',
        count: fulfill,
        title: 'Orders to fulfill',
        message: `${fulfill} order${fulfill === 1 ? '' : 's'} need${fulfill === 1 ? 's' : ''} picking, packing or shipping.`,
        href: '/orders?status=New',
        linkLabel: 'Fulfill orders',
        tone: 'danger',
      });
    }

    // 2) Valuable cards still unlisted.
    const valuable = db
      .prepare(
        `SELECT COUNT(*) AS c, COALESCE(SUM(COALESCE(market_value, 0)), 0) AS v
         FROM inventory
         WHERE user_id = ? AND status NOT IN ('Listed', 'Sold')
           AND COALESCE(market_value, 0) >= ?`,
      )
      .get(userId, valuableThreshold) as { c: number; v: number };
    if (valuable.c > 0) {
      items.push({
        key: 'valuable_unlisted',
        count: valuable.c,
        title: 'Valuable cards unlisted',
        message: `${valuable.c} card${valuable.c === 1 ? '' : 's'} worth ${money(valuable.v)} total are not listed yet.`,
        href: '/inventory?status=Ready to List',
        linkLabel: 'List them',
        tone: 'warning',
      });
    }

    // 3) Listings priced away from the suggested price (under or over).
    const listingRows = db
      .prepare(
        `SELECT l.id, l.price, i.condition AS condition, i.card_id AS card_id
         FROM listings l
         LEFT JOIN inventory i ON i.id = l.inventory_id
         WHERE l.user_id = ? AND l.inventory_id IS NOT NULL AND i.card_id IS NOT NULL
           AND l.status IN ('draft', 'ready', 'active', 'listed')`,
      )
      .all(userId) as Array<{ id: string; price: number; condition: string | null; card_id: string }>;
    let underpriced = 0;
    let overpriced = 0;
    for (const l of listingRows) {
      const priced = mockPricingEngine.priceCard(
        { cardId: l.card_id, condition: l.condition ?? 'NM', mode: settings.pricingMode },
        settings,
      );
      if (!priced || priced.suggestedPrice <= 0) continue;
      const diff = (l.price - priced.suggestedPrice) / priced.suggestedPrice;
      if (diff <= -tolerance) underpriced++;
      else if (diff >= tolerance) overpriced++;
    }
    if (underpriced > 0) {
      items.push({
        key: 'underpriced_listings',
        count: underpriced,
        title: 'Underpriced listings',
        message: `${underpriced} listing${underpriced === 1 ? '' : 's'} sit${underpriced === 1 ? 's' : ''} well below the suggested price — you may be leaving money on the table.`,
        href: '/listings',
        linkLabel: 'Review pricing',
        tone: 'warning',
      });
    }
    if (overpriced > 0) {
      items.push({
        key: 'overpriced_listings',
        count: overpriced,
        title: 'Overpriced listings',
        message: `${overpriced} listing${overpriced === 1 ? '' : 's'} sit${overpriced === 1 ? 's' : ''} well above the suggested price and may be slow to sell.`,
        href: '/listings',
        linkLabel: 'Review pricing',
        tone: 'info',
      });
    }

    // 4) Bulk cards ready to package (approximate lots at the largest lot size).
    const bulkSummary = bulkService.getBulkSummary(userId);
    const bulkCount = bulkSummary.totalCount;
    if (bulkCount > 0) {
      const settingsBulk = settingsService.getBulkSettings(userId);
      const largest = Math.max(1, ...settingsBulk.defaultLotSizes);
      const approxLots = Math.floor(bulkCount / largest);
      if (approxLots >= 1) {
        items.push({
          key: 'bulk_to_package',
          count: bulkCount,
          title: 'Bulk ready to package',
          message: `${bulkCount.toLocaleString('en-US')} bulk cards could pack into about ${approxLots} lot${approxLots === 1 ? '' : 's'} to sell.`,
          href: '/bulk',
          linkLabel: 'Package bulk',
          tone: 'info',
        });
      }
    }

    // 5) Cards missing a storage location.
    const missingStorage = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM inventory
           WHERE user_id = ? AND status <> 'Sold' AND storage_location_id IS NULL`,
        )
        .get(userId) as { c: number }
    ).c;
    if (missingStorage > 0) {
      items.push({
        key: 'missing_storage',
        count: missingStorage,
        title: 'Cards missing a storage location',
        message: `${missingStorage} card${missingStorage === 1 ? '' : 's'} have no storage location, making them hard to find when they sell.`,
        href: '/inventory',
        linkLabel: 'Assign storage',
        tone: 'info',
      });
    }

    // Most urgent (danger) first, then by count desc within a tone.
    const toneRank: Record<AttentionTone, number> = { danger: 0, warning: 1, info: 2, success: 3 };
    return items.sort((a, b) => toneRank[a.tone] - toneRank[b.tone] || b.count - a.count);
  },
};
