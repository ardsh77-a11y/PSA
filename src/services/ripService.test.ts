import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/schema.js';
import { __setTestDb } from '../db/connection.js';
import { ripService, estimateRipProfit } from './ripService.js';
import { ripsRepository } from '../repositories/ripsRepository.js';
import { expensesRepository } from '../repositories/expensesRepository.js';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  __setTestDb(db);
  return db;
}

function seedUser(db: DatabaseSync): string {
  db.prepare("INSERT INTO users (id, email, password_hash, password_salt, display_name) VALUES ('u1','a@x.co','h','s','A')").run();
  return 'u1';
}

test('estimateRipProfit = pulled value - box cost (section-26 example)', () => {
  // $105 box, 36 packs, $142 pulled -> $37 profit.
  assert.strictEqual(estimateRipProfit(142, 105), 37);
});

test('logRip stores the rip with $37 estimated profit and an acquisition expense', () => {
  const db = freshDb();
  try {
    const user = seedUser(db);
    const rip = ripService.logRip(user, {
      product_name: 'Obsidian Flames Booster Box',
      packs: 36,
      box_cost: 105,
      estimated_pulled_value: 142,
      cards_pulled: 360,
    });

    assert.strictEqual(rip.estimated_profit, 37);
    assert.strictEqual(rip.box_cost, 105);
    assert.strictEqual(rip.packs, 36);

    // A linked acquisition expense of $105 was recorded.
    assert.ok(rip.expense_id, 'rip links to an expense');
    const expense = expensesRepository.getById(user, rip.expense_id!)!;
    assert.strictEqual(expense.amount, 105);
    assert.strictEqual(expense.type, 'Rip');
    assert.strictEqual(expensesRepository.totalForUser(user), 105);

    // It is retrievable + user-scoped.
    assert.strictEqual(ripsRepository.listByUser(user).length, 1);
    assert.strictEqual(ripsRepository.listByUser('u2').length, 0);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('deleteRip removes the rip and its linked expense', () => {
  const db = freshDb();
  try {
    const user = seedUser(db);
    const rip = ripService.logRip(user, { product_name: 'ETB', box_cost: 50, estimated_pulled_value: 60 });
    assert.strictEqual(expensesRepository.countForUser(user), 1);
    assert.strictEqual(ripService.deleteRip(user, rip.id), true);
    assert.strictEqual(ripsRepository.countForUser(user), 0);
    assert.strictEqual(expensesRepository.countForUser(user), 0);
  } finally {
    __setTestDb(null);
    db.close();
  }
});
