import { getDb } from '../db/connection.js';
import { strategyFor, pokemonStrategy } from '../domain/tcg.js';
import { DEFAULT_SKU_FORMAT } from './settings.js';

/**
 * SKU generation (sections 21, 22).
 *
 * A SKU encodes the game, set, card number, condition and a per-user sequence,
 * e.g. `PKM-OBF-125-NM-001`. The default format is
 * `{game}-{set}-{number}-{condition}-{seq}` but a user can supply a custom
 * format string in Settings using those tokens.
 *
 * Sequences are per-user and monotonically increasing. We derive the next
 * sequence from the highest numeric suffix seen across the user's existing
 * inventory + listing SKUs, so a fresh SKU never collides with an old one and
 * the counter survives restarts without needing an extra column. After
 * computing a candidate we verify uniqueness and bump until it is free.
 */

/** Map a full condition code to the short code used inside a SKU. */
export const CONDITION_CODE: Record<string, string> = {
  M: 'M',
  NM: 'NM',
  LP: 'LP',
  MP: 'MP',
  HP: 'HP',
  DMG: 'DMG',
  GRADED: 'GR',
};

export interface GenerateSkuInput {
  /** Game short code (defaults to the Pokemon strategy's PKM). */
  gameCode?: string;
  /** Set abbreviation, e.g. 'OBF'. */
  setAbbreviation?: string | null;
  /** Card number, e.g. '125/197' or '125'. */
  cardNumber?: string | null;
  /** Condition grade code, e.g. 'NM'. */
  condition?: string | null;
  /** Per-user sequence number (1-based). */
  sequence: number;
  /** Optional custom format string; falls back to the default. */
  format?: string;
}

/** Normalize a raw token into an uppercase, SKU-safe fragment. */
function tokenize(raw: string | null | undefined, fallback = 'X'): string {
  if (!raw) return fallback;
  const cleaned = String(raw)
    .toUpperCase()
    .replace(/\s+/g, '')
    // Card numbers like 125/197 collapse to the printed number (125).
    .replace(/\/.*$/, '')
    .replace(/[^A-Z0-9]/g, '');
  return cleaned || fallback;
}

/** Short condition code (e.g. NM), defaulting to NM when unknown/absent. */
export function conditionCode(condition: string | null | undefined): string {
  if (!condition) return 'NM';
  const upper = condition.toUpperCase();
  return CONDITION_CODE[upper] ?? tokenize(upper, 'NM');
}

/** Zero-pad a sequence to at least 3 digits (001, 010, 1000). */
export function formatSequence(seq: number): string {
  const n = Math.max(0, Math.floor(seq));
  return String(n).padStart(3, '0');
}

/**
 * Render a SKU from its parts + a format string. Pure and deterministic.
 * Supported tokens: {game} {set} {number} {condition} {seq}.
 */
export function generateSku(input: GenerateSkuInput): string {
  const game = tokenize(input.gameCode ?? pokemonStrategy.skuGameCode, 'PKM');
  const set = tokenize(input.setAbbreviation, 'GEN');
  const number = tokenize(input.cardNumber, '000');
  const condition = conditionCode(input.condition);
  const seq = formatSequence(input.sequence);
  const format = input.format && input.format.trim() ? input.format : DEFAULT_SKU_FORMAT;

  return format
    .replace(/\{game\}/gi, game)
    .replace(/\{set\}/gi, set)
    .replace(/\{number\}/gi, number)
    .replace(/\{condition\}/gi, condition)
    .replace(/\{seq\}/gi, seq)
    .trim();
}

