import { renderLayout } from '../layout.js';
import { statusBadge, cardThumb, type BadgeTone } from '../components/index.js';
import { escapeHtml } from '../../util/html.js';
import type { UserRecord } from '../../server/router.js';
import type { InventoryRow } from '../../repositories/inventoryRepository.js';
import type { PriceSnapshot } from '../../repositories/priceSnapshotsRepository.js';
import type { Listing } from '../../repositories/listingsRepository.js';
import type { Sale } from '../../repositories/salesRepository.js';
import { describeLocation, type StorageLocation } from '../../repositories/storageLocationsRepository.js';
import { INVENTORY_STATUSES, statusTone, strategyFor } from '../../domain/tcg.js';
import { PRICING_MODES, PRICING_MODE_LABELS, type PricingMode } from '../../services/settings.js';
import type { PriceResult, MarketData } from '../../services/interfaces/pricing.js';
import type { ClassificationResult } from '../../services/interfaces/classification.js';

export interface CardDetailPageData {
  user: UserRecord;
  row: InventoryRow;
  priceHistory: PriceSnapshot[];
  latestSnapshot?: PriceSnapshot;
  listings: Listing[];
  sales: Sale[];
  storageLocations: StorageLocation[];
  mode: PricingMode;
  marketData: MarketData | null;
  pricing: PriceResult | null;
  classification: ClassificationResult | null;
}

const DECISION_LABEL: Record<string, string> = {
  SELL_INDIVIDUALLY: 'Sell individually',
  BULK: 'Bulk',
  REVIEW: 'Review',
};

function decisionBadge(decision: string | undefined): string {
  if (!decision) return statusBadge('—', 'neutral');
  const tone: BadgeTone =
    decision === 'SELL_INDIVIDUALLY' ? 'success' : decision === 'BULK' ? 'neutral' : 'warning';
  return statusBadge(DECISION_LABEL[decision] ?? decision, tone);
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

function conditionSelect(current: string): string {
  const opts = strategyFor('pokemon')
    .conditionOptions()
    .map(
      (c) => `<option value="${escapeHtml(c.code)}"${c.code === current ? ' selected' : ''}>${escapeHtml(c.label)} (${escapeHtml(c.code)})</option>`,
    )
    .join('');
  return `<select data-price-condition aria-label="Condition for pricing">${opts}</select>`;
}

/** Storage-location assignment dropdown (section 21). Assigns on change. */
function storageSelect(
  locations: StorageLocation[],
  current: string | null,
  inventoryId: string,
): string {
  const options = [`<option value=""${current ? '' : ' selected'}>Unassigned</option>`]
    .concat(
      locations.map(
        (l) =>
          `<option value="${escapeHtml(l.id)}"${l.id === current ? ' selected' : ''}>${escapeHtml(describeLocation(l))}</option>`,
      ),
    )
    .join('');
  return `<select data-storage-assign data-inventory-id="${escapeHtml(inventoryId)}" aria-label="Storage location">${options}</select>`;
}

function modeSelect(current: PricingMode): string {
  const opts = PRICING_MODES.map(
    (m) => `<option value="${escapeHtml(m)}"${m === current ? ' selected' : ''}>${escapeHtml(PRICING_MODE_LABELS[m])}</option>`,
  ).join('');
  return `<select data-price-mode aria-label="Pricing mode">${opts}</select>`;
}

/** The section-15 price panel. Values carry data hooks for live recompute. */
function pricePanel(data: CardDetailPageData): string {
  const { pricing, marketData } = data;
  if (!data.row.card_id) {
    return `<p class="muted">Link this item to a card to see pricing.</p>`;
  }
  if (!pricing) {
    return `<p class="muted">No market data available for this card yet.</p>`;
  }
  const comp = marketData ? String(marketData.competitionCount) : '—';
  return `<div class="price-controls">
    <label class="inline-field"><span>Condition</span>${conditionSelect(data.row.condition)}</label>
    <label class="inline-field"><span>Mode</span>${modeSelect(data.mode)}</label>
  </div>
  <div class="price-panel value-cards" data-price-panel>
    <div class="value-card"><div class="value-label">Market</div><div class="value-amount" data-price-market>${escapeHtml(money(pricing.marketPrice))}</div><div class="value-hint">${escapeHtml(`${comp} comparable listings`)}</div></div>
    <div class="value-card"><div class="value-label">Recommended listing</div><div class="value-amount" data-price-suggested>${escapeHtml(money(pricing.suggestedPrice))}</div><div class="value-hint">at your ${escapeHtml(PRICING_MODE_LABELS[pricing.mode])} mode</div></div>
    <div class="value-card"><div class="value-label">Estimated fees</div><div class="value-amount" data-price-fees>${escapeHtml(money(pricing.estimatedFees))}</div><div class="value-hint">marketplace fees</div></div>
    <div class="value-card"><div class="value-label">Estimated shipping</div><div class="value-amount" data-price-shipping>${escapeHtml(money(pricing.estimatedShipping))}</div><div class="value-hint">seller pays</div></div>
    <div class="value-card"><div class="value-label">Estimated net</div><div class="value-amount" data-price-net>${escapeHtml(money(pricing.estimatedNet))}</div><div class="value-hint">after fees + shipping</div></div>
  </div>`;
}

/** The section-10 recommendation card (decision badge + explanation). */
function recommendationCard(data: CardDetailPageData): string {
  const c = data.classification;
  if (!c) {
    return `<p class="muted">A recommendation appears once pricing data is available.</p>`;
  }
  return `<div class="recommendation-card" data-recommendation>
    <div class="recommendation-head">
      <span data-decision-badge>${decisionBadge(c.decision)}</span>
      <span class="recommendation-score">Score ${escapeHtml(String(Math.round(c.score)))}/100</span>
    </div>
    <p class="recommendation-reason" data-recommendation-reason>${escapeHtml(c.reason)}</p>
  </div>`;
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
  <div class="page-actions">
    ${row.card_id ? `<button type="button" class="btn btn-primary" data-generate-listing data-inventory-id="${escapeHtml(row.id)}">Generate listing</button>` : ''}
    ${statusBadge(row.status, statusTone(row.status))}
  </div>
</section>

<div class="detail-grid" data-card-detail data-inventory-id="${escapeHtml(row.id)}" data-card-id="${escapeHtml(row.card_id ?? '')}">
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
      <label class="inline-field"><span>Storage</span>${storageSelect(data.storageLocations, row.storage_location_id, row.id)}</label>
      <button type="button" class="btn btn-primary btn-sm" data-save-detail>Save changes</button>
    </div>

    <dl class="info-list">${infoRows}</dl>
  </section>
</div>

<section class="panel">
  <div class="panel-header"><h2>Pricing</h2></div>
  ${pricePanel(data)}
</section>

<section class="panel">
  <div class="panel-header"><h2>Recommendation</h2></div>
  ${recommendationCard(data)}
</section>

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
