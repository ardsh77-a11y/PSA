import type { Router, RequestContext } from '../router.js';
import { html, redirect } from '../respond.js';
import { config } from '../../config/index.js';
import { userRepository } from '../../repositories/userRepository.js';
import { verifyPassword } from '../../util/password.js';
import { createSession, destroySession } from '../../util/session.js';
import { setCookie, clearCookie } from '../middleware/cookies.js';
import { renderAuthPage } from '../../views/pages/auth.js';
import type { ParsedBody } from '../middleware/bodyParser.js';

const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function fields(ctx: RequestContext): Record<string, string> {
  return (ctx.body as ParsedBody | undefined)?.fields ?? {};
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Register the authentication routes. On successful login/register a session
 * cookie is issued and the user is redirected to the dashboard.
 */
export function registerAuthRoutes(router: Router): void {
  router.get('/login', (ctx) => {
    if (ctx.user) return redirect(ctx.res, '/dashboard');
    html(ctx.res, 200, renderAuthPage({ mode: 'login' }));
  });

  router.get('/register', (ctx) => {
    if (ctx.user) return redirect(ctx.res, '/dashboard');
    html(ctx.res, 200, renderAuthPage({ mode: 'register' }));
  });

  router.post('/register', (ctx) => {
    const f = fields(ctx);
    const email = (f.email ?? '').trim();
    const displayName = (f.displayName ?? '').trim();
    const password = f.password ?? '';

    const fail = (error: string) =>
      html(ctx.res, 400, renderAuthPage({ mode: 'register', error, values: { email, displayName } }));

    if (!email || !displayName || !password) return fail('All fields are required.');
    if (!isValidEmail(email)) return fail('Please enter a valid email address.');
    if (password.length < 8) return fail('Password must be at least 8 characters.');
    if (userRepository.findByEmail(email)) return fail('An account with that email already exists.');

    const user = userRepository.create({ email, password, displayName });
    issueSession(ctx, user.id);
    redirect(ctx.res, '/dashboard');
  });

  router.post('/login', (ctx) => {
    const f = fields(ctx);
    const email = (f.email ?? '').trim();
    const password = f.password ?? '';

    const fail = () =>
      html(ctx.res, 401, renderAuthPage({ mode: 'login', error: 'Invalid email or password.', values: { email } }));

    const user = userRepository.findByEmail(email);
    if (!user) return fail();
    if (!verifyPassword(password, user.password_hash, user.password_salt)) return fail();

    issueSession(ctx, user.id);
    redirect(ctx.res, '/dashboard');
  });

  router.post('/logout', (ctx) => {
    destroySession(ctx.sessionToken);
    clearCookie(ctx.res, config.sessionCookieName);
    redirect(ctx.res, '/login');
  });
}

function issueSession(ctx: RequestContext, userId: string): void {
  const token = createSession(userId);
  setCookie(ctx.res, config.sessionCookieName, token, { maxAge: SESSION_MAX_AGE });
}
