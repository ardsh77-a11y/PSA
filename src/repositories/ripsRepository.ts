import { getDb } from '../db/connection.js';
import { newId } from '../util/ids.js';

/**
 * Rips repository (FEAT-007, section 26). A "rip" records a sealed product that
 * was opened: the product name, how many packs, the box/case cost, how many
 * cards were pulled, the estimated total pulled value and the derived estimated
 * profit (pulled value - box cost). The acquisition cost is also recorded as an
 * expense (linked via expense_id) so it allocates into profit.
 */
export interface Rip {
  id: string;
  user_id: string;
  product_name: string;
  packs: number;
  box_cost: number;
  cards_pulled: number;
  estimated_pulled_value: number;
  estimated_profit: number;
  expense_id: string | null;
  notes: string | null;
  opened_at: string;
  created_at: string;
}

export interface CreateRipInput {
  id?: string;
  user_id: string;
  product_name: string;
  packs?: number;
  box_cost?: number;
  cards_pulled?: number;
  estimated_pulled_value?: number;
  estimated_profit?: number;
  expense_id?: string | null;
  notes?: string | null;
  opened_at?: string | null;
}

export const ripsRepository = {
  getById(userId: string, id: string): Rip | undefined {
    return getDb()
      .prepare('SELECT * FROM rips WHERE user_id = ? AND id = ?')
      .get(userId, id) as Rip | undefined;
  },

  listByUser(userId: string): Rip[] {
    return getDb()
      .prepare('SELECT * FROM rips WHERE user_id = ? ORDER BY opened_at DESC, id DESC')
      .all(userId) as Rip[];
  },

  countForUser(userId: string): number {
    const row = getDb()
      .prepare('SELECT COUNT(*) AS c FROM rips WHERE user_id = ?')
      .get(userId) as { c: number };
    return row.c;
  },

  create(input: CreateRipInput): Rip {
    const db = getDb();
    const id = input.id ?? newId();
    db.prepare(
      `INSERT INTO rips
        (id, user_id, product_name, packs, box_cost, cards_pulled, estimated_pulled_value, estimated_profit, expense_id, notes, opened_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
    ).run(
      id,
      input.user_id,
      input.product_name,
      input.packs ?? 1,
      input.box_cost ?? 0,
      input.cards_pulled ?? 0,
      input.estimated_pulled_value ?? 0,
      input.estimated_profit ?? 0,
      input.expense_id ?? null,
      input.notes ?? null,
      input.opened_at ?? null,
    );
    return this.getById(input.user_id, id)!;
  },

  delete(userId: string, id: string): boolean {
    const res = getDb()
      .prepare('DELETE FROM rips WHERE user_id = ? AND id = ?')
      .run(userId, id);
    return res.changes > 0;
  },
};
