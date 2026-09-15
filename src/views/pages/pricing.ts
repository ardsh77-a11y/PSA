import { renderLayout } from '../layout.js';
import { statusBadge, emptyState, type BadgeTone } from '../components/index.js';
import { escapeHtml } from '../../util/html.js';
import type { UserRecord } from '../../server/router.js';
import type { InventoryRow } from '../../repositories/inventoryRepository.js';
import { PRICING_MODES, PRICING_MODE_LABELS, type PricingMode } from '../../services/settings.js';
import type { PriceResult, MarketData } from '../../services/interfaces/pricing.js';
import type { ClassificationResult } from '../../services/interfaces/classification.js';

/** A pre-computed pricing row for the dashboard table. */
export interface PricingRow {
  row: InventoryRow;
  marketData: MarketData | null;
  pricing: PriceResult | null;
  classification: ClassificationResult | null;
}

export interface PricingPageData {
  user: UserRecord;
  mode: PricingMode;
  rows: PricingRow[];
  recomputed?: number;
}

function money(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `$${v.toFixed(2)}`;
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

function modeSwitcher(current: PricingMode): string {
  const opts = PRICING_MODES.map(
    (m) => `<option value="${escapeHtml(m)}"${m === current ? ' selected' : ''}>${escapeHtml(PRICING_MODE_LABELS[m])}</option>`,
  ).join('');
  return `<form method="post" action="/pricing/mode" class="inline-form" data-enhance-form>
    <label class="inline-field"><span>Pricing mode</span><select name="pricingMode" data-mode-select onchange="this.form.submit()">${opts}</select></label>
    <noscript><button type="submit" class="btn btn-secondary btn-sm">Apply</button></noscript>
  </form>`;
}

/** Compare listing price vs suggested to flag under/overpriced listings. */
function priceFlag(row: InventoryRow, pricing: PriceResult | null): string {
  if (!pricing) return '';
  const listing = row.target_price;
  if (listing === null || listing === undefined) return '';
  const suggested = pricing.suggestedPrice;
  const delta = listing - suggested;
  const pct = suggested > 0 ? delta / suggested : 0;
  if (pct <= -0.1) return `<span class="badge badge-warning" title="Listed below suggested">Underpriced</span>`;
  if (pct >= 0.1) return `<span class="badge badge-danger" title="Listed above suggested">Overpriced</span>`;
  return `<span class="badge badge-success" title="Within 10% of suggested">On target</span>`;
}

export function renderPricingPage(data: PricingPageData): string {
  const recomputedNote = data.recomputed
    ? `<div class="form-success" role="status">Recomputed and stored values for ${escapeHtml(data.recomputed)} inventory item${data.recomputed === 1 ? '' : 's'}.</div>`
    : '';

  const tableRows = data.rows
    .map(({ row, marketData, pricing, classification }) => {
      const title = row.card_name ?? 'Unlinked item';
      const sub = [row.set_abbreviation, row.card_number, row.condition].filter(Boolean).join(' · ');
      return `<tr>
        <td>
          <a href="/inventory/${escapeHtml(row.id)}" class="cell-title">${escapeHtml(title)}</a>
          <div class="cell-sub">${escapeHtml(sub)}</div>
        </td>
        <td class="num">${escapeHtml(money(pricing?.marketPrice ?? row.market_value))}</td>
        <td class="num">${escapeHtml(money(pricing?.suggestedPrice))}</td>
        <td class="num">${escapeHtml(money(pricing?.estimatedFees))}</td>
        <td class="num">${escapeHtml(money(pricing?.estimatedNet))}</td>
        <td class="num">${escapeHtml(marketData ? String(marketData.competitionCount) : '—')}</td>
        <td>${decisionBadge(classification?.decision)}</td>
        <td>${priceFlag(row, pricing)}</td>
      </tr>`;
    })
    .join('');

  const tableOrEmpty =
    data.rows.length === 0
      ? emptyState({
          title: 'No inventory to price',
          message: 'Add inventory to see market prices, suggested listing prices and single-vs-bulk recommendations.',
          actionLabel: 'Add inventory',
          actionHref: '/inventory/new',
        })
      : `<div class="table-wrap"><table class="data-table pricing-table">
          <thead><tr>
            <th>Card</th>
            <th class="num">Market</th>
            <th class="num">Suggested</th>
            <th class="num">Fees</th>
            <th class="num">Net</th>
            <th class="num">Comp.</th>
            <th>Recommendation</th>
            <th>Listing</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table></div>`;

  const body = `<section class="page-header">
  <div>
    <h1>Pricing</h1>
    <p class="page-subtitle">Market prices, suggested listing prices and single-vs-bulk recommendations for your inventory.</p>
  </div>
  <div class="page-actions">
    ${modeSwitcher(data.mode)}
    <form method="post" action="/pricing/recompute" data-enhance-form>
      <button type="submit" class="btn btn-primary btn-sm">Recompute &amp; store values</button>
    </form>
  </div>
</section>

${recomputedNote}

<section class="panel">
  ${tableOrEmpty}
</section>`;

  return renderLayout({ title: 'Pricing', user: data.user, activeNav: 'pricing', body });
}
