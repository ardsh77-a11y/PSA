import type { Router, RequestContext } from '../router.js';
import { json } from '../respond.js';
import { requireAuth } from './app.js';
import type { ParsedBody } from '../middleware/bodyParser.js';
import { importExportService } from '../../services/importExport.js';

/**
 * CSV import/export routes (FEAT-008, section 35).
 *
 * Exports stream CSV from the repos as downloadable attachments. The import
 * accepts a CSV file (multipart) or a raw text/csv body, bulk-creates inventory
 * with per-row validation, and returns a summary; bad rows are reported and
 * never abort the whole import.
 */

function sendCsv(ctx: RequestContext, filename: string, csv: string): void {
  ctx.res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
  ctx.res.end(csv);
}

/** Extract CSV text from a request body: a multipart file part or raw body. */
function extractCsv(ctx: RequestContext): string {
  const b = ctx.body as ParsedBody | undefined;
  if (!b) return '';
  if (b.files && b.files.length > 0) {
    return b.files[0].bytes.toString('utf8');
  }
  if (b.fields && typeof b.fields.csv === 'string' && b.fields.csv.trim()) {
    return b.fields.csv;
  }
  // Fall back to the raw request body (text/csv upload).
  return b.raw ?? '';
}

export function registerImportExportRoutes(router: Router): void {
  router.get(
    '/export/inventory.csv',
    requireAuth((ctx) => sendCsv(ctx, 'inventory.csv', importExportService.exportInventoryCsv(ctx.user!.id))),
  );
  router.get(
    '/export/sales.csv',
    requireAuth((ctx) => sendCsv(ctx, 'sales.csv', importExportService.exportSalesCsv(ctx.user!.id))),
  );
  router.get(
    '/export/profit-report.csv',
    requireAuth((ctx) => sendCsv(ctx, 'profit-report.csv', importExportService.exportProfitReportCsv(ctx.user!.id))),
  );
  router.get(
    '/export/listings.csv',
    requireAuth((ctx) => sendCsv(ctx, 'listings.csv', importExportService.exportListingsCsv(ctx.user!.id))),
  );

  // POST /api/import/inventory — bulk create inventory from a CSV.
  router.post('/api/import/inventory', (ctx) => {
    if (!ctx.user) {
      json(ctx.res, 401, { error: 'Authentication required.' });
      return;
    }
    const csv = extractCsv(ctx);
    if (!csv.trim()) {
      json(ctx.res, 422, { error: 'No CSV content provided.' });
      return;
    }
    const result = importExportService.importInventoryCsv(ctx.user.id, csv);
    json(ctx.res, 200, {
      created: result.created,
      skipped: result.skipped,
      errored: result.errored,
      total: result.total,
      errors: result.errors,
    });
  });
}
