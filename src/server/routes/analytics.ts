import type { Router } from '../router.js';
import { html } from '../respond.js';
import { requireAuth } from './app.js';
import { analyticsService } from '../../services/analyticsService.js';
import { inventoryRepository } from '../../repositories/inventoryRepository.js';
import { renderAnalyticsPage } from '../../views/pages/analytics.js';

/** Register the Analytics dashboard page (FEAT-008, section 27). */
export function registerAnalyticsRoutes(router: Router): void {
  router.get(
    '/analytics',
    requireAuth((ctx) => {
      const userId = ctx.user!.id;
      const analytics = analyticsService.getAnalytics(userId);
      html(
        ctx.res,
        200,
        renderAnalyticsPage({
          user: ctx.user!,
          analytics,
          showDemoBanner: inventoryRepository.hasDemoData(userId),
        }),
      );
    }),
  );
}
