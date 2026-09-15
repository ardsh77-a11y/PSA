import { getDb } from '../db/connection.js';
import { newId } from '../util/ids.js';

/** Thin orders repository. Fully fleshed out in a later feature. */
export interface Order {
  id: string;
  user_id: string;
  marketplace: string | null;
  external_order_id: string | null;
  buyer: string | null;
  sale_price: number;
  fees: number;
  shipping: number;
  net_revenue: number;
  status: string;
  tracking_number: string | null;
  created_at: string;
  shipped_at: string | null;
}

export interface CreateOrderInput {
  id?: string;
  user_id: string;
  marketplace?: string | null;
  external_order_id?: string | null;
  buyer?: string | null;
  sale_price?: number;
  fees?: number;
  shipping?: number;
  net_revenue?: number;
  status?: string;
  tracking_number?: string | null;
  shipped_at?: string | null;
}

export const ordersRepository = {
  getById(userId: string, id: string): Order | undefined {
    return getDb()
      .prepare('SELECT * FROM orders WHERE user_id = ? AND id = ?')
      .get(userId, id) as Order | undefined;
  },

  countForUser(userId: string): number {
    const row = getDb()
      .prepare('SELECT COUNT(*) AS c FROM orders WHERE user_id = ?')
      .get(userId) as { c: number };
    return row.c;
  },

  create(input: CreateOrderInput): Order {
    const db = getDb();
    const id = input.id ?? newId();
    db.prepare(
      `INSERT INTO orders
        (id, user_id, marketplace, external_order_id, buyer, sale_price, fees, shipping, net_revenue, status, tracking_number, shipped_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.user_id,
      input.marketplace ?? null,
      input.external_order_id ?? null,
      input.buyer ?? null,
      input.sale_price ?? 0,
      input.fees ?? 0,
      input.shipping ?? 0,
      input.net_revenue ?? 0,
      input.status ?? 'pending',
      input.tracking_number ?? null,
      input.shipped_at ?? null,
    );
    return this.getById(input.user_id, id)!;
  },
};
