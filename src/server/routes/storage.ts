import type { Router } from '../router.js';
import { html } from '../respond.js';
import { requireAuth } from './app.js';
import { getDb } from '../../db/connection.js';
import { storageLocationsRepository } from '../../repositories/storageLocationsRepository.js';
import { renderStoragePage } from '../../views/pages/storage.js';

/** Register the storage-locations management page (section 21). */
export function registerStorageRoutes(router: Router): void {
  router.get(
    '/storage',
    requireAuth((ctx) => {
      const userId = ctx.user!.id;
      const locations = storageLocationsRepository.listForUser(userId);

      // Count how many inventory rows are assigned to each location.
      const rows = getDb()
        .prepare(
          `SELECT storage_location_id AS id, COUNT(*) AS c
           FROM inventory
           WHERE user_id = ? AND storage_location_id IS NOT NULL
           GROUP BY storage_location_id`,
        )
        .all(userId) as Array<{ id: string; c: number }>;
      const usage: Record<string, number> = {};
      for (const r of rows) usage[r.id] = r.c;

      html(ctx.res, 200, renderStoragePage({ user: ctx.user!, locations, usage }));
    }),
  );
}
