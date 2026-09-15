import type { Router, RequestContext } from '../server/router.js';
import { json } from '../server/respond.js';
import { inventoryRepository } from '../repositories/inventoryRepository.js';
import { mockPricingEngine } from '../services/mock/mockPricingEngine.js';
import { mockClassificationService } from '../services/mock/mockClassificationService.js';
import { settingsService, PRICING_MODES, type PricingMode } from '../services/settings.js';

function requireUser(ctx: RequestContext): string | null {
  if (!ctx.user) {
    json(ctx.res, 401, { error: 'Authentication required.' });
    return null;
  }
  return ctx.user.id;
}

function parseMode(raw: string | undefined): PricingMode | undefined {
  if (!raw) return undefined;
  return (PRICING_MODES as string[]).includes(raw) ? (raw as PricingMode) : undefined;
}

/**
 * JSON pricing API consumed by the Card Detail + Pricing front-end
 * enhancements. Both endpoints are session-scoped and use the current user's
 * pricing settings (fees/shipping/mode) so results match what the pages show.
 */
export function registerPricingApi(router: Router): void {
  // GET /api/pricing/:cardId?condition=&mode=
  router.get('/api/pricing/:cardId', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const settings = settingsService.getPricingSettings(userId);
    const mode = parseMode(ctx.query.mode) ?? settings.pricingMode;
    const condition = ctx.query.condition || undefined;

    const marketData = mockPricingEngine.getMarketData(ctx.params.cardId);
    const pricing = mockPricingEngine.priceCard(
      { cardId: ctx.params.cardId, condition, mode },
      settings,
    );
    if (!pricing) return json(ctx.res, 404, { error: 'No market data for that card.' });

    json(ctx.res, 200, { marketData, pricing, mode });
  });

  // GET /api/classify/:inventoryId
  router.get('/api/classify/:inventoryId', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const row = inventoryRepository.getById(userId, ctx.params.inventoryId);
    if (!row) return json(ctx.res, 404, { error: 'Not found.' });
    if (!row.card_id) return json(ctx.res, 422, { error: 'Inventory item is not linked to a card.' });

    const settings = settingsService.getPricingSettings(userId);
    const mode = parseMode(ctx.query.mode) ?? settings.pricingMode;
    const condition = ctx.query.condition || row.condition;
    const marketData = mockPricingEngine.getMarketData(row.card_id);
    const pricing = mockPricingEngine.priceCard(
      { cardId: row.card_id, condition, mode },
      settings,
    );
    if (!pricing) return json(ctx.res, 404, { error: 'No market data for that card.' });

    const classification = mockClassificationService.classify({ marketData, pricing, settings });
    json(ctx.res, 200, { marketData, pricing, classification, mode });
  });
}
