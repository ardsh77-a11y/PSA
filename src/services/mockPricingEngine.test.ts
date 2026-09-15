import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/schema.js';
import { __setTestDb } from '../db/connection.js';
import {
  mockPricingEngine,
  computeFeesAndNet,
  computeSuggestedPrice,
  deriveMarketValue,
} from './mock/mockPricingEngine.js';
import { DEFAULT_PRICING_SETTINGS, type PricingSettings } from './settings.js';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  __setTestDb(db);
  return db;
}

function seedCardWithSnapshot(db: DatabaseSync): void {
  db.prepare("INSERT INTO cards (id, name, rarity, is_holo) VALUES ('c1','Charizard ex','Ultra Rare',1)").run();
  db.prepare(
    `INSERT INTO price_snapshots (id, card_id, source, market_price, low, high, recent_sold_low, recent_sold_high, competition_count, captured_at)
     VALUES ('ps1','c1','mock-market', 40, 32, 50, 34, 46, 12, '2024-01-01 00:00:00')`,
  ).run();
}

const settings: PricingSettings = { ...DEFAULT_PRICING_SETTINGS };

test('getMarketData uses the latest seeded snapshot', () => {
  const db = freshDb();
  try {
    seedCardWithSnapshot(db);
    const md = mockPricingEngine.getMarketData('c1');
    assert.ok(md);
    assert.strictEqual(md!.marketPrice, 40);
    assert.strictEqual(md!.low, 32);
    assert.strictEqual(md!.competitionCount, 12);
    assert.strictEqual(md!.source, 'mock-market');
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('getMarketData derives a deterministic value when no snapshot exists', () => {
  const db = freshDb();
  try {
    db.prepare("INSERT INTO cards (id, name, rarity, is_holo) VALUES ('c2','Pikachu','Common',0)").run();
    const a = mockPricingEngine.getMarketData('c2');
    const b = mockPricingEngine.getMarketData('c2');
    assert.ok(a);
    assert.deepStrictEqual(a, b, 'derivation must be stable');
    assert.strictEqual(a!.source, 'mock-derived');
    // A common should be cheap; an ultra rare holo should be much dearer.
    const common = deriveMarketValue({ id: 'x', rarity: 'Common' });
    const ultra = deriveMarketValue({ id: 'x', rarity: 'Ultra Rare', is_holo: 1 });
    assert.ok(ultra > common * 5, 'rarity should strongly increase value');
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('getMarketData returns null for unknown card', () => {
  const db = freshDb();
  try {
    assert.strictEqual(mockPricingEngine.getMarketData('nope'), null);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('suggested price ordering respects mode: fast <= balanced <= max', () => {
  const db = freshDb();
  try {
    seedCardWithSnapshot(db);
    const fast = mockPricingEngine.priceCard({ cardId: 'c1', condition: 'NM', mode: 'fast_sale' }, settings)!;
    const bal = mockPricingEngine.priceCard({ cardId: 'c1', condition: 'NM', mode: 'balanced' }, settings)!;
    const max = mockPricingEngine.priceCard({ cardId: 'c1', condition: 'NM', mode: 'max_profit' }, settings)!;
    assert.ok(fast.suggestedPrice <= bal.suggestedPrice, 'fast <= balanced');
    assert.ok(bal.suggestedPrice <= max.suggestedPrice, 'balanced <= max');
    assert.ok(fast.suggestedPrice < max.suggestedPrice, 'fast strictly below max for this card');
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('fees and net math is correct (12.9% + $0.30, shipping + packaging)', () => {
  const { estimatedFees, estimatedShipping, estimatedNet } = computeFeesAndNet(40, settings);
  // 40 * 0.129 + 0.30 = 5.16 + 0.30 = 5.46
  assert.strictEqual(estimatedFees, 5.46);
  assert.strictEqual(estimatedShipping, 1.0);
  // 40 - 5.46 - 1.00 - 0.25 = 33.29
  assert.strictEqual(estimatedNet, 33.29);
});

test('priceCard returns consistent fees/net matching the pure helper', () => {
  const db = freshDb();
  try {
    seedCardWithSnapshot(db);
    const res = mockPricingEngine.priceCard({ cardId: 'c1', condition: 'NM', mode: 'balanced' }, settings)!;
    const expected = computeFeesAndNet(res.suggestedPrice, settings);
    assert.strictEqual(res.estimatedFees, expected.estimatedFees);
    assert.strictEqual(res.estimatedShipping, expected.estimatedShipping);
    assert.strictEqual(res.estimatedNet, expected.estimatedNet);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('condition lowers the suggested price (LP < NM)', () => {
  const nm = computeSuggestedPrice(40, 33, 'NM', 'balanced');
  const lp = computeSuggestedPrice(40, 33, 'LP', 'balanced');
  assert.ok(lp < nm);
});
