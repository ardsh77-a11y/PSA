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

/**
 * The 'Demo data' banner shown at the top of pages when the current user has
 * demo-flagged inventory, so seeded data is clearly distinguished (section 44).
 */
export function demoBanner(): string {
  return `<div class="demo-banner" role="note">
  <span class="badge badge-info">Demo data</span>
  <span>You are viewing sample inventory seeded for exploration. Add your own cards any time; demo rows are clearly marked.</span>
</div>`;
}

/** A small inline 'Demo' tag for individual seeded rows/records. */
export function demoTag(): string {
  return `<span class="badge badge-info demo-tag" title="Seeded demo data">Demo</span>`;
}

/** Neutral placeholder card image (served from public/). */
export function cardThumb(imageUrl: string | null | undefined, alt: string, size: 'sm' | 'lg' = 'sm'): string {
  const src = imageUrl && imageUrl.trim() ? imageUrl : '/card-placeholder.svg';
  return `<img class="card-thumb card-thumb-${escapeHtml(size)}" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" />`;
}

export interface PaginationOptions {
  page: number;
  pageSize: number;
  total: number;
  /** Build an href for a given page number, preserving current filters. */
  hrefForPage: (page: number) => string;
}

/** Server-rendered pagination control. */
export function pagination(opts: PaginationOptions): string {
  const { page, pageSize, total } = opts;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) {
    const only = total === 0 ? 'No results' : `${total} result${total === 1 ? '' : 's'}`;
    return `<div class="pagination"><span class="pagination-info">${escapeHtml(only)}</span></div>`;
  }
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const prev =
    page > 1
      ? `<a class="btn btn-ghost" href="${escapeHtml(opts.hrefForPage(page - 1))}">Prev</a>`
      : `<span class="btn btn-ghost disabled" aria-disabled="true">Prev</span>`;
  const next =
    page < pageCount
      ? `<a class="btn btn-ghost" href="${escapeHtml(opts.hrefForPage(page + 1))}">Next</a>`
      : `<span class="btn btn-ghost disabled" aria-disabled="true">Next</span>`;
  return `<div class="pagination">
  <span class="pagination-info">${escapeHtml(`${from}–${to} of ${total}`)}</span>
  <div class="pagination-controls">${prev}<span class="pagination-page">Page ${escapeHtml(String(page))} / ${escapeHtml(String(pageCount))}</span>${next}</div>
</div>`;
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
