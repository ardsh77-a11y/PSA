import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/schema.js';
import { __setTestDb } from '../db/connection.js';
import { computeOrderProfit, estimateFees, recordSale } from './profitService.js';
import { DEFAULT_PRICING_SETTINGS, type PricingSettings } from './settings.js';
import { ordersRepository } from '../repositories/ordersRepository.js';
import { orderItemsRepository } from '../repositories/orderItemsRepository.js';
import { inventoryRepository } from '../repositories/inventoryRepository.js';
import { salesRepository } from '../repositories/salesRepository.js';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  __setTestDb(db);
  return db;
}

function seed(db: DatabaseSync): { user: string } {
  db.prepare("INSERT INTO users (id, email, password_hash, password_salt, display_name) VALUES ('u1','a@x.co','h','s','A')").run();
  db.prepare("INSERT INTO sets (id, name, abbreviation) VALUES ('s1','Obsidian Flames','OBF')").run();
  db.prepare("INSERT INTO cards (id, set_id, name) VALUES ('c1','s1','Charizard ex')").run();
  return { user: 'u1' };
}

const settings: PricingSettings = { ...DEFAULT_PRICING_SETTINGS, feePct: 0.1, fixedFee: 0.3, shippingCost: 1, packagingCost: 0.25 };

test('estimateFees applies fee % + fixed fee', () => {
  assert.strictEqual(estimateFees(100, settings), 10.3); // 100*0.1 + 0.30
});

test('computeOrderProfit = revenue - fees - shipping - packaging - cost basis - expenses', () => {
  const db = freshDb();
  try {
    const { user } = seed(db);
    const inv = inventoryRepository.create({ user_id: user, card_id: 'c1', acquisition_cost: 12, quantity: 1 });
    const order = ordersRepository.create({ user_id: user, sale_price: 100, status: 'New' });
    orderItemsRepository.create({ order_id: order.id, inventory_id: inv.id, card_id: 'c1', quantity: 1, unit_price: 100 });
    const items = orderItemsRepository.rawForOrder(order.id);

    const b = computeOrderProfit(order, items, settings);
    assert.strictEqual(b.salePrice, 100);
    assert.strictEqual(b.fees, 10.3);
    assert.strictEqual(b.shipping, 1);
    assert.strictEqual(b.packaging, 0.25);
    assert.strictEqual(b.costBasis, 12);
    // net = 100 - 10.30 - 1 - 0.25 - 12 = 76.45
    assert.strictEqual(b.net, 76.45);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('computeOrderProfit honors configurable cost assumptions + overrides', () => {
  const db = freshDb();
  try {
    const { user } = seed(db);
    const order = ordersRepository.create({ user_id: user, sale_price: 50, status: 'New' });
    const custom: PricingSettings = { ...settings, feePct: 0.129, fixedFee: 0.5, shippingCost: 3, packagingCost: 1 };
    const b = computeOrderProfit(order, [], custom, { otherExpenses: 5 });
    // fees = 50*0.129 + 0.5 = 6.95; net = 50 - 6.95 - 3 - 1 - 0 - 5 = 34.05
    assert.strictEqual(b.fees, 6.95);
    assert.strictEqual(b.otherExpenses, 5);
    assert.strictEqual(b.net, 34.05);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('recordSale creates a sale row and flips inventory to Sold', () => {
  const db = freshDb();
  try {
    const { user } = seed(db);
    const inv = inventoryRepository.create({ user_id: user, card_id: 'c1', acquisition_cost: 20, quantity: 1, status: 'Listed' });
    const order = ordersRepository.create({ user_id: user, sale_price: 80, fees: 8, shipping: 2, status: 'Packed' });
    orderItemsRepository.create({ order_id: order.id, inventory_id: inv.id, card_id: 'c1', quantity: 1, unit_price: 80 });

    // Move to Shipped, then record the sale.
    ordersRepository.update(user, order.id, { status: 'Shipped' });
    const result = recordSale(user, order.id);
    assert.ok(result);
    assert.strictEqual(result!.saleIds.length, 1);

    const sales = salesRepository.listForOrder(user, order.id);
    assert.strictEqual(sales.length, 1);
    assert.strictEqual(sales[0].cost_basis, 20);
    assert.strictEqual(sales[0].sale_price, 80);

    const row = inventoryRepository.getById(user, inv.id)!;
    assert.strictEqual(row.status, 'Sold');
    assert.ok(row.date_sold, 'date_sold is stamped');

    // Idempotent: calling again does not double-record.
    const again = recordSale(user, order.id);
    assert.strictEqual(again!.saleIds.length, 1);
    assert.strictEqual(salesRepository.listForOrder(user, order.id).length, 1);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('recordSale is a no-op for a non-realized status', () => {
  const db = freshDb();
  try {
    const { user } = seed(db);
    const order = ordersRepository.create({ user_id: user, sale_price: 10, status: 'New' });
    assert.strictEqual(recordSale(user, order.id), undefined);
    assert.strictEqual(salesRepository.listForOrder(user, order.id).length, 0);
  } finally {
    __setTestDb(null);
    db.close();
  }
});
