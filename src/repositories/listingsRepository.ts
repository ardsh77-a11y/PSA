import { getDb } from '../db/connection.js';
import { newId } from '../util/ids.js';
import type { SqlValue } from 'node:sqlite';

/**
 * Listings repository (FEAT-005).
 *
 * A listing is a marketplace-ready draft generated from an inventory row. It
 * carries a search-optimized title, description, price, condition, SKU,
 * quantity, shipping and a JSON blob of item specifics (set/number/rarity/...).
 *
 * Status lifecycle (section 18): draft -> ready -> listed -> (ended | sold).
 * All methods are user-scoped for isolation.
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

/** Valid listing statuses, in lifecycle order. */
export const LISTING_STATUSES = ['draft', 'ready', 'listed', 'ended', 'sold'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

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
  item_specifics_json?: string;
  status?: string;
  shipping_cost?: number | null;
  published_at?: string | null;
}

/** Fields a client may update. Only provided keys are written. */
export interface UpdateListingInput {
  marketplace?: string | null;
  title?: string;
  description?: string | null;
  price?: number;
  condition?: string | null;
  sku?: string | null;
  quantity?: number;
  item_specifics_json?: string;
  status?: string;
  shipping_cost?: number | null;
  published_at?: string | null;
}

export interface ListingSearchFilters {
  status?: string;
  marketplace?: string;
  q?: string;
}

/** A listing joined with card display fields (for the management UI). */
export interface ListingRow extends Listing {
  card_name: string | null;
  card_number: string | null;
  set_name: string | null;
  set_abbreviation: string | null;
  card_image_url: string | null;
  inventory_status: string | null;
}

const ROW_SELECT = `
  SELECT
    l.*,
    c.name         AS card_name,
    c.number       AS card_number,
    c.image_url    AS card_image_url,
    s.name         AS set_name,
    s.abbreviation AS set_abbreviation,
    inv.status     AS inventory_status
  FROM listings l
  LEFT JOIN inventory inv ON inv.id = l.inventory_id
  LEFT JOIN cards c ON c.id = inv.card_id
  LEFT JOIN sets s ON s.id = c.set_id`;

export const listingsRepository = {
  getById(userId: string, id: string): ListingRow | undefined {
    return getDb()
      .prepare(`${ROW_SELECT} WHERE l.user_id = ? AND l.id = ?`)
      .get(userId, id) as ListingRow | undefined;
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

  /** User-scoped search with optional status/marketplace/text filters. */
  listByUser(userId: string, filters: ListingSearchFilters = {}): ListingRow[] {
    const clauses: string[] = ['l.user_id = ?'];
    const params: SqlValue[] = [userId];
    if (filters.status) {
      clauses.push('l.status = ?');
      params.push(filters.status);
    }
    if (filters.marketplace) {
      clauses.push('l.marketplace = ?');
      params.push(filters.marketplace);
    }
    if (filters.q && filters.q.trim()) {
      const term = `%${filters.q.trim()}%`;
      clauses.push('(l.title LIKE ? COLLATE NOCASE OR l.sku LIKE ? COLLATE NOCASE OR c.name LIKE ? COLLATE NOCASE)');
      params.push(term, term, term);
    }
    return getDb()
      .prepare(`${ROW_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY l.created_at DESC`)
      .all(...params) as ListingRow[];
  },

  /** Distinct statuses present for a user (for filter dropdowns). */
  distinctStatuses(userId: string): string[] {
    const rows = getDb()
      .prepare("SELECT DISTINCT status FROM listings WHERE user_id = ? AND status <> '' ORDER BY status")
      .all(userId) as Array<{ status: string }>;
    return rows.map((r) => r.status);
  },

  create(input: CreateListingInput): ListingRow {
    const db = getDb();
    const id = input.id ?? newId();
    db.prepare(
      `INSERT INTO listings
        (id, user_id, inventory_id, bulk_lot_id, marketplace, title, description, price, condition, sku, quantity, item_specifics_json, status, shipping_cost, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.item_specifics_json ?? '{}',
      input.status ?? 'draft',
      input.shipping_cost ?? null,
      input.published_at ?? null,
    );
    return this.getById(input.user_id, id)!;
  },

  /** Partial update; only provided, defined keys are written. */
  update(userId: string, id: string, patch: UpdateListingInput): ListingRow | undefined {
    const existing = this.getById(userId, id);
    if (!existing) return undefined;

    const sets: string[] = [];
    const params: SqlValue[] = [];
    const allowed: (keyof UpdateListingInput)[] = [
      'marketplace',
      'title',
      'description',
      'price',
      'condition',
      'sku',
      'quantity',
      'item_specifics_json',
      'status',
      'shipping_cost',
      'published_at',
    ];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(patch[key] as SqlValue);
      }
    }
    if (sets.length === 0) return existing;
    params.push(userId, id);
    getDb()
      .prepare(`UPDATE listings SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`)
      .run(...params);
    return this.getById(userId, id);
  },

  delete(userId: string, id: string): boolean {
    const res = getDb()
      .prepare('DELETE FROM listings WHERE user_id = ? AND id = ?')
      .run(userId, id);
    return res.changes > 0;
  },
};
