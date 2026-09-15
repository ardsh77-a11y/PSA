import { renderLayout } from '../layout.js';
import { demoBanner } from '../components/index.js';
import { barChart, lineChart, donutChart } from '../components/charts.js';
import { escapeHtml } from '../../util/html.js';
import type { UserRecord } from '../../server/router.js';
import type { Analytics } from '../../services/analyticsService.js';

export interface AnalyticsPageData {
  user: UserRecord;
  analytics: Analytics;
  showDemoBanner?: boolean;
}

function money(n: number): string {
  return `$${(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statCard(label: string, value: string, hint?: string): string {
  return `<div class="kpi-card">
  <div class="kpi-label">${escapeHtml(label)}</div>
  <div class="kpi-value">${escapeHtml(value)}</div>
  ${hint ? `<div class="kpi-hint">${escapeHtml(hint)}</div>` : ''}
</div>`;
}

/** Professional Analytics dashboard (FEAT-008, sections 27 + 31). */
export function renderAnalyticsPage(data: AnalyticsPageData): string {
  const { analytics: a } = data;
  const s = a.summary;

  const stats = [
    statCard('Revenue', money(s.revenue), `${s.cardsSold} card${s.cardsSold === 1 ? '' : 's'} sold`),
    statCard('Net profit', money(s.profit), s.revenue > 0 ? `${Math.round((s.profit / s.revenue) * 100)}% margin` : 'No sales yet'),
    statCard('Avg sale price', money(s.avgSalePrice)),
    statCard('Avg profit / card', money(s.avgProfitPerCard)),
    statCard('Inventory turnover', s.inventoryTurnover.toFixed(2), 'sold / avg on-hand'),
    statCard('Avg days to sale', s.avgDaysToSale > 0 ? `${s.avgDaysToSale.toFixed(0)} days` : '—'),
    statCard('Fees paid', money(s.totalFees)),
    statCard('Cost basis', money(s.totalCostBasis)),
  ].join('\n');

  const revenueChart = lineChart({
    title: 'Revenue & profit over time',
    labels: a.revenueOverTime.map((p) => p.period),
    series: [
      { name: 'Revenue', values: a.revenueOverTime.map((p) => p.revenue) },
      { name: 'Profit', values: a.revenueOverTime.map((p) => p.profit) },
    ],
    money: true,
    area: true,
  });

  const bulkVsSingles = donutChart({ title: 'Bulk vs singles revenue', data: a.bulkVsSingles, money: true });
  const bestSets = barChart({ title: 'Best-performing sets', data: a.bestSets, money: true });
  const bestPokemon = barChart({ title: 'Best-performing Pokémon', data: a.bestPokemon, money: true });
  const bestRarities = barChart({ title: 'Best-performing rarities', data: a.bestRarities, money: true });

  const body = `${data.showDemoBanner ? demoBanner() : ''}
<section class="page-header">
  <div>
    <h1>Analytics</h1>
    <p class="page-subtitle">Your seller performance at a glance — revenue, profit, turnover and what sells best.</p>
  </div>
</section>

<section class="kpi-grid analytics-stats">
${stats}
</section>

<section class="panel">
  <div class="panel-header"><h2>Revenue &amp; profit</h2></div>
  ${revenueChart}
</section>

<div class="analytics-grid">
  <section class="panel">
    <div class="panel-header"><h2>Bulk vs singles</h2></div>
    ${bulkVsSingles}
  </section>
  <section class="panel">
    <div class="panel-header"><h2>Best sets</h2></div>
    ${bestSets}
  </section>
  <section class="panel">
    <div class="panel-header"><h2>Best Pokémon</h2></div>
    ${bestPokemon}
  </section>
  <section class="panel">
    <div class="panel-header"><h2>Best rarities</h2></div>
    ${bestRarities}
  </section>
</div>`;

  return renderLayout({ title: 'Analytics', user: data.user, activeNav: 'analytics', body });
}
