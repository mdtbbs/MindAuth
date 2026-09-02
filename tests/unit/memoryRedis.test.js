const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.USE_MEMORY_REDIS = '1';

const { client } = require('../../src/redis');

test('memory Redis SET EX NX writes once and preserves the first value', async () => {
  const key = `memory-set-nx:${Date.now()}`;

  assert.equal(await client.set(key, 'first', 'EX', 60, 'NX'), 'OK');
  assert.equal(await client.set(key, 'second', 'EX', 60, 'NX'), null);
  assert.equal(await client.get(key), 'first');
  assert.ok(await client.ttl(key) > 0);
});

test('memory Redis SET NX permits a key after expiry', async () => {
  const key = `memory-set-expiry:${Date.now()}`;

  assert.equal(await client.set(key, 'first', 'NX'), 'OK');
  assert.equal(await client.pExpire(key, 1), 1);
  await new Promise(resolve => setTimeout(resolve, 5));

  assert.equal(await client.set(key, 'second', 'EX', 60, 'NX'), 'OK');
  assert.equal(await client.get(key), 'second');
});
