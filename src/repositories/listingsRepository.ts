import { getDb } from '../db/connection.js';
import { newId } from '../util/ids.js';

/**
 * Thin listings repository. Full listing generation/publishing lands in a later
 * feature; for now we support the reads needed by the Card Detail page plus a
 * basic create used by the demo seed.
 */
export interface Listing {
  id: string;
  user_id: string;
  inventory_id: string | null;
  bulk_lot_id: string | null;
  marketplace: string | null;
  title: string;
  description: string | null;
  price: number;
  condition: string | null;
  sku: string | null;
  quantity: number;
  item_specifics_json: string;
  status: string;
  shipping_cost: number | null;
  created_at: string;
  published_at: string | null;
}

export interface CreateListingInput {
  id?: string;
  user_id: string;
  inventory_id?: string | null;
  bulk_lot_id?: string | null;
  marketplace?: string | null;
  title: string;
  description?: string | null;
  price?: number;
  condition?: string | null;
  sku?: string | null;
  quantity?: number;
  status?: string;
  shipping_cost?: number | null;
  published_at?: string | null;
}

export const listingsRepository = {
  getById(userId: string, id: string): Listing | undefined {
    return getDb()
      .prepare('SELECT * FROM listings WHERE user_id = ? AND id = ?')
      .get(userId, id) as Listing | undefined;
  },

  listForInventory(userId: string, inventoryId: string): Listing[] {
    return getDb()
      .prepare('SELECT * FROM listings WHERE user_id = ? AND inventory_id = ? ORDER BY created_at DESC')
      .all(userId, inventoryId) as Listing[];
  },

  countForUser(userId: string): number {
    const row = getDb()
      .prepare('SELECT COUNT(*) AS c FROM listings WHERE user_id = ?')
      .get(userId) as { c: number };
    return row.c;
  },

  create(input: CreateListingInput): Listing {
    const db = getDb();
    const id = input.id ?? newId();
    db.prepare(
      `INSERT INTO listings
        (id, user_id, inventory_id, bulk_lot_id, marketplace, title, description, price, condition, sku, quantity, status, shipping_cost, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.user_id,
      input.inventory_id ?? null,
      input.bulk_lot_id ?? null,
      input.marketplace ?? null,
      input.title,
      input.description ?? null,
      input.price ?? 0,
      input.condition ?? null,
      input.sku ?? null,
      input.quantity ?? 1,
      input.status ?? 'draft',
      input.shipping_cost ?? null,
      input.published_at ?? null,
    );
    return this.getById(input.user_id, id)!;
  },
};
