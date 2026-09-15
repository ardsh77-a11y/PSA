import type { Router, RequestContext } from '../server/router.js';
import { json } from '../server/respond.js';
import type { ParsedBody } from '../server/middleware/bodyParser.js';
import { Validator } from './validation.js';
import { bulkService } from '../services/bulkService.js';
import { bulkListingGenerator } from '../services/bulkListingGenerator.js';
import { listingService } from '../services/listingService.js';
import { listingsRepository } from '../repositories/listingsRepository.js';
import { bulkLotsRepository } from '../repositories/bulkLotsRepository.js';
import { inventoryLotsRepository } from '../repositories/inventoryLotsRepository.js';
import { settingsService, BULK_CATEGORIES } from '../services/settings.js';
import { categoryForLotLabel, type ProposedLot } from '../services/bulkService.js';

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

/** Coerce a raw value into a number[] of lot sizes. */
function sizeArray(raw: unknown): number[] {
  const values: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : [];
  return values
    .map((v) => Math.floor(Number(v)))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** Coerce a raw value into a guarantees object suitable for JSON storage. */
function guaranteesFrom(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const g = raw as Record<string, unknown>;
  return {
    minRares: Math.max(0, Math.floor(Number(g.minRares) || 0)),
    minHolos: Math.max(0, Math.floor(Number(g.minHolos) || 0)),
    noEnergy: Boolean(g.noEnergy),
    englishOnly: Boolean(g.englishOnly),
    noDamaged: Boolean(g.noDamaged),
    noDuplicates: Boolean(g.noDuplicates),
    mixedSets: Boolean(g.mixedSets),
  };
}

/**
 * Find the inventory_lot whose canonical category matches `category` and
 * decrement its available quantity, so committed lots do not double-allocate.
 * Falls back gracefully if there is no matching aggregate pool.
 */
function allocateFromPool(userId: string, category: string, amount: number): number {
  const pools = inventoryLotsRepository.listForUser(userId);
  let remaining = amount;
  for (const pool of pools) {
    if (remaining <= 0) break;
    if (categoryForLotLabel(pool.category) !== category) continue;
    const removed = inventoryLotsRepository.decrementQuantity(userId, pool.id, remaining);
    remaining -= removed;
  }
  return amount - remaining;
}

/** Register the JSON bulk API. All endpoints are session-user scoped. */
export function registerBulkApi(router: Router): void {
  // POST /api/bulk/generate-lots { category, lotSizes[], targetCount? } -> proposal
  router.post('/api/bulk/generate-lots', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const src = bodyObject(ctx);
    const v = new Validator(src);
    const category = v.optionalEnum('category', BULK_CATEGORIES, 'Category');
    if (!category) {
      v.errors.category = v.errors.category ?? 'A bulk category is required.';
      return json(ctx.res, 422, { errors: v.errors });
    }
    const lotSizes = sizeArray(src.lotSizes);
    const targetCount = src.targetCount !== undefined ? Number(src.targetCount) : undefined;

    const plan = bulkService.generateLots(userId, {
      category: category as never,
      lotSizes: lotSizes.length ? lotSizes : undefined,
      targetCount: Number.isFinite(targetCount as number) ? (targetCount as number) : undefined,
    });
    json(ctx.res, 200, { plan });
  });

  // POST /api/bulk/lots { category, lots:[{cardCount}], guarantees? } -> commit
  router.post('/api/bulk/lots', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const src = bodyObject(ctx);
    const v = new Validator(src);
    const category = v.optionalEnum('category', BULK_CATEGORIES, 'Category');
    if (!category) {
      v.errors.category = v.errors.category ?? 'A bulk category is required.';
      return json(ctx.res, 422, { errors: v.errors });
    }

    // Accept either an explicit list of lot card counts, or fall back to
    // generating a plan from lotSizes.
    let counts: number[] = [];
    if (Array.isArray(src.lots)) {
      counts = (src.lots as unknown[])
        .map((l) => {
          if (l && typeof l === 'object') return Math.floor(Number((l as Record<string, unknown>).cardCount));
          return Math.floor(Number(l));
        })
        .filter((n) => Number.isFinite(n) && n > 0);
    }
    if (counts.length === 0) {
      const lotSizes = sizeArray(src.lotSizes);
      const plan = bulkService.generateLots(userId, {
        category: category as never,
        lotSizes: lotSizes.length ? lotSizes : undefined,
      });
      counts = plan.lots.map((l: ProposedLot) => l.cardCount);
    }
    if (counts.length === 0) {
      return json(ctx.res, 422, { error: 'No lots to commit for this category.' });
    }

    // Enforce the available pool: committing must not exceed what is available.
    const available = bulkService.availableForCategory(userId, category as never);
    const totalRequested = counts.reduce((s, n) => s + n, 0);
    if (totalRequested > available) {
      return json(ctx.res, 422, {
        error: `Requested ${totalRequested} cards but only ${available} available in ${category}.`,
      });
    }

    const guaranteesObj =
      src.guarantees !== undefined
        ? guaranteesFrom(src.guarantees)
        : (settingsService.getBulkSettings(userId).guarantees as unknown as Record<string, unknown>);
    const guaranteesJson = JSON.stringify(guaranteesObj);

    const created: string[] = [];
    for (const cardCount of counts) {
      const lot = bulkLotsRepository.create({
        user_id: userId,
        category: category as string,
        card_count: cardCount,
        suggested_price: bulkService.suggestedPriceFor(userId, cardCount),
        guarantees_json: guaranteesJson,
        status: 'draft',
      });
      // Decrement the aggregate pool so the same cards are not re-allocated.
      allocateFromPool(userId, category as string, cardCount);
      created.push(lot.id);
    }

    json(ctx.res, 201, { created, count: created.length });
  });

  // PUT /api/bulk/lots/:id - edit card_count / guarantees / status
  const updateHandler = (ctx: RequestContext) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const existing = bulkLotsRepository.getById(userId, ctx.params.id);
    if (!existing) return json(ctx.res, 404, { error: 'Not found.' });

    const src = bodyObject(ctx);
    const v = new Validator(src);
    const patch: Record<string, unknown> = {};

    if (v.has('card_count')) {
      const cc = v.optionalInt('card_count', 'Card count', { min: 1 });
      if (cc !== undefined) {
        patch.card_count = cc;
        patch.suggested_price = bulkService.suggestedPriceFor(userId, cc);
      }
    }
    if (v.has('title')) patch.title = v.optionalString('title');
    if (v.has('description')) patch.description = v.optionalString('description');
    if (v.has('suggested_price')) patch.suggested_price = v.optionalNumber('suggested_price', 'Price', { min: 0 });
    if (v.has('guarantees')) patch.guarantees_json = JSON.stringify(guaranteesFrom(src.guarantees));

    if (!v.valid) return json(ctx.res, 422, { errors: v.errors });
    for (const key of Object.keys(patch)) {
      if (patch[key] === undefined) delete patch[key];
    }
    const lot = bulkLotsRepository.update(userId, ctx.params.id, patch);
    json(ctx.res, 200, { lot });
  };
  router.put('/api/bulk/lots/:id', updateHandler);
  router.patch('/api/bulk/lots/:id', updateHandler);

  // POST /api/bulk/lots/:id/listing { publish? } - generate (and optionally publish)
  router.post('/api/bulk/lots/:id/listing', async (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const listingId = bulkListingGenerator.generateForLot(userId, ctx.params.id);
    if (!listingId) return json(ctx.res, 404, { error: 'Not found.' });

    const src = bodyObject(ctx);
    let published: string | null = null;
    if (src.publish === true || src.publish === 'true' || src.publish === '1') {
      const outcome = await listingService.publish(userId, listingId);
      if (outcome) published = outcome.externalId;
    }
    const listing = listingsRepository.getById(userId, listingId);
    json(ctx.res, 201, { listing, listingId, published, redirect: `/listings/${listingId}` });
  });

  // DELETE /api/bulk/lots/:id
  router.delete('/api/bulk/lots/:id', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const deleted = bulkLotsRepository.delete(userId, ctx.params.id);
    if (!deleted) return json(ctx.res, 404, { error: 'Not found.' });
    json(ctx.res, 200, { ok: true });
  });

  // POST /api/bulk/categories { categories[] } - persist included categories
  router.post('/api/bulk/categories', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const src = bodyObject(ctx);
    const raw = src.categories;
    const list = Array.isArray(raw)
      ? raw.map((c) => String(c))
      : typeof raw === 'string'
        ? raw.split(',').map((c) => c.trim())
        : [];
    const categories = list.filter((c): c is (typeof BULK_CATEGORIES)[number] =>
      (BULK_CATEGORIES as readonly string[]).includes(c),
    );
    const settings = settingsService.setIncludedCategories(userId, categories);
    json(ctx.res, 200, { settings });
  });

  // POST /api/bulk/guarantees { guarantees } - persist default guarantees
  router.post('/api/bulk/guarantees', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const src = bodyObject(ctx);
    const g = guaranteesFrom(src.guarantees ?? src);
    const settings = settingsService.setBulkGuarantees(userId, {
      minRares: Number(g.minRares) || 0,
      minHolos: Number(g.minHolos) || 0,
      noEnergy: Boolean(g.noEnergy),
      englishOnly: Boolean(g.englishOnly),
      noDamaged: Boolean(g.noDamaged),
      noDuplicates: Boolean(g.noDuplicates),
      mixedSets: Boolean(g.mixedSets),
    });
    json(ctx.res, 200, { settings });
  });
}
