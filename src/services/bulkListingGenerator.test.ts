import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/schema.js';
import { __setTestDb } from '../db/connection.js';
import { bulkListingGenerator, buildBulkTitle, guaranteeLines } from './bulkListingGenerator.js';
import { bulkLotsRepository } from '../repositories/bulkLotsRepository.js';
import { listingsRepository } from '../repositories/listingsRepository.js';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  __setTestDb(db);
  return db;
}

function seedUser(db: DatabaseSync, id = 'u1'): string {
  db.prepare(
    "INSERT INTO users (id, email, password_hash, password_salt, display_name) VALUES (?, ?, 'h', 's', 'U')",
  ).run(id, `${id}@x.co`);
  return id;
}

test('buildBulkTitle follows the section-13 pattern', () => {
  const title = buildBulkTitle({ category: 'commons', card_count: 500, guarantees_json: '{"englishOnly":true}' });
  assert.strictEqual(title, 'Pokemon TCG 500 Card Bulk Lot - English Commons Uncommons Rares Holos');
});

test('guaranteeLines renders only active guarantees', () => {
  const lines = guaranteeLines({
    minRares: 5,
    minHolos: 2,
    noEnergy: true,
    englishOnly: true,
    noDamaged: false,
    noDuplicates: false,
    mixedSets: true,
  });
  assert.ok(lines.includes('Minimum 5 rares guaranteed'));
  assert.ok(lines.includes('Minimum 2 holos guaranteed'));
  assert.ok(lines.includes('No energy cards'));
  assert.ok(lines.includes('English only'));
  assert.ok(lines.includes('Cards from a mix of sets'));
  assert.ok(!lines.some((l) => l.includes('damaged')));
  assert.ok(!lines.some((l) => l.includes('duplicates')));
});

test('generateForLot produces a listing with title, guarantees, quantity==card_count, SKU', () => {
  const db = freshDb();
  try {
    const u = seedUser(db);
    const guarantees = {
      minRares: 3,
      minHolos: 0,
      noEnergy: true,
      englishOnly: true,
      noDamaged: false,
      noDuplicates: false,
      mixedSets: false,
    };
    const lot = bulkLotsRepository.create({
      user_id: u,
      category: 'commons',
      card_count: 500,
      guarantees_json: JSON.stringify(guarantees),
      status: 'draft',
    });

    const listingId = bulkListingGenerator.generateForLot(u, lot.id);
    assert.ok(listingId, 'listing generated');

    const listing = listingsRepository.getById(u, listingId!)!;
    // Title matches section-13.
    assert.strictEqual(listing.title, 'Pokemon TCG 500 Card Bulk Lot - English Commons Uncommons Rares Holos');
    // Quantity equals the lot card count.
    assert.strictEqual(listing.quantity, 500);
    // A SKU is assigned to the listing (bulk variant).
    assert.ok(listing.sku && listing.sku.includes('BULK'), `SKU assigned: ${listing.sku}`);
    // The listing is linked to the bulk lot.
    assert.strictEqual(listing.bulk_lot_id, lot.id);
    // Configured guarantees appear as description lines.
    assert.ok(listing.description!.includes('Minimum 3 rares guaranteed'));
    assert.ok(listing.description!.includes('No energy cards'));
    assert.ok(listing.description!.includes('English only'));

    // The lot is now marked listed with the SKU + title persisted.
    const updatedLot = bulkLotsRepository.getById(u, lot.id)!;
    assert.strictEqual(updatedLot.status, 'listed');
    assert.strictEqual(updatedLot.sku, listing.sku);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('generateForLot uses the per-card bulk rate for the suggested price', () => {
  const db = freshDb();
  try {
    const u = seedUser(db);
    const lot = bulkLotsRepository.create({ user_id: u, category: 'commons', card_count: 100, status: 'draft' });
    const listingId = bulkListingGenerator.generateForLot(u, lot.id)!;
    const listing = listingsRepository.getById(u, listingId)!;
    // Default per-card rate is 0.03 -> 100 * 0.03 = 3.00.
    assert.ok(Math.abs(listing.price - 3.0) < 0.001, `price ${listing.price} == 100 * 0.03`);
  } finally {
    __setTestDb(null);
    db.close();
  }
});
