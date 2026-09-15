import { renderLayout } from '../layout.js';
import { statusBadge, emptyState, pagination, cardThumb, demoBanner } from '../components/index.js';
import { escapeHtml } from '../../util/html.js';
import type { UserRecord } from '../../server/router.js';
import type { InventorySearchParams, InventorySearchResult, InventoryRow } from '../../repositories/inventoryRepository.js';
import type { CardSet } from '../../repositories/setsRepository.js';
import { describeLocation, type StorageLocation } from '../../repositories/storageLocationsRepository.js';
import { INVENTORY_STATUSES, statusTone, strategyFor } from '../../domain/tcg.js';

export interface InventoryPageData {
  user: UserRecord;
  result: InventorySearchResult;
  params: InventorySearchParams;
  sets: CardSet[];
  rarities: string[];
  storageLocations: StorageLocation[];
  showDemoBanner: boolean;
  /** Optional heading override (used by Singles/Bulk filtered views). */
  heading?: string;
  subtitle?: string;
  activeNav?: string;
}

function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `$${v.toFixed(2)}`;
}

function selectOptions(values: string[], selected: string | undefined): string {
  return values
    .map((val) => `<option value="${escapeHtml(val)}"${val === selected ? ' selected' : ''}>${escapeHtml(val)}</option>`)
    .join('');
}

/** Build a query string for the current filters, overriding some keys. */
function buildQuery(params: InventorySearchParams, overrides: Record<string, string | number | undefined>): string {
  const merged: Record<string, string> = {};
  const src: Record<string, unknown> = {
    q: params.q,
    setId: params.setId,
    rarity: params.rarity,
    condition: params.condition,
    status: params.status,
    minPrice: params.minPrice,
    maxPrice: params.maxPrice,
    sku: params.sku,
    storageLocationId: params.storageLocationId,
    classification: params.classification,
    sort: params.sort,
    page: params.page,
    pageSize: params.pageSize,
  };
  for (const [k, val] of Object.entries({ ...src, ...overrides })) {
    if (val === undefined || val === null || val === '') continue;
    merged[k] = String(val);
  }
  const qs = Object.entries(merged)
    .map(([k, val]) => `${encodeURIComponent(k)}=${encodeURIComponent(val)}`)
    .join('&');
  return qs ? `?${qs}` : '';
}

function sortHeader(label: string, token: string, params: InventorySearchParams): string {
  const current = params.sort ?? '';
  const isAsc = current === token || current === `+${token}`;
  const isDesc = current === `-${token}`;
  const next = isAsc ? `-${token}` : token;
  const arrow = isAsc ? ' ▲' : isDesc ? ' ▼' : '';
  const href = buildQuery(params, { sort: next, page: 1 });
  return `<th><a class="sort-link" href="${escapeHtml(href)}">${escapeHtml(label)}${arrow}</a></th>`;
}

function rarityBadge(rarity: string | null): string {
  if (!rarity) return '—';
  const rank = strategyFor('pokemon').rarityRank(rarity);
  const cls = rank >= 6 ? 'rarity-chase' : rank >= 4 ? 'rarity-holo' : 'rarity-common';
  return `<span class="rarity-badge ${cls}">${escapeHtml(rarity)}</span>`;
}

function renderRow(row: InventoryRow): string {
  const title = row.card_name ?? 'Unlinked item';
  const setLine = [row.set_name, row.card_number].filter(Boolean).join(' · ');
  const holo = row.is_reverse_holo ? ' Reverse Holo' : row.is_holo ? ' Holo' : '';
  const location = describeLocation({
    box: row.storage_box,
    shelf: row.storage_shelf,
    slot: row.storage_slot,
    label: row.storage_label,
  });
  const detailHref = `/inventory/${encodeURIComponent(row.id)}`;
  const canGenerate = Boolean(row.card_id);
  return `<tr data-inventory-row data-inventory-id="${escapeHtml(row.id)}">
    <td class="col-select">${canGenerate ? `<input type="checkbox" data-inventory-select value="${escapeHtml(row.id)}" aria-label="Select ${escapeHtml(title)}" />` : ''}</td>
    <td class="col-thumb">${cardThumb(row.card_image_url, title, 'sm')}</td>
    <td class="col-name">
      <a href="${escapeHtml(detailHref)}" class="row-title">${escapeHtml(title)}</a>
      <div class="row-sub">${escapeHtml(setLine)}${escapeHtml(holo)}</div>
    </td>
    <td>${rarityBadge(row.rarity)}</td>
    <td>${escapeHtml(row.condition)}</td>
    <td class="num">${escapeHtml(String(row.quantity))}</td>
    <td class="num">${escapeHtml(money(row.market_value))}</td>
    <td class="num">${escapeHtml(money(row.target_price))}</td>
    <td>${statusBadge(row.status, statusTone(row.status))}</td>
    <td class="col-sku">${escapeHtml(row.sku ?? '—')}</td>
    <td>${escapeHtml(location)}</td>
    <td class="col-actions">
      <a class="btn btn-ghost btn-sm" href="${escapeHtml(detailHref)}">View</a>
      ${canGenerate ? `<button type="button" class="btn btn-ghost btn-sm" data-generate-listing data-inventory-id="${escapeHtml(row.id)}">Generate listing</button>` : ''}
    </td>
  </tr>`;
}

