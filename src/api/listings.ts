import type { Router, RequestContext } from '../server/router.js';
import { json } from '../server/respond.js';
import type { ParsedBody } from '../server/middleware/bodyParser.js';
import { listingsRepository, LISTING_STATUSES } from '../repositories/listingsRepository.js';
import { listingGenerator } from '../services/listingGenerator.js';
import { listingService } from '../services/listingService.js';
import { Validator } from './validation.js';
import { MARKETPLACES, PRICING_MODES } from '../services/settings.js';

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

/** Coerce a raw value into a string[] of inventory/listing ids. */
function idArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v)).filter((v) => v.trim().length > 0);
  }
  if (typeof raw === 'string' && raw.trim()) {
    // Support comma-separated fallback for form posts.
    return raw.split(',').map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

/** Register the JSON listings API. All endpoints are session-user scoped. */
export function registerListingsApi(router: Router): void {
  // POST /api/listings/generate { inventoryId, mode?, marketplace? }
  router.post('/api/listings/generate', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const src = bodyObject(ctx);
    const v = new Validator(src);
    const inventoryId = v.requiredString('inventoryId', 'Inventory item');
    const mode = v.optionalEnum('mode', PRICING_MODES, 'Mode');
    const marketplace = v.optionalEnum('marketplace', MARKETPLACES, 'Marketplace');
    if (!v.valid || !inventoryId) return json(ctx.res, 422, { errors: v.errors });

    const listingId = listingGenerator.generateForInventory(userId, inventoryId, {
      mode: mode as never,
      marketplace,
    });
    if (!listingId) {
      return json(ctx.res, 422, { error: 'Could not generate a listing: item is missing or not linked to a card.' });
    }
    const listing = listingsRepository.getById(userId, listingId);
    json(ctx.res, 201, { listing, redirect: `/listings/${listingId}` });
  });

  // POST /api/listings/batch-generate { inventoryIds[], mode?, marketplace? }
  router.post('/api/listings/batch-generate', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const src = bodyObject(ctx);
    const inventoryIds = idArray(src.inventoryIds ?? src.ids);
    if (inventoryIds.length === 0) {
      return json(ctx.res, 422, { errors: { inventoryIds: 'Select at least one inventory item.' } });
    }
    const v = new Validator(src);
    const mode = v.optionalEnum('mode', PRICING_MODES, 'Mode');
    const marketplace = v.optionalEnum('marketplace', MARKETPLACES, 'Marketplace');

    const created: string[] = [];
    const skipped: string[] = [];
    for (const inventoryId of inventoryIds) {
      const listingId = listingGenerator.generateForInventory(userId, inventoryId, {
        mode: mode as never,
        marketplace,
      });
      if (listingId) created.push(listingId);
      else skipped.push(inventoryId);
    }
    json(ctx.res, 201, {
      created,
      skipped,
      count: created.length,
      redirect: created.length ? `/listings/batch?ids=${created.join(',')}` : '/listings',
    });
  });

  // PUT /api/listings/:id - edit fields
  const updateHandler = (ctx: RequestContext) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const existing = listingsRepository.getById(userId, ctx.params.id);
    if (!existing) return json(ctx.res, 404, { error: 'Not found.' });

    const src = bodyObject(ctx);
    const v = new Validator(src);
    const patch: Record<string, unknown> = {};

    if (v.has('title')) patch.title = v.requiredString('title', 'Title');
    if (v.has('description')) patch.description = v.optionalString('description');
    if (v.has('price')) patch.price = v.optionalNumber('price', 'Price', { min: 0 });
    if (v.has('shipping_cost')) patch.shipping_cost = v.optionalNumber('shipping_cost', 'Shipping', { min: 0 });
    if (v.has('condition')) patch.condition = v.optionalString('condition');
    if (v.has('quantity')) patch.quantity = v.optionalInt('quantity', 'Quantity', { min: 1 });
    if (v.has('sku')) patch.sku = v.optionalString('sku');
    if (v.has('marketplace')) patch.marketplace = v.optionalEnum('marketplace', MARKETPLACES, 'Marketplace');
    if (v.has('status')) patch.status = v.optionalEnum('status', LISTING_STATUSES, 'Status');

    if (!v.valid) return json(ctx.res, 422, { errors: v.errors });
    for (const key of Object.keys(patch)) {
      if (patch[key] === undefined) delete patch[key];
    }
    const listing = listingsRepository.update(userId, ctx.params.id, patch);
    json(ctx.res, 200, { listing });
  };
  router.put('/api/listings/:id', updateHandler);
  router.patch('/api/listings/:id', updateHandler);

  // POST /api/listings/:id/publish - publish via MarketplacePublisher
  router.post('/api/listings/:id/publish', async (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const outcome = await listingService.publish(userId, ctx.params.id);
    if (!outcome) return json(ctx.res, 404, { error: 'Not found.' });
    json(ctx.res, 200, {
      listing: outcome.listing,
      externalId: outcome.externalId,
      publishedAt: outcome.publishedAt,
    });
  });

  // POST /api/listings/:id/return - back to inventory
  router.post('/api/listings/:id/return', async (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const listing = await listingService.returnToInventory(userId, ctx.params.id);
    if (!listing) return json(ctx.res, 404, { error: 'Not found.' });
    json(ctx.res, 200, { listing });
  });

  // POST /api/listings/:id/end - end the listing
  router.post('/api/listings/:id/end', async (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const listing = await listingService.end(userId, ctx.params.id);
    if (!listing) return json(ctx.res, 404, { error: 'Not found.' });
    json(ctx.res, 200, { listing });
  });

  // DELETE /api/listings/:id
  router.delete('/api/listings/:id', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const deleted = listingsRepository.delete(userId, ctx.params.id);
    if (!deleted) return json(ctx.res, 404, { error: 'Not found.' });
    json(ctx.res, 200, { ok: true });
  });

  // POST /api/listings/batch-approve { ids[] } - publish many at once
  router.post('/api/listings/batch-approve', async (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const src = bodyObject(ctx);
    const ids = idArray(src.ids ?? src.listingIds);
    if (ids.length === 0) {
      return json(ctx.res, 422, { errors: { ids: 'Select at least one listing.' } });
    }
    const published: string[] = [];
    const failed: string[] = [];
    for (const id of ids) {
      const outcome = await listingService.publish(userId, id);
      if (outcome) published.push(id);
      else failed.push(id);
    }
    json(ctx.res, 200, { published, failed, count: published.length });
  });
}
