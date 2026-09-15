import { renderLayout } from '../layout.js';
import { statusBadge, emptyState, type BadgeTone } from '../components/index.js';
import { escapeHtml } from '../../util/html.js';
import type { UserRecord } from '../../server/router.js';
import type { BulkSummary } from '../../services/bulkService.js';
import type { BulkLot } from '../../repositories/bulkLotsRepository.js';
import {
  BULK_CATEGORIES,
  BULK_CATEGORY_LABELS,
  type BulkSettings,
  type BulkCategory,
} from '../../services/settings.js';

export interface BulkPageData {
  user: UserRecord;
  summary: BulkSummary;
  settings: BulkSettings;
  lots: BulkLot[];
}

function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `$${v.toFixed(2)}`;
}

function bulkLotStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'listed':
      return 'info';
    case 'sold':
      return 'success';
    default:
      return 'neutral';
  }
}

/** Category summary cards (count + est value) for included categories (section 11). */
function summaryCards(data: BulkPageData): string {
  const included = data.summary.categories.filter((c) => c.included);
  const cards = included
    .map(
      (c) => `<button type="button" class="bulk-summary-card" data-bulk-category="${escapeHtml(c.category)}" aria-label="Generate lots for ${escapeHtml(c.label)}">
      <div class="bulk-summary-label">${escapeHtml(c.label)}</div>
      <div class="bulk-summary-count">${escapeHtml(c.count.toLocaleString())}</div>
      <div class="bulk-summary-value">${escapeHtml(money(c.estimatedValue))} est.</div>
    </button>`,
    )
    .join('\n');
  if (!cards) {
    return `<p class="muted">No bulk categories are enabled. Use “Configure categories” to include some.</p>`;
  }
  return `<div class="bulk-summary-grid">${cards}</div>`;
}

/** The "Configure categories" control (persisted to settings). */
function configureCategories(data: BulkPageData): string {
  const rows = BULK_CATEGORIES.map((cat) => {
    const checked = data.settings.includedCategories.includes(cat) ? ' checked' : '';
    return `<label class="check-inline"><input type="checkbox" name="categories" value="${escapeHtml(cat)}"${checked} /> <span>${escapeHtml(BULK_CATEGORY_LABELS[cat])}</span></label>`;
  }).join('\n');
  return `<details class="bulk-config" data-bulk-config>
    <summary>Configure categories</summary>
    <form data-bulk-categories-form>
      <div class="check-grid">${rows}</div>
      <button type="submit" class="btn btn-secondary btn-sm">Save categories</button>
    </form>
  </details>`;
}

/** Guarantee configuration UI (section 14). */
function guaranteeConfig(data: BulkPageData): string {
  const g = data.settings.guarantees;
  const chk = (on: boolean) => (on ? ' checked' : '');
  return `<form class="bulk-guarantees" data-bulk-guarantees-form>
    <div class="grid-2">
      <label class="field"><span>Minimum rares</span><input type="number" name="minRares" min="0" step="1" value="${escapeHtml(g.minRares)}" /></label>
      <label class="field"><span>Minimum holos</span><input type="number" name="minHolos" min="0" step="1" value="${escapeHtml(g.minHolos)}" /></label>
    </div>
    <div class="check-grid">
      <label class="check-inline"><input type="checkbox" name="noEnergy"${chk(g.noEnergy)} /> <span>No energy cards</span></label>
      <label class="check-inline"><input type="checkbox" name="englishOnly"${chk(g.englishOnly)} /> <span>English only</span></label>
      <label class="check-inline"><input type="checkbox" name="noDamaged"${chk(g.noDamaged)} /> <span>No damaged</span></label>
      <label class="check-inline"><input type="checkbox" name="noDuplicates"${chk(g.noDuplicates)} /> <span>No duplicates</span></label>
      <label class="check-inline"><input type="checkbox" name="mixedSets"${chk(g.mixedSets)} /> <span>Mixed sets</span></label>
    </div>
    <button type="submit" class="btn btn-secondary btn-sm">Save guarantees</button>
  </form>`;
}

