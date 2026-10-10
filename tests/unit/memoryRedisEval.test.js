/**
 * Unit tests for the in-memory Redis `eval` dispatcher.
 *
 * The adapter cannot run Lua, so it emulates the exact scripts this codebase
 * sends. It used to emulate only the rate-limit script for every caller —
 * which meant the device-code script executed INCR on a JSON payload and
 * corrupted `device:{code}` into the string "NaN" under USE_MEMORY_REDIS=1.
 */
process.env.USE_MEMORY_REDIS = '1';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { client } = require('../../src/redis');

const RATE_LIMIT_SCRIPT = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
  if count > tonumber(ARGV[1]) then return redis.call('TTL', KEYS[1]) end
  return 0
`;

const DEVICE_CODE_SCRIPT = `
  local value = redis.call('GET', KEYS[1])
  if not value then return false end
  local data = cjson.decode(value)
  if data.client_id ~= ARGV[1] or data.approved ~= true then return false end
  redis.call('DEL', KEYS[1])
  return value
`;

test('rate-limit script counts and reports retry seconds', async () => {
  const key = `test_eval_rl:${Date.now()}`;
  assert.equal(await client.eval(RATE_LIMIT_SCRIPT, { keys: [key], arguments: ['2', '60'] }), 0);
  assert.equal(await client.eval(RATE_LIMIT_SCRIPT, { keys: [key], arguments: ['2', '60'] }), 0);
  const wait = await client.eval(RATE_LIMIT_SCRIPT, { keys: [key], arguments: ['2', '60'] });
  assert.ok(wait > 0, `3rd call should return wait seconds, got ${wait}`);
});

test('device-code script returns the payload once and consumes it', async () => {
  const key = `device:unittest${Date.now()}`;
  await client.setEx(key, 300, JSON.stringify({ client_id: 'c1', approved: true }));

  const raw = await client.eval(DEVICE_CODE_SCRIPT, { keys: [key], arguments: ['c1'] });
  assert.equal(typeof raw, 'string');
  assert.equal(JSON.parse(raw).client_id, 'c1');
  assert.equal(await client.get(key), null, 'key must be consumed');

  assert.equal(await client.eval(DEVICE_CODE_SCRIPT, { keys: [key], arguments: ['c1'] }), null);
});

test('device-code script rejects a wrong client or an unapproved request', async () => {
  const key = `device:unittest2${Date.now()}`;
  await client.setEx(key, 300, JSON.stringify({ client_id: 'c1', approved: false }));

  assert.equal(await client.eval(DEVICE_CODE_SCRIPT, { keys: [key], arguments: ['c1'] }), null, 'not approved');
  assert.ok(await client.get(key), 'rejected requests must not consume the code');
});

test('unknown scripts fail loudly instead of corrupting data', async () => {
  await assert.rejects(
    () => client.eval('redis.call("LPUSH", KEYS[1], "x")', { keys: ['test_eval_unknown'], arguments: [] }),
    /cannot emulate/,
  );
});
