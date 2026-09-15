import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/schema.js';
import { __setTestDb } from '../db/connection.js';
import { runSeed, DEMO_EMAIL } from './seed.js';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  __setTestDb(db);
  return db;
}

function count(db: DatabaseSync, sql: string): number {
  return (db.prepare(sql).get() as { c: number }).c;
}

test('seed creates a realistic dataset with the required scale', () => {
  const db = freshDb();
  try {
    const summary = runSeed();

    assert.ok(summary.sets >= 8, `expected >=8 sets, got ${summary.sets}`);
    assert.ok(summary.cards >= 100, `expected >=100 cards, got ${summary.cards}`);

    assert.strictEqual(count(db, 'SELECT COUNT(*) AS c FROM sets'), summary.sets);
    assert.ok(count(db, 'SELECT COUNT(*) AS c FROM cards') >= 100);

    // Demo user exists.
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(DEMO_EMAIL) as { id: string } | undefined;
    assert.ok(user, 'demo user should exist');

    // Inventory spans multiple statuses.
    const statuses = (db
      .prepare('SELECT DISTINCT status FROM inventory WHERE user_id = ?')
      .all(user!.id) as Array<{ status: string }>).map((r) => r.status);
    assert.ok(statuses.length >= 4, `expected inventory across multiple statuses, got ${statuses.join(', ')}`);
    for (const required of ['Unprocessed', 'Identified', 'Listed', 'Sold']) {
      assert.ok(statuses.includes(required), `expected a '${required}' inventory row`);
    }

    // All user-owned inventory is flagged is_demo.
    const nonDemo = count(db, `SELECT COUNT(*) AS c FROM inventory WHERE user_id = '${user!.id}' AND is_demo = 0`);
    assert.strictEqual(nonDemo, 0, 'all seeded inventory must be is_demo=1');

    // The required marquee card exists.
    const charizard = db
      .prepare("SELECT name FROM cards WHERE id = 'card-charizard-ex-obf-125'")
      .get() as { name: string } | undefined;
    assert.ok(charizard, 'Charizard ex 125/197 Obsidian Flames should be seeded');

    // Supporting data present.
    assert.ok(count(db, 'SELECT COUNT(*) AS c FROM price_snapshots') > 0);
    assert.ok(count(db, 'SELECT COUNT(*) AS c FROM storage_locations') > 0);
    assert.ok(count(db, 'SELECT COUNT(*) AS c FROM listings') > 0);
    assert.ok(count(db, 'SELECT COUNT(*) AS c FROM orders') > 0);
    assert.ok(count(db, 'SELECT COUNT(*) AS c FROM sales') > 0);
    assert.ok(count(db, 'SELECT COUNT(*) AS c FROM expenses') > 0);
    assert.ok(count(db, 'SELECT COUNT(*) AS c FROM inventory_lots') > 0);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('seed is idempotent: running twice does not duplicate rows', () => {
  const db = freshDb();
  try {
    const first = runSeed();
    const cards1 = count(db, 'SELECT COUNT(*) AS c FROM cards');
    const sets1 = count(db, 'SELECT COUNT(*) AS c FROM sets');
    const inv1 = count(db, 'SELECT COUNT(*) AS c FROM inventory');
    const users1 = count(db, 'SELECT COUNT(*) AS c FROM users');

    const second = runSeed();
    const cards2 = count(db, 'SELECT COUNT(*) AS c FROM cards');
    const sets2 = count(db, 'SELECT COUNT(*) AS c FROM sets');
    const inv2 = count(db, 'SELECT COUNT(*) AS c FROM inventory');
    const users2 = count(db, 'SELECT COUNT(*) AS c FROM users');

    assert.strictEqual(cards1, cards2, 'card count must not change on re-seed');
    assert.strictEqual(sets1, sets2, 'set count must not change on re-seed');
    assert.strictEqual(inv1, inv2, 'inventory count must not change on re-seed');
    assert.strictEqual(users1, 1, 'exactly one demo user');
    assert.strictEqual(users2, 1, 'still exactly one demo user after re-seed');
    assert.strictEqual(first.inventory, second.inventory);
  } finally {
    __setTestDb(null);
    db.close();
  }
});
