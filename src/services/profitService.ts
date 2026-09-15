import { getDb } from '../db/connection.js';
import { ordersRepository, type Order, SALE_REALIZED_STATUSES, isOrderStatus } from '../repositories/ordersRepository.js';
import { orderItemsRepository, type OrderItem } from '../repositories/orderItemsRepository.js';
import { salesRepository } from '../repositories/salesRepository.js';
import { inventoryRepository } from '../repositories/inventoryRepository.js';
import { settingsService, type PricingSettings } from './settings.js';

/**
 * True profit tracking (section 25). Net profit is:
 *
 *   net = sale_price
 *         - marketplace_fees        (fee % of sale_price + fixed fee)
 *         - shipping                (seller-paid shipping)
 *         - packaging               (materials cost per order)
 *         - card acquisition cost   (sum of the items' cost basis / rip cost)
 *         - other allocated expenses
 *
 * Fee/shipping/packaging defaults come from the user's pricing Settings, but an
 * order that already carries its own fees/shipping (e.g. from a marketplace
 * import) uses those actuals instead of the estimate.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface ProfitBreakdown {
  salePrice: number;
  fees: number;
  shipping: number;
  packaging: number;
  costBasis: number;
  otherExpenses: number;
  net: number;
}

export interface ComputeProfitOptions {
  /** Override the marketplace fees (use the order's actual fees). */
  fees?: number;
  /** Override shipping cost. */
  shipping?: number;
  /** Override packaging cost. */
  packaging?: number;
  /** Extra allocated expenses beyond the items' cost basis. */
  otherExpenses?: number;
}

/** The cost basis carried by an order item (acquisition / rip cost). */
export function itemCostBasis(item: Pick<OrderItem, 'inventory_id' | 'quantity'>, userId: string): number {
  if (!item.inventory_id) return 0;
  const inv = inventoryRepository.getById(userId, item.inventory_id);
  if (!inv) return 0;
  return round2((inv.acquisition_cost ?? 0) * (item.quantity ?? 1));
}

/**
 * Compute the marketplace fees for a sale price from settings: fee % of the
 * sale price plus the fixed per-order fee.
 */
export function estimateFees(salePrice: number, settings: PricingSettings): number {
  return round2(salePrice * settings.feePct + settings.fixedFee);
}

/**
 * Compute the profit breakdown for an order + its items. Uses the order's
 * actual fees/shipping when present (> 0), otherwise estimates from settings.
 * `costBasis` is the sum of the items' acquisition cost unless an override is
 * supplied.
 */
export function computeOrderProfit(
  order: Pick<Order, 'user_id' | 'sale_price' | 'fees' | 'shipping'>,
  items: Array<Pick<OrderItem, 'inventory_id' | 'quantity'>>,
  settings: PricingSettings,
  opts: ComputeProfitOptions = {},
): ProfitBreakdown {
  const salePrice = round2(order.sale_price ?? 0);

  const fees =
    opts.fees !== undefined
      ? round2(opts.fees)
      : order.fees && order.fees > 0
        ? round2(order.fees)
        : estimateFees(salePrice, settings);

  const shipping =
    opts.shipping !== undefined
      ? round2(opts.shipping)
      : order.shipping && order.shipping > 0
        ? round2(order.shipping)
        : round2(settings.shippingCost);

  const packaging = opts.packaging !== undefined ? round2(opts.packaging) : round2(settings.packagingCost);

  const costBasis =
    opts.otherExpenses === undefined && items.length === 0
      ? 0
      : round2(items.reduce((sum, it) => sum + itemCostBasis(it, order.user_id), 0));

  const otherExpenses = opts.otherExpenses !== undefined ? round2(opts.otherExpenses) : 0;

  const net = round2(salePrice - fees - shipping - packaging - costBasis - otherExpenses);

  return { salePrice, fees, shipping, packaging, costBasis, otherExpenses, net };
}

export interface RecordSaleResult {
  order: Order;
  breakdown: ProfitBreakdown;
  saleIds: string[];
}

/**
 * When an order reaches Shipped/Delivered, record the realized sale(s) and flip
 * the linked inventory to Sold. Idempotent: if sales already exist for the
 * order, it does not double-record. The per-item net profit apportions the
 * order-level fees/shipping/packaging proportionally by unit price.
 */
export function recordSale(userId: string, orderId: string): RecordSaleResult | undefined {
  const order = ordersRepository.getById(userId, orderId);
  if (!order) return undefined;
  if (!isOrderStatus(order.status) || !SALE_REALIZED_STATUSES.includes(order.status)) return undefined;

  // Idempotency: don't re-record if this order already produced sales.
  const existing = salesRepository.listForOrder(userId, orderId);
  const settings = settingsService.getPricingSettings(userId);
  const items = orderItemsRepository.rawForOrder(orderId);
  const breakdown = computeOrderProfit(order, items, settings);

  if (existing.length > 0) {
    return { order, breakdown, saleIds: existing.map((s) => s.id) };
  }

  // Apportion order-level costs (fees + shipping + packaging) across items by
  // their unit price so each sale row carries a fair slice.
  const overhead = round2(breakdown.fees + breakdown.shipping + breakdown.packaging);
  const totalUnit = items.reduce((sum, it) => sum + (it.unit_price ?? 0) * (it.quantity ?? 1), 0);

  const saleIds: string[] = [];
  const soldAt = new Date().toISOString().slice(0, 19).replace('T', ' ');

  if (items.length === 0) {
    // Order with no line items: record a single sale row against the order.
    const sale = salesRepository.create({
      user_id: userId,
      order_id: orderId,
      sale_price: breakdown.salePrice,
      fees: breakdown.fees,
      shipping: breakdown.shipping,
      cost_basis: breakdown.costBasis,
      net_profit: breakdown.net,
      sold_at: soldAt,
    });
    saleIds.push(sale.id);
    return { order, breakdown, saleIds };
  }

  for (const item of items) {
    const itemRevenue = round2((item.unit_price ?? 0) * (item.quantity ?? 1));
    const share = totalUnit > 0 ? itemRevenue / totalUnit : 1 / items.length;
    const itemOverhead = round2(overhead * share);
    const costBasis = itemCostBasis(item, userId);
    const feeShare = round2(breakdown.fees * share);
    const shipShare = round2(breakdown.shipping * share);
    const net = round2(itemRevenue - itemOverhead - costBasis);

    const sale = salesRepository.create({
      user_id: userId,
      order_id: orderId,
      inventory_id: item.inventory_id ?? null,
      card_id: item.card_id ?? null,
      sale_price: itemRevenue,
      fees: feeShare,
      shipping: shipShare,
      cost_basis: costBasis,
      net_profit: net,
      sold_at: soldAt,
    });
    saleIds.push(sale.id);

    // Flip the linked inventory row to Sold with a sold date.
    if (item.inventory_id) {
      const inv = inventoryRepository.getById(userId, item.inventory_id);
      if (inv) {
        inventoryRepository.update(userId, item.inventory_id, { status: 'Sold' });
        getDb()
          .prepare("UPDATE inventory SET date_sold = ?, updated_at = datetime('now') WHERE user_id = ? AND id = ?")
          .run(soldAt, userId, item.inventory_id);
      }
    }
  }

  return { order, breakdown, saleIds };
}

export const profitService = {
  computeOrderProfit,
  recordSale,
  estimateFees,
  itemCostBasis,
};
