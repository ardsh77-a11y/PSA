import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/schema.js';
import { __setTestDb } from '../db/connection.js';
import { inventoryRepository } from '../repositories/inventoryRepository.js';
import { listingsRepository } from '../repositories/listingsRepository.js';
import {
  generateSku,
  conditionCode,
  formatSequence,
  highestSequence,
  skuGenerator,
} from './skuGenerator.js';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  __setTestDb(db);
  return db;
}

function seed(db: DatabaseSync): void {
  db.prepare("INSERT INTO users (id, email, password_hash, password_salt, display_name) VALUES ('ua','a@x.co','h','s','A')").run();
  db.prepare("INSERT INTO users (id, email, password_hash, password_salt, display_name) VALUES ('ub','b@x.co','h','s','B')").run();
  db.prepare("INSERT INTO sets (id, name, abbreviation, total_cards) VALUES ('s1','Obsidian Flames','OBF',197)").run();
  db.prepare("INSERT INTO cards (id, set_id, name, number, rarity) VALUES ('c1','s1','Charizard ex','125/197','Ultra Rare')").run();
}

test('generateSku produces the default PKM-OBF-125-NM-001 format', () => {
  const sku = generateSku({
    gameCode: 'PKM',
    setAbbreviation: 'OBF',
    cardNumber: '125/197',
    condition: 'NM',
    sequence: 1,
  });
  assert.strictEqual(sku, 'PKM-OBF-125-NM-001');
});

test('condition codes and sequence padding', () => {
  assert.strictEqual(conditionCode('NM'), 'NM');
  assert.strictEqual(conditionCode('GRADED'), 'GR');
  assert.strictEqual(conditionCode(null), 'NM');
  assert.strictEqual(formatSequence(1), '001');
  assert.strictEqual(formatSequence(42), '042');
  assert.strictEqual(formatSequence(1000), '1000');
});

test('generateSku honors a custom format string with all tokens', () => {
  const sku = generateSku({
    gameCode: 'PKM',
    setAbbreviation: 'OBF',
    cardNumber: '125',
    condition: 'LP',
    sequence: 7,
    format: '{set}_{number}_{condition}_{game}_{seq}',
  });
  assert.strictEqual(sku, 'OBF_125_LP_PKM_007');
});

test('highestSequence reads the trailing numeric suffix', () => {
  assert.strictEqual(highestSequence(['PKM-OBF-125-NM-001', 'PKM-OBF-58-NM-010', null]), 10);
  assert.strictEqual(highestSequence([]), 0);
});

test('per-user sequence increments and stays unique across inventory + listings', () => {
  const db = freshDb();
  try {
    seed(db);

    // First SKU for user A starts at 001.
    const first = skuGenerator.generateForUser('ua', {
      game: 'pokemon',
      setAbbreviation: 'OBF',
      cardNumber: '125/197',
      condition: 'NM',
    });
    assert.strictEqual(first.sku, 'PKM-OBF-125-NM-001');
    assert.strictEqual(first.sequence, 1);

    // Persist it on an inventory row so the next call must advance.
    inventoryRepository.create({ id: 'i1', user_id: 'ua', card_id: 'c1', condition: 'NM', quantity: 1, sku: first.sku });

    const second = skuGenerator.generateForUser('ua', {
      game: 'pokemon',
      setAbbreviation: 'OBF',
      cardNumber: '125/197',
      condition: 'NM',
    });
    assert.strictEqual(second.sequence, 2, 'sequence must advance past the used SKU');
    assert.notStrictEqual(second.sku, first.sku);

    // A listing SKU also counts toward uniqueness.
    listingsRepository.create({ user_id: 'ua', title: 'x', sku: second.sku, status: 'draft' });
    const third = skuGenerator.generateForUser('ua', {
      game: 'pokemon',
      setAbbreviation: 'OBF',
      cardNumber: '125/197',
      condition: 'NM',
    });
    assert.ok(!skuGenerator.isTaken('ua', third.sku), 'generated SKU must be free');
    assert.strictEqual(third.sequence, 3);

    // Per-user: user B starts fresh at 001 despite user A's usage.
    const bFirst = skuGenerator.generateForUser('ub', {
      game: 'pokemon',
      setAbbreviation: 'OBF',
      cardNumber: '125/197',
      condition: 'NM',
    });
    assert.strictEqual(bFirst.sku, 'PKM-OBF-125-NM-001');
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('assignToInventory fills a SKU on a row that lacks one and is idempotent', () => {
  const db = freshDb();
  try {
    seed(db);
    inventoryRepository.create({ id: 'i1', user_id: 'ua', card_id: 'c1', condition: 'NM', quantity: 1 });

    const sku = skuGenerator.assignToInventory('ua', 'i1');
    assert.strictEqual(sku, 'PKM-OBF-125-NM-001');
    const row = inventoryRepository.getById('ua', 'i1');
    assert.strictEqual(row!.sku, 'PKM-OBF-125-NM-001');

    // Calling again returns the existing SKU (no churn).
    const again = skuGenerator.assignToInventory('ua', 'i1');
    assert.strictEqual(again, 'PKM-OBF-125-NM-001');
  } finally {
    __setTestDb(null);
    db.close();
  }
});
