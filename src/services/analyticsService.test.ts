import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/schema.js';
import { __setTestDb } from '../db/connection.js';
import { analyticsService } from './analyticsService.js';
import { inventoryRepository } from '../repositories/inventoryRepository.js';
import { salesRepository } from '../repositories/salesRepository.js';

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
  db.prepare("INSERT INTO cards (id, set_id, name, pokemon_name, rarity) VALUES ('c1','obf','Charizard ex','Charizard','Ultra Rare')").run();
  db.prepare("INSERT INTO cards (id, set_id, name, pokemon_name, rarity) VALUES ('c2','mew','Pikachu','Pikachu','Common')").run();
  return 'u1';
}

test('aggregates revenue, avg sale price and profit', () => {
  const db = freshDb();
  try {
    const user = seed(db);
    salesRepository.create({ user_id: user, card_id: 'c1', sale_price: 60, net_profit: 40 });
    salesRepository.create({ user_id: user, card_id: 'c2', sale_price: 20, net_profit: 10 });

    const a = analyticsService.getAnalytics(user);
    assert.strictEqual(a.summary.revenue, 80);
    assert.strictEqual(a.summary.profit, 50);
    assert.strictEqual(a.summary.cardsSold, 2);
    assert.strictEqual(a.summary.avgSalePrice, 40, '80 / 2');
    assert.strictEqual(a.summary.avgProfitPerCard, 25, '50 / 2');
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('best set is the one with the most revenue', () => {
  const db = freshDb();
  try {
    const user = seed(db);
    salesRepository.create({ user_id: user, card_id: 'c1', sale_price: 60, net_profit: 40 }); // Obsidian Flames
    salesRepository.create({ user_id: user, card_id: 'c2', sale_price: 20, net_profit: 10 }); // 151

    const a = analyticsService.getAnalytics(user);
    assert.strictEqual(a.bestSets[0].label, 'Obsidian Flames');
    assert.strictEqual(a.bestSets[0].value, 60);
    assert.strictEqual(a.bestPokemon[0].label, 'Charizard');
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('singles vs bulk revenue split matches inventory classification', () => {
  const db = freshDb();
  try {
    const user = seed(db);
    const single = inventoryRepository.create({ user_id: user, card_id: 'c1', quantity: 1, market_value: 60, status: 'Sold', classification: 'single' });
    const bulk = inventoryRepository.create({ user_id: user, card_id: 'c2', quantity: 1, market_value: 20, status: 'Sold', classification: 'bulk' });
    salesRepository.create({ user_id: user, inventory_id: single.id, card_id: 'c1', sale_price: 60, net_profit: 40 });
    salesRepository.create({ user_id: user, inventory_id: bulk.id, card_id: 'c2', sale_price: 20, net_profit: 10 });

    const a = analyticsService.getAnalytics(user);
    const singles = a.bulkVsSingles.find((x) => x.label === 'Singles')!.value;
    const bulkRev = a.bulkVsSingles.find((x) => x.label === 'Bulk')!.value;
    assert.strictEqual(singles, 60);
    assert.strictEqual(bulkRev, 20);
  } finally {
    __setTestDb(null);
    db.close();
  }
});
