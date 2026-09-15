import { renderLayout } from '../layout.js';
import { emptyState } from '../components/index.js';
import { escapeHtml } from '../../util/html.js';
import type { UserRecord } from '../../server/router.js';
import type { Rip } from '../../repositories/ripsRepository.js';

export interface RipPageData {
  user: UserRecord;
  rips: Rip[];
}

function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const neg = v < 0;
  return `${neg ? '-' : ''}$${Math.abs(v).toFixed(2)}`;
}

/**
 * Pack/Rip tracking (section 26). A form to log a rip (product, packs, box cost,
 * pulled value, cards pulled, date) with a live estimated-profit preview, plus a
 * table of logged rips. Estimated profit = pulled value - box cost.
 */
function renderForm(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `<form class="rip-form" data-rip-form>
    <div class="form-grid">
      <label class="field">
        <span>Product name</span>
        <input type="text" name="product_name" required placeholder="e.g. Obsidian Flames Booster Box" />
      </label>
      <label class="field">
        <span>Number of packs</span>
        <input type="number" name="packs" min="1" step="1" value="36" />
      </label>
      <label class="field">
        <span>Box / case cost ($)</span>
        <input type="number" name="box_cost" min="0" step="0.01" data-rip-cost value="105.00" />
      </label>
      <label class="field">
        <span>Estimated pulled value ($)</span>
        <input type="number" name="estimated_pulled_value" min="0" step="0.01" data-rip-pulled value="142.00" />
      </label>
      <label class="field">
        <span>Cards pulled</span>
        <input type="number" name="cards_pulled" min="0" step="1" value="0" />
      </label>
      <label class="field">
        <span>Date opened</span>
        <input type="date" name="opened_at" value="${escapeHtml(today)}" />
      </label>
      <label class="field field-wide">
        <span>Notes</span>
        <input type="text" name="notes" placeholder="Optional notes" />
      </label>
    </div>
    <div class="rip-form-footer">
      <div class="rip-estimate">Estimated profit: <strong data-rip-estimate>$37.00</strong></div>
      <button type="submit" class="btn btn-primary">Log rip</button>
    </div>
  </form>`;
}

function renderRow(r: Rip): string {
  const profitClass = r.estimated_profit >= 0 ? 'profit-pos' : 'profit-neg';
  return `<tr data-rip-row data-rip-id="${escapeHtml(r.id)}">
    <td class="col-name"><span class="row-title">${escapeHtml(r.product_name)}</span>
      ${r.notes ? `<div class="row-sub">${escapeHtml(r.notes)}</div>` : ''}</td>
    <td class="num">${escapeHtml(String(r.packs))}</td>
    <td class="num">${escapeHtml(money(r.box_cost))}</td>
    <td class="num">${escapeHtml(String(r.cards_pulled))}</td>
    <td class="num">${escapeHtml(money(r.estimated_pulled_value))}</td>
    <td class="num ${profitClass}">${escapeHtml(money(r.estimated_profit))}</td>
    <td>${escapeHtml((r.opened_at ?? '').slice(0, 10))}</td>
    <td class="col-actions"><button type="button" class="btn btn-danger btn-sm" data-rip-delete data-rip-id="${escapeHtml(r.id)}">Delete</button></td>
  </tr>`;
}

export function renderRipPage(data: RipPageData): string {
  const { rips } = data;

  let list: string;
  if (rips.length === 0) {
    list = emptyState({
      title: 'No rips logged yet',
      message: 'Log a sealed product you opened to track its cost, packs, pulled value and estimated profit.',
    });
  } else {
    const head = `<tr>
      <th>Product</th>
      <th class="num">Packs</th>
      <th class="num">Box cost</th>
      <th class="num">Cards</th>
      <th class="num">Pulled value</th>
      <th class="num">Est. profit</th>
      <th>Opened</th>
      <th class="col-actions"></th>
    </tr>`;
    const rows = rips.map(renderRow).join('\n');
    list = `<div class="table-wrap"><table class="data-table rips-table" data-rips-table><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
  }

  const body = `<section class="page-header">
  <div>
    <h1>Pack / Rip Tracking</h1>
    <p class="page-subtitle">${escapeHtml(`${rips.length} rip${rips.length === 1 ? '' : 's'} logged`)}</p>
  </div>
  <div class="page-actions"><a class="btn btn-ghost" href="/orders">Back to orders</a></div>
</section>

<section class="panel" data-rip-page>
  <h2>Log a rip</h2>
  ${renderForm()}
</section>

<section class="panel">
  <h2>Logged rips</h2>
  ${list}
</section>`;

  return renderLayout({ title: 'Pack / Rip Tracking', user: data.user, activeNav: 'orders', body });
}
