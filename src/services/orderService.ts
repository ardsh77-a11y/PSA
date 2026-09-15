import { getDb } from '../db/connection.js';
import {
  ordersRepository,
  type OrderRow,
  canTransition,
  isOrderStatus,
  SALE_REALIZED_STATUSES,
} from '../repositories/ordersRepository.js';
import { orderItemsRepository } from '../repositories/orderItemsRepository.js';
import { inventoryRepository } from '../repositories/inventoryRepository.js';
import { listingsRepository } from '../repositories/listingsRepository.js';
import { settingsService } from './settings.js';
import { computeOrderProfit, estimateFees, recordSale } from './profitService.js';

/**
 * Order orchestration (FEAT-007): creating orders (including a demo helper that
 * turns a Listed/Ready inventory item into a New order) and advancing the
 * fulfillment lifecycle. Reaching Shipped/Delivered records the sale and flips
 * inventory to Sold via {@link ./profitService.ts}.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface CreateOrderFromInventoryOptions {
  buyer?: string | null;
  marketplace?: string | null;
  salePrice?: number;
  shipping?: number;
}

export interface TransitionResult {
  order: OrderRow;
  recordedSaleIds: string[];
}

export const orderService = {
  /**
   * Create an order for a single inventory item (demo helper to exercise the
   * fulfillment flow). Prices from the item's listing/target/market value when
   * no explicit sale price is given. Returns undefined if the item is missing.
   */
  createFromInventory(
    userId: string,
    inventoryId: string,
    opts: CreateOrderFromInventoryOptions = {},
  ): OrderRow | undefined {
    const inv = inventoryRepository.getById(userId, inventoryId);
    if (!inv) return undefined;

    const settings = settingsService.getPricingSettings(userId);

    // Prefer an explicit price, else the most recent listing price, else the
    // item's target/market value.
    let salePrice = opts.salePrice;
    let marketplace: string | null = opts.marketplace ?? inv.marketplace ?? null;
    if (salePrice === undefined) {
      const listings = listingsRepository.listForInventory(userId, inventoryId);
      const active = listings.find((l) => l.price && l.price > 0);
      if (active) {
        salePrice = active.price;
        marketplace = marketplace ?? active.marketplace;
      }
    }
    if (salePrice === undefined) {
      salePrice = inv.target_price ?? inv.market_value ?? 0;
    }
    salePrice = round2(salePrice ?? 0);

    const fees = estimateFees(salePrice, settings);
    const shipping = opts.shipping !== undefined ? round2(opts.shipping) : round2(settings.shippingCost);

    const order = ordersRepository.create({
      user_id: userId,
      marketplace: marketplace ?? 'eBay',
      buyer: opts.buyer ?? null,
      sale_price: salePrice,
      fees,
      shipping,
      net_revenue: round2(salePrice - fees - shipping - settings.packagingCost - (inv.acquisition_cost ?? 0)),
      status: 'New',
    });

    orderItemsRepository.create({
      order_id: order.id,
      inventory_id: inv.id,
      card_id: inv.card_id ?? null,
      quantity: 1,
      unit_price: salePrice,
    });

    return ordersRepository.getById(userId, order.id);
  },

  /**
   * Advance an order to a new status, enforcing the allowed transitions. On
   * Shipped/Delivered it records the sale and flips inventory to Sold. `Shipped`
   * also stamps shipped_at (and stores the tracking number when provided).
   * Returns undefined for an unknown order or a disallowed transition.
   */
  transition(
    userId: string,
    orderId: string,
    toStatus: string,
    opts: { tracking_number?: string | null } = {},
  ): TransitionResult | undefined {
    const order = ordersRepository.getById(userId, orderId);
    if (!order) return undefined;
    if (!isOrderStatus(toStatus)) return undefined;
    if (!canTransition(order.status, toStatus)) return undefined;

    const patch: Record<string, unknown> = { status: toStatus };
    if (opts.tracking_number !== undefined) {
      patch.tracking_number = opts.tracking_number ? opts.tracking_number : null;
    }
    if (toStatus === 'Shipped' && !order.shipped_at) {
      patch.shipped_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
    }

    ordersRepository.update(userId, orderId, patch);

    let recordedSaleIds: string[] = [];
    if (SALE_REALIZED_STATUSES.includes(toStatus)) {
      const result = recordSale(userId, orderId);
      if (result) recordedSaleIds = result.saleIds;
    }

    return { order: ordersRepository.getById(userId, orderId)!, recordedSaleIds };
  },

  /** Store/update just the tracking number (user-scoped). */
  setTracking(userId: string, orderId: string, tracking: string | null): OrderRow | undefined {
    const order = ordersRepository.getById(userId, orderId);
    if (!order) return undefined;
    ordersRepository.update(userId, orderId, { tracking_number: tracking ? tracking : null });
    return ordersRepository.getById(userId, orderId);
  },

  /** Profit breakdown for an order (for the detail view). */
  profitFor(userId: string, orderId: string) {
    const order = ordersRepository.getById(userId, orderId);
    if (!order) return undefined;
    const settings = settingsService.getPricingSettings(userId);
    const items = orderItemsRepository.rawForOrder(orderId);
    return computeOrderProfit(order, items, settings);
  },
};
