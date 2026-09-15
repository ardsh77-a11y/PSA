import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../db/schema.js';
import { __setTestDb } from '../../db/connection.js';
import { Router, type RequestContext, type UserRecord } from '../router.js';
import { registerInventoryRoutes } from './inventory.js';
import { registerInventoryApi } from '../../api/inventory.js';
import { registerCardsApi } from '../../api/cards.js';
import { inventoryRepository } from '../../repositories/inventoryRepository.js';

/**
 * Lightweight router integration tests. We build the router, install a fake
 * ServerResponse, and drive handlers directly with a synthesized context.
 */
interface CapturedResponse {
  status: number;
  headers: Record<string, string | string[]>;
  body: string;
}

function fakeCtx(
  method: string,
  params: Record<string, string>,
  query: Record<string, string>,
  user: UserRecord | undefined,
  body?: unknown,
): { ctx: RequestContext; captured: CapturedResponse } {
  const captured: CapturedResponse = { status: 0, headers: {}, body: '' };
  const res = {
    statusCode: 0,
    headersSent: false,
    setHeader() {},
    getHeader() {
      return undefined;
    },
    writeHead(status: number, headers?: Record<string, string | string[]>) {
      captured.status = status;
      if (headers) captured.headers = headers;
    },
    write(chunk: string) {
      captured.body += chunk;
    },
    end(chunk?: string) {
      if (chunk) captured.body += chunk;
    },
  };
  const ctx = {
    req: { method, headers: {} } as never,
    res: res as never,
    params,
    query,
    body,
    user,
  } as RequestContext;
  return { ctx, captured };
}

function buildTestRouter(): Router {
  const router = new Router();
  registerInventoryRoutes(router);
  registerInventoryApi(router);
  registerCardsApi(router);
  return router;
}

function setupDb(): { db: DatabaseSync; user: UserRecord } {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  __setTestDb(db);
  db.prepare("INSERT INTO users (id, email, password_hash, password_salt, display_name) VALUES ('u1','demo@x.co','h','s','Demo')").run();
  db.prepare("INSERT INTO sets (id, name, abbreviation, total_cards) VALUES ('s1','Obsidian Flames','OBF',197)").run();
  db.prepare("INSERT INTO cards (id, set_id, name, number, rarity) VALUES ('c1','s1','Charizard ex','125/197','Ultra Rare')").run();
  return { db, user: { id: 'u1', email: 'demo@x.co', display_name: 'Demo' } };
}

async function run(router: Router, method: string, path: string, user: UserRecord | undefined, query: Record<string, string> = {}, body?: unknown) {
  const matched = router.match(method, path);
  assert.ok(matched, `no route matched ${method} ${path}`);
  const { ctx, captured } = fakeCtx(method, matched!.params, query, user, body);
  await matched!.handler(ctx);
  return captured;
}

test('GET /inventory renders 200 with a populated table', async () => {
  const { db, user } = setupDb();
  try {
    inventoryRepository.create({ id: 'i1', user_id: 'u1', card_id: 'c1', status: 'Listed', market_value: 42, is_demo: 1 });
    const router = buildTestRouter();
    const res = await run(router, 'GET', '/inventory', user);
    assert.strictEqual(res.status, 200);
    assert.match(res.body, /Charizard ex/);
    assert.match(res.body, /Demo data/); // demo banner shows for is_demo inventory
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('GET /api/inventory returns filtered JSON scoped to the user', async () => {
  const { db, user } = setupDb();
  try {
    inventoryRepository.create({ id: 'i1', user_id: 'u1', card_id: 'c1', status: 'Listed', market_value: 42 });
    const router = buildTestRouter();
    const res = await run(router, 'GET', '/api/inventory', user, { status: 'Listed' });
    assert.strictEqual(res.status, 200);
    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.total, 1);
    assert.strictEqual(parsed.rows[0].id, 'i1');

    const none = await run(router, 'GET', '/api/inventory', user, { status: 'Sold' });
    assert.strictEqual(JSON.parse(none.body).total, 0);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('GET /api/inventory rejects unauthenticated requests', async () => {
  const { db } = setupDb();
  try {
    const router = buildTestRouter();
    const res = await run(router, 'GET', '/api/inventory', undefined);
    assert.strictEqual(res.status, 401);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('POST /api/inventory validates and creates a record', async () => {
  const { db, user } = setupDb();
  try {
    const router = buildTestRouter();

    // Missing card -> field error, nothing created.
    const bad = await run(router, 'POST', '/api/inventory', user, {}, { json: { quantity: 2 } });
    assert.strictEqual(bad.status, 422);
    assert.ok(JSON.parse(bad.body).errors.card_id);

    // Valid create.
    const ok = await run(router, 'POST', '/api/inventory', user, {}, { json: { card_id: 'c1', quantity: 2, status: 'Identified' } });
    assert.strictEqual(ok.status, 201);
    const row = JSON.parse(ok.body).row;
    assert.strictEqual(row.card_id, 'c1');
    assert.strictEqual(row.quantity, 2);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('PATCH /api/inventory/:id updates status; DELETE removes it', async () => {
  const { db, user } = setupDb();
  try {
    inventoryRepository.create({ id: 'i1', user_id: 'u1', card_id: 'c1', status: 'Identified', market_value: 42 });
    const router = buildTestRouter();

    const patched = await run(router, 'PATCH', '/api/inventory/i1', user, {}, { json: { status: 'Listed' } });
    assert.strictEqual(patched.status, 200);
    assert.strictEqual(JSON.parse(patched.body).row.status, 'Listed');

    const del = await run(router, 'DELETE', '/api/inventory/i1', user);
    assert.strictEqual(del.status, 200);
    assert.strictEqual(inventoryRepository.getById('u1', 'i1'), undefined);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('GET /inventory/:id renders the Card Detail page', async () => {
  const { db, user } = setupDb();
  try {
    inventoryRepository.create({ id: 'i1', user_id: 'u1', card_id: 'c1', status: 'Listed', market_value: 42, acquisition_cost: 10 });
    const router = buildTestRouter();
    const res = await run(router, 'GET', '/inventory/i1', user);
    assert.strictEqual(res.status, 200);
    assert.match(res.body, /Charizard ex/);
    assert.match(res.body, /Cost basis/);
    assert.match(res.body, /Est. profit/);
  } finally {
    __setTestDb(null);
    db.close();
  }
});

test('GET /api/cards searches the shared catalog', async () => {
  const { db, user } = setupDb();
  try {
    const router = buildTestRouter();
    const res = await run(router, 'GET', '/api/cards', user, { q: 'Charizard' });
    assert.strictEqual(res.status, 200);
    const rows = JSON.parse(res.body).rows;
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].id, 'c1');
  } finally {
    __setTestDb(null);
    db.close();
  }
});
