import { escapeHtml } from '../util/html.js';
import type { UserRecord } from '../server/router.js';

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: string;
}

/**
 * The section-4 sidebar navigation. Order matters and is intentionally the
 * canonical list of 10 destinations used across the app.
 */
export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: 'grid' },
  { key: 'scan', label: 'Scan Cards', href: '/scan', icon: 'camera' },
  { key: 'inventory', label: 'Inventory', href: '/inventory', icon: 'box' },
  { key: 'singles', label: 'Singles', href: '/singles', icon: 'card' },
  { key: 'bulk', label: 'Bulk', href: '/bulk', icon: 'stack' },
  { key: 'listings', label: 'Listings', href: '/listings', icon: 'tag' },
  { key: 'orders', label: 'Orders', href: '/orders', icon: 'cart' },
  { key: 'analytics', label: 'Analytics', href: '/analytics', icon: 'chart' },
  { key: 'pricing', label: 'Pricing', href: '/pricing', icon: 'coin' },
  { key: 'settings', label: 'Settings', href: '/settings', icon: 'gear' },
];

const ICONS: Record<string, string> = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  camera: '<path d="M4 8a2 2 0 0 1 2-2h1l1.2-1.6a1 1 0 0 1 .8-.4h4a1 1 0 0 1 .8.4L16 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.5" r="3.2"/>',
  box: '<path d="M3.5 7 12 3l8.5 4-8.5 4z"/><path d="M3.5 7v10L12 21m8.5-14v10L12 21m0-10v10"/>',
  card: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M7.5 8h6M7.5 12h9M7.5 16h5"/>',
  stack: '<path d="M12 3 3.5 7 12 11l8.5-4z"/><path d="m3.5 12 8.5 4 8.5-4M3.5 17 12 21l8.5-4"/>',
  tag: '<path d="M3.5 11.5 11 4a2 2 0 0 1 1.4-.6H19a1.5 1.5 0 0 1 1.5 1.5v6.6a2 2 0 0 1-.6 1.4l-7.5 7.5a2 2 0 0 1-2.8 0l-6.1-6.1a2 2 0 0 1 0-2.8z"/><circle cx="16" cy="8" r="1.4"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M3 4h2l2.2 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.2L21 8H6"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  coin: '<ellipse cx="12" cy="6.5" rx="7" ry="3"/><path d="M5 6.5v11c0 1.66 3.13 3 7 3s7-1.34 7-3v-11"/><path d="M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.5M12 19v2.5M4.5 4.5l1.8 1.8M17.7 17.7l1.8 1.8M2.5 12H5m14 0h2.5M4.5 19.5l1.8-1.8M17.7 6.3l1.8-1.8"/>',
};

function navIcon(name: string): string {
  const body = ICONS[name] ?? ICONS['grid'];
  return `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

function renderNav(activeNav: string): string {
  return NAV_ITEMS.map((item) => {
    const active = item.key === activeNav ? ' class="nav-link active" aria-current="page"' : ' class="nav-link"';
    return `<li><a href="${escapeHtml(item.href)}"${active}>${navIcon(item.icon)}<span>${escapeHtml(item.label)}</span></a></li>`;
  }).join('\n');
}

export interface LayoutOptions {
  title: string;
  user?: UserRecord;
  activeNav: string;
  body: string;
}

/** Render a full authenticated app page with topbar + sidebar. */
export function renderLayout(opts: LayoutOptions): string {
  const { title, user, activeNav, body } = opts;
  const displayName = user?.display_name ?? user?.email ?? 'Account';
  const initial = String(displayName).trim().charAt(0).toUpperCase() || 'P';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} · PokeOps</title>
  <link rel="stylesheet" href="/app.css" />
</head>
<body class="app-shell">
  <div class="sidebar-scrim" data-sidebar-scrim hidden></div>
  <aside class="sidebar" data-sidebar>
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"></span>
      <span class="brand-name">PokeOps</span>
    </div>
    <nav class="sidebar-nav" aria-label="Primary">
      <ul>
${renderNav(activeNav)}
      </ul>
    </nav>
    <div class="sidebar-footer">Seller OS · v0.1</div>
  </aside>
  <div class="main-column">
    <header class="topbar">
      <button class="icon-btn sidebar-toggle" data-sidebar-toggle aria-label="Toggle navigation">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>
      <div class="topbar-title">${escapeHtml(title)}</div>
      <div class="topbar-spacer"></div>
      <div class="user-menu" data-user-menu>
        <button class="user-trigger" data-user-trigger aria-haspopup="true" aria-expanded="false">
          <span class="avatar">${escapeHtml(initial)}</span>
          <span class="user-name">${escapeHtml(displayName)}</span>
        </button>
        <div class="user-dropdown" data-user-dropdown hidden>
          <a href="/settings">Settings</a>
          <form method="post" action="/logout"><button type="submit">Log out</button></form>
        </div>
      </div>
    </header>
    <main class="content" id="content">
${body}
    </main>
  </div>
  <div class="toast-stack" data-toasts aria-live="polite"></div>
  <script src="/app.js" defer></script>
</body>
</html>`;
}
