import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/schema.js';
import { __setTestDb } from '../db/connection.js';
import { attentionService } from './attentionService.js';
import { inventoryRepository } from '../repositories/inventoryRepository.js';
import { ordersRepository } from '../repositories/ordersRepository.js';
import { listingsRepository } from '../repositories/listingsRepository.js';
import { priceSnapshotsRepository } from '../repositories/priceSnapshotsRepository.js';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  __setTestDb(db);
  return db;
}

function seed(db: DatabaseSync): string {
  db.prepare("INSERT INTO users (id, email, password_hash, password_salt, display_name) VALUES ('u1','a@x.co','h','s','A')").run();
  db.prepare("INSERT INTO sets (id, name, abbreviation) VALUES ('s1','Obsidian Flames','OBF')").run();
  db.prepare("INSERT INTO cards (id, set_id, name, rarity, is_holo) VALUES ('c1','s1','Charizard ex','Ultra Rare',1)").run();
  // A stable market snapshot so the pricing engine yields a known suggestion.
  priceSnapshotsRepository.create({ card_id: 'c1', source: 'mock-market', market_price: 40, low: 32, high: 50, competition_count: 5 });
  return 'u1';
}

function byKey(items: ReturnType<typeof attentionService.getAttentionItems>, key: string) {
  return items.find((i) => i.key === key);
}

test('detects valuable unlisted cards', () => {
  const db = freshDb();
  try {
    const user = seed(db);
    inventoryRepository.create({ user_id: user, card_id: 'c1', quantity: 1, market_value: 40, status: 'Ready to List' });
    const items = attentionService.getAttentionItems(user);
    const v = byKey(items, 'valuable_unlisted');
    assert.ok(v, 'valuable_unlisted item present');
    assert.strictEqual(v!.count, 1);
    assert.match(v!.href, /inventory/);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('detects orders needing fulfillment', () => {
  const db = freshDb();
  try {
    const user = seed(db);
    ordersRepository.create({ user_id: user, sale_price: 10, status: 'New' });
    ordersRepository.create({ user_id: user, sale_price: 10, status: 'Packed' });
    ordersRepository.create({ user_id: user, sale_price: 10, status: 'Delivered' });
    const items = attentionService.getAttentionItems(user);
    const o = byKey(items, 'orders_to_fulfill');
    assert.ok(o);
    assert.strictEqual(o!.count, 2, 'New + Packed, not Delivered');
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('detects underpriced listings against the pricing suggestion', () => {
  const db = freshDb();
  try {
    const user = seed(db);
    const inv = inventoryRepository.create({ user_id: user, card_id: 'c1', condition: 'NM', quantity: 1, market_value: 40, status: 'Listed' });
    // Suggested at balanced/NM ~= $40; list way under at $10.
    listingsRepository.create({ user_id: user, inventory_id: inv.id, title: 'Charizard', price: 10, condition: 'NM', status: 'active' });
    const items = attentionService.getAttentionItems(user);
    const u = byKey(items, 'underpriced_listings');
    assert.ok(u, 'underpriced listing detected');
    assert.strictEqual(u!.count, 1);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('detects cards missing a storage location', () => {
  const db = freshDb();
  try {
    const user = seed(db);
    inventoryRepository.create({ user_id: user, card_id: 'c1', quantity: 1, market_value: 2, status: 'Reviewed', storage_location_id: null });
    const items = attentionService.getAttentionItems(user);
    const m = byKey(items, 'missing_storage');
    assert.ok(m);
    assert.strictEqual(m!.count, 1);
  } finally {
    __setTestDb(null);
    db.close();
  }
});
