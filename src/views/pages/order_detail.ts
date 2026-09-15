import { renderLayout } from '../layout.js';
import { statusBadge, cardThumb } from '../components/index.js';
import { escapeHtml } from '../../util/html.js';
import type { UserRecord } from '../../server/router.js';
import type { OrderRow } from '../../repositories/ordersRepository.js';
import type { OrderItemRow } from '../../repositories/orderItemsRepository.js';
import { describeLocation } from '../../repositories/storageLocationsRepository.js';
import type { ProfitBreakdown } from '../../services/profitService.js';
import { orderStatusTone } from './orders.js';

export interface OrderDetailPageData {
  user: UserRecord;
  order: OrderRow;
  items: OrderItemRow[];
  profit: ProfitBreakdown;
}

function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const neg = v < 0;
  return `${neg ? '-' : ''}$${Math.abs(v).toFixed(2)}`;
}

/**
 * The fulfillment workflow (section 24). Renders the sold card(s) with photo +
 * storage location and a clear step ladder: Mark Picked -> Mark Packed -> enter
 * Tracking -> Mark Shipped. The active step is derived from the order status so
 * the seller always sees the single next action. Actions post to the JSON API
 * via app.js; a no-JS fallback posts the transition form.
 */

const STEP_ORDER = ['New', 'Picking', 'Packed', 'Shipped', 'Delivered'] as const;

function stepIndex(status: string): number {
  const i = (STEP_ORDER as readonly string[]).indexOf(status);
  return i < 0 ? 0 : i;
}

function renderItem(item: OrderItemRow): string {
  const name = item.card_name ?? item.pokemon_name ?? 'Card';
  const sub = [item.set_name, item.card_number, item.rarity].filter(Boolean).join(' · ');
  const location = describeLocation({
    box: item.storage_box,
    shelf: item.storage_shelf,
    slot: item.storage_slot,
    label: item.storage_label,
  });
  const cond = item.inventory_condition ? ` · ${item.inventory_condition}` : '';
  const sku = item.inventory_sku ? `<div class="row-sub">SKU ${escapeHtml(item.inventory_sku)}</div>` : '';
  return `<div class="fulfill-item">
    <div class="fulfill-item-photo">${cardThumb(item.card_image_url, name, 'lg')}</div>
    <div class="fulfill-item-body">
      <div class="fulfill-item-name">${escapeHtml(name)}${escapeHtml(cond)}</div>
      <div class="row-sub">${escapeHtml(sub)}</div>
      ${sku}
      <div class="fulfill-location">
        <span class="fulfill-location-label">Location</span>
        <span class="fulfill-location-value">${escapeHtml(location)}</span>
      </div>
      <div class="row-sub">Qty ${escapeHtml(String(item.quantity))} · ${escapeHtml(money(item.unit_price))} each</div>
    </div>
  </div>`;
}

function stepClass(status: string, step: (typeof STEP_ORDER)[number]): string {
  const cur = stepIndex(status);
  const idx = stepIndex(step);
  if (status === 'Cancelled' || status === 'Returned') return 'step done-terminal';
  if (idx < cur) return 'step done';
  if (idx === cur) return 'step current';
  return 'step pending';
}

function renderStepper(order: OrderRow): string {
  const steps = STEP_ORDER.map((s) => {
    const cls = stepClass(order.status, s);
    return `<li class="${cls}"><span class="step-dot" aria-hidden="true"></span><span class="step-label">${escapeHtml(s)}</span></li>`;
  }).join('');
  return `<ol class="fulfill-stepper">${steps}</ol>`;
}

/**
 * The primary action button(s) for the current status. Each carries a
 * data-order-action so app.js can PATCH the transition without a reload.
 */
