import { getDb } from '../db/connection.js';
import { newId } from '../util/ids.js';
import type { SqlValue } from 'node:sqlite';

/**
 * Orders repository (FEAT-007).
 *
 * The order lifecycle (section 23) is:
 *   New -> Picking -> Packed -> Shipped -> Delivered
 * plus the terminal side-states Cancelled and Returned. Reaching Shipped (or
 * Delivered) records a Sale and flips the linked inventory to Sold; see
 * {@link ../services/profitService.ts}.
 *
 * All methods are user-scoped for isolation.
 */
export interface Order {
  id: string;
  user_id: string;
  marketplace: string | null;
  external_order_id: string | null;
  buyer: string | null;
  sale_price: number;
  fees: number;
  shipping: number;
  net_revenue: number;
  status: string;
  tracking_number: string | null;
  created_at: string;
  shipped_at: string | null;
}

/** Canonical order statuses, in lifecycle order plus the two side-states. */
export const ORDER_STATUSES = [
  'New',
  'Picking',
  'Packed',
  'Shipped',
  'Delivered',
  'Cancelled',
  'Returned',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Allowed transitions from each status. The happy path advances one step at a
 * time; Cancelled/Returned can be reached from most active states. The API
 * validates against this map so a bad transition never corrupts state.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  New: ['Picking', 'Packed', 'Shipped', 'Cancelled'],
  Picking: ['Packed', 'Shipped', 'Cancelled'],
  Packed: ['Shipped', 'Cancelled'],
  Shipped: ['Delivered', 'Returned'],
  Delivered: ['Returned'],
  Cancelled: [],
  Returned: [],
};

/** Statuses at which a sale is considered realized (revenue recognized). */
export const SALE_REALIZED_STATUSES: OrderStatus[] = ['Shipped', 'Delivered'];

export function isOrderStatus(v: unknown): v is OrderStatus {
  return typeof v === 'string' && (ORDER_STATUSES as readonly string[]).includes(v);
}

/** Whether a transition from `from` to `to` is permitted. */
export function canTransition(from: string, to: string): boolean {
  if (!isOrderStatus(from) || !isOrderStatus(to)) return false;
  if (from === to) return true;
  return ORDER_TRANSITIONS[from].includes(to);
}

export interface CreateOrderInput {
  id?: string;
  user_id: string;
  marketplace?: string | null;
  external_order_id?: string | null;
  buyer?: string | null;
  sale_price?: number;
  fees?: number;
  shipping?: number;
  net_revenue?: number;
  status?: string;
  tracking_number?: string | null;
  shipped_at?: string | null;
}

/** Fields that may be patched on an order. Only provided keys are written. */
export interface UpdateOrderInput {
  buyer?: string | null;
  sale_price?: number;
  fees?: number;
  shipping?: number;
  net_revenue?: number;
  status?: string;
  tracking_number?: string | null;
  shipped_at?: string | null;
}

export interface OrderSearchFilters {
  status?: string;
  marketplace?: string;
  q?: string;
}

/**
 * An order row joined with a summary of its items (first card for display plus
 * a total item count) and the storage location of the first linked inventory
 * row, so the Orders table can show card + location without a second query.
 */
export interface OrderRow extends Order {
  item_count: number;
  first_card_name: string | null;
  first_card_number: string | null;
  first_set_name: string | null;
  first_card_image_url: string | null;
  storage_box: string | null;
  storage_shelf: string | null;
  storage_slot: string | null;
  storage_label: string | null;
}

const ROW_SELECT = `
  SELECT
    o.*,
    (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
    fc.name         AS first_card_name,
    fc.number       AS first_card_number,
    fs.name         AS first_set_name,
    fc.image_url    AS first_card_image_url,
    sl.box          AS storage_box,
    sl.shelf        AS storage_shelf,
    sl.slot         AS storage_slot,
    sl.label        AS storage_label
  FROM orders o
  LEFT JOIN order_items foi ON foi.id = (
    SELECT oi2.id FROM order_items oi2 WHERE oi2.order_id = o.id ORDER BY oi2.id LIMIT 1
  )
  LEFT JOIN cards fc ON fc.id = foi.card_id
  LEFT JOIN sets fs ON fs.id = fc.set_id
  LEFT JOIN inventory inv ON inv.id = foi.inventory_id
  LEFT JOIN storage_locations sl ON sl.id = inv.storage_location_id`;

