import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/schema.js';
import { __setTestDb } from '../db/connection.js';
import { inventoryRepository } from './inventoryRepository.js';

/**
 * Inventory repository tests. Each test installs a fresh in-memory DB via the
 * connection testing hook, so the real SQL runs but nothing touches the disk
 * or the shared singleton.
 */
function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  __setTestDb(db);
  return db;
}

function seedTwoUsers(db: DatabaseSync): { a: string; b: string } {
  db.prepare("INSERT INTO users (id, email, password_hash, password_salt, display_name) VALUES ('ua','a@x.co','h','s','A')").run();
  db.prepare("INSERT INTO users (id, email, password_hash, password_salt, display_name) VALUES ('ub','b@x.co','h','s','B')").run();
  db.prepare("INSERT INTO sets (id, name, abbreviation, total_cards) VALUES ('s1','Obsidian Flames','OBF',197)").run();
  db.prepare("INSERT INTO sets (id, name, abbreviation, total_cards) VALUES ('s2','Paldea Evolved','PAL',279)").run();
  db.prepare("INSERT INTO cards (id, set_id, name, number, rarity) VALUES ('c1','s1','Charizard ex','125/197','Ultra Rare')").run();
  db.prepare("INSERT INTO cards (id, set_id, name, number, rarity) VALUES ('c2','s1','Pikachu','58/197','Common')").run();
  db.prepare("INSERT INTO cards (id, set_id, name, number, rarity) VALUES ('c3','s2','Gardevoir ex','86/279','Double Rare')").run();
  return { a: 'ua', b: 'ub' };
}

test('inventory search filters by rarity, status, price and text q', () => {
  const db = freshDb();
  try {
    const { a } = seedTwoUsers(db);
    inventoryRepository.create({ id: 'i1', user_id: a, card_id: 'c1', status: 'Listed', market_value: 42, condition: 'NM', quantity: 1 });
    inventoryRepository.create({ id: 'i2', user_id: a, card_id: 'c2', status: 'Unprocessed', market_value: 0.15, condition: 'NM', quantity: 200 });
    inventoryRepository.create({ id: 'i3', user_id: a, card_id: 'c3', status: 'Ready to List', market_value: 12, condition: 'LP', quantity: 1 });

    const ultra = inventoryRepository.search(a, { rarity: 'Ultra Rare' });
    assert.strictEqual(ultra.total, 1);
    assert.strictEqual(ultra.rows[0].id, 'i1');

    const listed = inventoryRepository.search(a, { status: 'Listed' });
    assert.strictEqual(listed.total, 1);
    assert.strictEqual(listed.rows[0].id, 'i1');

    const midPrice = inventoryRepository.search(a, { minPrice: 1, maxPrice: 20 });
    assert.strictEqual(midPrice.total, 1);
    assert.strictEqual(midPrice.rows[0].id, 'i3');

    const byText = inventoryRepository.search(a, { q: 'Charizard' });
    assert.strictEqual(byText.total, 1);
    assert.strictEqual(byText.rows[0].id, 'i1');

    const bySet = inventoryRepository.search(a, { q: 'Paldea' });
    assert.strictEqual(bySet.total, 1);
    assert.strictEqual(bySet.rows[0].id, 'i3');
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('inventory search paginates with correct totals', () => {
  const db = freshDb();
  try {
    const { a } = seedTwoUsers(db);
    for (let i = 0; i < 25; i++) {
      inventoryRepository.create({ id: `p${i}`, user_id: a, card_id: 'c2', status: 'Identified', market_value: 1, quantity: 1 });
    }
    const page1 = inventoryRepository.search(a, { pageSize: 10, page: 1 });
    assert.strictEqual(page1.total, 25);
    assert.strictEqual(page1.rows.length, 10);
    assert.strictEqual(page1.page, 1);

    const page3 = inventoryRepository.search(a, { pageSize: 10, page: 3 });
    assert.strictEqual(page3.total, 25);
    assert.strictEqual(page3.rows.length, 5);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('inventory search is user-scoped: user B cannot see user A rows', () => {
  const db = freshDb();
  try {
    const { a, b } = seedTwoUsers(db);
    inventoryRepository.create({ id: 'ia', user_id: a, card_id: 'c1', market_value: 42, quantity: 1 });
    inventoryRepository.create({ id: 'ib', user_id: b, card_id: 'c2', market_value: 1, quantity: 1 });

    const forA = inventoryRepository.search(a, {});
    assert.strictEqual(forA.total, 1);
    assert.strictEqual(forA.rows[0].id, 'ia');

    const forB = inventoryRepository.search(b, {});
    assert.strictEqual(forB.total, 1);
    assert.strictEqual(forB.rows[0].id, 'ib');

    assert.ok(inventoryRepository.getById(a, 'ia'));
    assert.strictEqual(inventoryRepository.getById(b, 'ia'), undefined);

    assert.strictEqual(inventoryRepository.update(b, 'ia', { status: 'Sold' }), undefined);
    assert.strictEqual(inventoryRepository.delete(b, 'ia'), false);
    assert.ok(inventoryRepository.getById(a, 'ia'), 'row A must still exist after B tried to delete');
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('inventory update applies only provided fields and never wipes others', () => {
  const db = freshDb();
  try {
    const { a } = seedTwoUsers(db);
    inventoryRepository.create({ id: 'iu', user_id: a, card_id: 'c1', status: 'Identified', market_value: 42, target_price: 50, condition: 'NM', quantity: 1 });
    const updated = inventoryRepository.update(a, 'iu', { status: 'Listed' });
    assert.ok(updated);
    assert.strictEqual(updated!.status, 'Listed');
    assert.strictEqual(updated!.target_price, 50);
    assert.strictEqual(updated!.condition, 'NM');
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('inventory sort ascending/descending by market value', () => {
  const db = freshDb();
  try {
    const { a } = seedTwoUsers(db);
    inventoryRepository.create({ id: 'lo', user_id: a, card_id: 'c2', market_value: 1, quantity: 1 });
    inventoryRepository.create({ id: 'hi', user_id: a, card_id: 'c1', market_value: 42, quantity: 1 });
    const desc = inventoryRepository.search(a, { sort: '-value' });
    assert.strictEqual(desc.rows[0].id, 'hi');
    const asc = inventoryRepository.search(a, { sort: '+value' });
    assert.strictEqual(asc.rows[0].id, 'lo');
  } finally {
    __setTestDb(null);
    db.close();
  }
});
