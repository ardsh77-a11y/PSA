import type { ServerResponse } from 'node:http';

/** Send an HTML response. */
export function html(res: ServerResponse, status: number, markup: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(markup);
}

/** Send a JSON response. */
export function json(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

/** Send a 302 redirect. */
export function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location });
  res.end();
}
