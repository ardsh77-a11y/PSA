import { getDb } from '../db/connection.js';
import { newId } from '../util/ids.js';
import type { SqlValue } from 'node:sqlite';

/** A raw inventory row (as stored). */
export interface Inventory {
  id: string;
  user_id: string;
  card_id: string | null;
  condition: string;
  quantity: number;
  acquisition_cost: number;
  market_value: number | null;
  target_price: number | null;
  status: string;
  marketplace: string | null;
  sku: string | null;
  storage_location_id: string | null;
  date_acquired: string | null;
  date_listed: string | null;
  date_sold: string | null;
  notes: string | null;
  image_url: string | null;
  is_demo: number;
  classification: string | null;
  created_at: string;
  updated_at: string;
}

/** An inventory row joined with card, set and storage display fields. */
export interface InventoryRow extends Inventory {
  card_name: string | null;
  pokemon_name: string | null;
  card_number: string | null;
  rarity: string | null;
  card_type: string | null;
  is_holo: number | null;
  is_reverse_holo: number | null;
  card_image_url: string | null;
  set_name: string | null;
  set_abbreviation: string | null;
  storage_box: string | null;
  storage_shelf: string | null;
  storage_slot: string | null;
  storage_label: string | null;
}

export interface CreateInventoryInput {
  id?: string;
  user_id: string;
  card_id?: string | null;
  condition?: string;
  quantity?: number;
  acquisition_cost?: number;
  market_value?: number | null;
  target_price?: number | null;
  status?: string;
  marketplace?: string | null;
  sku?: string | null;
  storage_location_id?: string | null;
  date_acquired?: string | null;
  notes?: string | null;
  image_url?: string | null;
  is_demo?: boolean | number;
  classification?: string | null;
}

/** Fields a client may update. Only provided keys are written. */
export interface UpdateInventoryInput {
  condition?: string;
  quantity?: number;
  acquisition_cost?: number;
  market_value?: number | null;
  target_price?: number | null;
  status?: string;
  marketplace?: string | null;
  sku?: string | null;
  storage_location_id?: string | null;
  notes?: string | null;
  classification?: string | null;
}

