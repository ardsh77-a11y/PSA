import type { Router, RequestContext } from '../router.js';
import { html, redirect } from '../respond.js';
import { requireAuth } from './app.js';
import { notFound } from '../errors.js';
import { listingsRepository, type ListingRow, type ListingSearchFilters } from '../../repositories/listingsRepository.js';
import { listingGenerator } from '../../services/listingGenerator.js';
import { renderListingsPage } from '../../views/pages/listings.js';
import { renderListingPreviewPage } from '../../views/pages/listing_preview.js';
import { renderBatchReviewPage } from '../../views/pages/listings_batch.js';

function filtersFromQuery(query: Record<string, string>): ListingSearchFilters {
  return {
    status: query.status || undefined,
    marketplace: query.marketplace || undefined,
    q: query.q || undefined,
  };
}

export function registerListingsRoutes(router: Router): void {
  // Listings management page.
  router.get(
    '/listings',
    requireAuth((ctx) => {
      const userId = ctx.user!.id;
      const filters = filtersFromQuery(ctx.query);
      const listings = listingsRepository.listByUser(userId, filters);
      html(ctx.res, 200, renderListingsPage({ user: ctx.user!, listings, filters }));
    }),
  );

  // Batch review screen (literal must beat /listings/:id).
  router.get(
    '/listings/batch',
    requireAuth((ctx) => {
      const userId = ctx.user!.id;
      const ids = (ctx.query.ids ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const listings = ids
        .map((id) => listingsRepository.getById(userId, id))
        .filter((l): l is ListingRow => Boolean(l));
      html(ctx.res, 200, renderBatchReviewPage({ user: ctx.user!, listings }));
    }),
  );

  // eBay-style listing preview / editor.
  router.get(
    '/listings/:id',
    requireAuth((ctx) => {
      const userId = ctx.user!.id;
      const listing = listingsRepository.getById(userId, ctx.params.id);
      if (!listing) return notFound(ctx.res);
      html(ctx.res, 200, renderListingPreviewPage({ user: ctx.user!, listing }));
    }),
  );

  // Generate a listing from an inventory item, then open its preview.
  // Progressive-enhancement fallback for the JSON API (works without JS).
  router.post(
    '/inventory/:id/listing',
    requireAuth((ctx) => {
      const userId = ctx.user!.id;
      const listingId = listingGenerator.generateForInventory(userId, ctx.params.id);
      if (!listingId) return notFound(ctx.res);
      redirect(ctx.res, `/listings/${encodeURIComponent(listingId)}`);
    }),
  );
}