/** Highest trailing numeric suffix across a list of SKUs (0 when none). */
export function highestSequence(skus: Array<string | null | undefined>): number {
  let max = 0;
  for (const sku of skus) {
    if (!sku) continue;
    const m = /(\d+)\D*$/.exec(sku);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max;
}

export interface SkuGenerator {
  /** Whether a SKU is already used by this user (inventory or listings). */
  isTaken(userId: string, sku: string): boolean;
  /** Compute the next free sequence number for a user. */
  nextSequence(userId: string): number;
  /**
   * Generate a unique SKU for a card belonging to a user, honoring the user's
   * format string. Guaranteed not to collide with an existing inventory/listing
   * SKU for that user.
   */
  generateForUser(
    userId: string,
    card: { game?: string | null; setAbbreviation?: string | null; cardNumber?: string | null; condition?: string | null },
    format?: string,
  ): { sku: string; sequence: number };
  /**
   * Assign a SKU to an inventory row that lacks one (section 21). Returns the
   * assigned SKU (or the existing one if already present).
   */
  assignToInventory(userId: string, inventoryId: string, format?: string): string | null;
  /**
   * Generate a unique bulk-lot SKU (FEAT-006). Uses a `BULK` set token and the
   * category as the number token, e.g. `PKM-BULK-COMMONS-500-001`, and is
   * guaranteed not to collide with an existing inventory/listing SKU.
   */
  generateForBulkLot(
    userId: string,
    lot: { category?: string | null; cardCount?: number | null },
  ): { sku: string; sequence: number };
}

/** Collect every SKU currently used by a user (inventory + listings). */
function userSkus(userId: string): string[] {
  const db = getDb();
  const inv = db
    .prepare("SELECT sku FROM inventory WHERE user_id = ? AND sku IS NOT NULL AND sku <> ''")
    .all(userId) as Array<{ sku: string }>;
  const lst = db
    .prepare("SELECT sku FROM listings WHERE user_id = ? AND sku IS NOT NULL AND sku <> ''")
    .all(userId) as Array<{ sku: string }>;
  return [...inv.map((r) => r.sku), ...lst.map((r) => r.sku)];
}

export const skuGenerator: SkuGenerator = {
  isTaken(userId: string, sku: string): boolean {
    const db = getDb();
    const inv = db
      .prepare('SELECT 1 FROM inventory WHERE user_id = ? AND sku = ? LIMIT 1')
      .get(userId, sku);
    if (inv) return true;
    const lst = db
      .prepare('SELECT 1 FROM listings WHERE user_id = ? AND sku = ? LIMIT 1')
      .get(userId, sku);
    return Boolean(lst);
  },

  nextSequence(userId: string): number {
    return highestSequence(userSkus(userId)) + 1;
  },

  generateForUser(userId, card, format): { sku: string; sequence: number } {
    const strategy = strategyFor(card.game);
    let sequence = this.nextSequence(userId);
    // Guard against pathological collisions (e.g. custom format that omits the
    // sequence): bump until the SKU is free, capped so we never loop forever.
    for (let attempt = 0; attempt < 100000; attempt++) {
      const sku = generateSku({
        gameCode: strategy.skuGameCode,
        setAbbreviation: card.setAbbreviation ?? null,
        cardNumber: card.cardNumber ?? null,
        condition: card.condition ?? null,
        sequence,
        format,
      });
      if (!this.isTaken(userId, sku)) {
        return { sku, sequence };
      }
      sequence++;
    }
    // Extremely unlikely fallback: suffix with the raw sequence.
    return { sku: `${strategy.skuGameCode}-${Date.now()}`, sequence };
  },

  assignToInventory(userId, inventoryId, format): string | null {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT i.id, i.condition, i.sku, c.game AS game, c.number AS number, s.abbreviation AS set_abbreviation
         FROM inventory i
         LEFT JOIN cards c ON c.id = i.card_id
         LEFT JOIN sets s ON s.id = c.set_id
         WHERE i.user_id = ? AND i.id = ?`,
      )
      .get(userId, inventoryId) as
      | { id: string; condition: string; sku: string | null; game: string | null; number: string | null; set_abbreviation: string | null }
      | undefined;
    if (!row) return null;
    if (row.sku && row.sku.trim()) return row.sku;

    const { sku } = this.generateForUser(
      userId,
      {
        game: row.game,
        setAbbreviation: row.set_abbreviation,
        cardNumber: row.number,
        condition: row.condition,
      },
      format,
    );
    db.prepare("UPDATE inventory SET sku = ?, updated_at = datetime('now') WHERE user_id = ? AND id = ?").run(
      sku,
      userId,
      inventoryId,
    );
    return sku;
  },

  generateForBulkLot(userId, lot): { sku: string; sequence: number } {
    const game = tokenize(pokemonStrategy.skuGameCode, 'PKM');
    const category = tokenize(lot.category, 'BULK');
    const count = tokenize(lot.cardCount != null ? String(lot.cardCount) : null, '0');
    let sequence = this.nextSequence(userId);
    for (let attempt = 0; attempt < 100000; attempt++) {
      const seq = formatSequence(sequence);
      const sku = `${game}-BULK-${category}-${count}-${seq}`;
      if (!this.isTaken(userId, sku)) return { sku, sequence };
      sequence++;
    }
    return { sku: `${game}-BULK-${Date.now()}`, sequence };
  },
};
