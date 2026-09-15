import { getDb } from '../db/connection.js';
import { salesRepository } from '../repositories/salesRepository.js';
import { settingsService } from './settings.js';
import { mockPricingEngine } from './mock/mockPricingEngine.js';

/**
 * Dashboard KPI service (FEAT-008, section 5).
 *
 * Computes the headline metrics for a user's seller operation, each paired with
 * a short supporting-context string (e.g. "173 cards waiting to be listed") so
 * the Dashboard reads like a briefing rather than a wall of numbers. Everything
 * is scoped to the user and computed with SQL over node:sqlite, except the
 * projected profit on unsold inventory which reuses the pricing engine.
 *
 * Statuses (section 9): Unprocessed, Identified, Reviewed, Ready to List,
 * Listed, Sold. "Unlisted" means anything not yet Listed and not Sold.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function money(n: number): string {
  return `$${round2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function plural(n: number, one: string, many = one + 's'): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

/** A single KPI: a value, a preformatted display string, and its context. */
export interface Kpi {
  key: string;
  label: string;
  value: number;
  display: string;
  context: string;
}

export interface DashboardKpis {
  totalInventoryValue: Kpi;
  unlistedInventoryValue: Kpi;
  listedInventoryValue: Kpi;
  estimatedProfit: Kpi;
  cardsInInventory: Kpi;
  cardsSold: Kpi;
  revenue: Kpi;
  pendingOrders: Kpi;
}

interface ValueCount {
  value: number;
  cards: number;
}

