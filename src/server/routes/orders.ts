import type { Router } from '../router.js';
import { html } from '../respond.js';
import { requireAuth } from './app.js';
import { notFound } from '../errors.js';
import { ordersRepository, type OrderSearchFilters } from '../../repositories/ordersRepository.js';
import { orderItemsRepository } from '../../repositories/orderItemsRepository.js';
import { ripsRepository } from '../../repositories/ripsRepository.js';
import { orderService } from '../../services/orderService.js';
import { renderOrdersPage } from '../../views/pages/orders.js';
import { renderOrderDetailPage } from '../../views/pages/order_detail.js';
import { renderRipPage } from '../../views/pages/rip.js';

function filtersFromQuery(query: Record<string, string>): OrderSearchFilters {
  return {
    status: query.status || undefined,
    marketplace: query.marketplace || undefined,
    q: query.q || undefined,
  };
}

/** Register the Orders + fulfillment + Pack/Rip pages (sections 23, 24, 26). */
export function registerOrdersRoutes(router: Router): void {
  // Orders management table.
  router.get(
    '/orders',
    requireAuth((ctx) => {
      const userId = ctx.user!.id;
      const filters = filtersFromQuery(ctx.query);
      const orders = ordersRepository.listByUser(userId, filters);
      html(ctx.res, 200, renderOrdersPage({ user: ctx.user!, orders, filters }));
    }),
  );

  // Pack/Rip tracking (literal must beat /orders/:id — different prefix, safe).
  router.get(
    '/rips',
    requireAuth((ctx) => {
      const userId = ctx.user!.id;
      const rips = ripsRepository.listByUser(userId);
      html(ctx.res, 200, renderRipPage({ user: ctx.user!, rips }));
    }),
  );

  // Order fulfillment detail.
  router.get(
    '/orders/:id',
    requireAuth((ctx) => {
      const userId = ctx.user!.id;
      const order = ordersRepository.getById(userId, ctx.params.id);
      if (!order) return notFound(ctx.res);
      const items = orderItemsRepository.listForOrder(order.id);
      const profit = orderService.profitFor(userId, order.id)!;
      html(ctx.res, 200, renderOrderDetailPage({ user: ctx.user!, order, items, profit }));
    }),
  );
}
