import { renderLayout } from '../layout.js';
import { statusBadge, emptyState, cardThumb, type BadgeTone } from '../components/index.js';
import { escapeHtml } from '../../util/html.js';
import type { UserRecord } from '../../server/router.js';
import type { ListingRow, ListingSearchFilters } from '../../repositories/listingsRepository.js';
import { LISTING_STATUSES } from '../../repositories/listingsRepository.js';
import { MARKETPLACES } from '../../services/settings.js';

export interface ListingsPageData {
  user: UserRecord;
  listings: ListingRow[];
  filters: ListingSearchFilters;
}

function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `$${v.toFixed(2)}`;
}

/** Tone for a listing status badge. */
export function listingStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'listed':
      return 'info';
    case 'ready':
      return 'warning';
    case 'sold':
      return 'success';
    case 'ended':
      return 'neutral';
    default:
      return 'neutral';
  }
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function selectOptions(values: readonly string[], selected: string | undefined): string {
  return values
    .map((v) => `<option value="${escapeHtml(v)}"${v === selected ? ' selected' : ''}>${escapeHtml(v)}</option>`)
    .join('');
}

function rowActions(l: ListingRow): string {
  const preview = `<a class="btn btn-ghost btn-sm" href="/listings/${encodeURIComponent(l.id)}">Edit</a>`;
  const publish =
    l.status !== 'listed' && l.status !== 'sold'
      ? `<button type="button" class="btn btn-primary btn-sm" data-listing-action="publish" data-listing-id="${escapeHtml(l.id)}">Publish</button>`
      : '';
  const end =
    l.status === 'listed'
      ? `<button type="button" class="btn btn-secondary btn-sm" data-listing-action="end" data-listing-id="${escapeHtml(l.id)}">End</button>`
      : '';
  const ret = l.inventory_id
    ? `<button type="button" class="btn btn-ghost btn-sm" data-listing-action="return" data-listing-id="${escapeHtml(l.id)}">Return to inventory</button>`
    : '';
  const del = `<button type="button" class="btn btn-danger btn-sm" data-listing-action="delete" data-listing-id="${escapeHtml(l.id)}">Delete</button>`;
  return `<div class="row-actions">${preview}${publish}${end}${ret}${del}</div>`;
}

function renderRow(l: ListingRow): string {
  const title = l.title || l.card_name || 'Untitled listing';
  return `<tr data-listing-row data-listing-id="${escapeHtml(l.id)}">
    <td class="col-thumb">${cardThumb(l.card_image_url, title, 'sm')}</td>
    <td class="col-name">
      <a href="/listings/${encodeURIComponent(l.id)}" class="row-title">${escapeHtml(title)}</a>
      <div class="row-sub">${escapeHtml([l.set_name, l.card_number].filter(Boolean).join(' · '))}</div>
    </td>
    <td>${escapeHtml(l.marketplace ?? '—')}</td>
    <td class="num">${escapeHtml(money(l.price))}</td>
    <td class="col-sku">${escapeHtml(l.sku ?? '—')}</td>
    <td data-listing-status>${statusBadge(statusLabel(l.status), listingStatusTone(l.status))}</td>
    <td class="col-actions">${rowActions(l)}</td>
  </tr>`;
}

export function renderListingsPage(data: ListingsPageData): string {
  const { listings, filters } = data;

  const filterBar = `<form class="filter-bar" method="get" action="/listings">
    <div class="filter-search">
      <input type="search" name="q" value="${escapeHtml(filters.q ?? '')}" placeholder="Search title, SKU, card…" aria-label="Search listings" />
    </div>
    <select name="status" aria-label="Status"><option value="">Any status</option>${selectOptions(LISTING_STATUSES, filters.status)}</select>
    <select name="marketplace" aria-label="Marketplace"><option value="">Any marketplace</option>${selectOptions(MARKETPLACES, filters.marketplace)}</select>
    <button type="submit" class="btn btn-primary">Filter</button>
    <a class="btn btn-ghost" href="/listings">Reset</a>
  </form>`;

  let content: string;
  if (listings.length === 0) {
    const anyFilter = Boolean(filters.q || filters.status || filters.marketplace);
    content = emptyState(
      anyFilter
        ? {
            title: 'No matching listings',
            message: 'No listings match these filters. Try widening your search or resetting the filters.',
            actionLabel: 'Reset filters',
            actionHref: '/listings',
          }
        : {
            title: 'No listings yet',
            message: 'Generate a listing from an inventory item to see it here. Open a card and choose “Generate listing”.',
            actionLabel: 'Go to inventory',
            actionHref: '/inventory',
          },
    );
  } else {
    const head = `<tr>
      <th class="col-thumb"></th>
      <th>Title</th>
      <th>Marketplace</th>
      <th class="num">Price</th>
      <th>SKU</th>
      <th>Status</th>
      <th class="col-actions"></th>
    </tr>`;
    const rows = listings.map(renderRow).join('\n');
    content = `<div class="table-wrap">
      <table class="data-table listings-table" data-listings-table><thead>${head}</thead><tbody>${rows}</tbody></table>
    </div>`;
  }

  const body = `<section class="page-header">
  <div>
    <h1>Listings</h1>
    <p class="page-subtitle">${escapeHtml(`${listings.length} listing${listings.length === 1 ? '' : 's'}`)}</p>
  </div>
  <div class="page-actions">
    <a class="btn btn-secondary" href="/inventory">Generate from inventory</a>
  </div>
</section>

<section class="panel" data-listings-page>
  ${filterBar}
  ${content}
</section>`;

  return renderLayout({ title: 'Listings', user: data.user, activeNav: 'listings', body });
}
