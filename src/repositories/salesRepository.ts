import { getDb } from '../db/connection.js';
import { newId } from '../util/ids.js';

/** Thin sales repository. Analytics wiring comes in a later feature. */
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

export const salesRepository = {
  listForInventory(userId: string, inventoryId: string): Sale[] {
    return getDb()
      .prepare('SELECT * FROM sales WHERE user_id = ? AND inventory_id = ? ORDER BY sold_at DESC')
      .all(userId, inventoryId) as Sale[];
  },

  countForUser(userId: string): number {
    const row = getDb()
      .prepare('SELECT COUNT(*) AS c FROM sales WHERE user_id = ?')
      .get(userId) as { c: number };
    return row.c;
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
