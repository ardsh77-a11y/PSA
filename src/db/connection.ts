import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config/index.js';
import { runMigrations } from './schema.js';

let db: DatabaseSync | null = null;

/**
 * Return the process-wide SQLite connection, creating it (and the containing
 * data directory) on first use. Enables WAL journaling and foreign keys, then
 * runs migrations so the schema is always present.
 */
export function getDb(): DatabaseSync {
  if (db) return db;

  const dir = dirname(config.dbPath);
  if (dir && dir !== '.') {
    mkdirSync(dir, { recursive: true });
  }

  const instance = new DatabaseSync(config.dbPath);
  instance.exec('PRAGMA journal_mode = WAL;');
  instance.exec('PRAGMA foreign_keys = ON;');

  runMigrations(instance);

  db = instance;
  return db;
}

/** Close the singleton connection (used by tests / graceful shutdown). */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Testing hook: replace the process-wide connection with a caller-provided
 * instance (typically an in-memory DatabaseSync). Pass null to reset so the
 * next getDb() rebuilds from config. Not used in production code paths.
 */
export function __setTestDb(instance: DatabaseSync | null): void {
  db = instance;
}
