import type { ServerResponse } from 'node:http';

/** Parse a Cookie header into a name->value map. */
export function parseCookies(header: string | string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  const raw = Array.isArray(header) ? header.join(';') : header;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

/** Append a Set-Cookie header (HttpOnly, Lax, root path). */
export function setCookie(
  res: ServerResponse,
  name: string,
  value: string,
  options: { maxAge?: number } = {},
): void {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  appendHeader(res, 'Set-Cookie', parts.join('; '));
}

/** Expire a cookie immediately. */
export function clearCookie(res: ServerResponse, name: string): void {
  appendHeader(res, 'Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function appendHeader(res: ServerResponse, name: string, value: string): void {
  const existing = res.getHeader(name);
  if (existing === undefined) {
    res.setHeader(name, value);
  } else if (Array.isArray(existing)) {
    res.setHeader(name, [...existing, value]);
  } else {
    res.setHeader(name, [String(existing), value]);
  }
}
