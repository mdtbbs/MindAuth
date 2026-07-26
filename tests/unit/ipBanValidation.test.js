/**
 * Unit tests for the admin ip-bans route input validation
 * (_validateBanTarget) — IPv4 + IPv6 with family-dependent CIDR range.
 *
 * The route module pulls in db/redis-backed dependencies, so both are
 * replaced with inert mocks in require.cache before requiring it
 * (same pattern as newFeatures.test.js). Validation itself is pure.
 */

process.env.USE_MEMORY_REDIS = '1';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// -- Mock db + redis before requiring the route --
const redisPath = require.resolve('../../src/redis');
require.cache[redisPath] = {
  id: redisPath, filename: redisPath, loaded: true,
  exports: { client: { get: async () => null, setEx: async () => 'OK', del: async () => 1 } },
};
const dbPath = require.resolve('../../src/db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { pool: { execute: async () => [[]], query: async () => [[]] } },
};

const { _validateBanTarget } = require('../../src/routes/admin/ipBans');

test('accepts plain IPv4', () => {
  assert.equal(_validateBanTarget('192.0.2.1', undefined).valid, true);
  assert.equal(_validateBanTarget('192.0.2.1', null).valid, true);
});

test('accepts IPv4 with CIDR 0-32', () => {
  assert.equal(_validateBanTarget('192.0.2.0', 0).valid, true);
  assert.equal(_validateBanTarget('192.0.2.0', 24).valid, true);
  assert.equal(_validateBanTarget('192.0.2.0', 32).valid, true);
});

test('rejects IPv4 CIDR above 32', () => {
  const result = _validateBanTarget('192.0.2.0', 33);
  assert.equal(result.valid, false);
  assert.match(result.error, /0-32/);
});

test('accepts plain IPv6', () => {
  assert.equal(_validateBanTarget('2001:db8::1', undefined).valid, true);
  assert.equal(_validateBanTarget('::1', null).valid, true);
  assert.equal(_validateBanTarget('fe80::abcd', undefined).valid, true);
});

test('accepts IPv6 with CIDR 0-128', () => {
  assert.equal(_validateBanTarget('2001:db8::', 32).valid, true);
  assert.equal(_validateBanTarget('2001:db8::', 64).valid, true);
  assert.equal(_validateBanTarget('2001:db8::1', 128).valid, true);
  assert.equal(_validateBanTarget('2001:db8::', 0).valid, true);
});

test('rejects IPv6 CIDR above 128', () => {
  const result = _validateBanTarget('2001:db8::', 129);
  assert.equal(result.valid, false);
  assert.match(result.error, /0-128/);
});

test('rejects negative and non-integer CIDR for both families', () => {
  assert.equal(_validateBanTarget('192.0.2.0', -1).valid, false);
  assert.equal(_validateBanTarget('2001:db8::', -1).valid, false);
  assert.equal(_validateBanTarget('192.0.2.0', 'abc').valid, false);
});

test('rejects malformed addresses', () => {
  assert.equal(_validateBanTarget('not-an-ip', undefined).valid, false);
  assert.equal(_validateBanTarget('999.999.999.999', undefined).valid, false);
  assert.equal(_validateBanTarget('2001:db8::zzzz', undefined).valid, false);
  assert.equal(_validateBanTarget('', undefined).valid, false);
  assert.equal(_validateBanTarget(null, undefined).valid, false);
  assert.equal(_validateBanTarget(undefined, undefined).valid, false);
  assert.equal(_validateBanTarget(12345, undefined).valid, false);
});

test('rejects CIDR notation embedded in address (must be separate field)', () => {
  assert.equal(_validateBanTarget('2001:db8::/32', undefined).valid, false);
  assert.equal(_validateBanTarget('192.0.2.0/24', undefined).valid, false);
});
