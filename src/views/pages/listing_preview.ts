import { renderLayout } from '../layout.js';
import { statusBadge, cardThumb } from '../components/index.js';
import { escapeHtml } from '../../util/html.js';
import type { UserRecord } from '../../server/router.js';
import type { ListingRow } from '../../repositories/listingsRepository.js';
import { listingStatusTone } from './listings.js';
import { strategyFor } from '../../domain/tcg.js';
import { MARKETPLACES } from '../../services/settings.js';

export interface ListingPreviewPageData {
  user: UserRecord;
  listing: ListingRow;
}

function parseSpecifics(json: string | null | undefined): Record<string, string> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, string>;
  } catch {
    /* ignore */
  }
  return {};
}

function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `$${v.toFixed(2)}`;
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function marketplaceOptions(selected: string | null | undefined): string {
  return MARKETPLACES.map(
    (m) => `<option value="${escapeHtml(m)}"${m === selected ? ' selected' : ''}>${escapeHtml(m)}</option>`,
  ).join('');
}

function conditionOptions(current: string | null | undefined): string {
  return strategyFor('pokemon')
    .conditionOptions()
    .map(
      (c) => `<option value="${escapeHtml(c.code)}"${c.code === current ? ' selected' : ''}>${escapeHtml(c.label)} (${escapeHtml(c.code)})</option>`,
    )
    .join('');
}

/** eBay-style listing preview (section 18): all fields editable before publish. */
export function renderListingPreviewPage(data: ListingPreviewPageData): string {
  const l = data.listing;
  const specifics = parseSpecifics(l.item_specifics_json);
  const title = l.title || l.card_name || 'Untitled listing';

  // Item specifics are shown read-only (derived from the card) but the __ keys
  // are internal (e.g. __externalId) and hidden.
  const specificRows = Object.entries(specifics)
    .filter(([k]) => !k.startsWith('__'))
    .map(
      ([k, v]) => `<div class="info-row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`,
    )
    .join('');
  const externalId = specifics.__externalId;

  const published = l.status === 'listed' || l.status === 'sold';

  const body = `<section class="page-header">
  <div>
    <a class="back-link" href="/listings">← Back to listings</a>
    <h1>Listing preview</h1>
    <p class="page-subtitle">Review and edit before publishing. This is how buyers will see it.</p>
  </div>
  <div class="page-actions" data-listing-status>${statusBadge(statusLabel(l.status), listingStatusTone(l.status))}</div>
</section>

<div class="listing-preview" data-listing-preview data-listing-id="${escapeHtml(l.id)}">
  <section class="panel listing-preview-media">
    ${cardThumb(l.card_image_url, title, 'lg')}
    <p class="muted listing-photo-note">Photos are placeholders. Add product photos when a real marketplace integration is connected.</p>
  </section>

  <section class="panel listing-preview-main">
    <div class="field">
      <label><span>Title</span><input type="text" data-field="title" value="${escapeHtml(l.title)}" maxlength="80" /></label>
      <span class="field-hint">Search-optimized, no keyword stuffing. Marketplaces cap titles around 80 characters.</span>
    </div>

    <div class="grid-2">
      <div class="field">
        <label><span>Price ($)</span><input type="number" data-field="price" value="${escapeHtml(l.price)}" min="0" step="0.01" /></label>
      </div>
      <div class="field">
        <label><span>Shipping ($)</span><input type="number" data-field="shipping_cost" value="${escapeHtml(l.shipping_cost ?? '')}" min="0" step="0.01" /></label>
      </div>
      <div class="field">
        <label><span>Condition</span><select data-field="condition">${conditionOptions(l.condition)}</select></label>
      </div>
      <div class="field">
        <label><span>Quantity</span><input type="number" data-field="quantity" value="${escapeHtml(l.quantity)}" min="1" step="1" /></label>
      </div>
      <div class="field">
        <label><span>Marketplace</span><select data-field="marketplace">${marketplaceOptions(l.marketplace)}</select></label>
      </div>
      <div class="field">
        <label><span>SKU</span><input type="text" data-field="sku" value="${escapeHtml(l.sku ?? '')}" /></label>
      </div>
    </div>

    <div class="field">
      <label><span>Description</span><textarea data-field="description" rows="7">${escapeHtml(l.description ?? '')}</textarea></label>
    </div>

    <div class="listing-buy-box">
      <div class="listing-price" data-preview-price>${escapeHtml(money(l.price))}</div>
      <div class="listing-shipping">+ ${escapeHtml(money(l.shipping_cost))} shipping</div>
    </div>

    <div class="form-actions">
      <button type="button" class="btn btn-secondary" data-listing-save>Save</button>
      <button type="button" class="btn btn-primary" data-listing-publish${published ? ' disabled aria-disabled="true"' : ''}>Publish</button>
    </div>
    ${externalId ? `<p class="field-hint">Published to ${escapeHtml(l.marketplace ?? 'marketplace')} · external id <code>${escapeHtml(externalId)}</code></p>` : ''}
  </section>
</div>

<section class="panel">
  <div class="panel-header"><h2>Item specifics</h2></div>
  <dl class="info-list">${specificRows || '<p class="muted">No item specifics.</p>'}</dl>
  <p class="field-hint">Category: ${escapeHtml('Pokemon TCG Individual Cards')}</p>
</section>`;

  return renderLayout({ title: 'Listing preview', user: data.user, activeNav: 'listings', body });
}
