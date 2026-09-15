import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/schema.js';
import { __setTestDb } from '../db/connection.js';
import { mockRecognizer, seedFromRef, detectionCount, CONFIDENCE_THRESHOLD } from './mock/mockRecognizer.js';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  __setTestDb(db);
  return db;
}

/** Seed a small catalog; some cards get a price snapshot (preferred pool). */
function seedCatalog(db: DatabaseSync): void {
  db.prepare("INSERT INTO sets (id, name, abbreviation) VALUES ('s1','Base','BAS')").run();
  for (let i = 1; i <= 20; i++) {
    db.prepare(
      "INSERT INTO cards (id, set_id, name, pokemon_name, number, rarity, is_holo) VALUES (?, 's1', ?, ?, ?, 'Rare', ?)",
    ).run(`card-${i}`, `Poke ${i}`, `Poke ${i}`, `${i}/100`, i % 2);
  }
  // Snapshots for the first five (they should sort to the front of the pool).
  for (let i = 1; i <= 5; i++) {
    db.prepare(
      "INSERT INTO price_snapshots (id, card_id, market_price) VALUES (?, ?, ?)",
    ).run(`ps-${i}`, `card-${i}`, 10 + i);
  }
}

test('recognize is deterministic: same imageRef yields identical results', async () => {
  const db = freshDb();
  try {
    seedCatalog(db);
    const a = await mockRecognizer.recognize({ imageRef: 'batch/photo-a.jpg' });
    const b = await mockRecognizer.recognize({ imageRef: 'batch/photo-a.jpg' });
    assert.deepStrictEqual(a, b, 'identical imageRef must produce identical detections');
    assert.ok(a.length >= 1);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('different imageRefs generally produce different results', async () => {
  const db = freshDb();
  try {
    seedCatalog(db);
    const a = await mockRecognizer.recognize({ imageRef: 'one.jpg' });
    const b = await mockRecognizer.recognize({ imageRef: 'two.jpg' });
    assert.notDeepStrictEqual(a, b);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('filename count hint drives detection count', async () => {
  const db = freshDb();
  try {
    seedCatalog(db);
    const twelve = await mockRecognizer.recognize({ imageRef: 'uploads/12cards.jpg' });
    assert.strictEqual(twelve.length, 12);
    const three = await mockRecognizer.recognize({ imageRef: '3cards-photo.png' });
    assert.strictEqual(three.length, 3);
    const spaced = await mockRecognizer.recognize({ imageRef: '5 cards.png' });
    assert.strictEqual(spaced.length, 5);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('count hint clamps to a sane maximum', () => {
  const rng = () => 0.5;
  assert.strictEqual(detectionCount('999cards.jpg', rng), 24);
  assert.strictEqual(detectionCount('nofoto.jpg', rng), 1 + Math.floor(0.5 * 6));
});

test('confidence spread includes at least one needs-review (<0.85) detection', async () => {
  const db = freshDb();
  try {
    seedCatalog(db);
    // A 12-card batch reliably exercises the ~1/3 low-confidence branch.
    const results = await mockRecognizer.recognize({ imageRef: 'set/12cards.jpg' });
    const low = results.filter((r) => r.confidence < CONFIDENCE_THRESHOLD);
    const high = results.filter((r) => r.confidence >= 0.9);
    assert.ok(low.length >= 1, 'expected at least one low-confidence detection');
    assert.ok(high.length >= 1, 'expected at least one high-confidence detection');
    for (const r of results) {
      assert.ok(r.confidence >= 0 && r.confidence <= 1, 'confidence in [0,1]');
    }
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('results reference real seeded cards', async () => {
  const db = freshDb();
  try {
    seedCatalog(db);
    const results = await mockRecognizer.recognize({ imageRef: '6cards.jpg' });
    for (const r of results) {
      assert.ok(r.matchedCardId, 'each detection should match a card');
      const row = db.prepare('SELECT id, name FROM cards WHERE id = ?').get(r.matchedCardId!) as
        | { id: string; name: string }
        | undefined;
      assert.ok(row, `matchedCardId ${r.matchedCardId} must exist in the catalog`);
      assert.strictEqual(r.cardName, row!.name);
    }
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('set hint restricts sampling to that set when possible', async () => {
  const db = freshDb();
  try {
    seedCatalog(db);
    db.prepare("INSERT INTO sets (id, name, abbreviation) VALUES ('s2','Other','OTH')").run();
    db.prepare("INSERT INTO cards (id, set_id, name) VALUES ('only-s2','s2','Solo')").run();
    const results = await mockRecognizer.recognize({ imageRef: '4cards.jpg', hints: { setId: 's2' } });
    for (const r of results) {
      assert.strictEqual(r.matchedCardId, 'only-s2');
    }
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('seedFromRef is stable and deterministic', () => {
  assert.strictEqual(seedFromRef('abc'), seedFromRef('abc'));
  assert.notStrictEqual(seedFromRef('abc'), seedFromRef('abd'));
});
