/**
 * Unit tests for ipBanMatcher subnet matching — IPv4 regression + IPv6 support.
 * Pure function `_isInSubnet`; requires the module but never touches DB/Redis.
 */

process.env.USE_MEMORY_REDIS = '1';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { _isInSubnet, _ipToLong } = require('../../src/modules/security/ipBanMatcher');

test('IPv4 exact match', () => {
  assert.equal(_isInSubnet('10.0.0.1', '10.0.0.1', null), true);
  assert.equal(_isInSubnet('10.0.0.2', '10.0.0.1', null), false);
});

test('IPv4 CIDR match', () => {
  assert.equal(_isInSubnet('192.168.1.5', '192.168.1.0', 24), true);
  assert.equal(_isInSubnet('192.168.2.5', '192.168.1.0', 24), false);
  assert.equal(_isInSubnet('10.1.2.3', '10.0.0.0', 8), true);
  assert.equal(_isInSubnet('11.1.2.3', '10.0.0.0', 8), false);
});

test('IPv4 /0 matches everything, /32 is exact', () => {
  assert.equal(_isInSubnet('1.2.3.4', '9.9.9.9', 0), true);
  assert.equal(_isInSubnet('1.2.3.4', '1.2.3.4', 32), true);
  assert.equal(_isInSubnet('1.2.3.5', '1.2.3.4', 32), false);
});

test('IPv6 exact match (normalized)', () => {
  assert.equal(_isInSubnet('::1', '0:0:0:0:0:0:0:1', null), true);
  assert.equal(_isInSubnet('2001:db8::1', '2001:db8::1', null), true);
  assert.equal(_isInSubnet('2001:db8::2', '2001:db8::1', null), false);
});

test('IPv6 CIDR match', () => {
  assert.equal(_isInSubnet('2001:db8::1', '2001:db8::', 32), true);
  assert.equal(_isInSubnet('2001:db9::1', '2001:db8::', 32), false);
  assert.equal(_isInSubnet('fe80::abcd', 'fe80::', 10, true), true);
});

test('IPv6 embedded IPv4 (v4-mapped)', () => {
  assert.equal(_isInSubnet('::ffff:1.2.3.4', '::ffff:1.2.3.0', 120), true);
  assert.equal(_isInSubnet('::ffff:1.2.9.4', '::ffff:1.2.3.0', 120), false);
});

test('cross-family never matches', () => {
  assert.equal(_isInSubnet('192.168.1.1', '2001:db8::', null), false);
  assert.equal(_isInSubnet('2001:db8::1', '192.168.1.0', 24), false);
});

test('malformed input never matches (fail closed)', () => {
  assert.equal(_isInSubnet('not-an-ip', '10.0.0.0', 8), false);
  assert.equal(_isInSubnet('999.999.999.999', '10.0.0.0', 8), false);
  assert.equal(_isInSubnet('10.0.0.1', '10.0.0.0', 99), false);
});

test('_ipToLong still parses IPv4 (backward compat)', () => {
  assert.equal(_ipToLong('0.0.0.0'), 0);
  assert.equal(_ipToLong('255.255.255.255'), 4294967295);
});
