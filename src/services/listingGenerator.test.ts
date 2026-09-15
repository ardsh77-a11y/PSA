import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/schema.js';
import { __setTestDb } from '../db/connection.js';
import { inventoryRepository } from '../repositories/inventoryRepository.js';
import { listingsRepository } from '../repositories/listingsRepository.js';
import { listingGenerator } from './listingGenerator.js';
import { settingsService } from './settings.js';
import { pokemonStrategy } from '../domain/tcg.js';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  __setTestDb(db);
  return db;
}

function seed(db: DatabaseSync): void {
  db.prepare("INSERT INTO users (id, email, password_hash, password_salt, display_name) VALUES ('ua','a@x.co','h','s','A')").run();
  db.prepare("INSERT INTO sets (id, name, abbreviation, total_cards) VALUES ('s1','Obsidian Flames','OBF',197)").run();
  db.prepare("INSERT INTO cards (id, set_id, name, number, rarity) VALUES ('c1','s1','Charizard ex','125/197','Ultra Rare')").run();
  db.prepare(
    "INSERT INTO price_snapshots (id, card_id, source, market_price, low, high) VALUES ('ps1','c1','mock', 300, 250, 360)",
  ).run();
}

test('formatListingTitle matches the section-17 pattern without duplicated keywords', () => {
  const title = pokemonStrategy.formatListingTitle(
    {
      name: 'Charizard ex',
      number: '125/197',
      rarity: 'Ultra Rare',
      set_name: 'Obsidian Flames',
      is_holo: 0,
      is_reverse_holo: 0,
    },
    'NM',
  );
  assert.strictEqual(title, 'Charizard ex 125/197 Obsidian Flames Ultra Rare Pokemon TCG NM');

  // No duplicated words (case-insensitive) => no keyword stuffing.
  const words = title.toLowerCase().split(/\s+/);
  assert.strictEqual(words.length, new Set(words).size, 'title must not repeat any word');
});

test('generated draft carries title, description, specifics, price/shipping from pricing, SKU + quantity', () => {
  const db = freshDb();
  try {
    seed(db);
    inventoryRepository.create({ id: 'i1', user_id: 'ua', card_id: 'c1', condition: 'NM', quantity: 3 });

    const draft = listingGenerator.buildDraft('ua', 'i1');
    assert.ok(draft, 'draft should be built');

    // Title contains name, number, set, rarity, condition.
    assert.match(draft!.title, /Charizard ex/);
    assert.match(draft!.title, /125\/197/);
    assert.match(draft!.title, /Obsidian Flames/);
    assert.match(draft!.title, /Ultra Rare/);
    assert.match(draft!.title, /NM/);

    // Item specifics.
    assert.strictEqual(draft!.itemSpecifics.Set, 'Obsidian Flames');
    assert.strictEqual(draft!.itemSpecifics.Number, '125/197');
    assert.strictEqual(draft!.itemSpecifics.Rarity, 'Ultra Rare');
    assert.strictEqual(draft!.itemSpecifics.Language, 'English');

    // Price + shipping come from the pricing engine / settings.
    const settings = settingsService.getPricingSettings('ua');
    assert.strictEqual(draft!.shippingCost, settings.shippingCost);
    assert.ok(draft!.price > 0, 'price should be derived from the pricing engine');

    // Description mentions condition + shipping note.
    assert.match(draft!.description, /Condition/);
    assert.match(draft!.description, /Ships/);

    // SKU + quantity.
    assert.strictEqual(draft!.sku, 'PKM-OBF-125-NM-001');
    assert.strictEqual(draft!.quantity, 3);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('generated price respects pricing mode ordering (fast <= balanced <= max)', () => {
  const db = freshDb();
  try {
    seed(db);
    inventoryRepository.create({ id: 'i1', user_id: 'ua', card_id: 'c1', condition: 'NM', quantity: 1 });

    const fast = listingGenerator.buildDraft('ua', 'i1', { mode: 'fast_sale' })!;
    const balanced = listingGenerator.buildDraft('ua', 'i1', { mode: 'balanced' })!;
    const max = listingGenerator.buildDraft('ua', 'i1', { mode: 'max_profit' })!;
    assert.ok(fast.price <= balanced.price, 'fast <= balanced');
    assert.ok(balanced.price <= max.price, 'balanced <= max');
    assert.strictEqual(fast.mode, 'fast_sale');
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('generateForInventory persists a draft listing and assigns a SKU to the inventory row', () => {
  const db = freshDb();
  try {
    seed(db);
    inventoryRepository.create({ id: 'i1', user_id: 'ua', card_id: 'c1', condition: 'NM', quantity: 1 });

    const listingId = listingGenerator.generateForInventory('ua', 'i1');
    assert.ok(listingId, 'a listing id should be returned');

    const listing = listingsRepository.getById('ua', listingId!);
    assert.ok(listing);
    assert.strictEqual(listing!.status, 'draft');
    assert.strictEqual(listing!.inventory_id, 'i1');
    assert.strictEqual(listing!.sku, 'PKM-OBF-125-NM-001');

    // The inventory row now carries the same SKU (section 21).
    const inv = inventoryRepository.getById('ua', 'i1');
    assert.strictEqual(inv!.sku, 'PKM-OBF-125-NM-001');
  } finally {
    __setTestDb(null);
    db.close();
  }
});
