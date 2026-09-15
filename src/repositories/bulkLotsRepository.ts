import { getDb } from '../db/connection.js';
import { newId } from '../util/ids.js';
import type { SqlValue } from 'node:sqlite';

/**
 * Bulk-lots repository (FEAT-006).
 *
 * A bulk_lot is a packaged group of bulk cards the seller intends to sell as a
 * single lot (e.g. a 500-card commons lot). It carries the source category, a
 * card_count, a generated title/description/suggested_price/sku, a JSON blob of
 * guarantees (min rares, english only, ...) and a status
 * (draft -> listed). Committing a lot decrements the matching inventory_lot
 * pool so the same cards are never double-allocated.
 *
 * Every method is user-scoped for isolation.
 */
export interface BulkLot {
  id: string;
  user_id: string;
  category: string | null;
  card_count: number;
  title: string | null;
  description: string | null;
  suggested_price: number | null;
  sku: string | null;
  guarantees_json: string;
  status: string;
  created_at: string;
}

/** Valid bulk-lot statuses, in lifecycle order. */
export const BULK_LOT_STATUSES = ['draft', 'listed', 'sold'] as const;
export type BulkLotStatus = (typeof BULK_LOT_STATUSES)[number];

export interface CreateBulkLotInput {
  id?: string;
  user_id: string;
  category?: string | null;
  card_count?: number;
  title?: string | null;
  description?: string | null;
  suggested_price?: number | null;
  sku?: string | null;
  guarantees_json?: string;
  status?: string;
}

export interface UpdateBulkLotInput {
  category?: string | null;
  card_count?: number;
  title?: string | null;
  description?: string | null;
  suggested_price?: number | null;
  sku?: string | null;
  guarantees_json?: string;
  status?: string;
}

export const bulkLotsRepository = {
  getById(userId: string, id: string): BulkLot | undefined {
    return getDb()
      .prepare('SELECT * FROM bulk_lots WHERE user_id = ? AND id = ?')
      .get(userId, id) as BulkLot | undefined;
  },

  listForUser(userId: string): BulkLot[] {
    return getDb()
      .prepare('SELECT * FROM bulk_lots WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId) as BulkLot[];
  },

  countForUser(userId: string): number {
    const row = getDb()
      .prepare('SELECT COUNT(*) AS c FROM bulk_lots WHERE user_id = ?')
      .get(userId) as { c: number };
    return row.c;
  },

  create(input: CreateBulkLotInput): BulkLot {
    const db = getDb();
    const id = input.id ?? newId();
    db.prepare(
      `INSERT INTO bulk_lots
        (id, user_id, category, card_count, title, description, suggested_price, sku, guarantees_json, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.user_id,
      input.category ?? null,
      input.card_count ?? 0,
      input.title ?? null,
      input.description ?? null,
      input.suggested_price ?? null,
      input.sku ?? null,
      input.guarantees_json ?? '{}',
      input.status ?? 'draft',
    );
    return this.getById(input.user_id, id)!;
  },

  update(userId: string, id: string, patch: UpdateBulkLotInput): BulkLot | undefined {
    const existing = this.getById(userId, id);
    if (!existing) return undefined;
    const sets: string[] = [];
    const params: SqlValue[] = [];
    const allowed: (keyof UpdateBulkLotInput)[] = [
      'category',
      'card_count',
      'title',
      'description',
      'suggested_price',
      'sku',
      'guarantees_json',
      'status',
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
      .prepare(`UPDATE bulk_lots SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`)
      .run(...params);
    return this.getById(userId, id);
  },

  delete(userId: string, id: string): boolean {
    const res = getDb().prepare('DELETE FROM bulk_lots WHERE user_id = ? AND id = ?').run(userId, id);
    return res.changes > 0;
  },
};