/** Sum market_value*quantity + card count for rows matching a status filter. */
function inventoryValueWhere(userId: string, clause: string): ValueCount {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(market_value, 0) * quantity), 0) AS value,
              COALESCE(SUM(quantity), 0) AS cards
       FROM inventory WHERE user_id = ? ${clause}`,
    )
    .get(userId) as { value: number; cards: number };
  return { value: round2(row.value), cards: row.cards };
}

/**
 * Projected net profit on UNSOLD inventory: for each unsold row, price the card
 * at the user's mode/condition and take the estimated net. Reused from the
 * pricing engine so a real price feed changes this without code edits.
 */
function projectedUnsoldNet(userId: string): number {
  const settings = settingsService.getPricingSettings(userId);
  const rows = getDb()
    .prepare(
      `SELECT card_id, condition, quantity
       FROM inventory
       WHERE user_id = ? AND status <> 'Sold' AND card_id IS NOT NULL`,
    )
    .all(userId) as Array<{ card_id: string; condition: string; quantity: number }>;
  let net = 0;
  for (const r of rows) {
    const priced = mockPricingEngine.priceCard(
      { cardId: r.card_id, condition: r.condition, mode: settings.pricingMode },
      settings,
    );
    if (priced) net += priced.estimatedNet * (r.quantity ?? 1);
  }
  return round2(net);
}

export const dashboardService = {
  /** Compute all section-5 KPIs for a user, each with supporting context. */
  getKpis(userId: string): DashboardKpis {
    const total = inventoryValueWhere(userId, '');
    const unlisted = inventoryValueWhere(userId, "AND status NOT IN ('Listed', 'Sold')");
    const listed = inventoryValueWhere(userId, "AND status = 'Listed'");

    const salesAgg = salesRepository.aggregate(userId);
    const projectedNet = projectedUnsoldNet(userId);
    const estimatedProfit = round2(salesAgg.totalNetProfit + projectedNet);

    const pending = (
      getDb()
        .prepare(
          `SELECT COUNT(*) AS c FROM orders
           WHERE user_id = ? AND status NOT IN ('Delivered', 'Cancelled')`,
        )
        .get(userId) as { c: number }
    ).c;

    return {
      totalInventoryValue: {
        key: 'totalInventoryValue',
        label: 'Total inventory value',
        value: total.value,
        display: money(total.value),
        context: `${plural(total.cards, 'card')} across all statuses`,
      },
      unlistedInventoryValue: {
        key: 'unlistedInventoryValue',
        label: 'Unlisted inventory value',
        value: unlisted.value,
        display: money(unlisted.value),
        context: `${plural(unlisted.cards, 'card')} waiting to be listed`,
      },
      listedInventoryValue: {
        key: 'listedInventoryValue',
        label: 'Listed inventory value',
        value: listed.value,
        display: money(listed.value),
        context: `${plural(listed.cards, 'card')} live on marketplaces`,
      },
      estimatedProfit: {
        key: 'estimatedProfit',
        label: 'Estimated profit',
        value: estimatedProfit,
        display: money(estimatedProfit),
        context: `${money(salesAgg.totalNetProfit)} realized + ${money(projectedNet)} projected on unsold`,
      },
      cardsInInventory: {
        key: 'cardsInInventory',
        label: 'Cards in inventory',
        value: total.cards,
        display: total.cards.toLocaleString('en-US'),
        context: `${money(total.value)} total value`,
      },
      cardsSold: {
        key: 'cardsSold',
        label: 'Cards sold',
        value: salesAgg.count,
        display: salesAgg.count.toLocaleString('en-US'),
        context: salesAgg.count > 0 ? `${money(salesAgg.totalNetProfit)} net profit realized` : 'No sales recorded yet',
      },
      revenue: {
        key: 'revenue',
        label: 'Revenue',
        value: round2(salesAgg.totalRevenue),
        display: money(salesAgg.totalRevenue),
        context: `Across ${plural(salesAgg.count, 'sale')}`,
      },
      pendingOrders: {
        key: 'pendingOrders',
        label: 'Pending orders',
        value: pending,
        display: pending.toLocaleString('en-US'),
        context: pending > 0 ? `${plural(pending, 'order')} awaiting fulfillment` : 'All caught up',
      },
    };
  },

  /**
   * The inventory value breakdown that drives the Dashboard chart:
   * unlisted (not Listed/Sold) vs listed vs bulk (aggregate lots + itemized
   * bulk). Sold value is excluded so the chart reflects live holdings.
   */
  inventoryValueBreakdown(userId: string): Array<{ label: string; value: number }> {
    const db = getDb();
    const unlisted = inventoryValueWhere(userId, "AND status NOT IN ('Listed', 'Sold') AND (classification IS NULL OR LOWER(classification) <> 'bulk')");
    const listed = inventoryValueWhere(userId, "AND status = 'Listed'");
    const bulkItemized = (
      db
        .prepare(
          `SELECT COALESCE(SUM(COALESCE(market_value, 0) * quantity), 0) AS v
           FROM inventory WHERE user_id = ? AND status <> 'Sold' AND LOWER(classification) = 'bulk'`,
        )
        .get(userId) as { v: number }
    ).v;
    const bulkLots = (
      db
        .prepare('SELECT COALESCE(SUM(estimated_value), 0) AS v FROM inventory_lots WHERE user_id = ?')
        .get(userId) as { v: number }
    ).v;
    return [
      { label: 'Unlisted', value: round2(unlisted.value) },
      { label: 'Listed', value: round2(listed.value) },
      { label: 'Bulk', value: round2(bulkItemized + bulkLots) },
    ];
  },

  /**
   * A merged recent-activity feed: scans, listings created, cards sold, orders
   * shipped and inventory added, newest first. Each entry is a small,
   * display-ready record so the Dashboard can render it without more queries.
   */
  recentActivity(userId: string, limit = 12): Array<{ kind: string; icon: string; label: string; detail: string; at: string; href: string }> {
    const db = getDb();
    type Row = { kind: string; label: string; detail: string; at: string; href: string };
    const items: Row[] = [];

    const sales = db
      .prepare(
        `SELECT sa.sold_at AS at, sa.sale_price AS price, c.name AS card_name, sa.order_id AS order_id
         FROM sales sa LEFT JOIN cards c ON c.id = sa.card_id
         WHERE sa.user_id = ? ORDER BY sa.sold_at DESC LIMIT ?`,
      )
      .all(userId, limit) as Array<{ at: string; price: number; card_name: string | null; order_id: string | null }>;
    for (const s of sales) {
      items.push({
        kind: 'sale',
        label: `Sold ${s.card_name ?? 'a card'}`,
        detail: `${money(s.price)} sale`,
        at: s.at,
        href: s.order_id ? `/orders/${s.order_id}` : '/orders',
      });
    }

    const orders = db
      .prepare(
        `SELECT id, shipped_at AS at, buyer FROM orders
         WHERE user_id = ? AND shipped_at IS NOT NULL ORDER BY shipped_at DESC LIMIT ?`,
      )
      .all(userId, limit) as Array<{ id: string; at: string; buyer: string | null }>;
    for (const o of orders) {
      items.push({
        kind: 'shipped',
        label: 'Order shipped',
        detail: o.buyer ? `to ${o.buyer}` : 'fulfilled',
        at: o.at,
        href: `/orders/${o.id}`,
      });
    }

    const listings = db
      .prepare(
        `SELECT l.id, l.created_at AS at, l.title FROM listings l
         WHERE l.user_id = ? ORDER BY l.created_at DESC LIMIT ?`,
      )
      .all(userId, limit) as Array<{ id: string; at: string; title: string }>;
    for (const l of listings) {
      items.push({
        kind: 'listing',
        label: 'Listing created',
        detail: l.title,
        at: l.at,
        href: '/listings',
      });
    }

    const scans = db
      .prepare(
        `SELECT id, created_at AS at, detected_count FROM scans
         WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(userId, limit) as Array<{ id: string; at: string; detected_count: number }>;
    for (const s of scans) {
      items.push({
        kind: 'scan',
        label: 'Cards scanned',
        detail: `${plural(s.detected_count, 'card')} detected`,
        at: s.at,
        href: '/scan',
      });
    }

    const added = db
      .prepare(
        `SELECT i.id, i.created_at AS at, c.name AS card_name FROM inventory i
         LEFT JOIN cards c ON c.id = i.card_id
         WHERE i.user_id = ? ORDER BY i.created_at DESC LIMIT ?`,
      )
      .all(userId, limit) as Array<{ id: string; at: string; card_name: string | null }>;
    for (const a of added) {
      items.push({
        kind: 'inventory',
        label: 'Inventory added',
        detail: a.card_name ?? 'a card',
        at: a.at,
        href: `/inventory`,
      });
    }

    const icons: Record<string, string> = {
      sale: 'coin',
      shipped: 'cart',
      listing: 'tag',
      scan: 'camera',
      inventory: 'box',
    };

    return items
      .filter((i) => i.at)
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, limit)
      .map((i) => ({ ...i, icon: icons[i.kind] ?? 'grid' }));
  },
};

export { money as formatMoney };
