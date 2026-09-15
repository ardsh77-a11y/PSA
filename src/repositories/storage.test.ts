import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/schema.js';
import { __setTestDb } from '../db/connection.js';
import { storageLocationsRepository, describeLocation } from './storageLocationsRepository.js';
import { inventoryRepository } from './inventoryRepository.js';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  __setTestDb(db);
  return db;
}

function seedUsers(db: DatabaseSync): { a: string; b: string } {
  db.prepare("INSERT INTO users (id, email, password_hash, password_salt, display_name) VALUES ('ua','a@x.co','h','s','A')").run();
  db.prepare("INSERT INTO users (id, email, password_hash, password_salt, display_name) VALUES ('ub','b@x.co','h','s','B')").run();
  db.prepare("INSERT INTO sets (id, name, abbreviation) VALUES ('s1','Obsidian Flames','OBF')").run();
  db.prepare("INSERT INTO cards (id, set_id, name, rarity) VALUES ('c1','s1','Charizard ex','Ultra Rare')").run();
  return { a: 'ua', b: 'ub' };
}

test('describeLocation renders as BOX / Shelf / Slot (or a label)', () => {
  assert.strictEqual(
    describeLocation({ box: 'BOX-A', shelf: '2', slot: '14', label: null }),
    'BOX-A · Shelf 2 · Slot 14',
  );
  assert.strictEqual(describeLocation({ box: null, shelf: null, slot: null, label: 'Holo Binder' }), 'Holo Binder');
  assert.strictEqual(describeLocation({ box: null, shelf: null, slot: null, label: null }), 'Unassigned');
});

test('storage CRUD is user-scoped', () => {
  const db = freshDb();
  try {
    const { a, b } = seedUsers(db);
    const loc = storageLocationsRepository.create({ user_id: a, box: 'BOX-A', shelf: '2', slot: '14' });
    assert.ok(loc.id);
    assert.strictEqual(storageLocationsRepository.listForUser(a).length, 1);
    // User B cannot see or mutate user A's location.
    assert.strictEqual(storageLocationsRepository.getById(b, loc.id), undefined);
    assert.strictEqual(storageLocationsRepository.updateById({ id: loc.id, user_id: b, box: 'HACK' }), undefined);
    assert.strictEqual(storageLocationsRepository.deleteById(b, loc.id), false);
    assert.ok(storageLocationsRepository.getById(a, loc.id), 'A location survives B attempts');

    // A can update and delete their own.
    const updated = storageLocationsRepository.updateById({ id: loc.id, user_id: a, box: 'BOX-B', shelf: '1', slot: '3' });
    assert.strictEqual(updated!.box, 'BOX-B');
    assert.strictEqual(describeLocation(updated!), 'BOX-B · Shelf 1 · Slot 3');
    assert.strictEqual(storageLocationsRepository.deleteById(a, loc.id), true);
    assert.strictEqual(storageLocationsRepository.listForUser(a).length, 0);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('assigning a storage location to inventory is user-scoped and renders on the row', () => {
  const db = freshDb();
  try {
    const { a, b } = seedUsers(db);
    const loc = storageLocationsRepository.create({ user_id: a, box: 'BOX-A', shelf: '2', slot: '14' });
    const inv = inventoryRepository.create({ user_id: a, card_id: 'c1', quantity: 1 });

    // Assign via inventory update.
    inventoryRepository.update(a, inv.id, { storage_location_id: loc.id });
    const row = inventoryRepository.getById(a, inv.id)!;
    assert.strictEqual(row.storage_location_id, loc.id);
    // The joined row exposes the storage fields for display.
    assert.strictEqual(
      describeLocation({ box: row.storage_box, shelf: row.storage_shelf, slot: row.storage_slot, label: row.storage_label }),
      'BOX-A · Shelf 2 · Slot 14',
    );

    // User B cannot assign to A's inventory row.
    assert.strictEqual(inventoryRepository.update(b, inv.id, { storage_location_id: loc.id }), undefined);
  } finally {
    __setTestDb(null);
    db.close();
  }
});
