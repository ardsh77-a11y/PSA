import type { Router, RequestContext } from '../server/router.js';
import { json } from '../server/respond.js';
import type { ParsedBody } from '../server/middleware/bodyParser.js';
import { Validator } from './validation.js';
import { expensesRepository } from '../repositories/expensesRepository.js';

function requireUser(ctx: RequestContext): string | null {
  if (!ctx.user) {
    json(ctx.res, 401, { error: 'Authentication required.' });
    return null;
  }
  return ctx.user.id;
}

function bodyObject(ctx: RequestContext): Record<string, unknown> {
  const b = ctx.body as ParsedBody | undefined;
  if (!b) return {};
  if (b.json && typeof b.json === 'object') return b.json as Record<string, unknown>;
  return { ...b.fields };
}

/** Register the JSON expenses API (section 25). All endpoints session-scoped. */
export function registerExpensesApi(router: Router): void {
  // GET /api/expenses - list the user's expenses
  router.get('/api/expenses', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    json(ctx.res, 200, {
      expenses: expensesRepository.listByUser(userId),
      total: expensesRepository.totalForUser(userId),
    });
  });

  // POST /api/expenses { amount, type?, description?, incurred_at? }
  router.post('/api/expenses', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const src = bodyObject(ctx);
    const v = new Validator(src);
    const amount = v.optionalNumber('amount', 'Amount', { min: 0 });
    const type = v.optionalString('type');
    const description = v.optionalString('description');
    const incurredAt = v.optionalString('incurred_at');
    if (!v.valid) return json(ctx.res, 422, { errors: v.errors });
    if (amount === undefined) {
      return json(ctx.res, 422, { errors: { amount: 'Amount is required.' } });
    }
    const expense = expensesRepository.create({
      user_id: userId,
      amount,
      type: type ?? null,
      description: description ?? null,
      incurred_at: incurredAt ?? null,
    });
    json(ctx.res, 201, { expense });
  });

  // PUT / PATCH /api/expenses/:id - partial update
  const updateHandler = (ctx: RequestContext) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const existing = expensesRepository.getById(userId, ctx.params.id);
    if (!existing) return json(ctx.res, 404, { error: 'Not found.' });
    const src = bodyObject(ctx);
    const v = new Validator(src);
    const patch: Record<string, unknown> = {};
    if (v.has('amount')) patch.amount = v.optionalNumber('amount', 'Amount', { min: 0 });
    if (v.has('type')) patch.type = v.optionalString('type');
    if (v.has('description')) patch.description = v.optionalString('description');
    if (v.has('incurred_at')) patch.incurred_at = v.optionalString('incurred_at');
    if (!v.valid) return json(ctx.res, 422, { errors: v.errors });
    for (const key of Object.keys(patch)) {
      if (patch[key] === undefined) delete patch[key];
    }
    const expense = expensesRepository.update(userId, ctx.params.id, patch);
    json(ctx.res, 200, { expense });
  };
  router.put('/api/expenses/:id', updateHandler);
  router.patch('/api/expenses/:id', updateHandler);

  // DELETE /api/expenses/:id
  router.delete('/api/expenses/:id', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const deleted = expensesRepository.delete(userId, ctx.params.id);
    if (!deleted) return json(ctx.res, 404, { error: 'Not found.' });
    json(ctx.res, 200, { ok: true });
  });
}
