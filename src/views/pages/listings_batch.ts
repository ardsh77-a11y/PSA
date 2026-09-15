import { renderLayout } from '../layout.js';
import { statusBadge, cardThumb } from '../components/index.js';
import { escapeHtml } from '../../util/html.js';
import type { UserRecord } from '../../server/router.js';
import type { ListingRow } from '../../repositories/listingsRepository.js';
import { listingStatusTone } from './listings.js';

export interface BatchReviewPageData {
  user: UserRecord;
  listings: ListingRow[];
}

function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `$${v.toFixed(2)}`;
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function reviewCard(l: ListingRow): string {
  const title = l.title || l.card_name || 'Untitled listing';
  return `<li class="batch-card" data-batch-card data-listing-id="${escapeHtml(l.id)}" data-status="${escapeHtml(l.status)}">
    <label class="batch-select"><input type="checkbox" data-batch-check checked aria-label="Select ${escapeHtml(title)}" /></label>
    ${cardThumb(l.card_image_url, title, 'sm')}
    <div class="batch-card-body">
      <a class="row-title" href="/listings/${encodeURIComponent(l.id)}">${escapeHtml(title)}</a>
      <div class="row-sub">${escapeHtml([l.set_name, l.card_number, l.sku].filter(Boolean).join(' · '))}</div>
      <div class="batch-card-meta">
        <span>${escapeHtml(money(l.price))}</span>
        <span>${escapeHtml(l.marketplace ?? '—')}</span>
        <span data-listing-status>${statusBadge(statusLabel(l.status), listingStatusTone(l.status))}</span>
      </div>
    </div>
    <div class="batch-card-actions">
      <a class="btn btn-ghost btn-sm" href="/listings/${encodeURIComponent(l.id)}">Edit</a>
      <button type="button" class="btn btn-primary btn-sm" data-listing-action="publish" data-listing-id="${escapeHtml(l.id)}">Approve &amp; publish</button>
      <button type="button" class="btn btn-ghost btn-sm" data-listing-action="return" data-listing-id="${escapeHtml(l.id)}">Return to inventory</button>
      <button type="button" class="btn btn-danger btn-sm" data-listing-action="delete" data-listing-id="${escapeHtml(l.id)}">Reject</button>
    </div>
  </li>`;
}

/** Batch review screen (section 19): approve/publish many drafts at once. */
export function renderBatchReviewPage(data: BatchReviewPageData): string {
  const { listings } = data;
  const total = listings.length;

  const body = `<section class="page-header">
  <div>
    <a class="back-link" href="/inventory">← Back to inventory</a>
    <h1>Review generated listings</h1>
    <p class="page-subtitle" data-batch-counts>${escapeHtml(`${total} draft${total === 1 ? '' : 's'} ready to review`)}</p>
  </div>
  <div class="page-actions">
    <button type="button" class="btn btn-secondary" data-batch-select-all>Select all</button>
    <button type="button" class="btn btn-primary" data-batch-publish-all>Publish selected</button>
  </div>
</section>

<section class="panel" data-batch-review>
  <ul class="batch-list">
    ${listings.map(reviewCard).join('\n')}
  </ul>
</section>`;

  return renderLayout({ title: 'Review listings', user: data.user, activeNav: 'listings', body });
}