export const ordersRepository = {
  getById(userId: string, id: string): OrderRow | undefined {
    return getDb()
      .prepare(`${ROW_SELECT} WHERE o.user_id = ? AND o.id = ?`)
      .get(userId, id) as OrderRow | undefined;
  },

  countForUser(userId: string): number {
    const row = getDb()
      .prepare('SELECT COUNT(*) AS c FROM orders WHERE user_id = ?')
      .get(userId) as { c: number };
    return row.c;
  },

  /** User-scoped list with optional status/marketplace/text filters. */
  listByUser(userId: string, filters: OrderSearchFilters = {}): OrderRow[] {
    const clauses: string[] = ['o.user_id = ?'];
    const params: SqlValue[] = [userId];
    if (filters.status) {
      clauses.push('o.status = ?');
      params.push(filters.status);
    }
    if (filters.marketplace) {
      clauses.push('o.marketplace = ?');
      params.push(filters.marketplace);
    }
    if (filters.q && filters.q.trim()) {
      const term = `%${filters.q.trim()}%`;
      clauses.push('(o.buyer LIKE ? COLLATE NOCASE OR o.external_order_id LIKE ? COLLATE NOCASE OR o.tracking_number LIKE ? COLLATE NOCASE)');
      params.push(term, term, term);
    }
    return getDb()
      .prepare(`${ROW_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY o.created_at DESC, o.id DESC`)
      .all(...params) as OrderRow[];
  },

  /** Distinct statuses present for a user (for the filter dropdown). */
  distinctStatuses(userId: string): string[] {
    const rows = getDb()
      .prepare("SELECT DISTINCT status FROM orders WHERE user_id = ? AND status <> '' ORDER BY status")
      .all(userId) as Array<{ status: string }>;
    return rows.map((r) => r.status);
  },

  create(input: CreateOrderInput): OrderRow {
    const db = getDb();
    const id = input.id ?? newId();
    db.prepare(
      `INSERT INTO orders
        (id, user_id, marketplace, external_order_id, buyer, sale_price, fees, shipping, net_revenue, status, tracking_number, shipped_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.user_id,
      input.marketplace ?? null,
      input.external_order_id ?? null,
      input.buyer ?? null,
      input.sale_price ?? 0,
      input.fees ?? 0,
      input.shipping ?? 0,
      input.net_revenue ?? 0,
      input.status ?? 'New',
      input.tracking_number ?? null,
      input.shipped_at ?? null,
    );
    return this.getById(input.user_id, id)!;
  },

  /**
   * Partial update; only provided, defined keys are written. Returns the
   * refreshed row, or undefined if the order does not belong to the user, so a
   * cross-user or invalid patch never mutates data.
   */
  update(userId: string, id: string, patch: UpdateOrderInput): OrderRow | undefined {
    const existing = this.getById(userId, id);
    if (!existing) return undefined;

    const sets: string[] = [];
    const params: SqlValue[] = [];
    const allowed: (keyof UpdateOrderInput)[] = [
      'buyer',
      'sale_price',
      'fees',
      'shipping',
      'net_revenue',
      'status',
      'tracking_number',
      'shipped_at',
    ];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(patch[key] as SqlValue);
      }
    }
    if (sets.length === 0) return existing;
    params.push(userId, id);
    getDb()
      .prepare(`UPDATE orders SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`)
      .run(...params);
    return this.getById(userId, id);
  },

  delete(userId: string, id: string): boolean {
    const res = getDb()
      .prepare('DELETE FROM orders WHERE user_id = ? AND id = ?')
      .run(userId, id);
    return res.changes > 0;
  },
};