export interface InventorySearchParams {
  q?: string;
  setId?: string;
  rarity?: string;
  condition?: string;
  status?: string;
  minPrice?: number;
  maxPrice?: number;
  sku?: string;
  storageLocationId?: string;
  classification?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export interface InventorySearchResult {
  rows: InventoryRow[];
  total: number;
  page: number;
  pageSize: number;
}

const ROW_SELECT = `
  SELECT
    i.*,
    c.name            AS card_name,
    c.pokemon_name    AS pokemon_name,
    c.number          AS card_number,
    c.rarity          AS rarity,
    c.card_type       AS card_type,
    c.is_holo         AS is_holo,
    c.is_reverse_holo AS is_reverse_holo,
    c.image_url       AS card_image_url,
    s.name            AS set_name,
    s.abbreviation    AS set_abbreviation,
    sl.box            AS storage_box,
    sl.shelf          AS storage_shelf,
    sl.slot           AS storage_slot,
    sl.label          AS storage_label
  FROM inventory i
  LEFT JOIN cards c ON c.id = i.card_id
  LEFT JOIN sets s ON s.id = c.set_id
  LEFT JOIN storage_locations sl ON sl.id = i.storage_location_id`;

/** Column expressions safe to sort by, keyed by the client-facing sort token. */
const SORT_COLUMNS: Record<string, string> = {
  name: 'c.name',
  set: 's.name',
  rarity: 'c.rarity',
  condition: 'i.condition',
  quantity: 'i.quantity',
  value: 'i.market_value',
  target: 'i.target_price',
  status: 'i.status',
  sku: 'i.sku',
  created: 'i.created_at',
  updated: 'i.updated_at',
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function toInt(v: boolean | number | undefined): number {
  return v ? 1 : 0;
}

/**
 * Build the WHERE clause + bound parameters shared by search() and its COUNT.
 * Every query is scoped to `userId` first, guaranteeing user isolation.
 */
function buildWhere(userId: string, p: InventorySearchParams): { sql: string; params: SqlValue[] } {
  const clauses: string[] = ['i.user_id = ?'];
  const params: SqlValue[] = [userId];

  if (p.q && p.q.trim()) {
    const term = `%${p.q.trim()}%`;
    clauses.push('(c.name LIKE ? COLLATE NOCASE OR c.pokemon_name LIKE ? COLLATE NOCASE OR c.number LIKE ? COLLATE NOCASE OR i.sku LIKE ? COLLATE NOCASE OR s.name LIKE ? COLLATE NOCASE)');
    params.push(term, term, term, term, term);
  }
  if (p.setId) {
    clauses.push('c.set_id = ?');
    params.push(p.setId);
  }
  if (p.rarity) {
    clauses.push('c.rarity = ? COLLATE NOCASE');
    params.push(p.rarity);
  }
  if (p.condition) {
    clauses.push('i.condition = ?');
    params.push(p.condition);
  }
  if (p.status) {
    clauses.push('i.status = ?');
    params.push(p.status);
  }
  if (p.classification) {
    clauses.push('i.classification = ?');
    params.push(p.classification);
  }
  if (p.sku) {
    clauses.push('i.sku = ?');
    params.push(p.sku);
  }
  if (p.storageLocationId) {
    clauses.push('i.storage_location_id = ?');
    params.push(p.storageLocationId);
  }
  if (typeof p.minPrice === 'number' && Number.isFinite(p.minPrice)) {
    clauses.push('COALESCE(i.market_value, 0) >= ?');
    params.push(p.minPrice);
  }
  if (typeof p.maxPrice === 'number' && Number.isFinite(p.maxPrice)) {
    clauses.push('COALESCE(i.market_value, 0) <= ?');
    params.push(p.maxPrice);
  }

  return { sql: clauses.join(' AND '), params };
}

/** Data access for inventory. Every method is user-scoped. */
export const inventoryRepository = {
  getById(userId: string, id: string): InventoryRow | undefined {
    return getDb()
      .prepare(`${ROW_SELECT} WHERE i.user_id = ? AND i.id = ?`)
      .get(userId, id) as InventoryRow | undefined;
  },

  create(input: CreateInventoryInput): InventoryRow {
    const db = getDb();
    const id = input.id ?? newId();
    db.prepare(
      `INSERT INTO inventory
        (id, user_id, card_id, condition, quantity, acquisition_cost, market_value, target_price, status, marketplace, sku, storage_location_id, date_acquired, notes, image_url, is_demo, classification)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.user_id,
      input.card_id ?? null,
      input.condition ?? 'NM',
      input.quantity ?? 1,
      input.acquisition_cost ?? 0,
      input.market_value ?? null,
      input.target_price ?? null,
      input.status ?? 'Unprocessed',
      input.marketplace ?? null,
      input.sku ?? null,
      input.storage_location_id ?? null,
      input.date_acquired ?? null,
      input.notes ?? null,
      input.image_url ?? null,
      toInt(input.is_demo),
      input.classification ?? null,
    );
    return this.getById(input.user_id, id)!;
  },

  /**
   * Update only the provided fields for a user's inventory row. Returns the
   * refreshed row, or undefined if the row does not belong to the user. Unknown
   * or undefined fields are ignored so a partial/invalid payload never wipes
   * existing data.
   */
  update(userId: string, id: string, patch: UpdateInventoryInput): InventoryRow | undefined {
    const existing = this.getById(userId, id);
    if (!existing) return undefined;

    const sets: string[] = [];
    const params: SqlValue[] = [];
    const allowed: (keyof UpdateInventoryInput)[] = [
      'condition',
      'quantity',
      'acquisition_cost',
      'market_value',
      'target_price',
      'status',
      'marketplace',
      'sku',
      'storage_location_id',
      'notes',
      'classification',
    ];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(patch[key] as SqlValue);
      }
    }
    if (sets.length === 0) return existing;

    sets.push("updated_at = datetime('now')");
    params.push(userId, id);
    getDb()
      .prepare(`UPDATE inventory SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`)
      .run(...params);
    return this.getById(userId, id);
  },

  delete(userId: string, id: string): boolean {
    const res = getDb()
      .prepare('DELETE FROM inventory WHERE user_id = ? AND id = ?')
      .run(userId, id);
    return res.changes > 0;
  },

  /**
   * Powerful, user-scoped search with filtering, sorting and pagination.
   * Returns the page of rows plus the total match count (for the pager).
   */
  search(userId: string, params: InventorySearchParams = {}): InventorySearchResult {
    const db = getDb();
    const where = buildWhere(userId, params);

    const total = (
      db
        .prepare(
          `SELECT COUNT(*) AS c
           FROM inventory i
           LEFT JOIN cards c ON c.id = i.card_id
           LEFT JOIN sets s ON s.id = c.set_id
           WHERE ${where.sql}`,
        )
        .get(...where.params) as { c: number }
    ).c;

    const page = Math.max(1, Math.floor(params.page ?? 1));
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(params.pageSize ?? DEFAULT_PAGE_SIZE)));
    const offset = (page - 1) * pageSize;

    // Resolve sort: token may carry a `-` prefix for descending.
    let sortToken = params.sort ?? 'updated';
    let dir = 'DESC';
    if (sortToken.startsWith('-')) {
      dir = 'DESC';
      sortToken = sortToken.slice(1);
    } else if (sortToken.startsWith('+')) {
      dir = 'ASC';
      sortToken = sortToken.slice(1);
    } else if (['name', 'set', 'rarity', 'condition', 'sku', 'status'].includes(sortToken)) {
      dir = 'ASC';
    }
    const sortColumn = SORT_COLUMNS[sortToken] ?? SORT_COLUMNS['updated'];

    const rows = db
      .prepare(
        `${ROW_SELECT}
         WHERE ${where.sql}
         ORDER BY ${sortColumn} ${dir}, i.id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...where.params, pageSize, offset) as InventoryRow[];

    return { rows, total, page, pageSize };
  },

  /** Count of inventory rows for a user (used for demo-data detection). */
  countForUser(userId: string, onlyDemo = false): number {
    const sql = onlyDemo
      ? 'SELECT COUNT(*) AS c FROM inventory WHERE user_id = ? AND is_demo = 1'
      : 'SELECT COUNT(*) AS c FROM inventory WHERE user_id = ?';
    return (getDb().prepare(sql).get(userId) as { c: number }).c;
  },

  /** Whether the user has any demo inventory (drives the demo-data banner). */
  hasDemoData(userId: string): boolean {
    return this.countForUser(userId, true) > 0;
  },

  /** Distinct statuses present for a user (for filter dropdowns). */
  distinctStatuses(userId: string): string[] {
    const rows = getDb()
      .prepare("SELECT DISTINCT status FROM inventory WHERE user_id = ? AND status <> '' ORDER BY status")
      .all(userId) as Array<{ status: string }>;
    return rows.map((r) => r.status);
  },

  /** Aggregate stats for a user (total qty + total market value). */
  summary(userId: string): { rowCount: number; totalQuantity: number; totalValue: number } {
    const row = getDb()
      .prepare(
        `SELECT COUNT(*) AS rowCount,
                COALESCE(SUM(quantity), 0) AS totalQuantity,
                COALESCE(SUM(COALESCE(market_value, 0) * quantity), 0) AS totalValue
         FROM inventory WHERE user_id = ?`,
      )
      .get(userId) as { rowCount: number; totalQuantity: number; totalValue: number };
    return row;
  },
};
