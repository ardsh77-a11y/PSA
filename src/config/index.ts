/**
 * Central application configuration.
 * Values are read from process.env with sensible offline-first defaults.
 */

export interface AppConfig {
  port: number;
  dbPath: string;
  sessionCookieName: string;
  /** Marks the environment; used to toggle verbose logging etc. */
  env: string;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config: AppConfig = {
  port: envInt('PORT', 4000),
  dbPath: process.env.DB_PATH ?? 'data/pokeops.db',
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'pokeops_sid',
  env: process.env.NODE_ENV ?? 'development',
};
