import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/schema.js';
import { __setTestDb } from '../db/connection.js';
import { ordersRepository, canTransition, ORDER_STATUSES } from './ordersRepository.js';
import { orderItemsRepository } from './orderItemsRepository.js';
import { inventoryRepository } from './inventoryRepository.js';
import { salesRepository } from './salesRepository.js';
import { orderService } from '../services/orderService.js';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  __setTestDb(db);
  return db;
}

function seed(db: DatabaseSync): { a: string; b: string } {
  db.prepare("INSERT INTO users (id, email, password_hash, password_salt, display_name) VALUES ('ua','a@x.co','h','s','A')").run();
  db.prepare("INSERT INTO users (id, email, password_hash, password_salt, display_name) VALUES ('ub','b@x.co','h','s','B')").run();
  db.prepare("INSERT INTO sets (id, name, abbreviation) VALUES ('s1','Obsidian Flames','OBF')").run();
  db.prepare("INSERT INTO cards (id, set_id, name, image_url) VALUES ('c1','s1','Charizard ex','/x.png')").run();
  return { a: 'ua', b: 'ub' };
}

test('order statuses + transition guard follow the lifecycle', () => {
  assert.deepStrictEqual([...ORDER_STATUSES], ['New', 'Picking', 'Packed', 'Shipped', 'Delivered', 'Cancelled', 'Returned']);
  assert.strictEqual(canTransition('New', 'Picking'), true);
  assert.strictEqual(canTransition('Packed', 'Shipped'), true);
  assert.strictEqual(canTransition('Shipped', 'Delivered'), true);
  assert.strictEqual(canTransition('New', 'Cancelled'), true);
  assert.strictEqual(canTransition('Delivered', 'New'), false);
  assert.strictEqual(canTransition('Shipped', 'Picking'), false);
  assert.strictEqual(canTransition('bogus', 'New'), false);
});

test('order status transitions persist; tracking + shipped_at stored on Shipped', () => {
  const db = freshDb();
  try {
    const { a } = seed(db);
    const inv = inventoryRepository.create({ user_id: a, card_id: 'c1', acquisition_cost: 10, status: 'Listed' });
    const order = orderService.createFromInventory(a, inv.id, { salePrice: 50, buyer: 'buyer1' })!;
    assert.strictEqual(order.status, 'New');
    assert.strictEqual(order.item_count, 1);

    orderService.transition(a, order.id, 'Picking');
    assert.strictEqual(ordersRepository.getById(a, order.id)!.status, 'Picking');
    orderService.transition(a, order.id, 'Packed');
    assert.strictEqual(ordersRepository.getById(a, order.id)!.status, 'Packed');

    const shipped = orderService.transition(a, order.id, 'Shipped', { tracking_number: 'TRK123' });
    assert.ok(shipped);
    const after = ordersRepository.getById(a, order.id)!;
    assert.strictEqual(after.status, 'Shipped');
    assert.strictEqual(after.tracking_number, 'TRK123');
    assert.ok(after.shipped_at, 'shipped_at is stamped on Shipped');

    // Shipping records a sale and flips the inventory to Sold.
    assert.strictEqual(shipped!.recordedSaleIds.length, 1);
    assert.strictEqual(salesRepository.listForOrder(a, order.id).length, 1);
    assert.strictEqual(inventoryRepository.getById(a, inv.id)!.status, 'Sold');
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('a disallowed transition does not mutate the order', () => {
  const db = freshDb();
  try {
    const { a } = seed(db);
    const order = ordersRepository.create({ user_id: a, sale_price: 10, status: 'New' });
    // Cannot jump straight from New to Delivered.
    assert.strictEqual(orderService.transition(a, order.id, 'Delivered'), undefined);
    assert.strictEqual(ordersRepository.getById(a, order.id)!.status, 'New');
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('orders, items and sales are user-scoped', () => {
  const db = freshDb();
  try {
    const { a, b } = seed(db);
    const inv = inventoryRepository.create({ user_id: a, card_id: 'c1', acquisition_cost: 5, status: 'Listed' });
    const order = orderService.createFromInventory(a, inv.id, { salePrice: 40 })!;

    // User B cannot see or transition user A's order.
    assert.strictEqual(ordersRepository.getById(b, order.id), undefined);
    assert.strictEqual(orderService.transition(b, order.id, 'Picking'), undefined);
    assert.strictEqual(ordersRepository.listByUser(b).length, 0);
    assert.strictEqual(ordersRepository.listByUser(a).length, 1);

    // B cannot create an order from A's inventory item.
    assert.strictEqual(orderService.createFromInventory(b, inv.id, {}), undefined);

    // Complete the order for A, then confirm the sale is A-scoped only.
    orderService.transition(a, order.id, 'Picking');
    orderService.transition(a, order.id, 'Packed');
    orderService.transition(a, order.id, 'Shipped');
    assert.strictEqual(salesRepository.listByUser(a).length, 1);
    assert.strictEqual(salesRepository.listByUser(b).length, 0);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('order list surfaces card + storage location for fulfillment', () => {
  const db = freshDb();
  try {
    const { a } = seed(db);
    const loc = db.prepare("INSERT INTO storage_locations (id, user_id, box, shelf, slot) VALUES ('l1',?, 'BOX-A','2','14')");
    loc.run(a);
    const inv = inventoryRepository.create({ user_id: a, card_id: 'c1', status: 'Listed', storage_location_id: 'l1' });
    const order = orderService.createFromInventory(a, inv.id, { salePrice: 30 })!;

    const row = ordersRepository.getById(a, order.id)!;
    assert.strictEqual(row.first_card_name, 'Charizard ex');
    assert.strictEqual(row.storage_box, 'BOX-A');

    const items = orderItemsRepository.listForOrder(order.id);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].card_name, 'Charizard ex');
    assert.strictEqual(items[0].storage_box, 'BOX-A');
    assert.strictEqual(items[0].card_image_url, '/x.png');
  } finally {
    __setTestDb(null);
    db.close();
  }
});
