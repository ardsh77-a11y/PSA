import { renderLayout } from '../layout.js';
import { statusBadge, cardThumb } from '../components/index.js';
import { escapeHtml } from '../../util/html.js';
import type { UserRecord } from '../../server/router.js';
import type { InventoryRow } from '../../repositories/inventoryRepository.js';
import type { PriceSnapshot } from '../../repositories/priceSnapshotsRepository.js';
import type { Listing } from '../../repositories/listingsRepository.js';
import type { Sale } from '../../repositories/salesRepository.js';
import { describeLocation, type StorageLocation } from '../../repositories/storageLocationsRepository.js';
import { INVENTORY_STATUSES, statusTone, strategyFor } from '../../domain/tcg.js';

export interface CardDetailPageData {
  user: UserRecord;
  row: InventoryRow;
  priceHistory: PriceSnapshot[];
  latestSnapshot?: PriceSnapshot;
  listings: Listing[];
  sales: Sale[];
  storageLocations: StorageLocation[];
}

function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `$${v.toFixed(2)}`;
}

/** Render an inline SVG sparkline of market price over time. */
function sparkline(history: PriceSnapshot[]): string {
  const points = history
    .map((s) => s.market_price)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (points.length < 2) return '';

  const w = 320;
  const h = 64;
  const pad = 4;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = (w - pad * 2) / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = pad + i * step;
    const y = h - pad - ((p - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const path = `M${coords.join(' L')}`;
  const last = coords[coords.length - 1].split(',');
  return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Market price history">
    <polyline fill="none" stroke="var(--c-blue)" stroke-width="2" points="${escapeHtml(coords.join(' '))}" />
    <path d="${escapeHtml(path)} L${w - pad},${h - pad} L${pad},${h - pad} Z" fill="var(--c-blue-soft)" opacity="0.6" stroke="none" />
    <circle cx="${escapeHtml(last[0])}" cy="${escapeHtml(last[1])}" r="3" fill="var(--c-blue)" />
  </svg>`;
}

function priceTable(history: PriceSnapshot[]): string {
  const rows = history
    .slice()
    .reverse()
    .slice(0, 8)
    .map(
      (s) => `<tr>
        <td>${escapeHtml(s.captured_at.slice(0, 10))}</td>
        <td class="num">${escapeHtml(money(s.market_price))}</td>
        <td class="num">${escapeHtml(money(s.low))}</td>
        <td class="num">${escapeHtml(money(s.high))}</td>
      </tr>`,
    )
    .join('');
  return `<table class="data-table price-table"><thead><tr><th>Date</th><th class="num">Market</th><th class="num">Low</th><th class="num">High</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function statusSelect(current: string): string {
  const opts = INVENTORY_STATUSES.map(
    (s) => `<option value="${escapeHtml(s)}"${s === current ? ' selected' : ''}>${escapeHtml(s)}</option>`,
  ).join('');
  return `<select data-status-select aria-label="Change status">${opts}</select>`;
}

export function renderCardDetailPage(data: CardDetailPageData): string {
  const { row } = data;
  const strategy = strategyFor('pokemon');
  const title = row.card_name ?? 'Unlinked inventory item';
  const setLine = [row.set_name, row.set_abbreviation ? `(${row.set_abbreviation})` : '', row.card_number]
    .filter(Boolean)
    .join(' · ');

  const marketValue = row.market_value ?? data.latestSnapshot?.market_price ?? null;
  const costBasis = row.acquisition_cost * row.quantity;
  const totalMarket = marketValue !== null ? marketValue * row.quantity : null;
  const profit = totalMarket !== null ? totalMarket - costBasis : null;
  const profitClass = profit === null ? '' : profit >= 0 ? ' profit-positive' : ' profit-negative';

  const location = describeLocation({
    box: row.storage_box,
    shelf: row.storage_shelf,
    slot: row.storage_slot,
    label: row.storage_label,
  });

  const infoRows = [
    ['Set', setLine || '—'],
    ['Number', row.card_number ?? '—'],
    ['Rarity', row.rarity ?? '—'],
    ['Type', row.card_type ?? '—'],
    ['Finish', row.is_reverse_holo ? 'Reverse Holo' : row.is_holo ? 'Holo' : 'Non-holo'],
    ['Condition', row.condition],
    ['Quantity', String(row.quantity)],
    ['SKU', row.sku ?? '—'],
    ['Storage', location],
  ]
    .map(([label, val]) => `<div class="info-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(val)}</dd></div>`)
    .join('');

  const chart =
    data.priceHistory.length >= 2
      ? `<div class="price-history">${sparkline(data.priceHistory)}${priceTable(data.priceHistory)}</div>`
      : data.priceHistory.length === 1
        ? priceTable(data.priceHistory)
        : `<p class="muted">No price history captured yet.</p>`;

  const listingsSection =
    data.listings.length > 0
      ? `<table class="data-table"><thead><tr><th>Marketplace</th><th>Title</th><th class="num">Price</th><th>Status</th></tr></thead><tbody>${data.listings
          .map(
            (l) => `<tr><td>${escapeHtml(l.marketplace ?? '—')}</td><td>${escapeHtml(l.title)}</td><td class="num">${escapeHtml(money(l.price))}</td><td>${statusBadge(l.status, 'info')}</td></tr>`,
          )
          .join('')}</tbody></table>`
      : `<p class="muted">No marketplace listings yet.</p>`;

  const salesSection =
    data.sales.length > 0
      ? `<table class="data-table"><thead><tr><th>Date</th><th class="num">Sale</th><th class="num">Fees</th><th class="num">Net profit</th></tr></thead><tbody>${data.sales
          .map(
            (s) => `<tr><td>${escapeHtml(s.sold_at.slice(0, 10))}</td><td class="num">${escapeHtml(money(s.sale_price))}</td><td class="num">${escapeHtml(money(s.fees))}</td><td class="num">${escapeHtml(money(s.net_profit))}</td></tr>`,
          )
          .join('')}</tbody></table>`
      : `<p class="muted">No sales recorded yet.</p>`;

  const body = `<section class="page-header">
  <div>
    <a class="back-link" href="/inventory">← Back to inventory</a>
    <h1>${escapeHtml(title)}</h1>
    <p class="page-subtitle">${escapeHtml(
      strategy.formatCardTitle({
        name: row.card_name ?? '',
        pokemon_name: row.pokemon_name,
        number: row.card_number,
        rarity: row.rarity,
        is_holo: row.is_holo,
        is_reverse_holo: row.is_reverse_holo,
        set_name: row.set_name,
        set_abbreviation: row.set_abbreviation,
      }),
    )}</p>
  </div>
  <div class="page-actions">${statusBadge(row.status, statusTone(row.status))}</div>
</section>

<div class="detail-grid" data-card-detail data-inventory-id="${escapeHtml(row.id)}">
  <section class="panel detail-media">
    ${cardThumb(row.card_image_url, title, 'lg')}
  </section>

  <section class="panel detail-main">
    <div class="value-cards">
      <div class="value-card"><div class="value-label">Market value</div><div class="value-amount">${escapeHtml(money(marketValue))}</div><div class="value-hint">per card</div></div>
      <div class="value-card"><div class="value-label">Cost basis</div><div class="value-amount">${escapeHtml(money(costBasis))}</div><div class="value-hint">${escapeHtml(`${row.quantity} × ${money(row.acquisition_cost)}`)}</div></div>
      <div class="value-card${profitClass}"><div class="value-label">Est. profit</div><div class="value-amount">${escapeHtml(profit === null ? '—' : money(profit))}</div><div class="value-hint">market − cost</div></div>
    </div>

    <div class="detail-actions">
      <label class="inline-field"><span>Status</span>${statusSelect(row.status)}</label>
      <label class="inline-field"><span>Target price</span><input type="number" data-target-price value="${escapeHtml(row.target_price ?? '')}" min="0" step="0.01" placeholder="—" /></label>
      <button type="button" class="btn btn-primary btn-sm" data-save-detail>Save changes</button>
    </div>

    <dl class="info-list">${infoRows}</dl>
  </section>
</div>

<section class="panel">
  <div class="panel-header"><h2>Price history</h2></div>
  ${chart}
</section>

<section class="panel">
  <div class="panel-header"><h2>Listings</h2></div>
  ${listingsSection}
</section>

<section class="panel">
  <div class="panel-header"><h2>Sales history</h2></div>
  ${salesSection}
</section>`;

  return renderLayout({ title, user: data.user, activeNav: 'inventory', body });
}
