import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/schema.js';
import { __setTestDb } from '../db/connection.js';
import { bulkService, categoryForCard, categoryForLotLabel } from './bulkService.js';
import { bulkLotsRepository } from '../repositories/bulkLotsRepository.js';
import { inventoryLotsRepository } from '../repositories/inventoryLotsRepository.js';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  __setTestDb(db);
  return db;
}

function seedUser(db: DatabaseSync, id = 'u1'): string {
  db.prepare(
    "INSERT INTO users (id, email, password_hash, password_salt, display_name) VALUES (?, ?, 'h', 's', 'U')",
  ).run(id, `${id}@x.co`);
  return id;
}

test('categoryForCard maps rarity/holo/type onto bulk categories', () => {
  assert.strictEqual(categoryForCard({ rarity: 'Common', card_type: 'Fire', is_holo: 0, is_reverse_holo: 0 }), 'commons');
  assert.strictEqual(categoryForCard({ rarity: 'Uncommon', card_type: 'Water', is_holo: 0, is_reverse_holo: 0 }), 'uncommons');
  assert.strictEqual(categoryForCard({ rarity: 'Rare', card_type: 'Grass', is_holo: 0, is_reverse_holo: 0 }), 'regular_rares');
  assert.strictEqual(categoryForCard({ rarity: 'Rare Holo', card_type: 'Psychic', is_holo: 1, is_reverse_holo: 0 }), 'holos');
  assert.strictEqual(categoryForCard({ rarity: 'Reverse Holo', card_type: 'Fire', is_holo: 0, is_reverse_holo: 1 }), 'reverse_holos');
  assert.strictEqual(categoryForCard({ rarity: 'Common', card_type: 'Energy', is_holo: 0, is_reverse_holo: 0 }), 'energy');
});

test('categoryForLotLabel keyword-matches aggregate lot categories', () => {
  assert.strictEqual(categoryForLotLabel('Bulk commons/uncommons'), 'commons');
  assert.strictEqual(categoryForLotLabel('Energy cards'), 'energy');
  assert.strictEqual(categoryForLotLabel('Reverse holo bulk'), 'reverse_holos');
});

test('getBulkSummary aggregates itemized inventory + inventory_lots by category', () => {
  const db = freshDb();
  try {
    const u = seedUser(db);
    db.prepare("INSERT INTO sets (id, name, abbreviation) VALUES ('s1','Obsidian Flames','OBF')").run();
    db.prepare("INSERT INTO cards (id, set_id, name, rarity, card_type) VALUES ('c-common','s1','Pidgey','Common','Colorless')").run();
    // Itemized bulk inventory: 200 commons worth $0.10 each.
    db.prepare(
      "INSERT INTO inventory (id, user_id, card_id, quantity, market_value, classification, status) VALUES ('i1', ?, 'c-common', 200, 0.10, 'bulk', 'Unprocessed')",
    ).run(u);
    // Aggregate pool: 4200 commons est $42.
    inventoryLotsRepository.create({ user_id: u, category: 'Bulk commons/uncommons', quantity: 4200, estimated_value: 42 });

    const summary = bulkService.getBulkSummary(u);
    const commons = summary.categories.find((c) => c.category === 'commons')!;
    assert.strictEqual(commons.count, 4400);
    assert.ok(Math.abs(commons.estimatedValue - (200 * 0.1 + 42)) < 0.001, 'commons value = itemized + pool');
    assert.strictEqual(summary.totalCount, 4400);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('generateLots on 3,142 commons packs into 100/250/500 lots summing <= available', () => {
  const db = freshDb();
  try {
    const u = seedUser(db);
    inventoryLotsRepository.create({ user_id: u, category: 'Bulk commons', quantity: 3142, estimated_value: 30 });

    const plan = bulkService.generateLots(u, { category: 'commons', lotSizes: [100, 250, 500] });

    assert.strictEqual(plan.available, 3142);
    // Every lot size is one of the requested sizes.
    for (const lot of plan.lots) {
      assert.ok([100, 250, 500].includes(lot.cardCount), `lot ${lot.cardCount} is a requested size`);
    }
    // Includes at least one 500-, 250- and 100-card lot given greedy packing.
    const sizes = plan.lots.map((l) => l.cardCount);
    assert.ok(sizes.includes(500), 'produces 500-card lots');
    // 3142 -> 6x500 = 3000, then 142 -> 0x250 + 1x100 = 100, remainder 42.
    const total = sizes.reduce((s, n) => s + n, 0);
    assert.ok(total <= plan.available, 'allocated does not exceed available');
    assert.strictEqual(total, plan.allocated);
    assert.strictEqual(plan.remainder, plan.available - total);
    assert.ok(sizes.includes(100), 'produces a 100-card lot from the leftover');
    // Greedy check: 6 full 500s.
    assert.strictEqual(sizes.filter((n) => n === 500).length, 6);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('generateLots respects a targetCount cap', () => {
  const db = freshDb();
  try {
    const u = seedUser(db);
    inventoryLotsRepository.create({ user_id: u, category: 'Bulk commons', quantity: 3142, estimated_value: 30 });
    const plan = bulkService.generateLots(u, { category: 'commons', lotSizes: [500], targetCount: 1200 });
    const total = plan.lots.reduce((s, l) => s + l.cardCount, 0);
    assert.strictEqual(plan.lots.length, 2); // 2x500 = 1000
    assert.strictEqual(total, 1000);
    assert.ok(total <= 1200);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('committing lots decrements the available pool with no double allocation', () => {
  const db = freshDb();
  try {
    const u = seedUser(db);
    const pool = inventoryLotsRepository.create({ user_id: u, category: 'Bulk commons', quantity: 1000, estimated_value: 10 });

    // Simulate committing two 500-card lots by decrementing the pool.
    bulkLotsRepository.create({ user_id: u, category: 'commons', card_count: 500, status: 'draft' });
    inventoryLotsRepository.decrementQuantity(u, pool.id, 500);
    bulkLotsRepository.create({ user_id: u, category: 'commons', card_count: 500, status: 'draft' });
    inventoryLotsRepository.decrementQuantity(u, pool.id, 500);

    const after = inventoryLotsRepository.getById(u, pool.id)!;
    assert.strictEqual(after.quantity, 0, 'pool fully allocated, not double-counted');

    // A further decrement removes nothing (clamped at 0).
    const removed = inventoryLotsRepository.decrementQuantity(u, pool.id, 500);
    assert.strictEqual(removed, 0);
    assert.strictEqual(inventoryLotsRepository.getById(u, pool.id)!.quantity, 0);

    // The available count reported by the service reflects the drained pool.
    assert.strictEqual(bulkService.availableForCategory(u, 'commons'), 0);
  } finally {
    __setTestDb(null);
    db.close();
  }
});
