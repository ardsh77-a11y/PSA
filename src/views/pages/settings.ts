import { renderLayout } from '../layout.js';
import { escapeHtml } from '../../util/html.js';
import type { UserRecord } from '../../server/router.js';
import {
  PRICING_MODES,
  PRICING_MODE_LABELS,
  MARKETPLACES,
  type PricingSettings,
  type GenerationSettings,
} from '../../services/settings.js';

export interface SettingsPageData {
  user: UserRecord;
  settings: PricingSettings;
  generation: GenerationSettings;
  saved?: boolean;
  error?: string;
}

function marketplaceOptions(current: string): string {
  return MARKETPLACES.map(
    (m) => `<option value="${escapeHtml(m)}"${m === current ? ' selected' : ''}>${escapeHtml(m)}</option>`,
  ).join('');
}

function modeOptions(current: string): string {
  return PRICING_MODES.map(
    (m) => `<option value="${escapeHtml(m)}"${m === current ? ' selected' : ''}>${escapeHtml(PRICING_MODE_LABELS[m])}</option>`,
  ).join('');
}

/** Render the Settings page: per-user pricing preferences (section 16). */
export function renderSettingsPage(data: SettingsPageData): string {
  const s = data.settings;
  const feePctDisplay = (s.feePct * 100).toFixed(2);

  const banner = data.saved
    ? `<div class="form-success" role="status">Settings saved. Pricing and recommendations now use these preferences.</div>`
    : data.error
      ? `<div class="form-error">${escapeHtml(data.error)}</div>`
      : '';

  const body = `<section class="page-header">
  <div>
    <h1>Settings</h1>
    <p class="page-subtitle">Pricing preferences drive the pricing engine and the single-vs-bulk recommendations.</p>
  </div>
</section>

<form class="panel form-stack" method="post" action="/settings" data-enhance-form>
  ${banner}

  <fieldset class="form-section">
    <legend>Pricing strategy</legend>
    <div class="grid-2">
      <div class="field">
        <label><span>Default pricing mode</span><select name="pricingMode">${modeOptions(s.pricingMode)}</select></label>
        <span class="field-hint">Fast Sale undercuts market, Balanced sits at market, Maximum Profit prices above.</span>
      </div>
      <div class="field">
        <label><span>Bulk value cutoff hint ($)</span><input type="number" name="bulkValueCutoff" value="${escapeHtml(s.bulkValueCutoff)}" min="0" step="0.01" /></label>
        <span class="field-hint">Cards whose expected net is at/below this are strong bulk candidates.</span>
      </div>
    </div>
  </fieldset>

  <fieldset class="form-section">
    <legend>Fees &amp; costs</legend>
    <div class="grid-2">
      <div class="field">
        <label><span>Marketplace fee (%)</span><input type="number" name="feePct" value="${escapeHtml(feePctDisplay)}" min="0" max="100" step="0.01" /></label>
      </div>
      <div class="field">
        <label><span>Fixed fee per order ($)</span><input type="number" name="fixedFee" value="${escapeHtml(s.fixedFee)}" min="0" step="0.01" /></label>
      </div>
      <div class="field">
        <label><span>Default shipping cost ($)</span><input type="number" name="shippingCost" value="${escapeHtml(s.shippingCost)}" min="0" step="0.01" /></label>
      </div>
      <div class="field">
        <label><span>Packaging cost ($)</span><input type="number" name="packagingCost" value="${escapeHtml(s.packagingCost)}" min="0" step="0.01" /></label>
      </div>
    </div>
  </fieldset>

  <fieldset class="form-section">
    <legend>Single-vs-bulk thresholds</legend>
    <div class="grid-2">
      <div class="field">
        <label><span>Sell-individually score (≥)</span><input type="number" name="sellThreshold" value="${escapeHtml(s.sellThreshold)}" min="0" max="100" step="1" /></label>
        <span class="field-hint">Score at or above which a card is recommended to sell individually.</span>
      </div>
      <div class="field">
        <label><span>Bulk score (≤)</span><input type="number" name="bulkThreshold" value="${escapeHtml(s.bulkThreshold)}" min="0" max="100" step="1" /></label>
        <span class="field-hint">Score at or below which a card is recommended for bulk.</span>
      </div>
    </div>
  </fieldset>

  <fieldset class="form-section">
    <legend>Scoring weights</legend>
    <p class="field-hint">The recommendation combines these factors into a single score — it is not a lone price threshold.</p>
    <div class="grid-2">
      <div class="field">
        <label><span>Net profit weight</span><input type="number" name="weightNet" value="${escapeHtml(s.weights.net)}" min="0" step="0.1" /></label>
      </div>
      <div class="field">
        <label><span>Market value weight</span><input type="number" name="weightValue" value="${escapeHtml(s.weights.value)}" min="0" step="0.1" /></label>
      </div>
      <div class="field">
        <label><span>Demand weight</span><input type="number" name="weightDemand" value="${escapeHtml(s.weights.demand)}" min="0" step="0.1" /></label>
      </div>
      <div class="field">
        <label><span>Low-competition weight</span><input type="number" name="weightCompetition" value="${escapeHtml(s.weights.competition)}" min="0" step="0.1" /></label>
      </div>
    </div>
  </fieldset>

  <fieldset class="form-section">
    <legend>Listing generation</legend>
    <div class="grid-2">
      <div class="field">
        <label><span>SKU format</span><input type="text" name="skuFormat" value="${escapeHtml(data.generation.skuFormat)}" /></label>
        <span class="field-hint">Tokens: {game} {set} {number} {condition} {seq}. Example output: PKM-OBF-125-NM-001.</span>
      </div>
      <div class="field">
        <label><span>Default marketplace</span><select name="defaultMarketplace">${marketplaceOptions(data.generation.defaultMarketplace)}</select></label>
        <span class="field-hint">New listing drafts target this marketplace.</span>
      </div>
      <div class="field">
        <label><span>Generation pricing mode</span><select name="generationMode">${modeOptions(data.generation.generationMode)}</select></label>
        <span class="field-hint">Pricing mode used when a listing price is generated.</span>
      </div>
    </div>
  </fieldset>

  <div class="form-actions">
    <button type="submit" class="btn btn-primary">Save settings</button>
    <a class="btn btn-ghost" href="/pricing">Go to Pricing</a>
  </div>
</form>

<section class="panel" data-import-export>
  <div class="panel-header"><h2>Import &amp; export</h2><span class="panel-sub">CSV in and out (section 35)</span></div>
  <div class="impexp-grid">
    <div class="impexp-export">
      <h3>Export CSV</h3>
      <p class="field-hint">Download your data for spreadsheets, accounting or backups.</p>
      <div class="impexp-links">
        <a class="btn btn-ghost" href="/export/inventory.csv">Inventory</a>
        <a class="btn btn-ghost" href="/export/sales.csv">Sales</a>
        <a class="btn btn-ghost" href="/export/profit-report.csv">Profit report</a>
        <a class="btn btn-ghost" href="/export/listings.csv">Listings</a>
      </div>
    </div>
    <div class="impexp-import">
      <h3>Import inventory</h3>
      <p class="field-hint">Upload a CSV with columns: card_name, set_name, set_abbreviation, card_number, rarity, condition, quantity, acquisition_cost, market_value, status, sku, classification, notes. Bad rows are reported without aborting the import.</p>
      <form class="impexp-form" method="post" action="/api/import/inventory" enctype="multipart/form-data" data-import-form>
        <input type="file" name="file" accept=".csv,text/csv" data-import-file />
        <button type="submit" class="btn btn-primary">Import</button>
      </form>
      <div class="impexp-result" data-import-result hidden></div>
    </div>
  </div>
</section>`;

  return renderLayout({ title: 'Settings', user: data.user, activeNav: 'settings', body });
}
