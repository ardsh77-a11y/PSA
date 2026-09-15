import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/schema.js';
import { __setTestDb } from '../db/connection.js';
import { inventoryRepository } from '../repositories/inventoryRepository.js';
import { listingsRepository } from '../repositories/listingsRepository.js';
import { listingGenerator } from './listingGenerator.js';
import { createListingService } from './listingService.js';
import { mockMarketplacePublisher, createMockPublisher } from './mock/mockMarketplacePublisher.js';
import type { MarketplacePublisher, PublishableListing, PublishResult, UnpublishResult } from './interfaces/marketplace.js';

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
  db.prepare("INSERT INTO cards (id, set_id, name, number, rarity) VALUES ('c2','s1','Pikachu','58/197','Common')").run();
  db.prepare("INSERT INTO price_snapshots (id, card_id, source, market_price, low, high) VALUES ('ps1','c1','mock', 300, 250, 360)").run();
}

test('generate then publish via mock sets listing listed + external id and flips inventory to Listed', async () => {
  const db = freshDb();
  try {
    seed(db);
    inventoryRepository.create({ id: 'i1', user_id: 'ua', card_id: 'c1', condition: 'NM', quantity: 1, status: 'Ready to List' });

    const listingId = listingGenerator.generateForInventory('ua', 'i1', { marketplace: 'eBay' })!;
    const service = createListingService(mockMarketplacePublisher);
    const outcome = await service.publish('ua', listingId);
    assert.ok(outcome, 'publish should succeed');
    assert.ok(outcome!.externalId, 'external id assigned');

    const listing = listingsRepository.getById('ua', listingId);
    assert.strictEqual(listing!.status, 'listed');
    assert.ok(listing!.published_at, 'published_at recorded');

    const inv = inventoryRepository.getById('ua', 'i1');
    assert.strictEqual(inv!.status, 'Listed', 'linked inventory flips to Listed');
    assert.ok(inv!.date_listed, 'date_listed recorded');
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('return-to-inventory restores inventory status and reverts the listing to draft', async () => {
  const db = freshDb();
  try {
    seed(db);
    inventoryRepository.create({ id: 'i1', user_id: 'ua', card_id: 'c1', condition: 'NM', quantity: 1 });
    const listingId = listingGenerator.generateForInventory('ua', 'i1')!;
    const service = createListingService(mockMarketplacePublisher);

    await service.publish('ua', listingId);
    assert.strictEqual(inventoryRepository.getById('ua', 'i1')!.status, 'Listed');

    const reverted = await service.returnToInventory('ua', listingId);
    assert.strictEqual(reverted!.status, 'draft');
    const inv = inventoryRepository.getById('ua', 'i1');
    assert.strictEqual(inv!.status, 'Ready to List', 'inventory restored to a sellable status');
    assert.strictEqual(inv!.date_listed, null, 'date_listed cleared');
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('batch-generate style loop creates N drafts', () => {
  const db = freshDb();
  try {
    seed(db);
    inventoryRepository.create({ id: 'i1', user_id: 'ua', card_id: 'c1', condition: 'NM', quantity: 1 });
    inventoryRepository.create({ id: 'i2', user_id: 'ua', card_id: 'c2', condition: 'NM', quantity: 1 });

    const ids = ['i1', 'i2'].map((id) => listingGenerator.generateForInventory('ua', id)).filter(Boolean);
    assert.strictEqual(ids.length, 2, 'two drafts created');

    const drafts = listingsRepository.listByUser('ua', { status: 'draft' });
    assert.strictEqual(drafts.length, 2);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('publishing is fully behind the MarketplacePublisher interface (swap-safe)', async () => {
  const db = freshDb();
  try {
    seed(db);
    inventoryRepository.create({ id: 'i1', user_id: 'ua', card_id: 'c1', condition: 'NM', quantity: 1 });
    const listingId = listingGenerator.generateForInventory('ua', 'i1')!;

    // A completely custom publisher implementing ONLY the interface.
    let publishCalls = 0;
    const custom: MarketplacePublisher = {
      name: 'custom-test',
      async publish(listing: PublishableListing): Promise<PublishResult> {
        publishCalls++;
        return { externalId: 'CUSTOM-' + listing.id, publishedAt: new Date().toISOString(), marketplace: 'CustomMarket' };
      },
      async unpublish(_listing: PublishableListing, externalId: string): Promise<UnpublishResult> {
        return { externalId, unpublishedAt: new Date().toISOString() };
      },
    };

    const service = createListingService(custom);
    const outcome = await service.publish('ua', listingId);
    assert.strictEqual(publishCalls, 1, 'the injected publisher was used');
    assert.strictEqual(outcome!.externalId, 'CUSTOM-' + listingId);

    const listing = listingsRepository.getById('ua', listingId);
    assert.strictEqual(listing!.status, 'listed');
    assert.strictEqual(listing!.marketplace, 'CustomMarket', 'marketplace comes from the publisher result');
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('mock publisher is offline + deterministic for the same listing', async () => {
  const p = createMockPublisher('eBay');
  const listing: PublishableListing = { id: 'abc', title: 't', price: 1, quantity: 1, marketplace: 'eBay' };
  const a = await p.publish(listing);
  const b = await p.publish(listing);
  assert.strictEqual(a.externalId, b.externalId, 'stable external id for the same listing');
  assert.match(a.externalId, /^EBA-/);
});
