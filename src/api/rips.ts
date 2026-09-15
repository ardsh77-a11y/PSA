import type { Router, RequestContext } from '../server/router.js';
import { json } from '../server/respond.js';
import type { ParsedBody } from '../server/middleware/bodyParser.js';
import { Validator } from './validation.js';
import { ripsRepository } from '../repositories/ripsRepository.js';
import { ripService } from '../services/ripService.js';

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

/** Register the JSON pack/rip tracking API (section 26). Session-scoped. */
export function registerRipsApi(router: Router): void {
  // GET /api/rips - list logged rips
  router.get('/api/rips', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    json(ctx.res, 200, { rips: ripsRepository.listByUser(userId) });
  });

  // POST /api/rips { product_name, packs?, box_cost?, cards_pulled?, estimated_pulled_value?, notes?, opened_at? }
  router.post('/api/rips', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const src = bodyObject(ctx);
    const v = new Validator(src);
    const productName = v.requiredString('product_name', 'Product name');
    const packs = v.optionalInt('packs', 'Packs', { min: 1 });
    const boxCost = v.optionalNumber('box_cost', 'Box cost', { min: 0 });
    const cardsPulled = v.optionalInt('cards_pulled', 'Cards pulled', { min: 0 });
    const pulledValue = v.optionalNumber('estimated_pulled_value', 'Pulled value', { min: 0 });
    const notes = v.optionalString('notes');
    const openedAt = v.optionalString('opened_at');
    if (!v.valid || !productName) return json(ctx.res, 422, { errors: v.errors });

    const rip = ripService.logRip(userId, {
      product_name: productName,
      packs,
      box_cost: boxCost,
      cards_pulled: cardsPulled,
      estimated_pulled_value: pulledValue,
      notes: notes ?? null,
      opened_at: openedAt ?? null,
    });
    json(ctx.res, 201, { rip });
  });

  // DELETE /api/rips/:id - also removes the linked acquisition expense
  router.delete('/api/rips/:id', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const deleted = ripService.deleteRip(userId, ctx.params.id);
    if (!deleted) return json(ctx.res, 404, { error: 'Not found.' });
    json(ctx.res, 200, { ok: true });
  });
}
