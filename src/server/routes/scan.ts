import type { Router } from '../router.js';
import { html } from '../respond.js';
import { requireAuth } from './app.js';
import { notFound } from '../errors.js';
import { scansRepository } from '../../repositories/scansRepository.js';
import { scanResultsRepository } from '../../repositories/scanResultsRepository.js';
import { setsRepository } from '../../repositories/setsRepository.js';
import { renderScanPage, renderScanDetailPage } from '../../views/pages/scan.js';

/** Register the server-rendered Scan pages. */
export function registerScanRoutes(router: Router): void {
  // Scan list + upload UI.
  router.get(
    '/scan',
    requireAuth((ctx) => {
      const userId = ctx.user!.id;
      html(
        ctx.res,
        200,
        renderScanPage({
          user: ctx.user!,
          scans: scansRepository.listForUser(userId),
          sets: setsRepository.listAll(),
        }),
      );
    }),
  );

  // Scan detail (review + correct detections).
  router.get(
    '/scan/:id',
    requireAuth((ctx) => {
      const userId = ctx.user!.id;
      const scan = scansRepository.getById(userId, ctx.params.id);
      if (!scan) return notFound(ctx.res);
      html(
        ctx.res,
        200,
        renderScanDetailPage({
          user: ctx.user!,
          scan,
          results: scanResultsRepository.listByScan(scan.id),
        }),
      );
    }),
  );
}
