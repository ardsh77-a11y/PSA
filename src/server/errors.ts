import type { ServerResponse } from 'node:http';
import { escapeHtml } from '../util/html.js';
import { html as sendHtml } from './respond.js';

/**
 * Render a minimal, styled error page. It links the shared stylesheet so the
 * page still matches the design system without depending on the full layout
 * (avoids coupling the low-level error handler to view modules).
 */
function errorPage(status: number, heading: string, message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(status)} ${escapeHtml(heading)} · PokeOps</title>
  <link rel="stylesheet" href="/app.css" />
</head>
<body class="error-body">
  <main class="error-page">
    <div class="error-code">${escapeHtml(status)}</div>
    <h1>${escapeHtml(heading)}</h1>
    <p>${escapeHtml(message)}</p>
    <a class="btn btn-primary" href="/">Back to PokeOps</a>
  </main>
</body>
</html>`;
}

/** Send a styled 404 page. */
export function notFound(res: ServerResponse): void {
  sendHtml(res, 404, errorPage(404, 'Page not found', 'The page you were looking for does not exist.'));
}

/** Send a styled 500 page and log the underlying error. */
export function serverError(res: ServerResponse, err: unknown): void {
  console.error('[error] unhandled request error:', err);
  if (res.headersSent) {
    try {
      res.end();
    } catch {
      // response already closed
    }
    return;
  }
  sendHtml(res, 500, errorPage(500, 'Something went wrong', 'An unexpected error occurred. Please try again.'));
}
