import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations, TABLE_NAMES } from './schema.js';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  return db;
}

test('runMigrations creates all 15 entity tables', () => {
  const db = freshDb();
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  const names = new Set(rows.map((r) => r.name));

  assert.strictEqual(TABLE_NAMES.length, 15, 'expected 15 declared tables');
  for (const t of TABLE_NAMES) {
    assert.ok(names.has(t), `missing table: ${t}`);
  }
  db.close();
});

test('runMigrations is idempotent', () => {
  const db = freshDb();
  runMigrations(db); // second run should not throw
  const count = (
    db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get() as {
      c: number;
    }
  ).c;
  assert.strictEqual(count, 15);
  db.close();
});

test('user + card + inventory rows insert with foreign keys', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO users (id, email, password_hash, password_salt, display_name) VALUES (?, ?, ?, ?, ?)",
  ).run('u1', 'a@b.co', 'h', 's', 'Tester');
  db.prepare('INSERT INTO cards (id, name) VALUES (?, ?)').run('c1', 'Pikachu');
  db.prepare(
    'INSERT INTO inventory (id, user_id, card_id, quantity) VALUES (?, ?, ?, ?)',
  ).run('i1', 'u1', 'c1', 3);

  const inv = db.prepare('SELECT user_id, card_id, quantity FROM inventory WHERE id = ?').get('i1') as {
    user_id: string;
    card_id: string;
    quantity: number;
  };
  assert.strictEqual(inv.user_id, 'u1');
  assert.strictEqual(inv.card_id, 'c1');
  assert.strictEqual(inv.quantity, 3);
  db.close();
});

test('foreign_keys constraint is enforced', () => {
  const db = freshDb();
  assert.throws(() => {
    db.prepare('INSERT INTO inventory (id, user_id, quantity) VALUES (?, ?, ?)').run(
      'i2',
      'does-not-exist',
      1,
    );
  }, 'inserting inventory for a missing user should violate the FK');
  db.close();
});

test('inventory is scopable by user_id', () => {
  const db = freshDb();
  db.prepare("INSERT INTO users (id, email, password_hash, password_salt, display_name) VALUES ('u1','a@b.co','h','s','A')").run();
  db.prepare("INSERT INTO users (id, email, password_hash, password_salt, display_name) VALUES ('u2','c@d.co','h','s','B')").run();
  db.prepare("INSERT INTO inventory (id, user_id, quantity) VALUES ('x','u1',1)").run();
  db.prepare("INSERT INTO inventory (id, user_id, quantity) VALUES ('y','u2',1)").run();

  const forU1 = db.prepare('SELECT id FROM inventory WHERE user_id = ?').all('u1') as Array<{ id: string }>;
  assert.strictEqual(forU1.length, 1);
  assert.strictEqual(forU1[0].id, 'x');
  db.close();
});
