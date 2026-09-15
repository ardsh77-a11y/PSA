import type { IncomingMessage } from 'node:http';
import { config } from '../../config/index.js';
import { getSession } from '../../util/session.js';
import { getDb } from '../../db/connection.js';
import { parseCookies } from './cookies.js';
import type { UserRecord } from '../router.js';

export interface ResolvedSession {
  sessionToken?: string;
  user?: UserRecord;
}

/**
 * Parse the session cookie, look up the session in the in-memory store, and
 * load the associated user from the database. Returns the token + user (if
 * any) so the router can attach them to the request context.
 */
export function resolveSession(req: IncomingMessage): ResolvedSession {
  const cookies = parseCookies(req.headers['cookie']);
  const token = cookies[config.sessionCookieName];
  const session = getSession(token);
  if (!session) return { sessionToken: token };

  const db = getDb();
  const row = db
    .prepare('SELECT id, email, display_name FROM users WHERE id = ?')
    .get(session.userId) as UserRecord | undefined;

  if (!row) return { sessionToken: token };
  return { sessionToken: token, user: row };
}
