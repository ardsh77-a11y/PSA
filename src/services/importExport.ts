import { inventoryRepository } from '../repositories/inventoryRepository.js';
import { salesRepository } from '../repositories/salesRepository.js';
import { listingsRepository } from '../repositories/listingsRepository.js';
import { cardsRepository } from '../repositories/cardsRepository.js';
import { setsRepository } from '../repositories/setsRepository.js';
import { INVENTORY_STATUSES } from '../domain/tcg.js';

/**
 * CSV import/export (FEAT-008, section 35). Zero dependencies: the CSV parser
 * and serializer are small pure functions implemented here (RFC-4180-ish:
 * quoted fields, escaped quotes "", commas and newlines inside quotes).
 *
 * Export streams inventory / sales / profit-report / listings from the repos as
 * CSV text. Import bulk-creates inventory (and cards on demand) from a CSV with
 * per-row validation: a bad row is REPORTED, never aborts the whole import.
 */

// ---------------------------------------------------------------------------
// Pure CSV primitives
// ---------------------------------------------------------------------------

/** Serialize one field, quoting when it contains a comma, quote or newline. */
export function csvField(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Serialize a matrix of rows (arrays of cells) into CSV text. */
export function toCsv(rows: Array<Array<unknown>>): string {
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n');
}

/**
 * Parse CSV text into rows of string cells. Handles quoted fields with escaped
 * quotes and embedded commas/newlines. Tolerant of \n or \r\n line endings.
 * Blank trailing lines are dropped. Never throws.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      endField();
      i++;
      continue;
    }
    if (ch === '\r') {
      // swallow \r; the \n (if present) handles the row end
      if (text[i + 1] === '\n') {
        endRow();
        i += 2;
        continue;
      }
      endRow();
      i++;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Flush the final field/row unless the input ended on a clean row break.
  if (field.length > 0 || row.length > 0) endRow();

  // Drop entirely-empty rows (e.g. a trailing newline produced one).
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function money(n: number | null | undefined): number {
  return Math.round((n ?? 0) * 100) / 100;
}

/** The canonical inventory export header (also the accepted import columns). */
export const INVENTORY_CSV_HEADER = [
  'card_name',
  'set_name',
  'set_abbreviation',
  'card_number',
  'rarity',
  'condition',
  'quantity',
  'acquisition_cost',
  'market_value',
  'status',
  'sku',
  'classification',
  'notes',
];

export const importExportService = {
  /** Inventory export: one row per inventory item, joined with card/set fields. */
  exportInventoryCsv(userId: string): string {
    const { rows } = inventoryRepository.search(userId, { pageSize: 200, sort: '-value' });
    const out: Array<Array<unknown>> = [INVENTORY_CSV_HEADER];
    for (const r of rows) {
      out.push([
        r.card_name ?? '',
        r.set_name ?? '',
        r.set_abbreviation ?? '',
        r.card_number ?? '',
        r.rarity ?? '',
        r.condition,
        r.quantity,
        money(r.acquisition_cost),
        money(r.market_value),
        r.status,
        r.sku ?? '',
        r.classification ?? '',
        r.notes ?? '',
      ]);
    }
    return toCsv(out);
  },

  /** Sales export: realized sales with fees/shipping/profit. */
  exportSalesCsv(userId: string): string {
    const rows = salesRepository.listByUser(userId);
    const header = ['sold_at', 'card_name', 'set_name', 'card_number', 'sale_price', 'fees', 'shipping', 'cost_basis', 'net_profit', 'order_id'];
    const out: Array<Array<unknown>> = [header];
    for (const r of rows) {
      out.push([
        r.sold_at,
        r.card_name ?? '',
        r.set_name ?? '',
        r.card_number ?? '',
        money(r.sale_price),
        money(r.fees),
        money(r.shipping),
        money(r.cost_basis),
        money(r.net_profit),
        r.order_id ?? '',
      ]);
    }
    return toCsv(out);
  },

  /**
   * Profit report: one row per sale plus a totals row. Mirrors the true-profit
   * math already recorded on each sale (section 25).
   */
  exportProfitReportCsv(userId: string): string {
    const rows = salesRepository.listByUser(userId);
    const header = ['sold_at', 'card_name', 'sale_price', 'fees', 'shipping', 'cost_basis', 'net_profit'];
    const out: Array<Array<unknown>> = [header];
    let totRev = 0;
    let totFees = 0;
    let totShip = 0;
    let totCost = 0;
    let totNet = 0;
    for (const r of rows) {
      totRev += r.sale_price;
      totFees += r.fees;
      totShip += r.shipping;
      totCost += r.cost_basis;
      totNet += r.net_profit;
      out.push([
        r.sold_at,
        r.card_name ?? '',
        money(r.sale_price),
        money(r.fees),
        money(r.shipping),
        money(r.cost_basis),
        money(r.net_profit),
      ]);
    }
    out.push(['TOTAL', '', money(totRev), money(totFees), money(totShip), money(totCost), money(totNet)]);
    return toCsv(out);
  },

  /** Listings export: marketplace-ready draft listings. */
  exportListingsCsv(userId: string): string {
    const rows = listingsRepository.listByUser(userId);
    const header = ['title', 'card_name', 'set_name', 'sku', 'price', 'condition', 'quantity', 'marketplace', 'status', 'created_at'];
    const out: Array<Array<unknown>> = [header];
    for (const r of rows) {
      out.push([
        r.title,
        r.card_name ?? '',
        r.set_name ?? '',
        r.sku ?? '',
        money(r.price),
        r.condition ?? '',
        r.quantity,
        r.marketplace ?? '',
        r.status,
        r.created_at,
      ]);
    }
    return toCsv(out);
  },

  /** Bulk-create inventory from CSV text. See {@link ImportResult}. */
  importInventoryCsv(userId: string, csvText: string): ImportResult {
    return importInventoryCsv(userId, csvText);
  },
};

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportRowError {
  /** 1-based row number in the source file (header is row 1). */
  row: number;
  message: string;
  raw: string[];
}

export interface ImportResult {
  created: number;
  skipped: number;
  errored: number;
  /** Total data rows processed (excludes the header). */
  total: number;
  errors: ImportRowError[];
  /** The ids of the inventory rows created (for round-trip verification). */
  createdIds: string[];
}

function toNumber(v: string | undefined): number | null {
  if (v === undefined || v.trim() === '') return null;
  const cleaned = v.replace(/[$,]/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve (or create) a card matching the imported row's identity fields. We
 * match on name + number within a set when possible; otherwise create a new
 * catalog card so the inventory row always links to something.
 */
function resolveCard(fields: Record<string, string>): string | null {
  const name = (fields.card_name ?? '').trim();
  if (!name) return null;

  const number = (fields.card_number ?? '').trim();
  const setAbbrev = (fields.set_abbreviation ?? '').trim();
  const setName = (fields.set_name ?? '').trim();
  const rarity = (fields.rarity ?? '').trim() || null;

  // Resolve the set: prefer abbreviation, then name.
  let setId: string | null = null;
  if (setAbbrev) {
    const s = setsRepository.findByAbbreviation(setAbbrev);
    if (s) setId = s.id;
  }
  if (!setId && setName) {
    const match = setsRepository.listAll().find((s) => s.name.toLowerCase() === setName.toLowerCase());
    if (match) setId = match.id;
  }

  // Try to find an existing card by name (+ number) in the catalog.
  const candidates = cardsRepository.search(name, 25);
  const exact = candidates.find(
    (c) =>
      c.name.toLowerCase() === name.toLowerCase() &&
      (!number || (c.number ?? '').toLowerCase() === number.toLowerCase()) &&
      (!setId || c.set_id === setId),
  );
  if (exact) return exact.id;

  // Create a new catalog card.
  const card = cardsRepository.create({
    set_id: setId,
    name,
    pokemon_name: name.replace(/\s+ex$|\s+v$|\s+vmax$/i, '').trim() || name,
    number: number || null,
    rarity,
  });
  return card.id;
}

function importInventoryCsv(userId: string, csvText: string): ImportResult {
  const result: ImportResult = { created: 0, skipped: 0, errored: 0, total: 0, errors: [], createdIds: [] };
  const rows = parseCsv(csvText ?? '');
  if (rows.length === 0) {
    return result;
  }

  // Header row: normalize to lower_snake keys.
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const dataRows = rows.slice(1);

  const validStatuses = new Set<string>(INVENTORY_STATUSES as readonly string[]);

  for (let idx = 0; idx < dataRows.length; idx++) {
    const raw = dataRows[idx];
    const rowNum = idx + 2; // +1 for 0-based, +1 for header
    result.total++;

    // Skip fully blank rows silently.
    if (raw.every((c) => c.trim() === '')) {
      result.skipped++;
      continue;
    }

    const fields: Record<string, string> = {};
    header.forEach((key, i) => {
      if (key) fields[key] = raw[i] ?? '';
    });

    // --- Validation (bad rows are reported, not fatal) ---
    const name = (fields.card_name ?? '').trim();
    if (!name) {
      result.errored++;
      result.errors.push({ row: rowNum, message: 'Missing required column "card_name".', raw });
      continue;
    }

    const qtyProvided = (fields.quantity ?? '').trim() !== '';
    const qty = toNumber(fields.quantity);
    if (qtyProvided && qty === null) {
      result.errored++;
      result.errors.push({ row: rowNum, message: `Invalid quantity "${fields.quantity}".`, raw });
      continue;
    }
    const quantity = qty === null ? 1 : Math.floor(qty);
    if (quantity <= 0) {
      result.errored++;
      result.errors.push({ row: rowNum, message: `Invalid quantity "${fields.quantity}".`, raw });
      continue;
    }

    const acquisitionCost = toNumber(fields.acquisition_cost);
    if (fields.acquisition_cost && acquisitionCost === null) {
      result.errored++;
      result.errors.push({ row: rowNum, message: `Invalid acquisition_cost "${fields.acquisition_cost}".`, raw });
      continue;
    }

    const marketValue = toNumber(fields.market_value);
    if (fields.market_value && marketValue === null) {
      result.errored++;
      result.errors.push({ row: rowNum, message: `Invalid market_value "${fields.market_value}".`, raw });
      continue;
    }

    let status = (fields.status ?? '').trim();
    if (status && !validStatuses.has(status)) {
      result.errored++;
      result.errors.push({ row: rowNum, message: `Unknown status "${status}".`, raw });
      continue;
    }
    if (!status) status = 'Unprocessed';

    const condition = (fields.condition ?? '').trim() || 'NM';
    const classification = (fields.classification ?? '').trim() || null;

    // --- Create the card + inventory row ---
    try {
      const cardId = resolveCard(fields);
      const created = inventoryRepository.create({
        user_id: userId,
        card_id: cardId,
        condition,
        quantity,
        acquisition_cost: acquisitionCost ?? 0,
        market_value: marketValue,
        status,
        sku: (fields.sku ?? '').trim() || null,
        classification,
        notes: (fields.notes ?? '').trim() || null,
      });
      result.created++;
      result.createdIds.push(created.id);
    } catch (err) {
      result.errored++;
      result.errors.push({ row: rowNum, message: `Could not create row: ${(err as Error).message}`, raw });
    }
  }

  return result;
}
