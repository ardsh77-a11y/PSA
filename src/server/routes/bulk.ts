import type { Router } from '../router.js';
import { html } from '../respond.js';
import { requireAuth } from './app.js';
import { bulkService } from '../../services/bulkService.js';
import { bulkLotsRepository } from '../../repositories/bulkLotsRepository.js';
import { settingsService } from '../../services/settings.js';
import { renderBulkPage } from '../../views/pages/bulk.js';

/** Register the Bulk section page (section 11-14). */
export function registerBulkRoutes(router: Router): void {
  router.get(
    '/bulk',
    requireAuth((ctx) => {
      const userId = ctx.user!.id;
      html(
        ctx.res,
        200,
        renderBulkPage({
          user: ctx.user!,
          summary: bulkService.getBulkSummary(userId),
          settings: settingsService.getBulkSettings(userId),
          lots: bulkLotsRepository.listForUser(userId),
        }),
      );
    }),
  );
}
