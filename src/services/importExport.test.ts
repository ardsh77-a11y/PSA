import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/schema.js';
import { __setTestDb } from '../db/connection.js';
import { importExportService, parseCsv, toCsv, INVENTORY_CSV_HEADER } from './importExport.js';
import { inventoryRepository } from '../repositories/inventoryRepository.js';

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
  db.prepare("INSERT INTO cards (id, set_id, name, number, rarity) VALUES ('c1','obf','Charizard ex','125/197','Ultra Rare')").run();
  return 'u1';
}

test('parseCsv handles quoted fields, escaped quotes and embedded commas', () => {
  const rows = parseCsv('a,b,c\r\n"x,y","he said ""hi""",z\n');
  assert.deepStrictEqual(rows[0], ['a', 'b', 'c']);
  assert.deepStrictEqual(rows[1], ['x,y', 'he said "hi"', 'z']);
});

test('toCsv quotes fields that need it and round-trips', () => {
  const csv = toCsv([['a', 'b'], ['x,y', 'q"q']]);
  const back = parseCsv(csv);
  assert.deepStrictEqual(back, [['a', 'b'], ['x,y', 'q"q']]);
});

test('CSV export round-trips through import', () => {
  const db = freshDb();
  try {
    const user = seed(db);
    inventoryRepository.create({ user_id: user, card_id: 'c1', condition: 'NM', quantity: 2, acquisition_cost: 12, market_value: 40, status: 'Ready to List', classification: 'single' });

    const exported = importExportService.exportInventoryCsv(user);
    assert.match(exported.split('\r\n')[0], /card_name/, 'has a header');

    // Import into a second user; the row should be recreated.
    db.prepare("INSERT INTO users (id, email, password_hash, password_salt, display_name) VALUES ('u2','b@x.co','h','s','B')").run();
    const result = importExportService.importInventoryCsv('u2', exported);
    assert.strictEqual(result.created, 1, 'one row created');
    assert.strictEqual(result.errored, 0);

    const rows = inventoryRepository.search('u2', {}).rows;
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].quantity, 2);
    assert.strictEqual(rows[0].card_name, 'Charizard ex');
    assert.strictEqual(rows[0].market_value, 40);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('bad rows are reported without aborting the whole import', () => {
  const db = freshDb();
  try {
    const user = seed(db);
    const csv = toCsv([
      INVENTORY_CSV_HEADER,
      ['Pikachu', '151', 'MEW', '25/165', 'Common', 'NM', '3', '0.10', '0.25', 'Unprocessed', '', 'single', ''],
      // Bad row: missing card_name.
      ['', '151', 'MEW', '26/165', 'Common', 'NM', '1', '0', '0', 'Unprocessed', '', 'single', ''],
      // Bad row: invalid quantity.
      ['Bulbasaur', '151', 'MEW', '1/165', 'Common', 'NM', 'notanumber', '0', '0', 'Unprocessed', '', 'single', ''],
      // Bad row: unknown status.
      ['Squirtle', '151', 'MEW', '7/165', 'Common', 'NM', '1', '0', '0', 'Nonsense', '', 'single', ''],
      // Good row again after the bad ones (proves the import didn't abort).
      ['Charmander', '151', 'MEW', '4/165', 'Common', 'NM', '1', '0', '0', 'Unprocessed', '', 'single', ''],
    ]);

    const result = importExportService.importInventoryCsv(user, csv);
    assert.strictEqual(result.total, 5);
    assert.strictEqual(result.created, 2, 'the two good rows import');
    assert.strictEqual(result.errored, 3, 'three bad rows reported');
    assert.strictEqual(result.errors.length, 3);
    assert.match(result.errors[0].message, /card_name/);
  } finally {
    __setTestDb(null);
    db.close();
  }
});
