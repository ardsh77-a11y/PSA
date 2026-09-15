import test from 'node:test';
import assert from 'node:assert';
import { Router, matchPath, type RequestContext } from './router.js';

test('matchPath matches a static route', () => {
  assert.deepStrictEqual(matchPath('/login', '/login'), {});
  assert.deepStrictEqual(matchPath('/dashboard', '/dashboard'), {});
});

test('matchPath extracts a :param', () => {
  assert.deepStrictEqual(matchPath('/inventory/:id', '/inventory/abc123'), { id: 'abc123' });
});

test('matchPath extracts multiple params', () => {
  assert.deepStrictEqual(matchPath('/orders/:orderId/items/:itemId', '/orders/o1/items/i9'), {
    orderId: 'o1',
    itemId: 'i9',
  });
});

test('matchPath returns null on segment-count mismatch', () => {
  assert.strictEqual(matchPath('/inventory/:id', '/inventory'), null);
  assert.strictEqual(matchPath('/inventory', '/inventory/extra'), null);
});

test('matchPath returns null on static mismatch', () => {
  assert.strictEqual(matchPath('/login', '/register'), null);
});

test('matchPath decodes url-encoded params', () => {
  assert.deepStrictEqual(matchPath('/cards/:name', '/cards/Mr%20Mime'), { name: 'Mr Mime' });
});

test('Router.match dispatches to the right method + handler', () => {
  const router = new Router();
  const noop = (_ctx: RequestContext) => {};
  router.get('/login', noop);
  router.post('/login', noop);
  router.get('/inventory/:id', noop);

  const getLogin = router.match('GET', '/login');
  assert.ok(getLogin);
  assert.deepStrictEqual(getLogin!.params, {});

  const postLogin = router.match('POST', '/login');
  assert.ok(postLogin);

  const param = router.match('GET', '/inventory/xyz');
  assert.ok(param);
  assert.deepStrictEqual(param!.params, { id: 'xyz' });

  assert.strictEqual(router.match('DELETE', '/login'), null);
  assert.strictEqual(router.match('GET', '/nope'), null);
});
