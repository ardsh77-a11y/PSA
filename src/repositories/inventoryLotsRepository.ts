import { getDb } from '../db/connection.js';
import { newId } from '../util/ids.js';
import type { SqlValue } from 'node:sqlite';

/**
 * Inventory-lots repository (FEAT-006).
 *
 * An inventory_lot is an *aggregate* of bulk cards the seller holds but does
 * not track individually: a category (e.g. "Bulk commons/uncommons"), a
 * quantity (card count) and an estimated value. The Bulk Lot Generator draws
 * from these aggregate pools; committing a bulk lot decrements the matching
 * pool's quantity so the same cards are never allocated twice.
 *
 * Every method is user-scoped for isolation.
 */
export interface InventoryLot {
  id: string;
  user_id: string;
  category: string | null;
  quantity: number;
  estimated_value: number | null;
  notes: string | null;
}

export interface CreateInventoryLotInput {
  id?: string;
  user_id: string;
  category?: string | null;
  quantity?: number;
  estimated_value?: number | null;
  notes?: string | null;
}

export interface UpdateInventoryLotInput {
  category?: string | null;
  quantity?: number;
  estimated_value?: number | null;
  notes?: string | null;
}

export const inventoryLotsRepository = {
  getById(userId: string, id: string): InventoryLot | undefined {
    return getDb()
      .prepare('SELECT * FROM inventory_lots WHERE user_id = ? AND id = ?')
      .get(userId, id) as InventoryLot | undefined;
  },

  listForUser(userId: string): InventoryLot[] {
    return getDb()
      .prepare('SELECT * FROM inventory_lots WHERE user_id = ? ORDER BY category')
      .all(userId) as InventoryLot[];
  },

  create(input: CreateInventoryLotInput): InventoryLot {
    const db = getDb();
    const id = input.id ?? newId();
    db.prepare(
      `INSERT INTO inventory_lots (id, user_id, category, quantity, estimated_value, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.user_id,
      input.category ?? null,
      input.quantity ?? 0,
      input.estimated_value ?? null,
      input.notes ?? null,
    );
    return this.getById(input.user_id, id)!;
  },

  update(userId: string, id: string, patch: UpdateInventoryLotInput): InventoryLot | undefined {
    const existing = this.getById(userId, id);
    if (!existing) return undefined;
    const sets: string[] = [];
    const params: SqlValue[] = [];
    const allowed: (keyof UpdateInventoryLotInput)[] = ['category', 'quantity', 'estimated_value', 'notes'];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(patch[key] as SqlValue);
      }
    }
    if (sets.length === 0) return existing;
    params.push(userId, id);
    getDb()
      .prepare(`UPDATE inventory_lots SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`)
      .run(...params);
    return this.getById(userId, id);
  },

  /**
   * Decrement a lot's available quantity by `amount`, clamped at 0 so the pool
   * never goes negative. Returns the actual amount removed (which may be less
   * than requested if the pool was short) or 0 if the lot is missing.
   */
  decrementQuantity(userId: string, id: string, amount: number): number {
    const existing = this.getById(userId, id);
    if (!existing) return 0;
    const removed = Math.max(0, Math.min(amount, existing.quantity));
    if (removed === 0) return 0;
    getDb()
      .prepare('UPDATE inventory_lots SET quantity = quantity - ? WHERE user_id = ? AND id = ?')
      .run(removed, userId, id);
    return removed;
  },

  delete(userId: string, id: string): boolean {
    const res = getDb().prepare('DELETE FROM inventory_lots WHERE user_id = ? AND id = ?').run(userId, id);
    return res.changes > 0;
  },
};
