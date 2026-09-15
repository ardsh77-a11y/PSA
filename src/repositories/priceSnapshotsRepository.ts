import { getDb } from '../db/connection.js';
import { newId } from '../util/ids.js';

/** A captured market-price snapshot for a card (shared reference data). */
export interface PriceSnapshot {
  id: string;
  card_id: string;
  source: string | null;
  market_price: number | null;
  low: number | null;
  high: number | null;
  recent_sold_low: number | null;
  recent_sold_high: number | null;
  competition_count: number | null;
  captured_at: string;
}

export interface CreatePriceSnapshotInput {
  id?: string;
  card_id: string;
  source?: string | null;
  market_price?: number | null;
  low?: number | null;
  high?: number | null;
  recent_sold_low?: number | null;
  recent_sold_high?: number | null;
  competition_count?: number | null;
  captured_at?: string | null;
}

/** Data access for price_snapshots. Snapshots belong to a card, not a user. */
export const priceSnapshotsRepository = {
  /** All snapshots for a card, oldest first (for charting a history). */
  historyForCard(cardId: string): PriceSnapshot[] {
    return getDb()
      .prepare('SELECT * FROM price_snapshots WHERE card_id = ? ORDER BY captured_at ASC')
      .all(cardId) as PriceSnapshot[];
  },

  /** The most recent snapshot for a card, if any. */
  latestForCard(cardId: string): PriceSnapshot | undefined {
    return getDb()
      .prepare('SELECT * FROM price_snapshots WHERE card_id = ? ORDER BY captured_at DESC LIMIT 1')
      .get(cardId) as PriceSnapshot | undefined;
  },

  create(input: CreatePriceSnapshotInput): PriceSnapshot {
    const db = getDb();
    const id = input.id ?? newId();
    db.prepare(
      `INSERT INTO price_snapshots
        (id, card_id, source, market_price, low, high, recent_sold_low, recent_sold_high, competition_count, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
    ).run(
      id,
      input.card_id,
      input.source ?? null,
      input.market_price ?? null,
      input.low ?? null,
      input.high ?? null,
      input.recent_sold_low ?? null,
      input.recent_sold_high ?? null,
      input.competition_count ?? null,
      input.captured_at ?? null,
    );
    return getDb().prepare('SELECT * FROM price_snapshots WHERE id = ?').get(id) as PriceSnapshot;
  },
};
