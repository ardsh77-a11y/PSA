import { getDb } from '../db/connection.js';
import { newId } from '../util/ids.js';

/** A raw scan row. Scans are user-owned (per-user isolation). */
export interface Scan {
  id: string;
  user_id: string;
  image_ref: string | null;
  status: string;
  detected_count: number;
  created_at: string;
}

export interface CreateScanInput {
  id?: string;
  user_id: string;
  image_ref?: string | null;
  status?: string;
  detected_count?: number;
}

/** Data access for scans. Every method is user-scoped. */
export const scansRepository = {
  create(input: CreateScanInput): Scan {
    const db = getDb();
    const id = input.id ?? newId();
    db.prepare(
      `INSERT INTO scans (id, user_id, image_ref, status, detected_count)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.user_id,
      input.image_ref ?? null,
      input.status ?? 'processing',
      input.detected_count ?? 0,
    );
    return this.getById(input.user_id, id)!;
  },

  getById(userId: string, id: string): Scan | undefined {
    return getDb()
      .prepare('SELECT * FROM scans WHERE user_id = ? AND id = ?')
      .get(userId, id) as Scan | undefined;
  },

  /** Update a scan's status and/or detected_count. Only provided keys write. */
  update(
    userId: string,
    id: string,
    patch: { status?: string; detected_count?: number },
  ): Scan | undefined {
    const existing = this.getById(userId, id);
    if (!existing) return undefined;
    const sets: string[] = [];
    const params: (string | number)[] = [];
    if (patch.status !== undefined) {
      sets.push('status = ?');
      params.push(patch.status);
    }
    if (patch.detected_count !== undefined) {
      sets.push('detected_count = ?');
      params.push(patch.detected_count);
    }
    if (sets.length === 0) return existing;
    params.push(userId, id);
    getDb()
      .prepare(`UPDATE scans SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`)
      .run(...params);
    return this.getById(userId, id);
  },

  /** Most recent scans for a user, newest first. */
  listForUser(userId: string, limit = 50): Scan[] {
    return getDb()
      .prepare('SELECT * FROM scans WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
      .all(userId, limit) as Scan[];
  },

  delete(userId: string, id: string): boolean {
    const res = getDb()
      .prepare('DELETE FROM scans WHERE user_id = ? AND id = ?')
      .run(userId, id);
    return res.changes > 0;
  },
};
