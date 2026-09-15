import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/schema.js';
import { __setTestDb } from '../db/connection.js';
import { recommendationService } from './recommendationService.js';
import { inventoryRepository } from '../repositories/inventoryRepository.js';
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
  db.prepare("INSERT INTO sets (id, name, abbreviation) VALUES ('s1','Set','ST')").run();
  // High-value, low-competition, high demand card.
  db.prepare("INSERT INTO cards (id, set_id, name, rarity, is_holo) VALUES ('hi','s1','Charizard ex','Ultra Rare',1)").run();
  priceSnapshotsRepository.create({ card_id: 'hi', source: 'm', market_price: 80, low: 70, high: 95, recent_sold_low: 60, recent_sold_high: 95, competition_count: 2 });
  // Low-value, high-competition, fresh card.
  db.prepare("INSERT INTO cards (id, set_id, name, rarity) VALUES ('lo','s1','Pikachu','Common')").run();
  priceSnapshotsRepository.create({ card_id: 'lo', source: 'm', market_price: 0.2, low: 0.15, high: 0.3, recent_sold_low: 0.18, recent_sold_high: 0.2, competition_count: 60 });
  return 'u1';
}

test('ranks high-value/high-demand/older cards above low-value fresh ones', () => {
  const db = freshDb();
  try {
    const user = seed(db);
    const old = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    const fresh = new Date().toISOString().slice(0, 19).replace('T', ' ');

    inventoryRepository.create({ user_id: user, card_id: 'hi', condition: 'NM', quantity: 1, market_value: 80, status: 'Ready to List', date_acquired: old });
    inventoryRepository.create({ user_id: user, card_id: 'lo', condition: 'NM', quantity: 1, market_value: 0.2, status: 'Ready to List', date_acquired: fresh });

    const recs = recommendationService.listTheseNext(user, 5);
    assert.strictEqual(recs.length, 2);
    assert.strictEqual(recs[0].cardName, 'Charizard ex', 'high-value card ranks first');
    assert.ok(recs[0].score > recs[1].score, 'and has a higher score');
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('excludes Listed, Sold and bulk cards', () => {
  const db = freshDb();
  try {
    const user = seed(db);
    inventoryRepository.create({ user_id: user, card_id: 'hi', quantity: 1, market_value: 80, status: 'Listed' });
    inventoryRepository.create({ user_id: user, card_id: 'hi', quantity: 1, market_value: 80, status: 'Sold' });
    inventoryRepository.create({ user_id: user, card_id: 'lo', quantity: 100, market_value: 0.2, status: 'Unprocessed', classification: 'bulk' });
    inventoryRepository.create({ user_id: user, card_id: 'hi', quantity: 1, market_value: 80, status: 'Ready to List' });

    const recs = recommendationService.listTheseNext(user, 10);
    assert.strictEqual(recs.length, 1, 'only the unlisted single is recommended');
  } finally {
    __setTestDb(null);
    db.close();
  }
});