export function renderInventoryPage(data: InventoryPageData): string {
  const { params, result, sets, rarities, storageLocations } = data;
  const strategy = strategyFor('pokemon');
  const conditions = strategy.conditionOptions().map((c) => c.code);

  const setOptions = sets
    .map((s) => `<option value="${escapeHtml(s.id)}"${s.id === params.setId ? ' selected' : ''}>${escapeHtml(s.name)}${s.abbreviation ? ` (${escapeHtml(s.abbreviation)})` : ''}</option>`)
    .join('');
  const locationOptions = storageLocations
    .map((l) => `<option value="${escapeHtml(l.id)}"${l.id === params.storageLocationId ? ' selected' : ''}>${escapeHtml(describeLocation(l))}</option>`)
    .join('');

  const filterBar = `<form class="filter-bar" method="get" action="/inventory" data-inventory-filters>
    <div class="filter-search">
      <input type="search" name="q" value="${escapeHtml(params.q ?? '')}" placeholder="Search name, number, SKU, set…" aria-label="Search inventory" />
    </div>
    <select name="setId" aria-label="Set"><option value="">All sets</option>${setOptions}</select>
    <select name="rarity" aria-label="Rarity"><option value="">All rarities</option>${selectOptions(rarities, params.rarity)}</select>
    <select name="condition" aria-label="Condition"><option value="">Any condition</option>${selectOptions(conditions, params.condition)}</select>
    <select name="status" aria-label="Status"><option value="">Any status</option>${selectOptions([...INVENTORY_STATUSES], params.status)}</select>
    <select name="storageLocationId" aria-label="Storage"><option value="">Any location</option>${locationOptions}</select>
    <input type="number" name="minPrice" value="${escapeHtml(params.minPrice ?? '')}" placeholder="Min $" step="0.01" min="0" aria-label="Minimum price" class="price-input" />
    <input type="number" name="maxPrice" value="${escapeHtml(params.maxPrice ?? '')}" placeholder="Max $" step="0.01" min="0" aria-label="Maximum price" class="price-input" />
    ${params.sort ? `<input type="hidden" name="sort" value="${escapeHtml(params.sort)}" />` : ''}
    <button type="submit" class="btn btn-primary">Filter</button>
    <a class="btn btn-ghost" href="/inventory">Reset</a>
  </form>`;

  let content: string;
  if (result.total === 0) {
    const anyFilter = Boolean(
      params.q || params.setId || params.rarity || params.condition || params.status || params.minPrice || params.maxPrice || params.storageLocationId,
    );
    content = emptyState(
      anyFilter
        ? {
            title: 'No matching cards',
            message: 'No inventory matches these filters. Try widening your search or resetting the filters.',
            actionLabel: 'Reset filters',
            actionHref: '/inventory',
          }
        : {
            title: 'Your inventory is empty',
            message: 'Add your first card manually, or scan a batch to auto-identify singles.',
            actionLabel: 'Add a card',
            actionHref: '/inventory/new',
          },
    );
  } else {
    const head = `<tr>
      <th class="col-select"><input type="checkbox" data-inventory-select-all aria-label="Select all" /></th>
      <th class="col-thumb"></th>
      ${sortHeader('Card', 'name', params)}
      ${sortHeader('Rarity', 'rarity', params)}
      ${sortHeader('Cond.', 'condition', params)}
      ${sortHeader('Qty', 'quantity', params)}
      ${sortHeader('Market', 'value', params)}
      ${sortHeader('Target', 'target', params)}
      ${sortHeader('Status', 'status', params)}
      ${sortHeader('SKU', 'sku', params)}
      <th>Location</th>
      <th class="col-actions"></th>
    </tr>`;
    const rowsHtml = result.rows.map(renderRow).join('\n');
    const pager = pagination({
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      hrefForPage: (p) => `/inventory${buildQuery(params, { page: p })}`,
    });
    const batchBar = `<div class="batch-bar" data-batch-bar hidden>
      <span class="batch-bar-count" data-batch-bar-count>0 selected</span>
      <button type="button" class="btn btn-primary btn-sm" data-batch-generate>Generate listings</button>
    </div>`;
    content = `${batchBar}<div class="table-wrap">
      <table class="data-table inventory-table" data-inventory-table><thead>${head}</thead><tbody>${rowsHtml}</tbody></table>
    </div>
    ${pager}`;
  }

  const heading = data.heading ?? 'Inventory';
  const subtitle = data.subtitle ?? `${result.total} item${result.total === 1 ? '' : 's'} tracked`;

  const body = `${data.showDemoBanner ? demoBanner() : ''}
<section class="page-header">
  <div>
    <h1>${escapeHtml(heading)}</h1>
    <p class="page-subtitle">${escapeHtml(subtitle)}</p>
  </div>
  <div class="page-actions">
    <a class="btn btn-primary" href="/inventory/new">Add card</a>
  </div>
</section>

<section class="panel">
  ${filterBar}
  ${content}
</section>`;

  return renderLayout({ title: heading, user: data.user, activeNav: data.activeNav ?? 'inventory', body });
}
