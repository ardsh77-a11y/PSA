import type { Router, RequestContext } from '../server/router.js';
import { json } from '../server/respond.js';
import type { ParsedBody } from '../server/middleware/bodyParser.js';
import { Validator } from './validation.js';
import { ordersRepository, ORDER_STATUSES, canTransition } from '../repositories/ordersRepository.js';
import { orderItemsRepository } from '../repositories/orderItemsRepository.js';
import { orderService } from '../services/orderService.js';
import { MARKETPLACES } from '../services/settings.js';

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

/** Register the JSON orders API. All endpoints are session-user scoped. */
export function registerOrdersApi(router: Router): void {
  // GET /api/orders?status=&q= - list the user's orders (with items summary)
  router.get('/api/orders', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const orders = ordersRepository.listByUser(userId, {
      status: ctx.query.status || undefined,
      marketplace: ctx.query.marketplace || undefined,
      q: ctx.query.q || undefined,
    });
    json(ctx.res, 200, { orders });
  });

  // GET /api/orders/:id - a single order plus its items
  router.get('/api/orders/:id', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const order = ordersRepository.getById(userId, ctx.params.id);
    if (!order) return json(ctx.res, 404, { error: 'Not found.' });
    const items = orderItemsRepository.listForOrder(order.id);
    const profit = orderService.profitFor(userId, order.id);
    json(ctx.res, 200, { order, items, profit });
  });

  // POST /api/orders - create an order. Two shapes:
  //   { inventoryId, buyer?, marketplace?, salePrice?, shipping? }  (demo helper)
  //   { buyer?, marketplace?, salePrice?, shipping?, fees? }        (blank order)
  router.post('/api/orders', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const src = bodyObject(ctx);
    const v = new Validator(src);

    const inventoryId = v.optionalString('inventoryId');
    const buyer = v.optionalString('buyer');
    const marketplace = v.optionalEnum('marketplace', MARKETPLACES, 'Marketplace');
    const salePrice = v.optionalNumber('salePrice', 'Sale price', { min: 0 });
    const shipping = v.optionalNumber('shipping', 'Shipping', { min: 0 });
    if (!v.valid) return json(ctx.res, 422, { errors: v.errors });

    if (inventoryId) {
      const order = orderService.createFromInventory(userId, inventoryId, {
        buyer: buyer ?? null,
        marketplace: marketplace ?? null,
        salePrice,
        shipping,
      });
      if (!order) {
        return json(ctx.res, 422, { error: 'Could not create an order: inventory item is missing.' });
      }
      return json(ctx.res, 201, { order, redirect: `/orders/${order.id}` });
    }

    // Blank order (no line items) — still valid; profit is computed on the fly.
    const order = ordersRepository.create({
      user_id: userId,
      buyer: buyer ?? null,
      marketplace: marketplace ?? 'eBay',
      sale_price: salePrice ?? 0,
      shipping: shipping ?? 0,
      status: 'New',
    });
    json(ctx.res, 201, { order, redirect: `/orders/${order.id}` });
  });

  // PATCH /api/orders/:id - status transition and/or tracking number
  const patchHandler = (ctx: RequestContext) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const existing = ordersRepository.getById(userId, ctx.params.id);
    if (!existing) return json(ctx.res, 404, { error: 'Not found.' });

    const src = bodyObject(ctx);
    const v = new Validator(src);
    const status = v.optionalEnum('status', ORDER_STATUSES, 'Status');
    const tracking = v.has('tracking_number') ? v.optionalString('tracking_number') : undefined;
    if (!v.valid) return json(ctx.res, 422, { errors: v.errors });

    // A status change goes through the lifecycle guard + recordSale side-effect.
    if (status && status !== existing.status) {
      if (!canTransition(existing.status, status)) {
        return json(ctx.res, 422, {
          errors: { status: `Cannot move an order from ${existing.status} to ${status}.` },
        });
      }
      const result = orderService.transition(userId, ctx.params.id, status, {
        tracking_number: tracking,
      });
      if (!result) return json(ctx.res, 422, { errors: { status: 'Transition failed.' } });
      return json(ctx.res, 200, {
        order: result.order,
        recordedSales: result.recordedSaleIds,
      });
    }

    // Tracking-only update (no status change).
    if (tracking !== undefined) {
      const order = orderService.setTracking(userId, ctx.params.id, tracking ?? null);
      return json(ctx.res, 200, { order });
    }

    json(ctx.res, 200, { order: existing });
  };
  router.patch('/api/orders/:id', patchHandler);
  router.put('/api/orders/:id', patchHandler);

  // DELETE /api/orders/:id
  router.delete('/api/orders/:id', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const deleted = ordersRepository.delete(userId, ctx.params.id);
    if (!deleted) return json(ctx.res, 404, { error: 'Not found.' });
    json(ctx.res, 200, { ok: true });
  });
}
