import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/schema.js';
import { __setTestDb } from '../db/connection.js';
import { mockSellerAssistant, classifyIntent } from './mock/mockSellerAssistant.js';
import { inventoryRepository } from '../repositories/inventoryRepository.js';
import { salesRepository } from '../repositories/salesRepository.js';
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
  db.prepare("INSERT INTO sets (id, name, abbreviation) VALUES ('obf','Obsidian Flames','OBF')").run();
  db.prepare("INSERT INTO sets (id, name, abbreviation) VALUES ('mew','151','MEW')").run();
  db.prepare("INSERT INTO cards (id, set_id, name, pokemon_name, rarity, is_holo) VALUES ('c1','obf','Charizard ex','Charizard','Ultra Rare',1)").run();
  db.prepare("INSERT INTO cards (id, set_id, name, pokemon_name, rarity) VALUES ('c2','mew','Pikachu','Pikachu','Common')").run();
  priceSnapshotsRepository.create({ card_id: 'c1', source: 'm', market_price: 80, low: 70, high: 95, competition_count: 3 });
  return 'u1';
}

test('classifyIntent maps keywords to intents', () => {
  assert.strictEqual(classifyIntent('what is my most valuable unlisted inventory?'), 'most_valuable_unlisted');
  assert.strictEqual(classifyIntent('which set is making me the most money?'), 'best_set');
  assert.strictEqual(classifyIntent('how much is sitting in boxes?'), 'bulk_value');
});

test("'most valuable unlisted' returns a data-driven answer", async () => {
  const db = freshDb();
  try {
    const user = seed(db);
    inventoryRepository.create({ user_id: user, card_id: 'c1', condition: 'NM', quantity: 1, market_value: 80, status: 'Ready to List' });
    inventoryRepository.create({ user_id: user, card_id: 'c2', condition: 'NM', quantity: 1, market_value: 0.2, status: 'Ready to List' });

    const res = await mockSellerAssistant.ask(user, "what's my most valuable unlisted inventory?");
    assert.match(res.answer, /Charizard ex/, 'names the top card');
    assert.ok(res.data && res.data.rows && res.data.rows.length >= 1, 'returns rows');
    assert.strictEqual(res.data!.intent, 'most_valuable_unlisted');
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test("'which set makes the most money' returns a data-driven answer", async () => {
  const db = freshDb();
  try {
    const user = seed(db);
    salesRepository.create({ user_id: user, card_id: 'c1', sale_price: 60, net_profit: 40 });
    salesRepository.create({ user_id: user, card_id: 'c2', sale_price: 5, net_profit: 2 });

    const res = await mockSellerAssistant.ask(user, 'which set is making me the most money?');
    assert.match(res.answer, /Obsidian Flames/, 'names the top set');
    assert.ok(res.data && res.data.rows && res.data.rows.length >= 1);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('unknown question returns a helpful fallback', async () => {
  const db = freshDb();
  try {
    const user = seed(db);
    const res = await mockSellerAssistant.ask(user, 'hello there');
    assert.match(res.answer, /I can answer questions/);
    assert.ok(res.suggestions && res.suggestions.length > 0);
  } finally {
    __setTestDb(null);
    db.close();
  }
});
