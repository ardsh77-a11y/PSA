import { renderLayout } from '../layout.js';
import { emptyState, demoBanner } from '../components/index.js';
import { barChart, donutChart } from '../components/charts.js';
import { escapeHtml } from '../../util/html.js';
import type { UserRecord } from '../../server/router.js';
import { dashboardService, type Kpi } from '../../services/dashboardService.js';
import { attentionService, type AttentionItem } from '../../services/attentionService.js';
import { recommendationService, type Recommendation } from '../../services/recommendationService.js';
import { inventoryRepository } from '../../repositories/inventoryRepository.js';
import { ASSISTANT_SUGGESTIONS } from '../../services/mock/mockSellerAssistant.js';

/** Small inline activity icons (reused sidebar icon vocabulary). */
const ACTIVITY_ICONS: Record<string, string> = {
  coin: '<circle cx="12" cy="12" r="8"/><path d="M9.5 10.5c0-1 1-1.5 2.5-1.5s2.5.6 2.5 1.5-1 1.4-2.5 1.6-2.5.7-2.5 1.6S10 16 12 16s2.5-.6 2.5-1.5"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M3 4h2l2.2 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.2L21 8H6"/>',
  tag: '<path d="M3.5 11.5 11 4a2 2 0 0 1 1.4-.6H19a1.5 1.5 0 0 1 1.5 1.5v6.6a2 2 0 0 1-.6 1.4l-7.5 7.5a2 2 0 0 1-2.8 0l-6.1-6.1a2 2 0 0 1 0-2.8z"/>',
  camera: '<path d="M4 8a2 2 0 0 1 2-2h1l1.2-1.6h5.6L15 6h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.5" r="3.2"/>',
  box: '<path d="M3.5 7 12 3l8.5 4-8.5 4z"/><path d="M3.5 7v10L12 21m8.5-14v10L12 21"/>',
  grid: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/>',
};

