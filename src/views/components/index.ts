import { escapeHtml } from '../../util/html.js';

/**
 * Small server-side HTML component helpers. Each returns an escaped HTML
 * string. Callers pass already-trusted markup only via the explicitly-named
 * `*Html` parameters; everything else is escaped.
 */

export interface KpiCardOptions {
  label: string;
  value: string;
  hint?: string;
  trend?: 'up' | 'down' | 'flat';
}

export function kpiCard(opts: KpiCardOptions): string {
  const trendClass = opts.trend ? ` trend-${escapeHtml(opts.trend)}` : '';
  const hint = opts.hint ? `<div class="kpi-hint">${escapeHtml(opts.hint)}</div>` : '';
  return `<div class="kpi-card${trendClass}">
  <div class="kpi-label">${escapeHtml(opts.label)}</div>
  <div class="kpi-value">${escapeHtml(opts.value)}</div>
  ${hint}
</div>`;
}

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export function statusBadge(label: string, tone: BadgeTone = 'neutral'): string {
  return `<span class="badge badge-${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
}

export interface EmptyStateOptions {
  title: string;
  message: string;
  actionLabel?: string;
  actionHref?: string;
}

export function emptyState(opts: EmptyStateOptions): string {
  const action =
    opts.actionLabel && opts.actionHref
      ? `<a class="btn btn-primary" href="${escapeHtml(opts.actionHref)}">${escapeHtml(opts.actionLabel)}</a>`
      : '';
  return `<div class="empty-state">
  <div class="empty-illustration" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M7.5 9h9M7.5 13h6"/></svg>
  </div>
  <h3>${escapeHtml(opts.title)}</h3>
  <p>${escapeHtml(opts.message)}</p>
  ${action}
</div>`;
}

export interface TableColumn {
  header: string;
  /** Precomputed cell HTML per row (already escaped by the caller). */
  cell: (row: Record<string, unknown>) => string;
}

export function table(columns: TableColumn[], rows: Record<string, unknown>[]): string {
  const head = columns.map((c) => `<th>${escapeHtml(c.header)}</th>`).join('');
  const body = rows
    .map((row) => `<tr>${columns.map((c) => `<td>${c.cell(row)}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="table-wrap"><table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonOptions {
  label: string;
  href?: string;
  type?: 'button' | 'submit';
  variant?: ButtonVariant;
}

export function button(opts: ButtonOptions): string {
  const cls = `btn btn-${escapeHtml(opts.variant ?? 'primary')}`;
  if (opts.href) {
    return `<a class="${cls}" href="${escapeHtml(opts.href)}">${escapeHtml(opts.label)}</a>`;
  }
  return `<button class="${cls}" type="${escapeHtml(opts.type ?? 'button')}">${escapeHtml(opts.label)}</button>`;
}

export interface ActionCardOptions {
  title: string;
  description: string;
  href: string;
  cta: string;
}

export function actionCard(opts: ActionCardOptions): string {
  return `<a class="action-card" href="${escapeHtml(opts.href)}">
  <h3>${escapeHtml(opts.title)}</h3>
  <p>${escapeHtml(opts.description)}</p>
  <span class="action-cta">${escapeHtml(opts.cta)} →</span>
</a>`;
}
