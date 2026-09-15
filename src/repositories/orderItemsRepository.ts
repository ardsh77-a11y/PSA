import { getDb } from '../db/connection.js';
import { newId } from '../util/ids.js';

/** A raw order_items row. */
export interface OrderItem {
  id: string;
  order_id: string;
  inventory_id: string | null;
  listing_id: string | null;
  card_id: string | null;
  quantity: number;
  unit_price: number;
}

/**
 * An order item joined with card, set, inventory and storage fields so the
 * fulfillment view can show the sold card, its photo and its physical location
 * (BOX / Shelf / Slot) without extra queries.
 */
export interface OrderItemRow extends OrderItem {
  card_name: string | null;
  pokemon_name: string | null;
  card_number: string | null;
  rarity: string | null;
  card_image_url: string | null;
  set_name: string | null;
  set_abbreviation: string | null;
  inventory_status: string | null;
  inventory_sku: string | null;
  inventory_condition: string | null;
  acquisition_cost: number | null;
  storage_box: string | null;
  storage_shelf: string | null;
  storage_slot: string | null;
  storage_label: string | null;
}

export interface CreateOrderItemInput {
  id?: string;
  order_id: string;
  inventory_id?: string | null;
  listing_id?: string | null;
  card_id?: string | null;
  quantity?: number;
  unit_price?: number;
}

const ROW_SELECT = `
  SELECT
    oi.*,
    c.name            AS card_name,
    c.pokemon_name    AS pokemon_name,
    c.number          AS card_number,
    c.rarity          AS rarity,
    c.image_url       AS card_image_url,
    s.name            AS set_name,
    s.abbreviation    AS set_abbreviation,
    inv.status        AS inventory_status,
    inv.sku           AS inventory_sku,
    inv.condition     AS inventory_condition,
    inv.acquisition_cost AS acquisition_cost,
    sl.box            AS storage_box,
    sl.shelf          AS storage_shelf,
    sl.slot           AS storage_slot,
    sl.label          AS storage_label
  FROM order_items oi
  LEFT JOIN inventory inv ON inv.id = oi.inventory_id
  LEFT JOIN cards c ON c.id = COALESCE(oi.card_id, inv.card_id)
  LEFT JOIN sets s ON s.id = c.set_id
  LEFT JOIN storage_locations sl ON sl.id = inv.storage_location_id`;

export const orderItemsRepository = {
  /** All items for an order, joined for display. */
  listForOrder(orderId: string): OrderItemRow[] {
    return getDb()
      .prepare(`${ROW_SELECT} WHERE oi.order_id = ? ORDER BY oi.id`)
      .all(orderId) as OrderItemRow[];
  },

  /** Raw items for an order (no joins). */
  rawForOrder(orderId: string): OrderItem[] {
    return getDb()
      .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id')
      .all(orderId) as OrderItem[];
  },

  create(input: CreateOrderItemInput): OrderItem {
    const db = getDb();
    const id = input.id ?? newId();
    db.prepare(
      `INSERT INTO order_items (id, order_id, inventory_id, listing_id, card_id, quantity, unit_price)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.order_id,
      input.inventory_id ?? null,
      input.listing_id ?? null,
      input.card_id ?? null,
      input.quantity ?? 1,
      input.unit_price ?? 0,
    );
    return db.prepare('SELECT * FROM order_items WHERE id = ?').get(id) as OrderItem;
  },
};
