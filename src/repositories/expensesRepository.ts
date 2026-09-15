import { getDb } from '../db/connection.js';
import { newId } from '../util/ids.js';
import type { SqlValue } from 'node:sqlite';

/**
 * Expenses repository (FEAT-007). Business costs the seller incurs (supplies,
 * shipping materials, product/box purchases, marketplace fees, etc.). Pack/rip
 * acquisition costs are stored here too, so they allocate into profit as
 * "other expenses". These rows feed the profit/analytics views (FEAT-008).
 */
export interface Expense {
  id: string;
  user_id: string;
  type: string | null;
  description: string | null;
  amount: number;
  incurred_at: string;
}

/** Common expense categories surfaced in the UI (free-form allowed). */
export const EXPENSE_TYPES = ['Supplies', 'Shipping', 'Product', 'Fees', 'Rip', 'Other'] as const;

export interface CreateExpenseInput {
  id?: string;
  user_id: string;
  type?: string | null;
  description?: string | null;
  amount?: number;
  incurred_at?: string | null;
}

export interface UpdateExpenseInput {
  type?: string | null;
  description?: string | null;
  amount?: number;
  incurred_at?: string | null;
}

export const expensesRepository = {
  getById(userId: string, id: string): Expense | undefined {
    return getDb()
      .prepare('SELECT * FROM expenses WHERE user_id = ? AND id = ?')
      .get(userId, id) as Expense | undefined;
  },

  listByUser(userId: string): Expense[] {
    return getDb()
      .prepare('SELECT * FROM expenses WHERE user_id = ? ORDER BY incurred_at DESC, id DESC')
      .all(userId) as Expense[];
  },

  countForUser(userId: string): number {
    const row = getDb()
      .prepare('SELECT COUNT(*) AS c FROM expenses WHERE user_id = ?')
      .get(userId) as { c: number };
    return row.c;
  },

  /** Total expense amount for a user (feeds profit/analytics). */
  totalForUser(userId: string): number {
    const row = getDb()
      .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE user_id = ?')
      .get(userId) as { total: number };
    return row.total;
  },

  create(input: CreateExpenseInput): Expense {
    const db = getDb();
    const id = input.id ?? newId();
    db.prepare(
      `INSERT INTO expenses (id, user_id, type, description, amount, incurred_at)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
    ).run(
      id,
      input.user_id,
      input.type ?? null,
      input.description ?? null,
      input.amount ?? 0,
      input.incurred_at ?? null,
    );
    return this.getById(input.user_id, id)!;
  },

  /** Partial update; only provided, defined keys are written. */
  update(userId: string, id: string, patch: UpdateExpenseInput): Expense | undefined {
    const existing = this.getById(userId, id);
    if (!existing) return undefined;
    const sets: string[] = [];
    const params: SqlValue[] = [];
    const allowed: (keyof UpdateExpenseInput)[] = ['type', 'description', 'amount', 'incurred_at'];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(patch[key] as SqlValue);
      }
    }
    if (sets.length === 0) return existing;
    params.push(userId, id);
    getDb()
      .prepare(`UPDATE expenses SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`)
      .run(...params);
    return this.getById(userId, id);
  },

  delete(userId: string, id: string): boolean {
    const res = getDb()
      .prepare('DELETE FROM expenses WHERE user_id = ? AND id = ?')
      .run(userId, id);
    return res.changes > 0;
  },
};
