import type { Router, RequestContext } from '../router.js';
import { html, redirect } from '../respond.js';
import { requireAuth } from './app.js';
import type { ParsedBody } from '../middleware/bodyParser.js';
import { inventoryRepository } from '../../repositories/inventoryRepository.js';
import { cardsRepository } from '../../repositories/cardsRepository.js';
import { setsRepository } from '../../repositories/setsRepository.js';
import { storageLocationsRepository } from '../../repositories/storageLocationsRepository.js';
import { priceSnapshotsRepository } from '../../repositories/priceSnapshotsRepository.js';
import { listingsRepository } from '../../repositories/listingsRepository.js';
import { salesRepository } from '../../repositories/salesRepository.js';
import { renderInventoryPage } from '../../views/pages/inventory.js';
import { renderInventoryNewPage } from '../../views/pages/inventory_new.js';
import { renderCardDetailPage } from '../../views/pages/card_detail.js';
import { notFound } from '../errors.js';
import { searchParamsFromQuery } from '../../api/inventory.js';
import { INVENTORY_STATUSES } from '../../domain/tcg.js';
import { mockPricingEngine } from '../../services/mock/mockPricingEngine.js';
import { mockClassificationService } from '../../services/mock/mockClassificationService.js';
import { settingsService } from '../../services/settings.js';

function fields(ctx: RequestContext): Record<string, string> {
  return (ctx.body as ParsedBody | undefined)?.fields ?? {};
}

/** Shared data needed to render the inventory list (and its variants). */
function listPageData(ctx: RequestContext, overrides: Partial<Record<string, unknown>> = {}) {
  const userId = ctx.user!.id;
  const params = { ...searchParamsFromQuery(ctx.query), ...(overrides as object) } as ReturnType<typeof searchParamsFromQuery>;
  const result = inventoryRepository.search(userId, params);
  return {
    user: ctx.user!,
    result,
    params,
    sets: setsRepository.listAll(),
    rarities: cardsRepository.distinctRarities(),
    storageLocations: storageLocationsRepository.listForUser(userId),
    showDemoBanner: inventoryRepository.hasDemoData(userId),
  };
}

