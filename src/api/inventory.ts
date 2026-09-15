import type { Router, RequestContext } from '../server/router.js';
import { json } from '../server/respond.js';
import type { ParsedBody } from '../server/middleware/bodyParser.js';
import {
  inventoryRepository,
  type InventorySearchParams,
} from '../repositories/inventoryRepository.js';
import { Validator } from './validation.js';
import { INVENTORY_STATUSES } from '../domain/tcg.js';

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

function numberOrUndefined(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Build search params from the request query string. */
export function searchParamsFromQuery(query: Record<string, string>): InventorySearchParams {
  return {
    q: query.q || undefined,
    setId: query.setId || undefined,
    rarity: query.rarity || undefined,
    condition: query.condition || undefined,
    status: query.status || undefined,
    sku: query.sku || undefined,
    storageLocationId: query.storageLocationId || undefined,
    classification: query.classification || undefined,
    minPrice: numberOrUndefined(query.minPrice),
    maxPrice: numberOrUndefined(query.maxPrice),
    sort: query.sort || undefined,
    page: numberOrUndefined(query.page),
    pageSize: numberOrUndefined(query.pageSize),
  };
}

/** Register the JSON inventory API. All endpoints are session-scoped. */
export function registerInventoryApi(router: Router): void {
  // GET /api/inventory - search
  router.get('/api/inventory', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const result = inventoryRepository.search(userId, searchParamsFromQuery(ctx.query));
    json(ctx.res, 200, result);
  });

  // GET /api/inventory/:id
  router.get('/api/inventory/:id', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const row = inventoryRepository.getById(userId, ctx.params.id);
    if (!row) return json(ctx.res, 404, { error: 'Not found.' });
    json(ctx.res, 200, { row });
  });

  // POST /api/inventory - create manual entry
  router.post('/api/inventory', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const src = bodyObject(ctx);
    const v = new Validator(src);

    const cardId = v.optionalString('card_id');
    const condition = v.optionalString('condition');
    const quantity = v.optionalInt('quantity', 'Quantity', { min: 1 }) ?? 1;
    const acquisitionCost = v.optionalNumber('acquisition_cost', 'Acquisition cost', { min: 0 });
    const marketValue = v.optionalNumber('market_value', 'Market value', { min: 0 });
    const targetPrice = v.optionalNumber('target_price', 'Target price', { min: 0 });
    const status = v.optionalEnum('status', INVENTORY_STATUSES, 'Status');
    const sku = v.optionalString('sku');
    const storageLocationId = v.optionalString('storage_location_id');
    const notes = v.optionalString('notes');
    const classification = v.optionalString('classification');

    if (!cardId) {
      v.errors.card_id = v.errors.card_id ?? 'A card is required. Pick or create one first.';
    }
    if (!v.valid) return json(ctx.res, 422, { errors: v.errors });

    const row = inventoryRepository.create({
      user_id: userId,
      card_id: cardId,
      condition: condition ?? 'NM',
      quantity,
      acquisition_cost: acquisitionCost ?? 0,
      market_value: marketValue ?? null,
      target_price: targetPrice ?? null,
      status: status ?? 'Identified',
      sku: sku ?? null,
      storage_location_id: storageLocationId ?? null,
      notes: notes ?? null,
      classification: classification ?? null,
    });
    json(ctx.res, 201, { row });
  });

  // PUT / PATCH /api/inventory/:id - partial update
  const updateHandler = (ctx: RequestContext) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const existing = inventoryRepository.getById(userId, ctx.params.id);
    if (!existing) return json(ctx.res, 404, { error: 'Not found.' });

    const src = bodyObject(ctx);
    const v = new Validator(src);
    const patch: Record<string, unknown> = {};

    if (v.has('condition')) patch.condition = v.optionalString('condition');
    if (v.has('quantity')) patch.quantity = v.optionalInt('quantity', 'Quantity', { min: 0 });
    if (v.has('acquisition_cost')) patch.acquisition_cost = v.optionalNumber('acquisition_cost', 'Acquisition cost', { min: 0 });
    if (v.has('market_value')) patch.market_value = v.optionalNumber('market_value', 'Market value', { min: 0 });
    if (v.has('target_price')) patch.target_price = v.optionalNumber('target_price', 'Target price', { min: 0 });
    if (v.has('status')) patch.status = v.optionalEnum('status', INVENTORY_STATUSES, 'Status');
    if (v.has('marketplace')) patch.marketplace = v.optionalString('marketplace');
    if (v.has('sku')) patch.sku = v.optionalString('sku');
    if (v.has('storage_location_id')) patch.storage_location_id = v.optionalString('storage_location_id');
    if (v.has('notes')) patch.notes = v.optionalString('notes');
    if (v.has('classification')) patch.classification = v.optionalString('classification');

    if (!v.valid) return json(ctx.res, 422, { errors: v.errors });

    // Drop keys that failed validation (stayed undefined) so no data is lost.
    for (const key of Object.keys(patch)) {
      if (patch[key] === undefined) delete patch[key];
    }

    const row = inventoryRepository.update(userId, ctx.params.id, patch);
    json(ctx.res, 200, { row });
  };
  router.put('/api/inventory/:id', updateHandler);
  router.patch('/api/inventory/:id', updateHandler);

  // DELETE /api/inventory/:id
  router.delete('/api/inventory/:id', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const deleted = inventoryRepository.delete(userId, ctx.params.id);
    if (!deleted) return json(ctx.res, 404, { error: 'Not found.' });
    json(ctx.res, 200, { ok: true });
  });
}
