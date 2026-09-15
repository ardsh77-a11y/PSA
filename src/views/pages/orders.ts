import { renderLayout } from '../layout.js';
import { statusBadge, emptyState, cardThumb, type BadgeTone } from '../components/index.js';
import { escapeHtml } from '../../util/html.js';
import type { UserRecord } from '../../server/router.js';
import type { OrderRow, OrderSearchFilters } from '../../repositories/ordersRepository.js';
import { ORDER_STATUSES } from '../../repositories/ordersRepository.js';
import { describeLocation } from '../../repositories/storageLocationsRepository.js';

export interface OrdersPageData {
  user: UserRecord;
  orders: OrderRow[];
  filters: OrderSearchFilters;
}

function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `$${v.toFixed(2)}`;
}

/** Tone for an order status badge. */
export function orderStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'New':
      return 'info';
    case 'Picking':
    case 'Packed':
      return 'warning';
    case 'Shipped':
      return 'info';
    case 'Delivered':
      return 'success';
    case 'Cancelled':
      return 'danger';
    case 'Returned':
      return 'danger';
    default:
      return 'neutral';
  }
}

function cardSummary(o: OrderRow): string {
  const name = o.first_card_name ?? 'Item';
  const extra = o.item_count > 1 ? ` +${o.item_count - 1} more` : '';
  const sub = [o.first_set_name, o.first_card_number].filter(Boolean).join(' · ');
  return `<a href="/orders/${encodeURIComponent(o.id)}" class="row-title">${escapeHtml(name)}${escapeHtml(extra)}</a>
    <div class="row-sub">${escapeHtml(sub)}</div>`;
}

function locationText(o: OrderRow): string {
  return describeLocation({ box: o.storage_box, shelf: o.storage_shelf, slot: o.storage_slot, label: o.storage_label });
}

function selectOptions(values: readonly string[], selected: string | undefined): string {
  return values
    .map((v) => `<option value="${escapeHtml(v)}"${v === selected ? ' selected' : ''}>${escapeHtml(v)}</option>`)
    .join('');
}

function renderRow(o: OrderRow): string {
  const shortId = o.external_order_id ?? o.id.slice(0, 8);
  return `<tr data-order-row data-order-id="${escapeHtml(o.id)}">
    <td class="col-thumb">${cardThumb(o.first_card_image_url, o.first_card_name ?? 'Order', 'sm')}</td>
    <td class="col-id"><a href="/orders/${encodeURIComponent(o.id)}" class="row-title">${escapeHtml(shortId)}</a></td>
    <td class="col-name">${cardSummary(o)}</td>
    <td>${escapeHtml(o.buyer ?? '—')}</td>
    <td class="num">${escapeHtml(money(o.sale_price))}</td>
    <td class="num">${escapeHtml(money(o.fees))}</td>
    <td class="num">${escapeHtml(money(o.shipping))}</td>
    <td class="num">${escapeHtml(money(o.net_revenue))}</td>
    <td>${escapeHtml(locationText(o))}</td>
    <td data-order-status>${statusBadge(o.status, orderStatusTone(o.status))}</td>
    <td class="col-actions"><a class="btn btn-ghost btn-sm" href="/orders/${encodeURIComponent(o.id)}">Fulfill</a></td>
  </tr>`;
}

export function renderOrdersPage(data: OrdersPageData): string {
  const { orders, filters } = data;

  const filterBar = `<form class="filter-bar" method="get" action="/orders">
    <div class="filter-search">
      <input type="search" name="q" value="${escapeHtml(filters.q ?? '')}" placeholder="Search buyer, order #, tracking…" aria-label="Search orders" />
    </div>
    <select name="status" aria-label="Status"><option value="">Any status</option>${selectOptions(ORDER_STATUSES, filters.status)}</select>
    <button type="submit" class="btn btn-primary">Filter</button>
    <a class="btn btn-ghost" href="/orders">Reset</a>
  </form>`;

  let content: string;
  if (orders.length === 0) {
    const anyFilter = Boolean(filters.q || filters.status || filters.marketplace);
    content = emptyState(
      anyFilter
        ? {
            title: 'No matching orders',
            message: 'No orders match these filters. Try widening your search or resetting the filters.',
            actionLabel: 'Reset filters',
            actionHref: '/orders',
          }
        : {
            title: 'No orders yet',
            message: 'Orders appear here when a listing sells. Once an order arrives you can pick, pack and ship it from its fulfillment view.',
            actionLabel: 'Go to listings',
            actionHref: '/listings',
          },
    );
  } else {
    const head = `<tr>
      <th class="col-thumb"></th>
      <th>Order</th>
      <th>Card(s)</th>
      <th>Buyer</th>
      <th class="num">Sale</th>
      <th class="num">Fees</th>
      <th class="num">Shipping</th>
      <th class="num">Net</th>
      <th>Location</th>
      <th>Status</th>
      <th class="col-actions"></th>
    </tr>`;
    const rows = orders.map(renderRow).join('\n');
    content = `<div class="table-wrap">
      <table class="data-table orders-table" data-orders-table><thead>${head}</thead><tbody>${rows}</tbody></table>
    </div>`;
  }

  const body = `<section class="page-header">
  <div>
    <h1>Orders</h1>
    <p class="page-subtitle">${escapeHtml(`${orders.length} order${orders.length === 1 ? '' : 's'}`)}</p>
  </div>
  <div class="page-actions">
    <a class="btn btn-secondary" href="/rips">Pack / Rip tracking</a>
  </div>
</section>

<section class="panel" data-orders-page>
  ${filterBar}
  ${content}
</section>`;

  return renderLayout({ title: 'Orders', user: data.user, activeNav: 'orders', body });
}
