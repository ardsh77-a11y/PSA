import type { Router, RequestContext } from '../server/router.js';
import { json } from '../server/respond.js';
import type { ParsedBody } from '../server/middleware/bodyParser.js';
import { cardsRepository } from '../repositories/cardsRepository.js';
import { setsRepository } from '../repositories/setsRepository.js';
import { Validator } from './validation.js';
import { strategyFor } from '../domain/tcg.js';

function bodyObject(ctx: RequestContext): Record<string, unknown> {
  const b = ctx.body as ParsedBody | undefined;
  if (!b) return {};
  if (b.json && typeof b.json === 'object') return b.json as Record<string, unknown>;
  return { ...b.fields };
}

function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
}

/**
 * Register the cards API. Cards/sets are shared reference data (a global
 * catalog), so these endpoints are not user-scoped. They power the searchable
 * card picker on the manual entry page and let sellers add missing cards.
 */
export function registerCardsApi(router: Router): void {
  // GET /api/cards?q= - searchable picker
  router.get('/api/cards', (ctx) => {
    if (!ctx.user) return json(ctx.res, 401, { error: 'Authentication required.' });
    const q = ctx.query.q ?? '';
    const rows = q.trim() ? cardsRepository.search(q, 25) : [];
    const strategy = strategyFor('pokemon');
    const results = rows.map((c) => ({
      id: c.id,
      name: c.name,
      title: strategy.formatCardTitle(c),
      set_name: c.set_name,
      set_abbreviation: c.set_abbreviation,
      number: c.number,
      rarity: c.rarity,
      image_url: c.image_url,
    }));
    json(ctx.res, 200, { rows: results });
  });

  // GET /api/sets - list sets (used to populate the new-card set select)
  router.get('/api/sets', (ctx) => {
    if (!ctx.user) return json(ctx.res, 401, { error: 'Authentication required.' });
    json(ctx.res, 200, { rows: setsRepository.listAll() });
  });

  // POST /api/cards - create a card in the shared catalog
  router.post('/api/cards', (ctx) => {
    if (!ctx.user) return json(ctx.res, 401, { error: 'Authentication required.' });
    const src = bodyObject(ctx);
    const v = new Validator(src);

    const name = v.requiredString('name', 'Card name');
    const setId = v.optionalString('set_id');
    const pokemonName = v.optionalString('pokemon_name');
    const number = v.optionalString('number');
    const rarity = v.optionalString('rarity');
    const cardType = v.optionalString('card_type');
    const language = v.optionalString('language') ?? 'en';

    if (setId && !setsRepository.getById(setId)) {
      v.errors.set_id = 'Unknown set.';
    }
    if (!v.valid) return json(ctx.res, 422, { errors: v.errors });

    const card = cardsRepository.create({
      name: name!,
      set_id: setId ?? null,
      pokemon_name: pokemonName ?? null,
      number: number ?? null,
      rarity: rarity ?? null,
      card_type: cardType ?? null,
      language,
      is_holo: truthy(src.is_holo),
      is_reverse_holo: truthy(src.is_reverse_holo),
    });
    json(ctx.res, 201, { card });
  });
}
