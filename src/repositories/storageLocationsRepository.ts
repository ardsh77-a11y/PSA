import { getDb } from '../db/connection.js';
import { newId } from '../util/ids.js';

/** A user-owned physical storage location (box / shelf / slot). */
export interface StorageLocation {
  id: string;
  user_id: string;
  box: string | null;
  shelf: string | null;
  slot: string | null;
  label: string | null;
}

export interface CreateStorageLocationInput {
  id?: string;
  user_id: string;
  box?: string | null;
  shelf?: string | null;
  slot?: string | null;
  label?: string | null;
}

/** Human-readable one-line description, e.g. "BOX-A · Shelf 2 · Slot 14". */
export function describeLocation(loc: Pick<StorageLocation, 'box' | 'shelf' | 'slot' | 'label'>): string {
  if (loc.label) return loc.label;
  const parts: string[] = [];
  if (loc.box) parts.push(loc.box);
  if (loc.shelf) parts.push(`Shelf ${loc.shelf}`);
  if (loc.slot) parts.push(`Slot ${loc.slot}`);
  return parts.join(' · ') || 'Unassigned';
}

/** Data access for storage_locations. All queries are user-scoped. */
export const storageLocationsRepository = {
  getById(userId: string, id: string): StorageLocation | undefined {
    return getDb()
      .prepare('SELECT * FROM storage_locations WHERE user_id = ? AND id = ?')
      .get(userId, id) as StorageLocation | undefined;
  },

  listForUser(userId: string): StorageLocation[] {
    return getDb()
      .prepare('SELECT * FROM storage_locations WHERE user_id = ? ORDER BY box, shelf, slot')
      .all(userId) as StorageLocation[];
  },

  create(input: CreateStorageLocationInput): StorageLocation {
    const db = getDb();
    const id = input.id ?? newId();
    db.prepare(
      `INSERT INTO storage_locations (id, user_id, box, shelf, slot, label)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, input.user_id, input.box ?? null, input.shelf ?? null, input.slot ?? null, input.label ?? null);
    return this.getById(input.user_id, id)!;
  },

  upsertById(input: CreateStorageLocationInput & { id: string }): StorageLocation {
    const db = getDb();
    db.prepare(
      `INSERT OR IGNORE INTO storage_locations (id, user_id, box, shelf, slot, label)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(input.id, input.user_id, input.box ?? null, input.shelf ?? null, input.slot ?? null, input.label ?? null);
    return this.getById(input.user_id, input.id)!;
  },

  /** Overwrite an existing location's fields (user-scoped). */
  updateById(input: CreateStorageLocationInput & { id: string }): StorageLocation | undefined {
    const existing = this.getById(input.user_id, input.id);
    if (!existing) return undefined;
    getDb()
      .prepare(
        `UPDATE storage_locations SET box = ?, shelf = ?, slot = ?, label = ?
         WHERE user_id = ? AND id = ?`,
      )
      .run(input.box ?? null, input.shelf ?? null, input.slot ?? null, input.label ?? null, input.user_id, input.id);
    return this.getById(input.user_id, input.id);
  },

  /** Delete a location (user-scoped). Inventory rows keep their column NULLed. */
  deleteById(userId: string, id: string): boolean {
    const res = getDb()
      .prepare('DELETE FROM storage_locations WHERE user_id = ? AND id = ?')
      .run(userId, id);
    return res.changes > 0;
  },
};
