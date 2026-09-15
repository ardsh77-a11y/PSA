import type { ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const PUBLIC_DIR = resolve(process.cwd(), 'public');

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Attempt to serve a static file from public/ for the given request path.
 * Returns true if a file was served, false if no matching file exists.
 * Guards against path traversal by resolving inside PUBLIC_DIR.
 */
export function tryServeStatic(pathname: string, res: ServerResponse): boolean {
  // Normalise: strip leading slash, reject traversal.
  const relative = pathname.replace(/^\/+/, '');
  if (!relative || relative.includes('..')) return false;

  const filePath = resolve(join(PUBLIC_DIR, relative));
  if (!filePath.startsWith(PUBLIC_DIR)) return false; // traversal guard
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;

  const type = CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const data = readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': type });
  res.end(data);
  return true;
}