export function registerInventoryRoutes(router: Router): void {
  // Inventory list
  router.get(
    '/inventory',
    requireAuth((ctx) => {
      html(ctx.res, 200, renderInventoryPage(listPageData(ctx)));
    }),
  );

  // Manual entry form
  router.get(
    '/inventory/new',
    requireAuth((ctx) => {
      const userId = ctx.user!.id;
      html(
        ctx.res,
        200,
        renderInventoryNewPage({
          user: ctx.user!,
          sets: setsRepository.listAll(),
          storageLocations: storageLocationsRepository.listForUser(userId),
        }),
      );
    }),
  );

  router.post(
    '/inventory/new',
    requireAuth((ctx) => {
      const userId = ctx.user!.id;
      const f = fields(ctx);
      const fieldErrors: Record<string, string> = {};

      let cardId = (f.card_id ?? '').trim();

      // If no existing card selected, try to create one from the new-card block.
      if (!cardId) {
        const newName = (f.new_card_name ?? '').trim();
        if (newName) {
          const setId = (f.new_card_set_id ?? '').trim() || null;
          if (setId && !setsRepository.getById(setId)) {
            fieldErrors.set_id = 'Unknown set.';
          } else {
            const card = cardsRepository.create({
              name: newName,
              set_id: setId,
              pokemon_name: (f.new_card_pokemon ?? '').trim() || null,
              number: (f.new_card_number ?? '').trim() || null,
              rarity: (f.new_card_rarity ?? '').trim() || null,
              card_type: (f.new_card_type ?? '').trim() || null,
              is_holo: f.new_card_holo === '1',
              is_reverse_holo: f.new_card_reverse === '1',
            });
            cardId = card.id;
          }
        } else {
          fieldErrors.card_id = 'Pick an existing card or add a new one.';
        }
      } else if (!cardsRepository.getById(cardId)) {
        fieldErrors.card_id = 'That card no longer exists.';
      }

      const quantityRaw = (f.quantity ?? '1').trim();
      const quantity = Number.parseInt(quantityRaw, 10);
      if (!Number.isFinite(quantity) || quantity < 1) {
        fieldErrors.quantity = 'Quantity must be at least 1.';
      }

      const acquisitionCost = f.acquisition_cost ? Number(f.acquisition_cost) : 0;
      if (!Number.isFinite(acquisitionCost) || acquisitionCost < 0) {
        fieldErrors.acquisition_cost = 'Acquisition cost must be a non-negative number.';
      }
      const targetPrice = f.target_price ? Number(f.target_price) : undefined;
      if (targetPrice !== undefined && (!Number.isFinite(targetPrice) || targetPrice < 0)) {
        fieldErrors.target_price = 'Target price must be a non-negative number.';
      }

      const status = INVENTORY_STATUSES.includes((f.status ?? '') as never) ? f.status : 'Identified';

      if (Object.keys(fieldErrors).length > 0) {
        html(
          ctx.res,
          422,
          renderInventoryNewPage({
            user: ctx.user!,
            sets: setsRepository.listAll(),
            storageLocations: storageLocationsRepository.listForUser(userId),
            error: 'Please fix the errors below. Nothing was saved.',
            fieldErrors,
            values: { ...f },
          }),
        );
        return;
      }

      const row = inventoryRepository.create({
        user_id: userId,
        card_id: cardId,
        condition: f.condition || 'NM',
        quantity,
        acquisition_cost: acquisitionCost,
        target_price: targetPrice ?? null,
        status,
        storage_location_id: (f.storage_location_id ?? '').trim() || null,
        notes: (f.notes ?? '').trim() || null,
      });
      redirect(ctx.res, `/inventory/${encodeURIComponent(row.id)}`);
    }),
  );

  // Singles view (non-bulk inventory)
  router.get(
    '/singles',
    requireAuth((ctx) => {
      const data = listPageData(ctx, { classification: ctx.query.classification || 'single' });
      html(
        ctx.res,
        200,
        renderInventoryPage({
          ...data,
          heading: 'Singles',
          subtitle: `${data.result.total} single${data.result.total === 1 ? '' : 's'}`,
          activeNav: 'singles',
        }),
      );
    }),
  );

  // Card detail (MUST be registered after /inventory/new so that literal wins)
  router.get(
    '/inventory/:id',
    requireAuth((ctx) => {
      const userId = ctx.user!.id;
      const row = inventoryRepository.getById(userId, ctx.params.id);
      if (!row) return notFound(ctx.res);
      const priceHistory = row.card_id ? priceSnapshotsRepository.historyForCard(row.card_id) : [];
      const latestSnapshot = row.card_id ? priceSnapshotsRepository.latestForCard(row.card_id) : undefined;

      const settings = settingsService.getPricingSettings(userId);
      const marketData = row.card_id ? mockPricingEngine.getMarketData(row.card_id) : null;
      const pricing = row.card_id
        ? mockPricingEngine.priceCard(
            { cardId: row.card_id, condition: row.condition, mode: settings.pricingMode },
            settings,
          )
        : null;
      const classification =
        pricing !== null
          ? mockClassificationService.classify({ marketData, pricing, settings })
          : null;

      html(
        ctx.res,
        200,
        renderCardDetailPage({
          user: ctx.user!,
          row,
          priceHistory,
          latestSnapshot,
          listings: listingsRepository.listForInventory(userId, row.id),
          sales: salesRepository.listForInventory(userId, row.id),
          storageLocations: storageLocationsRepository.listForUser(userId),
          mode: settings.pricingMode,
          marketData,
          pricing,
          classification,
        }),
      );
    }),
  );
}
