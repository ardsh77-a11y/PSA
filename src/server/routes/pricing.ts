import type { Router, RequestContext } from '../router.js';
import { html, redirect } from '../respond.js';
import { requireAuth } from './app.js';
import type { ParsedBody } from '../middleware/bodyParser.js';
import { inventoryRepository } from '../../repositories/inventoryRepository.js';
import { mockPricingEngine } from '../../services/mock/mockPricingEngine.js';
import { mockClassificationService } from '../../services/mock/mockClassificationService.js';
import {
  settingsService,
  PRICING_MODES,
  DEFAULT_PRICING_SETTINGS,
  type PricingMode,
  type PricingSettings,
} from '../../services/settings.js';
import { renderPricingPage, type PricingRow } from '../../views/pages/pricing.js';
import { renderSettingsPage } from '../../views/pages/settings.js';

function fields(ctx: RequestContext): Record<string, string> {
  return (ctx.body as ParsedBody | undefined)?.fields ?? {};
}

function parseMode(raw: string | undefined): PricingMode | undefined {
  if (!raw) return undefined;
  return (PRICING_MODES as string[]).includes(raw) ? (raw as PricingMode) : undefined;
}

function num(raw: string | undefined, fallback: number, opts?: { min?: number; max?: number }): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  let n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  if (opts?.min !== undefined) n = Math.max(opts.min, n);
  if (opts?.max !== undefined) n = Math.min(opts.max, n);
  return n;
}

/** Build the enriched pricing rows for the current user + mode. */
function buildPricingRows(userId: string, settings: PricingSettings, mode: PricingMode): PricingRow[] {
  const result = inventoryRepository.search(userId, { pageSize: 200, sort: '-value' });
  return result.rows.map((row) => {
    if (!row.card_id) {
      return { row, marketData: null, pricing: null, classification: null };
    }
    const marketData = mockPricingEngine.getMarketData(row.card_id);
    const pricing = mockPricingEngine.priceCard(
      { cardId: row.card_id, condition: row.condition, mode },
      settings,
    );
    const classification = pricing
      ? mockClassificationService.classify({ marketData, pricing, settings })
      : null;
    return { row, marketData, pricing, classification };
  });
}

export function registerPricingRoutes(router: Router): void {
  // Pricing dashboard
  router.get(
    '/pricing',
    requireAuth((ctx) => {
      const userId = ctx.user!.id;
      const settings = settingsService.getPricingSettings(userId);
      const mode = parseMode(ctx.query.mode) ?? settings.pricingMode;
      const rows = buildPricingRows(userId, settings, mode);
      const recomputed = ctx.query.recomputed ? Number(ctx.query.recomputed) : undefined;
      html(ctx.res, 200, renderPricingPage({ user: ctx.user!, mode, rows, recomputed }));
    }),
  );

  // Quick pricing-mode switch (persisted to settings), then back to /pricing.
  router.post(
    '/pricing/mode',
    requireAuth((ctx) => {
      const userId = ctx.user!.id;
      const mode = parseMode(fields(ctx).pricingMode);
      if (mode) settingsService.setPricingMode(userId, mode);
      redirect(ctx.res, '/pricing');
    }),
  );

  // Recompute market_value + target_price for every inventory row and store it.
  router.post(
    '/pricing/recompute',
    requireAuth((ctx) => {
      const userId = ctx.user!.id;
      const settings = settingsService.getPricingSettings(userId);
      const result = inventoryRepository.search(userId, { pageSize: 200 });
      let count = 0;
      for (const row of result.rows) {
        if (!row.card_id) continue;
        const pricing = mockPricingEngine.priceCard(
          { cardId: row.card_id, condition: row.condition, mode: settings.pricingMode },
          settings,
        );
        if (!pricing) continue;
        inventoryRepository.update(userId, row.id, {
          market_value: pricing.marketPrice,
          target_price: pricing.suggestedPrice,
        });
        count++;
      }
      redirect(ctx.res, `/pricing?recomputed=${count}`);
    }),
  );

  // Settings page (pricing preferences).
  router.get(
    '/settings',
    requireAuth((ctx) => {
      const settings = settingsService.getPricingSettings(ctx.user!.id);
      const saved = ctx.query.saved === '1';
      html(ctx.res, 200, renderSettingsPage({ user: ctx.user!, settings, saved }));
    }),
  );

  router.post(
    '/settings',
    requireAuth((ctx) => {
      const userId = ctx.user!.id;
      const f = fields(ctx);
      const d = DEFAULT_PRICING_SETTINGS;
      const current = settingsService.getPricingSettings(userId);

      const settings: PricingSettings = {
        pricingMode: parseMode(f.pricingMode) ?? current.pricingMode,
        // Fee arrives as a percentage (e.g. 12.9) and is stored as a fraction.
        feePct: num(f.feePct, current.feePct * 100, { min: 0, max: 100 }) / 100,
        fixedFee: num(f.fixedFee, current.fixedFee, { min: 0 }),
        shippingCost: num(f.shippingCost, current.shippingCost, { min: 0 }),
        packagingCost: num(f.packagingCost, current.packagingCost, { min: 0 }),
        sellThreshold: num(f.sellThreshold, current.sellThreshold, { min: 0, max: 100 }),
        bulkThreshold: num(f.bulkThreshold, current.bulkThreshold, { min: 0, max: 100 }),
        weights: {
          net: num(f.weightNet, d.weights.net, { min: 0 }),
          value: num(f.weightValue, d.weights.value, { min: 0 }),
          demand: num(f.weightDemand, d.weights.demand, { min: 0 }),
          competition: num(f.weightCompetition, d.weights.competition, { min: 0 }),
        },
        bulkValueCutoff: num(f.bulkValueCutoff, current.bulkValueCutoff, { min: 0 }),
      };
      settingsService.savePricingSettings(userId, settings);
      redirect(ctx.res, '/settings?saved=1');
    }),
  );
}
