import { getDb } from '../db/connection.js';
import { newId } from '../util/ids.js';

/**
 * Sales repository (FEAT-007). A sale is the realized-revenue record created
 * when an order reaches Shipped/Delivered: it captures the sale price, fees,
 * shipping, cost basis and net profit for a single sold item. These rows feed
 * the profit/analytics views (FEAT-008).
 */
export interface Sale {
  id: string;
  user_id: string;
  order_id: string | null;
  inventory_id: string | null;
  card_id: string | null;
  sale_price: number;
  fees: number;
  shipping: number;
  cost_basis: number;
  net_profit: number;
  sold_at: string;
}

/** A sale joined with card/set fields for display. */
export interface SaleRow extends Sale {
  card_name: string | null;
  card_number: string | null;
  set_name: string | null;
  card_image_url: string | null;
}

export interface CreateSaleInput {
  id?: string;
  user_id: string;
  order_id?: string | null;
  inventory_id?: string | null;
  card_id?: string | null;
  sale_price?: number;
  fees?: number;
  shipping?: number;
  cost_basis?: number;
  net_profit?: number;
  sold_at?: string | null;
}

/** Aggregate totals across a user's sales (for dashboards / analytics). */
export interface SalesAggregate {
  count: number;
  totalRevenue: number;
  totalFees: number;
  totalShipping: number;
  totalCostBasis: number;
  totalNetProfit: number;
}

const ROW_SELECT = `
  SELECT
    sa.*,
    c.name         AS card_name,
    c.number       AS card_number,
    c.image_url    AS card_image_url,
    s.name         AS set_name
  FROM sales sa
  LEFT JOIN cards c ON c.id = sa.card_id
  LEFT JOIN sets s ON s.id = c.set_id`;

export const salesRepository = {
  getById(userId: string, id: string): Sale | undefined {
    return getDb()
      .prepare('SELECT * FROM sales WHERE user_id = ? AND id = ?')
      .get(userId, id) as Sale | undefined;
  },

  listForInventory(userId: string, inventoryId: string): Sale[] {
    return getDb()
      .prepare('SELECT * FROM sales WHERE user_id = ? AND inventory_id = ? ORDER BY sold_at DESC')
      .all(userId, inventoryId) as Sale[];
  },

  listForOrder(userId: string, orderId: string): Sale[] {
    return getDb()
      .prepare('SELECT * FROM sales WHERE user_id = ? AND order_id = ? ORDER BY sold_at DESC')
      .all(userId, orderId) as Sale[];
  },

  /** User-scoped list of sales joined for display, newest first. */
  listByUser(userId: string): SaleRow[] {
    return getDb()
      .prepare(`${ROW_SELECT} WHERE sa.user_id = ? ORDER BY sa.sold_at DESC, sa.id DESC`)
      .all(userId) as SaleRow[];
  },

  countForUser(userId: string): number {
    const row = getDb()
      .prepare('SELECT COUNT(*) AS c FROM sales WHERE user_id = ?')
      .get(userId) as { c: number };
    return row.c;
  },

  /** Aggregate revenue/fees/shipping/cost/profit totals for a user. */
  aggregate(userId: string): SalesAggregate {
    const row = getDb()
      .prepare(
        `SELECT
           COUNT(*) AS count,
           COALESCE(SUM(sale_price), 0) AS totalRevenue,
           COALESCE(SUM(fees), 0) AS totalFees,
           COALESCE(SUM(shipping), 0) AS totalShipping,
           COALESCE(SUM(cost_basis), 0) AS totalCostBasis,
           COALESCE(SUM(net_profit), 0) AS totalNetProfit
         FROM sales WHERE user_id = ?`,
      )
      .get(userId) as SalesAggregate;
    return row;
  },

  create(input: CreateSaleInput): Sale {
    const db = getDb();
    const id = input.id ?? newId();
    db.prepare(
      `INSERT INTO sales
        (id, user_id, order_id, inventory_id, card_id, sale_price, fees, shipping, cost_basis, net_profit, sold_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
    ).run(
      id,
      input.user_id,
      input.order_id ?? null,
      input.inventory_id ?? null,
      input.card_id ?? null,
      input.sale_price ?? 0,
      input.fees ?? 0,
      input.shipping ?? 0,
      input.cost_basis ?? 0,
      input.net_profit ?? 0,
      input.sold_at ?? null,
    );
    return getDb().prepare('SELECT * FROM sales WHERE id = ?').get(id) as Sale;
  },
};