/** The proposal modal (populated client-side after generate-lots). */
function proposalRegion(data: BulkPageData): string {
  const defaultSizes = data.settings.defaultLotSizes.join(', ');
  return `<div class="bulk-proposal" data-bulk-proposal hidden>
    <div class="panel-header"><h2>Proposed lots <span data-proposal-category></span></h2></div>
    <label class="inline-field"><span>Lot sizes</span><input type="text" data-lot-sizes value="${escapeHtml(defaultSizes)}" placeholder="100, 250, 500" /></label>
    <button type="button" class="btn btn-ghost btn-sm" data-reproposal>Recalculate</button>
    <div data-proposal-summary class="muted"></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Lot</th><th class="num">Cards</th><th class="num">Suggested price</th></tr></thead><tbody data-proposal-rows></tbody></table></div>
    <div class="form-actions">
      <button type="button" class="btn btn-primary" data-commit-lots>Commit lots</button>
      <button type="button" class="btn btn-ghost" data-cancel-proposal>Cancel</button>
    </div>
  </div>`;
}

function lotRow(lot: BulkLot): string {
  const label = BULK_CATEGORY_LABELS[(lot.category ?? 'mixed_bulk') as BulkCategory] ?? lot.category ?? 'Bulk';
  const canGenerate = lot.status === 'draft';
  const genBtn = canGenerate
    ? `<button type="button" class="btn btn-primary btn-sm" data-bulk-generate-listing data-lot-id="${escapeHtml(lot.id)}">Generate listing</button>`
    : `<a class="btn btn-ghost btn-sm" href="/listings">View listing</a>`;
  return `<tr data-bulk-lot-row data-lot-id="${escapeHtml(lot.id)}">
    <td>${escapeHtml(label)}</td>
    <td class="num">${escapeHtml(lot.card_count.toLocaleString())}</td>
    <td class="num">${escapeHtml(money(lot.suggested_price))}</td>
    <td>${escapeHtml(lot.sku ?? '—')}</td>
    <td data-lot-status>${statusBadge(lot.status.charAt(0).toUpperCase() + lot.status.slice(1), bulkLotStatusTone(lot.status))}</td>
    <td class="col-actions"><div class="row-actions">${genBtn}<button type="button" class="btn btn-danger btn-sm" data-bulk-delete-lot data-lot-id="${escapeHtml(lot.id)}">Delete</button></div></td>
  </tr>`;
}

function lotsSection(data: BulkPageData): string {
  if (data.lots.length === 0) {
    return emptyState({
      title: 'No bulk lots yet',
      message: 'Pick a category above and generate lots to package your bulk into sellable groups.',
    });
  }
  const rows = data.lots.map(lotRow).join('\n');
  return `<div class="table-wrap"><table class="data-table" data-bulk-lots-table>
    <thead><tr><th>Category</th><th class="num">Cards</th><th class="num">Price</th><th>SKU</th><th>Status</th><th class="col-actions"></th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

export function renderBulkPage(data: BulkPageData): string {
  const body = `<section class="page-header">
  <div>
    <h1>Bulk</h1>
    <p class="page-subtitle">${escapeHtml(`${data.summary.totalCount.toLocaleString()} bulk cards · ${money(data.summary.totalValue)} estimated value`)}</p>
  </div>
  <div class="page-actions">
    <a class="btn btn-ghost" href="/storage">Storage locations</a>
  </div>
</section>

<section class="panel" data-bulk-page>
  <div class="panel-header"><h2>Categories</h2></div>
  ${summaryCards(data)}
  ${configureCategories(data)}
  <p class="field-hint">Click a category to propose bulk lots (section 12).</p>
</section>

<section class="panel">
  ${proposalRegion(data)}
</section>

<section class="panel">
  <div class="panel-header"><h2>Lot guarantees</h2></div>
  <p class="field-hint">These guarantees are attached to newly generated lots and appear automatically in the listing description.</p>
  ${guaranteeConfig(data)}
</section>

<section class="panel">
  <div class="panel-header"><h2>Bulk lots</h2></div>
  ${lotsSection(data)}
</section>`;

  return renderLayout({ title: 'Bulk', user: data.user, activeNav: 'bulk', body });
}
