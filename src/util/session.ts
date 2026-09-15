import { randomBytes } from 'node:crypto';

/**
 * In-memory session store keyed by an opaque random token.
 *
 * NOTE (future upgrade): This store lives in process memory, so sessions are
 * lost on restart and are not shared across processes. For a horizontally
 * scaled deployment this should be replaced with a persistent/shared store
 * (e.g. a `sessions` SQLite table or Redis). The public API here is designed
 * so that swap is a drop-in change.
 */

export interface SessionData {
  userId: string;
  createdAt: number;
}

const store = new Map<string, SessionData>();

/** Create a new session for a user and return its opaque token. */
export function createSession(userId: string): string {
  const token = randomBytes(32).toString('hex');
  store.set(token, { userId, createdAt: Date.now() });
  return token;
}

/** Look up the session for a token, or undefined if unknown. */
export function getSession(token: string | undefined): SessionData | undefined {
  if (!token) return undefined;
  return store.get(token);
}

/** Destroy a session (logout). */
export function destroySession(token: string | undefined): void {
  if (token) store.delete(token);
}
