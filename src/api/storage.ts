import type { Router, RequestContext } from '../server/router.js';
import { json } from '../server/respond.js';
import type { ParsedBody } from '../server/middleware/bodyParser.js';
import { Validator } from './validation.js';
import {
  storageLocationsRepository,
  describeLocation,
} from '../repositories/storageLocationsRepository.js';
import { inventoryRepository } from '../repositories/inventoryRepository.js';

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

function optStr(src: Record<string, unknown>, key: string): string | null {
  const v = src[key];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Register the JSON storage-locations API. All endpoints are session-scoped. */
export function registerStorageApi(router: Router): void {
  // GET /api/storage - list the user's storage locations
  router.get('/api/storage', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const locations = storageLocationsRepository.listForUser(userId).map((l) => ({
      ...l,
      description: describeLocation(l),
    }));
    json(ctx.res, 200, { locations });
  });

  // POST /api/storage { box?, shelf?, slot?, label? } - create a location
  router.post('/api/storage', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const src = bodyObject(ctx);
    const box = optStr(src, 'box');
    const shelf = optStr(src, 'shelf');
    const slot = optStr(src, 'slot');
    const label = optStr(src, 'label');
    if (!box && !shelf && !slot && !label) {
      return json(ctx.res, 422, {
        errors: { box: 'Provide at least a box, shelf, slot or label.' },
      });
    }
    const location = storageLocationsRepository.create({ user_id: userId, box, shelf, slot, label });
    json(ctx.res, 201, { location: { ...location, description: describeLocation(location) } });
  });

  // PUT / PATCH /api/storage/:id - edit a location
  const updateHandler = (ctx: RequestContext) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const existing = storageLocationsRepository.getById(userId, ctx.params.id);
    if (!existing) return json(ctx.res, 404, { error: 'Not found.' });
    const src = bodyObject(ctx);
    // upsertById is INSERT OR IGNORE, so update via a direct repository write.
    const box = src.box !== undefined ? optStr(src, 'box') : existing.box;
    const shelf = src.shelf !== undefined ? optStr(src, 'shelf') : existing.shelf;
    const slot = src.slot !== undefined ? optStr(src, 'slot') : existing.slot;
    const label = src.label !== undefined ? optStr(src, 'label') : existing.label;
    storageLocationsRepository.updateById({ id: ctx.params.id, user_id: userId, box, shelf, slot, label });
    const location = storageLocationsRepository.getById(userId, ctx.params.id)!;
    json(ctx.res, 200, { location: { ...location, description: describeLocation(location) } });
  };
  router.put('/api/storage/:id', updateHandler);
  router.patch('/api/storage/:id', updateHandler);

  // DELETE /api/storage/:id
  router.delete('/api/storage/:id', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const deleted = storageLocationsRepository.deleteById(userId, ctx.params.id);
    if (!deleted) return json(ctx.res, 404, { error: 'Not found.' });
    json(ctx.res, 200, { ok: true });
  });

  // PATCH /api/inventory/:id/storage { storage_location_id } - assign a location
  router.patch('/api/inventory/:id/storage', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const existing = inventoryRepository.getById(userId, ctx.params.id);
    if (!existing) return json(ctx.res, 404, { error: 'Not found.' });

    const src = bodyObject(ctx);
    const v = new Validator(src);
    const locationId = v.optionalString('storage_location_id');
    // Empty string clears the assignment; a value must reference a real location.
    if (locationId && !storageLocationsRepository.getById(userId, locationId)) {
      return json(ctx.res, 422, { errors: { storage_location_id: 'Unknown storage location.' } });
    }
    const row = inventoryRepository.update(userId, ctx.params.id, {
      storage_location_id: locationId ? locationId : null,
    });
    json(ctx.res, 200, { row });
  });
}
