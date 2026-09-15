import { getDb } from '../db/connection.js';
import { newId } from '../util/ids.js';

/** A trading-card set (shared reference data, not user-scoped). */
export interface CardSet {
  id: string;
  game: string;
  name: string;
  abbreviation: string | null;
  series: string | null;
  release_date: string | null;
  total_cards: number | null;
}

export interface CreateSetInput {
  id?: string;
  game?: string;
  name: string;
  abbreviation?: string | null;
  series?: string | null;
  release_date?: string | null;
  total_cards?: number | null;
}

/**
 * Data access for the sets table. Sets are shared reference data (every user
 * sees the same catalog), so these queries are NOT user-scoped.
 */
export const setsRepository = {
  getById(id: string): CardSet | undefined {
    return getDb().prepare('SELECT * FROM sets WHERE id = ?').get(id) as CardSet | undefined;
  },

  findByAbbreviation(abbreviation: string): CardSet | undefined {
    return getDb()
      .prepare('SELECT * FROM sets WHERE abbreviation = ? COLLATE NOCASE')
      .get(abbreviation) as CardSet | undefined;
  },

  listAll(): CardSet[] {
    return getDb()
      .prepare('SELECT * FROM sets ORDER BY release_date DESC, name ASC')
      .all() as CardSet[];
  },

  create(input: CreateSetInput): CardSet {
    const db = getDb();
    const id = input.id ?? newId();
    db.prepare(
      `INSERT INTO sets (id, game, name, abbreviation, series, release_date, total_cards)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.game ?? 'pokemon',
      input.name,
      input.abbreviation ?? null,
      input.series ?? null,
      input.release_date ?? null,
      input.total_cards ?? null,
    );
    return this.getById(id)!;
  },

  /** Insert only if the id is not already present (idempotent seeding). */
  upsertById(input: CreateSetInput & { id: string }): CardSet {
    const db = getDb();
    db.prepare(
      `INSERT OR IGNORE INTO sets (id, game, name, abbreviation, series, release_date, total_cards)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.game ?? 'pokemon',
      input.name,
      input.abbreviation ?? null,
      input.series ?? null,
      input.release_date ?? null,
      input.total_cards ?? null,
    );
    return this.getById(input.id)!;
  },
};
