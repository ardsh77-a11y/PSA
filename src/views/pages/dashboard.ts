import { renderLayout } from '../layout.js';
import { kpiCard, emptyState, actionCard } from '../components/index.js';
import { escapeHtml } from '../../util/html.js';
import type { UserRecord } from '../../server/router.js';

/**
 * Placeholder Dashboard page. Real KPI + activity data is wired up in a later
 * feature (FEAT-006); for now it renders empty-state KPI cards and quick
 * actions so the shell and navigation are exercisable.
 */
export function renderDashboard(user: UserRecord): string {
  const firstName = String(user.display_name ?? user.email ?? '').split(/\s+/)[0] || 'there';

  const kpis = [
    kpiCard({ label: 'Inventory value', value: '$0.00', hint: 'No inventory yet' }),
    kpiCard({ label: 'Active listings', value: '0', hint: 'Nothing listed' }),
    kpiCard({ label: 'Open orders', value: '0', hint: 'No orders' }),
    kpiCard({ label: 'Net profit (30d)', value: '$0.00', hint: 'Awaiting sales' }),
  ].join('\n');

  const actions = [
    actionCard({ title: 'Scan cards', description: 'Digitize a batch by photo and auto-identify singles.', href: '/scan', cta: 'Start scanning' }),
    actionCard({ title: 'Add inventory', description: 'Track singles and bulk lots with costs and conditions.', href: '/inventory', cta: 'Open inventory' }),
    actionCard({ title: 'Create listings', description: 'Generate marketplace-ready listings from your inventory.', href: '/listings', cta: 'View listings' }),
  ].join('\n');

  const body = `<section class="page-header">
  <div>
    <h1>Welcome back, ${escapeHtml(firstName)}</h1>
    <p class="page-subtitle">Here is a snapshot of your seller operation.</p>
  </div>
</section>

<section class="kpi-grid">
${kpis}
</section>

<section class="panel">
  <div class="panel-header"><h2>Quick actions</h2></div>
  <div class="action-grid">
${actions}
  </div>
</section>

<section class="panel">
  <div class="panel-header"><h2>Recent activity</h2></div>
  ${emptyState({
    title: 'No activity yet',
    message: 'Once you scan cards, add inventory, or make sales, your recent activity will appear here.',
    actionLabel: 'Scan your first cards',
    actionHref: '/scan',
  })}
</section>`;

  return renderLayout({ title: 'Dashboard', user, activeNav: 'dashboard', body });
}
