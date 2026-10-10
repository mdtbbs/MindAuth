/**
 * Unit tests for rate-limit key families and client-type gating.
 *
 * Two regressions are locked down here:
 *   1. `resetRateLimit` used to delete only `${prefix}:${ip}` while the
 *      client-aware login limiter counts `${prefix}:default:${ip}`, so a
 *      successful login never actually cleared the counter.
 *   2. `X-Client-Type: mod` alone used to widen the login budget 5 → 20 for
 *      anyone who added a header.
 */
process.env.USE_MEMORY_REDIS = '1';
process.env.CLIENT_AWARE_RATE_LIMIT_KEY = 'unit-test-mod-key';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createClientAwareRateLimiter, createRateLimiter, resetRateLimit, detectClientType } = require('../../src/middleware/rateLimit');

const IP = '203.0.113.7';

function makeReq(headers = {}) {
  return { headers: { 'x-real-ip': IP, ...headers }, connection: { remoteAddress: IP } };
}

async function hit(limiter, headers = {}) {
  let status = 200;
  const res = {
    set() { return this; },
    status(code) { status = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await limiter(makeReq(headers), res, () => {});
  return status;
}

test('X-Client-Type header alone does not widen the budget', async () => {
  const limiter = createClientAwareRateLimiter({
    keyPrefix: 'ratelimit:unit_spoof',
    windowMs: 60_000,
    clients: { default: { maxAttempts: 2 }, mod: { maxAttempts: 5 } },
  });

  assert.equal(await hit(limiter, { 'x-client-type': 'mod' }), 200);
  assert.equal(await hit(limiter, { 'x-client-type': 'mod' }), 200);
  assert.equal(await hit(limiter, { 'x-client-type': 'mod' }), 429, '3rd request exhausts the default budget');
});

test('a client holding the shared key gets the mod budget', async () => {
  const limiter = createClientAwareRateLimiter({
    keyPrefix: 'ratelimit:unit_proven',
    windowMs: 60_000,
    clients: { default: { maxAttempts: 2 }, mod: { maxAttempts: 5 } },
  });

  const headers = { 'x-client-type': 'mod', 'x-client-key': 'unit-test-mod-key' };
  for (let i = 0; i < 5; i++) {
    assert.equal(await hit(limiter, headers), 200, `attempt ${i + 1} should pass`);
  }
  assert.equal(await hit(limiter, headers), 429, '6th request exhausts the mod budget');
});

test('detectClientType requires both the header and the shared key', () => {
  assert.equal(detectClientType(makeReq({})), 'default');
  assert.equal(detectClientType(makeReq({ 'x-client-type': 'mod' })), 'default');
  assert.equal(detectClientType(makeReq({ 'x-client-type': 'mod', 'x-client-key': 'wrong' })), 'default');
  assert.equal(
    detectClientType(makeReq({ 'x-client-type': 'mod', 'x-client-key': 'unit-test-mod-key' })),
    'mod',
  );
});

test('resetRateLimit clears the client-aware counter family', async () => {
  const limiter = createClientAwareRateLimiter({
    keyPrefix: 'ratelimit:unit_reset',
    windowMs: 60_000,
    clients: { default: { maxAttempts: 2 } },
  });

  await hit(limiter);
  await hit(limiter);
  assert.equal(await hit(limiter), 429);

  await resetRateLimit(IP, 'ratelimit:unit_reset');
  assert.equal(await hit(limiter), 200, 'counter must be cleared by resetRateLimit');
});

test('resetRateLimit also clears plain createRateLimiter counters', async () => {
  const limiter = createRateLimiter({ maxAttempts: 1, windowMs: 60_000, keyPrefix: 'ratelimit:unit_plain' });

  assert.equal(await hit(limiter), 200);
  assert.equal(await hit(limiter), 429);
  await resetRateLimit(IP, 'ratelimit:unit_plain');
  assert.equal(await hit(limiter), 200);
});
