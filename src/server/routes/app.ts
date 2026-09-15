import type { Router, RequestContext, Handler } from '../router.js';
import { html, redirect } from '../respond.js';
import { renderDashboard } from '../../views/pages/dashboard.js';

/**
 * Wrap a handler so it only runs for authenticated users; otherwise redirect
 * to /login. This is the guard every app (non-auth) route should use.
 */
export function requireAuth(handler: Handler): Handler {
  return (ctx: RequestContext) => {
    if (!ctx.user) {
      redirect(ctx.res, '/login');
      return;
    }
    return handler(ctx);
  };
}

/** Register the core application routes (root redirect + dashboard). */
export function registerAppRoutes(router: Router): void {
  router.get('/', (ctx) => {
    redirect(ctx.res, ctx.user ? '/dashboard' : '/login');
  });

  router.get(
    '/dashboard',
    requireAuth((ctx) => {
      html(ctx.res, 200, renderDashboard(ctx.user!));
    }),
  );
}
