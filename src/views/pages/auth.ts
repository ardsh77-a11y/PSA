import { escapeHtml } from '../../util/html.js';

export type AuthMode = 'login' | 'register';

export interface AuthPageOptions {
  mode: AuthMode;
  error?: string;
  values?: { email?: string; displayName?: string };
}

/**
 * Render the standalone (no-sidebar) login / register page. Shares the design
 * system stylesheet but uses a centered card layout.
 */
export function renderAuthPage(opts: AuthPageOptions): string {
  const isRegister = opts.mode === 'register';
  const title = isRegister ? 'Create your account' : 'Welcome back';
  const action = isRegister ? '/register' : '/login';
  const submitLabel = isRegister ? 'Create account' : 'Log in';
  const email = escapeHtml(opts.values?.email ?? '');
  const displayName = escapeHtml(opts.values?.displayName ?? '');

  const errorBlock = opts.error
    ? `<div class="form-error" role="alert">${escapeHtml(opts.error)}</div>`
    : '';

  const nameField = isRegister
    ? `<label class="field">
        <span>Display name</span>
        <input type="text" name="displayName" value="${displayName}" autocomplete="name" required />
      </label>`
    : '';

  const switcher = isRegister
    ? `<p class="auth-switch">Already have an account? <a href="/login">Log in</a></p>`
    : `<p class="auth-switch">New to PokeOps? <a href="/register">Create an account</a></p>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} · PokeOps</title>
  <link rel="stylesheet" href="/app.css" />
</head>
<body class="auth-body">
  <main class="auth-card">
    <div class="auth-brand">
      <span class="brand-mark" aria-hidden="true"></span>
      <span class="brand-name">PokeOps</span>
    </div>
    <h1>${escapeHtml(title)}</h1>
    <p class="auth-tagline">The operating system for Pokémon TCG sellers.</p>
    ${errorBlock}
    <form method="post" action="${action}" class="auth-form" data-enhance-form>
      ${nameField}
      <label class="field">
        <span>Email</span>
        <input type="email" name="email" value="${email}" autocomplete="email" required />
      </label>
      <label class="field">
        <span>Password</span>
        <input type="password" name="password" autocomplete="${isRegister ? 'new-password' : 'current-password'}" required minlength="8" />
      </label>
      <button type="submit" class="btn btn-primary btn-block">${escapeHtml(submitLabel)}</button>
    </form>
    ${switcher}
  </main>
</body>
</html>`;
}
