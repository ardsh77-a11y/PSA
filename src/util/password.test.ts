import test from 'node:test';
import assert from 'node:assert';
import { hashPassword, verifyPassword } from './password.js';

test('hashPassword produces a hash and salt', () => {
  const { hash, salt } = hashPassword('correct horse battery');
  assert.ok(hash.length > 0);
  assert.ok(salt.length > 0);
  assert.notStrictEqual(hash, salt);
});

test('verifyPassword round-trips a correct password', () => {
  const password = 's3cur3-p@ssword';
  const { hash, salt } = hashPassword(password);
  assert.strictEqual(verifyPassword(password, hash, salt), true);
});

test('verifyPassword rejects a wrong password', () => {
  const { hash, salt } = hashPassword('the-right-one');
  assert.strictEqual(verifyPassword('the-wrong-one', hash, salt), false);
});

test('different salts produce different hashes for the same password', () => {
  const a = hashPassword('same-password');
  const b = hashPassword('same-password');
  assert.notStrictEqual(a.salt, b.salt);
  assert.notStrictEqual(a.hash, b.hash);
});