function renderActions(order: OrderRow): string {
  const id = escapeHtml(order.id);
  const btn = (label: string, to: string, variant = 'primary') =>
    `<button type="button" class="btn btn-${variant} btn-lg" data-order-action data-order-id="${id}" data-order-to="${escapeHtml(to)}">${escapeHtml(label)}</button>`;

  const cancel = `<button type="button" class="btn btn-ghost" data-order-action data-order-id="${id}" data-order-to="Cancelled">Cancel order</button>`;

  switch (order.status) {
    case 'New':
      return `<div class="fulfill-actions">${btn('Mark Picked', 'Picking')}${cancel}</div>`;
    case 'Picking':
      return `<div class="fulfill-actions">${btn('Mark Packed', 'Packed')}${cancel}</div>`;
    case 'Packed':
      return `<div class="fulfill-actions">
        <div class="tracking-entry">
          <label for="tracking-input">Tracking number</label>
          <input type="text" id="tracking-input" data-order-tracking value="${escapeHtml(order.tracking_number ?? '')}" placeholder="e.g. 9400 1000 0000 0000 0000 00" />
        </div>
        ${btn('Mark Shipped', 'Shipped')}${cancel}
      </div>`;
    case 'Shipped':
      return `<div class="fulfill-actions">
        <div class="tracking-display">Tracking: <strong>${escapeHtml(order.tracking_number ?? '—')}</strong></div>
        ${btn('Mark Delivered', 'Delivered', 'secondary')}
        <button type="button" class="btn btn-ghost" data-order-action data-order-id="${id}" data-order-to="Returned">Mark Returned</button>
      </div>`;
    case 'Delivered':
      return `<div class="fulfill-actions">
        <div class="tracking-display">Tracking: <strong>${escapeHtml(order.tracking_number ?? '—')}</strong></div>
        <div class="fulfill-done">Order complete.</div>
        <button type="button" class="btn btn-ghost" data-order-action data-order-id="${id}" data-order-to="Returned">Mark Returned</button>
      </div>`;
    default:
      return `<div class="fulfill-actions"><div class="fulfill-done">Order ${escapeHtml(order.status.toLowerCase())}.</div></div>`;
  }
}

function renderProfit(p: ProfitBreakdown): string {
  const line = (label: string, value: number, negative = false) =>
    `<div class="profit-line"><span>${escapeHtml(label)}</span><span class="num">${negative && value !== 0 ? '-' : ''}${escapeHtml(money(negative ? Math.abs(value) : value))}</span></div>`;
  return `<div class="profit-breakdown" data-profit-breakdown>
    ${line('Sale price', p.salePrice)}
    ${line('Marketplace fees', p.fees, true)}
    ${line('Shipping', p.shipping, true)}
    ${line('Packaging', p.packaging, true)}
    ${line('Cost basis', p.costBasis, true)}
    ${line('Other expenses', p.otherExpenses, true)}
    <div class="profit-line profit-net"><span>Net profit</span><span class="num" data-profit-net>${escapeHtml(money(p.net))}</span></div>
  </div>`;
}

export function renderOrderDetailPage(data: OrderDetailPageData): string {
  const { order, items, profit } = data;
  const shortId = order.external_order_id ?? order.id.slice(0, 8);

  const meta = [
    order.marketplace ? `Marketplace: ${order.marketplace}` : null,
    order.buyer ? `Buyer: ${order.buyer}` : null,
    order.created_at ? `Placed: ${order.created_at}` : null,
    order.shipped_at ? `Shipped: ${order.shipped_at}` : null,
  ]
    .filter(Boolean)
    .map((t) => `<span class="order-meta-item">${escapeHtml(String(t))}</span>`)
    .join('');

  const itemsHtml = items.length
    ? items.map(renderItem).join('\n')
    : '<p class="muted">This order has no line items.</p>';

  const body = `<section class="page-header">
  <div>
    <h1>Order ${escapeHtml(shortId)}</h1>
    <p class="page-subtitle"><a href="/orders">← Back to orders</a></p>
  </div>
  <div class="page-actions" data-order-status>${statusBadge(order.status, orderStatusTone(order.status))}</div>
</section>

<div class="fulfill-layout" data-order-detail data-order-id="${escapeHtml(order.id)}">
  <section class="panel fulfill-main">
    <h2>Fulfillment</h2>
    ${renderStepper(order)}
    <div class="order-meta">${meta}</div>
    <div class="fulfill-items">${itemsHtml}</div>
    ${renderActions(order)}
  </section>
  <aside class="panel fulfill-side">
    <h2>Profit</h2>
    ${renderProfit(profit)}
  </aside>
</div>`;

  return renderLayout({ title: `Order ${shortId}`, user: data.user, activeNav: 'orders', body });
}
