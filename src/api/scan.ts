import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Router, RequestContext } from '../server/router.js';
import { json } from '../server/respond.js';
import type { ParsedBody } from '../server/middleware/bodyParser.js';
import type { UploadedFile } from '../server/middleware/multipart.js';
import { config } from '../config/index.js';
import { newId } from '../util/ids.js';
import { scanService } from '../services/scanService.js';
import { scanResultsRepository } from '../repositories/scanResultsRepository.js';
import { cardsRepository } from '../repositories/cardsRepository.js';
import { Validator } from './validation.js';

/** Where uploaded scan images are stored (alongside the DB, gitignored). */
const UPLOAD_DIR = join(dirname(config.dbPath), 'uploads');

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

/** Persist raw image bytes to data/uploads/<id> and return the stored ref. */
function storeUpload(bytes: Buffer, originalName: string): string {
  mkdirSync(UPLOAD_DIR, { recursive: true });
  const id = newId();
  // Keep the original filename as the ref suffix so count hints survive.
  const safeName = originalName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'upload';
  const ref = `${id}-${safeName}`;
  writeFileSync(join(UPLOAD_DIR, ref), bytes);
  return ref;
}

/** Decode a base64 data-URL (or bare base64) payload into bytes. */
function decodeDataUrl(value: string): Buffer | null {
  if (!value) return null;
  const comma = value.indexOf(',');
  const b64 = value.startsWith('data:') && comma !== -1 ? value.slice(comma + 1) : value;
  try {
    const buf = Buffer.from(b64, 'base64');
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

/**
 * Collect image uploads from the request. Supports:
 *  - multipart/form-data file parts (any field name), and
 *  - a base64 JSON fallback: { images: [{ dataUrl, filename }] } or a single
 *    { image, filename }.
 * Returns an array of { bytes, filename }.
 */
function collectImages(ctx: RequestContext): Array<{ bytes: Buffer; filename: string }> {
  const out: Array<{ bytes: Buffer; filename: string }> = [];
  const b = ctx.body as ParsedBody | undefined;

  const files: UploadedFile[] = b?.files ?? [];
  for (const f of files) {
    if (f.bytes && f.bytes.length > 0) {
      out.push({ bytes: f.bytes, filename: f.filename || 'upload.jpg' });
    }
  }

  // JSON base64 fallback.
  if (b?.json && typeof b.json === 'object') {
    const obj = b.json as Record<string, unknown>;
    const list = Array.isArray(obj.images) ? obj.images : [];
    for (const item of list) {
      if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        const bytes = decodeDataUrl(String(rec.dataUrl ?? rec.data ?? rec.image ?? ''));
        if (bytes) out.push({ bytes, filename: String(rec.filename ?? 'upload.jpg') });
      } else if (typeof item === 'string') {
        const bytes = decodeDataUrl(item);
        if (bytes) out.push({ bytes, filename: 'upload.jpg' });
      }
    }
    if (typeof obj.image === 'string') {
      const bytes = decodeDataUrl(obj.image);
      if (bytes) out.push({ bytes, filename: String(obj.filename ?? 'upload.jpg') });
    }
  }

  return out;
}

/** Register the JSON scan API. All endpoints are session-user scoped. */
export function registerScanApi(router: Router): void {
  // POST /api/scan - create a scan from one or more images and run recognition.
  router.post('/api/scan', async (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;

    const images = collectImages(ctx);
    if (images.length === 0) {
      return json(ctx.res, 422, {
        errors: { image: 'Upload at least one image (multipart file or base64 image).' },
      });
    }

    const body = bodyObject(ctx);
    const setHint = typeof body.set_id === 'string' && body.set_id ? body.set_id : undefined;
    const hints = setHint ? { setId: setHint } : undefined;

    const scans = [] as Array<{ scan: unknown; results: unknown; error?: string }>;
    for (const img of images) {
      const imageRef = storeUpload(img.bytes, img.filename);
      const out = await scanService.runScan({ userId, imageRef, bytes: img.bytes, hints });
      scans.push({ scan: out.scan, results: out.results, error: out.error });
    }

    // Return a single scan for the common one-image case, plus the full list.
    const first = scans[0];
    json(ctx.res, 201, { scan: first.scan, results: first.results, scans });
  });

  // GET /api/scan/:id - scan + its results.
  router.get('/api/scan/:id', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const data = scanService.getScan(userId, ctx.params.id);
    if (!data) return json(ctx.res, 404, { error: 'Not found.' });
    json(ctx.res, 200, data);
  });

  // PATCH /api/scan-result/:id - apply a manual correction.
  router.patch('/api/scan-result/:id', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const owned = scanService.getOwnedResult(userId, ctx.params.id);
    if (!owned) return json(ctx.res, 404, { error: 'Not found.' });

    const src = bodyObject(ctx);
    const v = new Validator(src);
    const patch: Record<string, unknown> = {};

    if (v.has('matchedCardId') || v.has('card_id')) {
      const cardId = v.optionalString('matchedCardId') ?? v.optionalString('card_id');
      if (cardId) {
        const card = cardsRepository.getById(cardId);
        if (!card) {
          v.errors.card_id = 'That card does not exist.';
        } else {
          // Re-match: adopt the chosen card's identity so the tile updates.
          patch.card_id = card.id;
          patch.card_name = card.name;
          patch.pokemon_name = card.pokemon_name;
          patch.set_name = card.set_name;
          patch.set_abbreviation = card.set_abbreviation;
          patch.card_number = card.number;
          patch.rarity = card.rarity;
          patch.card_type = card.card_type;
          patch.is_holo = card.is_holo;
          patch.is_reverse_holo = card.is_reverse_holo;
        }
      } else {
        patch.card_id = null;
      }
    }
    if (v.has('set_name')) patch.set_name = v.optionalString('set_name');
    if (v.has('set_abbreviation')) patch.set_abbreviation = v.optionalString('set_abbreviation');
    if (v.has('card_number')) patch.card_number = v.optionalString('card_number');
    if (v.has('rarity')) patch.rarity = v.optionalString('rarity');
    if (v.has('card_type')) patch.card_type = v.optionalString('card_type');
    if (v.has('estimated_condition') || v.has('condition')) {
      patch.estimated_condition = v.optionalString('estimated_condition') ?? v.optionalString('condition');
    }
    if (v.has('status')) {
      const status = v.optionalEnum('status', ['detected', 'needs_review', 'confirmed', 'committed'], 'Status');
      if (status) patch.status = status;
    }

    if (!v.valid) return json(ctx.res, 422, { errors: v.errors });

    for (const key of Object.keys(patch)) {
      if (patch[key] === undefined) delete patch[key];
    }

    const result = scanResultsRepository.update(ctx.params.id, patch);
    json(ctx.res, 200, { result });
  });

  // DELETE /api/scan-result/:id - drop a detection.
  router.delete('/api/scan-result/:id', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const owned = scanService.getOwnedResult(userId, ctx.params.id);
    if (!owned) return json(ctx.res, 404, { error: 'Not found.' });
    scanResultsRepository.delete(ctx.params.id);
    json(ctx.res, 200, { ok: true });
  });

  // POST /api/scan-result/:id/commit - add one confirmed detection to inventory.
  router.post('/api/scan-result/:id/commit', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const res = scanService.commitScanResult(userId, ctx.params.id);
    if (res.error) return json(ctx.res, 422, { error: res.error });
    json(ctx.res, 201, { inventory: res.inventory });
  });

  // POST /api/scan/:id/commit-all - commit every confirmed detection.
  router.post('/api/scan/:id/commit-all', (ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return;
    const scan = scanService.getScan(userId, ctx.params.id);
    if (!scan) return json(ctx.res, 404, { error: 'Not found.' });
    const summary = scanService.commitAllConfirmed(userId, ctx.params.id);
    json(ctx.res, 200, summary);
  });
}
