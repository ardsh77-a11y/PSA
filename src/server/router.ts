import type { IncomingMessage, ServerResponse } from 'node:http';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface UserRecord {
  id: string;
  email: string;
  display_name: string;
  [key: string]: unknown;
}

/** Per-request context passed to every handler. */
export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  /** Session token from the cookie, if present. */
  sessionToken?: string;
  /** Authenticated user, if any. */
  user?: UserRecord;
}

export type Handler = (ctx: RequestContext) => void | Promise<void>;

interface Route {
  method: HttpMethod;
  segments: string[];
  handler: Handler;
}

/**
 * Match a registered route path pattern against a concrete request path.
 * Supports `:param` segments. Returns extracted params or null on no match.
 *
 * Exported for unit testing.
 */
export function matchPath(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const patternSegments = splitPath(pattern);
  const pathSegments = splitPath(path);
  if (patternSegments.length !== pathSegments.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternSegments.length; i++) {
    const p = patternSegments[i];
    const actual = pathSegments[i];
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(actual);
    } else if (p !== actual) {
      return null;
    }
  }
  return params;
}

function splitPath(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

export class Router {
  private routes: Route[] = [];

  add(method: HttpMethod, pattern: string, handler: Handler): void {
    this.routes.push({ method, segments: splitPath(pattern), handler });
  }

  get(pattern: string, handler: Handler): void {
    this.add('GET', pattern, handler);
  }

  post(pattern: string, handler: Handler): void {
    this.add('POST', pattern, handler);
  }

  put(pattern: string, handler: Handler): void {
    this.add('PUT', pattern, handler);
  }

  patch(pattern: string, handler: Handler): void {
    this.add('PATCH', pattern, handler);
  }

  delete(pattern: string, handler: Handler): void {
    this.add('DELETE', pattern, handler);
  }

  /**
   * Find the first matching route for a method + path.
   * Returns the handler and extracted params, or null if nothing matched.
   */
  match(
    method: string,
    path: string,
  ): { handler: Handler; params: Record<string, string> } | null {
    const pathSegments = splitPath(path);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== pathSegments.length) continue;
      const params = matchSegments(route.segments, pathSegments);
      if (params) return { handler: route.handler, params };
    }
    return null;
  }
}

function matchSegments(
  patternSegments: string[],
  pathSegments: string[],
): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (let i = 0; i < patternSegments.length; i++) {
    const p = patternSegments[i];
    const actual = pathSegments[i];
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(actual);
    } else if (p !== actual) {
      return null;
    }
  }
  return params;
}
