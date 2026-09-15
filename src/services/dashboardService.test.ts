import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/schema.js';
import { __setTestDb } from '../db/connection.js';
import { dashboardService } from './dashboardService.js';
import { inventoryRepository } from '../repositories/inventoryRepository.js';
import { ordersRepository } from '../repositories/ordersRepository.js';
import { salesRepository } from '../repositories/salesRepository.js';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  __setTestDb(db);
  return db;
}

function seed(db: DatabaseSync): string {
  db.prepare("INSERT INTO users (id, email, password_hash, password_salt, display_name) VALUES ('u1','a@x.co','h','s','A')").run();
  db.prepare("INSERT INTO sets (id, name, abbreviation) VALUES ('s1','Obsidian Flames','OBF')").run();
  db.prepare("INSERT INTO cards (id, set_id, name, rarity) VALUES ('c1','s1','Charizard ex','Ultra Rare')").run();
  db.prepare("INSERT INTO cards (id, set_id, name, rarity) VALUES ('c2','s1','Pikachu','Common')").run();
  return 'u1';
}

test('KPIs: unlisted value excludes Listed and Sold', () => {
  const db = freshDb();
  try {
    const user = seed(db);
    // Unlisted (Ready to List): 2 x $10 = $20
    inventoryRepository.create({ user_id: user, card_id: 'c1', quantity: 2, market_value: 10, status: 'Ready to List' });
    // Listed: 1 x $50
    inventoryRepository.create({ user_id: user, card_id: 'c1', quantity: 1, market_value: 50, status: 'Listed' });
    // Sold: 1 x $99 (must not count toward unlisted)
    inventoryRepository.create({ user_id: user, card_id: 'c2', quantity: 1, market_value: 99, status: 'Sold' });

    const kpis = dashboardService.getKpis(user);
    assert.strictEqual(kpis.unlistedInventoryValue.value, 20, 'unlisted = 2 x $10');
    assert.strictEqual(kpis.listedInventoryValue.value, 50, 'listed = $50');
    assert.strictEqual(kpis.totalInventoryValue.value, 169, 'total = 20 + 50 + 99');
    assert.match(kpis.unlistedInventoryValue.context, /waiting to be listed/);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('KPIs: revenue sums sales and pending orders excludes Delivered/Cancelled', () => {
  const db = freshDb();
  try {
    const user = seed(db);
    salesRepository.create({ user_id: user, card_id: 'c1', sale_price: 40, net_profit: 25 });
    salesRepository.create({ user_id: user, card_id: 'c2', sale_price: 10, net_profit: 5 });

    ordersRepository.create({ user_id: user, sale_price: 40, status: 'New' });
    ordersRepository.create({ user_id: user, sale_price: 10, status: 'Packed' });
    ordersRepository.create({ user_id: user, sale_price: 10, status: 'Delivered' });
    ordersRepository.create({ user_id: user, sale_price: 10, status: 'Cancelled' });

    const kpis = dashboardService.getKpis(user);
    assert.strictEqual(kpis.revenue.value, 50, 'revenue = 40 + 10');
    assert.strictEqual(kpis.cardsSold.value, 2);
    assert.strictEqual(kpis.pendingOrders.value, 2, 'New + Packed only');
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('estimatedProfit combines realized sales net with projected unsold net', () => {
  const db = freshDb();
  try {
    const user = seed(db);
    salesRepository.create({ user_id: user, card_id: 'c1', sale_price: 40, net_profit: 25 });
    inventoryRepository.create({ user_id: user, card_id: 'c1', quantity: 1, market_value: 30, status: 'Ready to List' });

    const kpis = dashboardService.getKpis(user);
    // Realized 25 plus a positive projected net on the unsold card.
    assert.ok(kpis.estimatedProfit.value >= 25, 'includes realized net');
    assert.match(kpis.estimatedProfit.context, /realized/);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('inventoryValueBreakdown splits unlisted/listed/bulk', () => {
  const db = freshDb();
  try {
    const user = seed(db);
    inventoryRepository.create({ user_id: user, card_id: 'c1', quantity: 1, market_value: 20, status: 'Ready to List', classification: 'single' });
    inventoryRepository.create({ user_id: user, card_id: 'c1', quantity: 1, market_value: 50, status: 'Listed' });
    inventoryRepository.create({ user_id: user, card_id: 'c2', quantity: 100, market_value: 0.1, status: 'Unprocessed', classification: 'bulk' });

    const breakdown = dashboardService.inventoryValueBreakdown(user);
    const byLabel = Object.fromEntries(breakdown.map((b) => [b.label, b.value]));
    assert.strictEqual(byLabel['Unlisted'], 20);
    assert.strictEqual(byLabel['Listed'], 50);
    assert.strictEqual(byLabel['Bulk'], 10, '100 x $0.10');
  } finally {
    __setTestDb(null);
    db.close();
  }
});
