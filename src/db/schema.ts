import type { DatabaseSync } from 'node:sqlite';

/**
 * The complete PokeOps relational schema: all 15 entities plus indexes.
 * Idempotent (CREATE TABLE IF NOT EXISTS) so it can run on every boot.
 *
 * Per-user data isolation: every user-owned table carries a user_id column
 * that repositories MUST scope their queries by.
 */
export const TABLE_NAMES = [
  'users',
  'sets',
  'cards',
  'storage_locations',
  'inventory',
  'inventory_lots',
  'listings',
  'bulk_lots',
  'price_snapshots',
  'orders',
  'order_items',
  'sales',
  'expenses',
  'scans',
  'scan_results',
  'rips',
] as const;

export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      pricing_mode  TEXT NOT NULL DEFAULT 'balanced',
      settings_json TEXT NOT NULL DEFAULT '{}',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sets (
      id           TEXT PRIMARY KEY,
      game         TEXT NOT NULL DEFAULT 'pokemon',
      name         TEXT NOT NULL,
      abbreviation TEXT,
      series       TEXT,
      release_date TEXT,
      total_cards  INTEGER
    );

    CREATE TABLE IF NOT EXISTS cards (
      id              TEXT PRIMARY KEY,
      game            TEXT NOT NULL DEFAULT 'pokemon',
      set_id          TEXT REFERENCES sets(id) ON DELETE SET NULL,
      name            TEXT NOT NULL,
      pokemon_name    TEXT,
      number          TEXT,
      rarity          TEXT,
      card_type       TEXT,
      language        TEXT NOT NULL DEFAULT 'en',
      is_holo         INTEGER NOT NULL DEFAULT 0,
      is_reverse_holo INTEGER NOT NULL DEFAULT 0,
      image_url       TEXT,
      external_id     TEXT
    );

    CREATE TABLE IF NOT EXISTS storage_locations (
      id      TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      box     TEXT,
      shelf   TEXT,
      slot    TEXT,
      label   TEXT
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id                  TEXT PRIMARY KEY,
      user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      card_id             TEXT REFERENCES cards(id) ON DELETE SET NULL,
      condition           TEXT NOT NULL DEFAULT 'NM',
      quantity            INTEGER NOT NULL DEFAULT 1,
      acquisition_cost    REAL NOT NULL DEFAULT 0,
      market_value        REAL,
      target_price        REAL,
      status              TEXT NOT NULL DEFAULT 'in_stock',
      marketplace         TEXT,
      sku                 TEXT,
      storage_location_id TEXT REFERENCES storage_locations(id) ON DELETE SET NULL,
      date_acquired       TEXT,
      date_listed         TEXT,
      date_sold           TEXT,
      notes               TEXT,
      image_url           TEXT,
      is_demo             INTEGER NOT NULL DEFAULT 0,
      classification      TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS inventory_lots (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category        TEXT,
      quantity        INTEGER NOT NULL DEFAULT 0,
      estimated_value REAL,
      notes           TEXT
    );

    CREATE TABLE IF NOT EXISTS listings (
      id                  TEXT PRIMARY KEY,
      user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      inventory_id        TEXT REFERENCES inventory(id) ON DELETE SET NULL,
      bulk_lot_id         TEXT REFERENCES bulk_lots(id) ON DELETE SET NULL,
      marketplace         TEXT,
      title               TEXT NOT NULL,
      description         TEXT,
      price               REAL NOT NULL DEFAULT 0,
      condition           TEXT,
      sku                 TEXT,
      quantity            INTEGER NOT NULL DEFAULT 1,
      item_specifics_json TEXT NOT NULL DEFAULT '{}',
      status              TEXT NOT NULL DEFAULT 'draft',
      shipping_cost       REAL,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      published_at        TEXT
    );

    CREATE TABLE IF NOT EXISTS bulk_lots (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category        TEXT,
      card_count      INTEGER NOT NULL DEFAULT 0,
      title           TEXT,
      description     TEXT,
      suggested_price REAL,
      sku             TEXT,
      guarantees_json TEXT NOT NULL DEFAULT '{}',
      status          TEXT NOT NULL DEFAULT 'draft',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS price_snapshots (
      id                TEXT PRIMARY KEY,
      card_id           TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      source            TEXT,
      market_price      REAL,
      low               REAL,
      high              REAL,
      recent_sold_low   REAL,
      recent_sold_high  REAL,
      competition_count INTEGER,
      captured_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id                TEXT PRIMARY KEY,
      user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      marketplace       TEXT,
      external_order_id TEXT,
      buyer             TEXT,
      sale_price        REAL NOT NULL DEFAULT 0,
      fees              REAL NOT NULL DEFAULT 0,
      shipping          REAL NOT NULL DEFAULT 0,
      net_revenue       REAL NOT NULL DEFAULT 0,
      status            TEXT NOT NULL DEFAULT 'pending',
      tracking_number   TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      shipped_at        TEXT
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id           TEXT PRIMARY KEY,
      order_id     TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      inventory_id TEXT REFERENCES inventory(id) ON DELETE SET NULL,
      listing_id   TEXT REFERENCES listings(id) ON DELETE SET NULL,
      card_id      TEXT REFERENCES cards(id) ON DELETE SET NULL,
      quantity     INTEGER NOT NULL DEFAULT 1,
      unit_price   REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sales (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_id     TEXT REFERENCES orders(id) ON DELETE SET NULL,
      inventory_id TEXT REFERENCES inventory(id) ON DELETE SET NULL,
      card_id      TEXT REFERENCES cards(id) ON DELETE SET NULL,
      sale_price   REAL NOT NULL DEFAULT 0,
      fees         REAL NOT NULL DEFAULT 0,
      shipping     REAL NOT NULL DEFAULT 0,
      cost_basis   REAL NOT NULL DEFAULT 0,
      net_profit   REAL NOT NULL DEFAULT 0,
      sold_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type        TEXT,
      description TEXT,
      amount      REAL NOT NULL DEFAULT 0,
      incurred_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS scans (
      id             TEXT PRIMARY KEY,
      user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      image_ref      TEXT,
      status         TEXT NOT NULL DEFAULT 'pending',
      detected_count INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS scan_results (
      id                 TEXT PRIMARY KEY,
      scan_id            TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
      card_id            TEXT REFERENCES cards(id) ON DELETE SET NULL,
      pokemon_name       TEXT,
      card_name          TEXT,
      set_name           TEXT,
      set_abbreviation   TEXT,
      card_number        TEXT,
      rarity             TEXT,
      card_type          TEXT,
      language           TEXT,
      is_holo            INTEGER NOT NULL DEFAULT 0,
      is_reverse_holo    INTEGER NOT NULL DEFAULT 0,
      estimated_condition TEXT,
      confidence         REAL,
      status             TEXT NOT NULL DEFAULT 'detected',
      crop_ref           TEXT,
      raw_json           TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS rips (
      id                    TEXT PRIMARY KEY,
      user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_name          TEXT NOT NULL,
      packs                 INTEGER NOT NULL DEFAULT 1,
      box_cost              REAL NOT NULL DEFAULT 0,
      cards_pulled          INTEGER NOT NULL DEFAULT 0,
      estimated_pulled_value REAL NOT NULL DEFAULT 0,
      estimated_profit      REAL NOT NULL DEFAULT 0,
      expense_id            TEXT REFERENCES expenses(id) ON DELETE SET NULL,
      notes                 TEXT,
      opened_at             TEXT NOT NULL DEFAULT (datetime('now')),
      created_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_inventory_user_status ON inventory(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_inventory_user_card ON inventory(user_id, card_id);
    CREATE INDEX IF NOT EXISTS idx_cards_set ON cards(set_id);
    CREATE INDEX IF NOT EXISTS idx_price_snapshots_card ON price_snapshots(card_id);
    CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_listings_user_status ON listings(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_scan_results_scan ON scan_results(scan_id);
    CREATE INDEX IF NOT EXISTS idx_sales_user ON sales(user_id);
    CREATE INDEX IF NOT EXISTS idx_storage_user ON storage_locations(user_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_user ON expenses(user_id);
    CREATE INDEX IF NOT EXISTS idx_rips_user ON rips(user_id);
  `);
}
