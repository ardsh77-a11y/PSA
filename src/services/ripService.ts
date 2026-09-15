import { ripsRepository, type Rip } from '../repositories/ripsRepository.js';
import { expensesRepository } from '../repositories/expensesRepository.js';

/**
 * Pack/rip tracking (section 26). Logging a rip records the sealed product that
 * was opened and computes the estimated profit as:
 *
 *   estimated profit = estimated pulled value - box/case cost
 *
 * Section-26 worked example: a $105 box of 36 packs that pulled $142 of cards
 * nets $37 estimated profit.
 *
 * The box cost is also written to the expenses ledger (as an acquisition cost)
 * so it allocates into overall profit; the rip row links to that expense.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface LogRipInput {
  product_name: string;
  packs?: number;
  box_cost?: number;
  cards_pulled?: number;
  estimated_pulled_value?: number;
  notes?: string | null;
  opened_at?: string | null;
}

/** Compute the estimated profit for a rip: pulled value minus box cost. */
export function estimateRipProfit(estimatedPulledValue: number, boxCost: number): number {
  return round2((estimatedPulledValue ?? 0) - (boxCost ?? 0));
}

export const ripService = {
  estimateRipProfit,

  /**
   * Log a rip: derive the estimated profit, record the box cost as an expense,
   * and persist the rip row (linked to that expense). Returns the created rip.
   */
  logRip(userId: string, input: LogRipInput): Rip {
    const boxCost = round2(Math.max(0, input.box_cost ?? 0));
    const pulledValue = round2(Math.max(0, input.estimated_pulled_value ?? 0));
    const estimatedProfit = estimateRipProfit(pulledValue, boxCost);
    const packs = Math.max(1, Math.floor(input.packs ?? 1));
    const cardsPulled = Math.max(0, Math.floor(input.cards_pulled ?? 0));

    // Record the acquisition cost as an expense so it feeds profit tracking.
    let expenseId: string | null = null;
    if (boxCost > 0) {
      const expense = expensesRepository.create({
        user_id: userId,
        type: 'Rip',
        description: `Opened: ${input.product_name}`,
        amount: boxCost,
        incurred_at: input.opened_at ?? null,
      });
      expenseId = expense.id;
    }

    return ripsRepository.create({
      user_id: userId,
      product_name: input.product_name,
      packs,
      box_cost: boxCost,
      cards_pulled: cardsPulled,
      estimated_pulled_value: pulledValue,
      estimated_profit: estimatedProfit,
      expense_id: expenseId,
      notes: input.notes ?? null,
      opened_at: input.opened_at ?? null,
    });
  },

  /** Delete a rip and its linked acquisition expense (user-scoped). */
  deleteRip(userId: string, id: string): boolean {
    const rip = ripsRepository.getById(userId, id);
    if (!rip) return false;
    if (rip.expense_id) {
      expensesRepository.delete(userId, rip.expense_id);
    }
    return ripsRepository.delete(userId, id);
  },
};
