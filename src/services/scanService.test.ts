import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/schema.js';
import { __setTestDb } from '../db/connection.js';
import { scanService } from './scanService.js';
import { scansRepository } from '../repositories/scansRepository.js';
import { scanResultsRepository } from '../repositories/scanResultsRepository.js';
import { inventoryRepository } from '../repositories/inventoryRepository.js';
import type { Recognizer, RecognitionResult } from './interfaces/recognizer.js';

const USER = 'user-1';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  __setTestDb(db);
  db.prepare(
    "INSERT INTO users (id, email, password_hash, password_salt, display_name) VALUES (?, 'u@x', 'h', 's', 'U')",
  ).run(USER);
  db.prepare("INSERT INTO sets (id, name, abbreviation) VALUES ('s1','Base','BAS')").run();
  for (let i = 1; i <= 10; i++) {
    db.prepare(
      "INSERT INTO cards (id, set_id, name, pokemon_name, number, rarity) VALUES (?, 's1', ?, ?, ?, 'Rare')",
    ).run(`card-${i}`, `Poke ${i}`, `Poke ${i}`, `${i}/100`);
  }
  return db;
}

/** A recognizer we control precisely (one confirmed, one needs_review). */
const fixedRecognizer: Recognizer = {
  async recognize(): Promise<RecognitionResult[]> {
    return [
      { cardName: 'Poke 1', matchedCardId: 'card-1', estimatedCondition: 'NM', confidence: 0.95, cropRef: 'r#0' },
      { cardName: 'Poke 2', matchedCardId: 'card-2', estimatedCondition: 'LP', confidence: 0.6, cropRef: 'r#1' },
    ];
  },
};

test('runScan persists a scan and its results with confidence-based status', async () => {
  const db = freshDb();
  try {
    const out = await scanService.runScan({ userId: USER, imageRef: 'a.jpg' }, fixedRecognizer);
    assert.strictEqual(out.scan.status, 'ready');
    assert.strictEqual(out.scan.detected_count, 2);
    assert.strictEqual(out.results.length, 2);

    const persistedScan = scansRepository.getById(USER, out.scan.id);
    assert.ok(persistedScan);
    const results = scanResultsRepository.listByScan(out.scan.id);
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].status, 'confirmed');
    assert.strictEqual(results[1].status, 'needs_review');
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('a correction updates a scan result', async () => {
  const db = freshDb();
  try {
    const out = await scanService.runScan({ userId: USER, imageRef: 'a.jpg' }, fixedRecognizer);
    const target = out.results[1];
    const updated = scanResultsRepository.update(target.id, {
      card_id: 'card-5',
      card_name: 'Poke 5',
      estimated_condition: 'MP',
      status: 'confirmed',
    });
    assert.ok(updated);
    assert.strictEqual(updated!.card_id, 'card-5');
    assert.strictEqual(updated!.card_name, 'Poke 5');
    assert.strictEqual(updated!.estimated_condition, 'MP');
    assert.strictEqual(updated!.status, 'confirmed');
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('committing a confirmed result creates a user-scoped inventory row with corrected fields', async () => {
  const db = freshDb();
  try {
    const out = await scanService.runScan({ userId: USER, imageRef: 'a.jpg' }, fixedRecognizer);
    const first = out.results[0];
    // Apply a correction: change match + condition before committing.
    scanResultsRepository.update(first.id, { card_id: 'card-3', estimated_condition: 'LP' });

    const res = scanService.commitScanResult(USER, first.id);
    assert.ok(res.inventory, res.error);
    assert.strictEqual(res.inventory!.user_id, USER);
    assert.strictEqual(res.inventory!.card_id, 'card-3');
    assert.strictEqual(res.inventory!.condition, 'LP');
    assert.strictEqual(res.inventory!.status, 'Identified');
    assert.strictEqual(res.inventory!.quantity, 1);

    // The scan result is now marked committed.
    assert.strictEqual(scanResultsRepository.getById(first.id)!.status, 'committed');

    // Another user cannot see it.
    assert.strictEqual(inventoryRepository.countForUser('other'), 0);
    assert.strictEqual(inventoryRepository.countForUser(USER), 1);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('commitAllConfirmed commits confirmed and skips needs_review', async () => {
  const db = freshDb();
  try {
    const out = await scanService.runScan({ userId: USER, imageRef: 'a.jpg' }, fixedRecognizer);
    const summary = scanService.commitAllConfirmed(USER, out.scan.id);
    assert.strictEqual(summary.committed, 1, 'only the confirmed result commits');
    assert.strictEqual(summary.skipped, 1, 'the needs_review result is skipped');
    assert.strictEqual(inventoryRepository.countForUser(USER), 1);

    // The needs_review result is untouched (still reviewable, not committed).
    const results = scanResultsRepository.listByScan(out.scan.id);
    const review = results.find((r) => r.confidence !== null && r.confidence < 0.85)!;
    assert.strictEqual(review.status, 'needs_review');
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('a recognizer failure leaves the scan and any results intact (no data loss)', async () => {
  const db = freshDb();
  try {
    const failing: Recognizer = {
      async recognize(): Promise<RecognitionResult[]> {
        throw new Error('CV backend unavailable');
      },
    };
    const out = await scanService.runScan({ userId: USER, imageRef: 'boom.jpg' }, failing);
    assert.strictEqual(out.scan.status, 'error');
    assert.ok(out.error);

    // The scan row survives and is retrievable.
    const scan = scansRepository.getById(USER, out.scan.id);
    assert.ok(scan, 'scan row must persist through a recognizer failure');
    assert.strictEqual(scan!.status, 'error');
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('commit refuses an unmatched detection without a name', async () => {
  const db = freshDb();
  try {
    const scan = scansRepository.create({ user_id: USER, image_ref: 'x.jpg', status: 'ready' });
    const [row] = scanResultsRepository.bulkInsert(scan.id, [
      { confidence: 0.9, status: 'confirmed', card_id: null, card_name: null, pokemon_name: null },
    ]);
    const res = scanService.commitScanResult(USER, row.id);
    assert.strictEqual(res.inventory, undefined);
    assert.ok(res.error);
    assert.strictEqual(inventoryRepository.countForUser(USER), 0);
  } finally {
    __setTestDb(null);
    db.close();
  }
});
