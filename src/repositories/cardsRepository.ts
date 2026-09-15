import { getDb } from '../db/connection.js';
import { newId } from '../util/ids.js';

/** A card definition (shared reference data, not user-scoped). */
export interface Card {
  id: string;
  game: string;
  set_id: string | null;
  name: string;
  pokemon_name: string | null;
  number: string | null;
  rarity: string | null;
  card_type: string | null;
  language: string;
  is_holo: number;
  is_reverse_holo: number;
  image_url: string | null;
  external_id: string | null;
}

/** A card joined with display fields from its set. */
export interface CardWithSet extends Card {
  set_name: string | null;
  set_abbreviation: string | null;
}

export interface CreateCardInput {
  id?: string;
  game?: string;
  set_id?: string | null;
  name: string;
  pokemon_name?: string | null;
  number?: string | null;
  rarity?: string | null;
  card_type?: string | null;
  language?: string;
  is_holo?: boolean | number;
  is_reverse_holo?: boolean | number;
  image_url?: string | null;
  external_id?: string | null;
}

function toInt(v: boolean | number | undefined): number {
  return v ? 1 : 0;
}

const CARD_WITH_SET_SELECT = `
  SELECT c.*, s.name AS set_name, s.abbreviation AS set_abbreviation
  FROM cards c
  LEFT JOIN sets s ON s.id = c.set_id`;

/**
 * Data access for the cards table. Cards are shared reference data (a global
 * catalog); creation is intentionally NOT user-scoped. Inventory ownership is
 * what carries user isolation.
 */
export const cardsRepository = {
  getById(id: string): CardWithSet | undefined {
    return getDb()
      .prepare(`${CARD_WITH_SET_SELECT} WHERE c.id = ?`)
      .get(id) as CardWithSet | undefined;
  },

  /**
   * Search the catalog for the card picker: matches name, pokemon name, number
   * or set name/abbreviation. Returns up to `limit` rows.
   */
  search(q: string, limit = 20): CardWithSet[] {
    const term = `%${q.trim()}%`;
    return getDb()
      .prepare(
        `${CARD_WITH_SET_SELECT}
         WHERE c.name LIKE ? COLLATE NOCASE
            OR c.pokemon_name LIKE ? COLLATE NOCASE
            OR c.number LIKE ? COLLATE NOCASE
            OR s.name LIKE ? COLLATE NOCASE
            OR s.abbreviation LIKE ? COLLATE NOCASE
         ORDER BY c.name ASC
         LIMIT ?`,
      )
      .all(term, term, term, term, term, limit) as CardWithSet[];
  },

  create(input: CreateCardInput): CardWithSet {
    const db = getDb();
    const id = input.id ?? newId();
    db.prepare(
      `INSERT INTO cards
        (id, game, set_id, name, pokemon_name, number, rarity, card_type, language, is_holo, is_reverse_holo, image_url, external_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.game ?? 'pokemon',
      input.set_id ?? null,
      input.name,
      input.pokemon_name ?? null,
      input.number ?? null,
      input.rarity ?? null,
      input.card_type ?? null,
      input.language ?? 'en',
      toInt(input.is_holo),
      toInt(input.is_reverse_holo),
      input.image_url ?? null,
      input.external_id ?? null,
    );
    return this.getById(id)!;
  },

  /** Idempotent insert keyed by id (used by the demo seed). */
  upsertById(input: CreateCardInput & { id: string }): CardWithSet {
    const db = getDb();
    db.prepare(
      `INSERT OR IGNORE INTO cards
        (id, game, set_id, name, pokemon_name, number, rarity, card_type, language, is_holo, is_reverse_holo, image_url, external_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.game ?? 'pokemon',
      input.set_id ?? null,
      input.name,
      input.pokemon_name ?? null,
      input.number ?? null,
      input.rarity ?? null,
      input.card_type ?? null,
      input.language ?? 'en',
      toInt(input.is_holo),
      toInt(input.is_reverse_holo),
      input.image_url ?? null,
      input.external_id ?? null,
    );
    return this.getById(input.id)!;
  },

  /** Distinct rarity values present in the catalog (for filter dropdowns). */
  distinctRarities(): string[] {
    const rows = getDb()
      .prepare("SELECT DISTINCT rarity FROM cards WHERE rarity IS NOT NULL AND rarity <> '' ORDER BY rarity")
      .all() as Array<{ rarity: string }>;
    return rows.map((r) => r.rarity);
  },
};
