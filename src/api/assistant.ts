import type { Router, RequestContext } from '../server/router.js';
import { json } from '../server/respond.js';
import type { ParsedBody } from '../server/middleware/bodyParser.js';
import { mockSellerAssistant } from '../services/mock/mockSellerAssistant.js';

/**
 * Seller-assistant JSON API (FEAT-008, sections 28 + 38).
 *
 * POST /api/assistant { question } -> { answer, data?, suggestions? }
 *
 * The handler depends only on the {@link ../services/interfaces/sellerAssistant.js}
 * SellerAssistant interface, so swapping the mock for a real LLM-backed
 * implementation needs no route or UI change.
 */

function bodyObject(ctx: RequestContext): Record<string, unknown> {
  const b = ctx.body as ParsedBody | undefined;
  if (!b) return {};
  if (b.json && typeof b.json === 'object') return b.json as Record<string, unknown>;
  return { ...b.fields };
}

export function registerAssistantApi(router: Router): void {
  router.post('/api/assistant', async (ctx) => {
    if (!ctx.user) {
      json(ctx.res, 401, { error: 'Authentication required.' });
      return;
    }
    const src = bodyObject(ctx);
    const question = typeof src.question === 'string' ? src.question.trim() : '';
    if (!question) {
      json(ctx.res, 422, { error: 'A question is required.' });
      return;
    }
    const result = await mockSellerAssistant.ask(ctx.user.id, question);
    json(ctx.res, 200, result);
  });
}