function activityIcon(name: string): string {
  const body = ACTIVITY_ICONS[name] ?? ACTIVITY_ICONS.grid;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** A KPI card that shows value + supporting context (section 5). */
function kpiWithContext(kpi: Kpi): string {
  return `<div class="kpi-card kpi-context-card">
  <div class="kpi-label">${escapeHtml(kpi.label)}</div>
  <div class="kpi-value">${escapeHtml(kpi.display)}</div>
  <div class="kpi-hint">${escapeHtml(kpi.context)}</div>
</div>`;
}

function attentionCard(item: AttentionItem): string {
  return `<a class="attn-card attn-${escapeHtml(item.tone)}" href="${escapeHtml(item.href)}">
  <div class="attn-count">${escapeHtml(String(item.count))}</div>
  <div class="attn-body">
    <div class="attn-title">${escapeHtml(item.title)}</div>
    <div class="attn-message">${escapeHtml(item.message)}</div>
    <span class="attn-link">${escapeHtml(item.linkLabel)} →</span>
  </div>
</a>`;
}

function recommendationRow(rec: Recommendation, i: number): string {
  return `<li class="listnext-item">
  <span class="listnext-rank">${i + 1}</span>
  <div class="listnext-main">
    <div class="listnext-name">${escapeHtml(rec.cardName)}${rec.setName ? ` <span class="listnext-set">${escapeHtml(rec.setName)}</span>` : ''}</div>
    <div class="listnext-why">${escapeHtml(rec.rationale)}</div>
  </div>
  <div class="listnext-value">${escapeHtml(`$${rec.marketValue.toFixed(2)}`)}<span class="listnext-suggest">list @ $${rec.suggestedPrice.toFixed(2)}</span></div>
</li>`;
}

function suggestionChips(): string {
  return ASSISTANT_SUGGESTIONS.map(
    (s) => `<button type="button" class="assistant-chip" data-assistant-suggestion>${escapeHtml(s)}</button>`,
  ).join('');
}

/** The real Dashboard command center (FEAT-008, sections 5, 5A, 5B, 45). */
export function renderDashboard(user: UserRecord): string {
  const userId = user.id;
  const firstName = String(user.display_name ?? user.email ?? '').split(/\s+/)[0] || 'there';

  const kpis = dashboardService.getKpis(userId);
  const attention = attentionService.getAttentionItems(userId);
  const recommendations = recommendationService.listTheseNext(userId, 5);
  const breakdown = dashboardService.inventoryValueBreakdown(userId);
  const activity = dashboardService.recentActivity(userId, 10);
  const showDemoBanner = inventoryRepository.hasDemoData(userId);

  const kpiOrder: Kpi[] = [
    kpis.totalInventoryValue,
    kpis.unlistedInventoryValue,
    kpis.listedInventoryValue,
    kpis.revenue,
    kpis.estimatedProfit,
    kpis.cardsInInventory,
    kpis.cardsSold,
    kpis.pendingOrders,
  ];

  const kpiCards = kpiOrder.map(kpiWithContext).join('\n');

  const attentionPanel =
    attention.length > 0
      ? `<div class="attn-grid">${attention.map(attentionCard).join('\n')}</div>`
      : `<div class="attn-clear">
    <strong>You're all caught up.</strong>
    <span>No orders to fulfill, no valuable cards left unlisted, and pricing looks healthy.</span>
  </div>`;

  const listNextPanel =
    recommendations.length > 0
      ? `<ol class="listnext-list">${recommendations.map(recommendationRow).join('\n')}</ol>
    <a class="btn btn-ghost" href="/pricing">Price &amp; list these</a>`
      : emptyState({
          title: 'Nothing to list next',
          message: 'Add or scan some cards, then this list ranks the highest-leverage cards to list first.',
          actionLabel: 'Scan cards',
          actionHref: '/scan',
        });

  const activityFeed =
    activity.length > 0
      ? `<ul class="activity-feed">${activity
          .map(
            (a) => `<li class="activity-item"><a href="${escapeHtml(a.href)}"><span class="activity-icon activity-${escapeHtml(a.kind)}">${activityIcon(a.icon)}</span><span class="activity-text"><span class="activity-label">${escapeHtml(a.label)}</span><span class="activity-detail">${escapeHtml(a.detail)}</span></span></a></li>`,
          )
          .join('\n')}</ul>`
      : emptyState({
          title: 'No activity yet',
          message: 'Once you scan cards, add inventory, or make sales, your recent activity will appear here.',
          actionLabel: 'Scan your first cards',
          actionHref: '/scan',
        });

  const inventoryChart = donutChart({
    title: 'Inventory value breakdown',
    data: breakdown,
    money: true,
  });

  const attentionBarData = attention.slice(0, 6).map((a) => ({ label: a.title, value: a.count }));
  const attentionChart =
    attentionBarData.length > 0
      ? barChart({ title: 'Attention items by count', data: attentionBarData })
      : '';

  const body = `${showDemoBanner ? demoBanner() : ''}
<section class="page-header">
  <div>
    <h1>Welcome back, ${escapeHtml(firstName)}</h1>
    <p class="page-subtitle">Here is what needs your attention and what to do next.</p>
  </div>
</section>

<section class="kpi-grid dashboard-kpis">
${kpiCards}
</section>

<section class="panel panel-attention">
  <div class="panel-header"><h2>What needs your attention?</h2></div>
  ${attentionPanel}
</section>

<div class="dashboard-split">
  <section class="panel">
    <div class="panel-header"><h2>List these next</h2><span class="panel-sub">Ranked by value, demand, competition &amp; age</span></div>
    ${listNextPanel}
  </section>

  <section class="panel">
    <div class="panel-header"><h2>Ask PokeOps</h2><span class="panel-sub">Answers from your real data</span></div>
    <div class="assistant" data-assistant>
      <form class="assistant-form" data-assistant-form>
        <input type="text" name="question" class="assistant-input" placeholder="e.g. What should I list next?" autocomplete="off" data-assistant-input aria-label="Ask the seller assistant a question" />
        <button type="submit" class="btn btn-primary">Ask</button>
      </form>
      <div class="assistant-chips">${suggestionChips()}</div>
      <div class="assistant-answer" data-assistant-answer hidden></div>
    </div>
  </section>
</div>

<div class="dashboard-split">
  <section class="panel">
    <div class="panel-header"><h2>Inventory value</h2></div>
    ${inventoryChart}
  </section>

  <section class="panel">
    <div class="panel-header"><h2>Recent activity</h2></div>
    ${activityFeed}
  </section>
</div>

${attentionChart ? `<section class="panel"><div class="panel-header"><h2>Attention overview</h2></div>${attentionChart}</section>` : ''}`;

  return renderLayout({ title: 'Dashboard', user, activeNav: 'dashboard', body });
}
