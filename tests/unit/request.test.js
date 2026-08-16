/**
 * Unit tests for src/utils/request.js — client IP extraction.
 * Pure unit tests: fake req objects, no external services.
 *
 * getClientIp() unconditionally reads CDN / reverse-proxy headers in
 * priority order (ali-real-client-ip → x-real-ip → cf-connecting-ip →
 * x-forwarded-for[0] → socket peer), so no env-var setup is needed.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  getClientIp,
  isValidIpv4,
  normalizeIpCandidate,
} = require('../../src/utils/request');

function makeReq(remoteAddress, headers = {}) {
  return {
    headers,
    connection: { remoteAddress },
    socket: { remoteAddress },
    ip: remoteAddress,
  };
}

// ─── normalizeIpCandidate ────────────────────────────────────

test('normalizeIpCandidate accepts plain IPv4', () => {
  assert.equal(normalizeIpCandidate('1.2.3.4'), '1.2.3.4');
  assert.equal(normalizeIpCandidate('  1.2.3.4  '), '1.2.3.4');
});

test('normalizeIpCandidate strips IPv4 port', () => {
  assert.equal(normalizeIpCandidate('1.2.3.4:5678'), '1.2.3.4');
});

test('normalizeIpCandidate accepts plain IPv6', () => {
  assert.equal(normalizeIpCandidate('2001:db8::1'), '2001:db8::1');
  assert.equal(normalizeIpCandidate('::1'), '::1');
  assert.equal(normalizeIpCandidate('fe80::abcd:1234'), 'fe80::abcd:1234');
});

test('normalizeIpCandidate strips IPv6 brackets and port', () => {
  assert.equal(normalizeIpCandidate('[2001:db8::1]'), '2001:db8::1');
  assert.equal(normalizeIpCandidate('[2001:db8::1]:1234'), '2001:db8::1');
});

test('normalizeIpCandidate normalizes IPv6-mapped IPv4', () => {
  assert.equal(normalizeIpCandidate('::ffff:1.2.3.4'), '1.2.3.4');
});

test('normalizeIpCandidate rejects invalid values', () => {
  assert.equal(normalizeIpCandidate('not-an-ip'), null);
  assert.equal(normalizeIpCandidate('999.999.999.999'), null);
  assert.equal(normalizeIpCandidate('1.2.3.4; DROP TABLE'), null);
  assert.equal(normalizeIpCandidate('[not-an-ip]:80'), null);
  assert.equal(normalizeIpCandidate(''), null);
  assert.equal(normalizeIpCandidate(null), null);
  assert.equal(normalizeIpCandidate(undefined), null);
  assert.equal(normalizeIpCandidate(1234), null);
});

// ─── getClientIp: header priority ────────────────────────────

test('getClientIp returns ali-real-client-ip when present', () => {
  const req = makeReq('127.0.0.1', { 'ali-real-client-ip': '198.51.100.7' });
  assert.equal(getClientIp(req), '198.51.100.7');
});

test('getClientIp prefers ali-real-client-ip over x-real-ip', () => {
  const req = makeReq('127.0.0.1', {
    'ali-real-client-ip': '198.51.100.7',
    'x-real-ip': '203.0.113.5',
  });
  assert.equal(getClientIp(req), '198.51.100.7');
});

test('getClientIp prefers x-real-ip over cf-connecting-ip', () => {
  const req = makeReq('127.0.0.1', {
    'x-real-ip': '203.0.113.5',
    'cf-connecting-ip': '198.51.100.9',
  });
  assert.equal(getClientIp(req), '203.0.113.5');
});

test('getClientIp prefers cf-connecting-ip over x-forwarded-for', () => {
  const req = makeReq('127.0.0.1', {
    'cf-connecting-ip': '198.51.100.9',
    'x-forwarded-for': '203.0.113.10',
  });
  assert.equal(getClientIp(req), '198.51.100.9');
});

test('getClientIp falls back to x-forwarded-for when others are missing', () => {
  const req = makeReq('127.0.0.1', { 'x-forwarded-for': '198.51.100.7' });
  assert.equal(getClientIp(req), '198.51.100.7');
});

test('getClientIp takes first entry of x-forwarded-for chain', () => {
  const req = makeReq('127.0.0.1', { 'x-forwarded-for': '2001:db8::1, 10.0.0.1' });
  assert.equal(getClientIp(req), '2001:db8::1');
});

test('getClientIp falls back to socket peer when all headers are missing', () => {
  const req = makeReq('203.0.113.50');
  assert.equal(getClientIp(req), '203.0.113.50');
});

test('getClientIp falls back to socket peer when all header values are invalid', () => {
  const req = makeReq('203.0.113.50', {
    'ali-real-client-ip': 'unknown',
    'x-real-ip': '',
    'cf-connecting-ip': 'not-an-ip',
    'x-forwarded-for': 'junk, more-junk',
  });
  assert.equal(getClientIp(req), '203.0.113.50');
});

test('getClientIp skips invalid header and uses next in chain', () => {
  const req = makeReq('127.0.0.1', {
    'ali-real-client-ip': 'garbage',
    'x-real-ip': 'also-bad',
    'cf-connecting-ip': '198.51.100.11',
  });
  assert.equal(getClientIp(req), '198.51.100.11');
});

// ─── getClientIp: normalization per header ───────────────────

test('getClientIp reads IPv6 from ali-real-client-ip', () => {
  const req = makeReq('127.0.0.1', { 'ali-real-client-ip': '2001:db8::1' });
  assert.equal(getClientIp(req), '2001:db8::1');
});

test('getClientIp handles bracketed IPv6 with port in ali-real-client-ip', () => {
  const req = makeReq('127.0.0.1', { 'ali-real-client-ip': '[2001:db8::1]:1234' });
  assert.equal(getClientIp(req), '2001:db8::1');
});

test('getClientIp handles IPv4 with port in ali-real-client-ip', () => {
  const req = makeReq('127.0.0.1', { 'ali-real-client-ip': '198.51.100.7:52341' });
  assert.equal(getClientIp(req), '198.51.100.7');
});

test('getClientIp normalizes IPv6-mapped IPv4 in x-real-ip', () => {
  const req = makeReq('127.0.0.1', { 'x-real-ip': '::ffff:198.51.100.7' });
  assert.equal(getClientIp(req), '198.51.100.7');
});

test('getClientIp strips IPv6-mapped prefix on socket fallback', () => {
  const req = makeReq('::ffff:203.0.113.9');
  assert.equal(getClientIp(req), '203.0.113.9');
});

test('getClientIp returns IPv6 socket peer as-is', () => {
  const req = makeReq('2001:db8::42');
  assert.equal(getClientIp(req), '2001:db8::42');
});

test('getClientIp returns "unknown" when nothing is available', () => {
  const req = { headers: {}, connection: {}, socket: {} };
  assert.equal(getClientIp(req), 'unknown');
});

// ─── isValidIpv4 (backward compat) ───────────────────────────

test('isValidIpv4 still validates IPv4 only', () => {
  assert.equal(isValidIpv4('1.2.3.4'), true);
  assert.equal(isValidIpv4('1.2.3.4:80'), true); // port stripped by design
  assert.equal(isValidIpv4('2001:db8::1'), false);
  assert.equal(isValidIpv4('999.1.1.1'), false);
  assert.equal(isValidIpv4(''), false);
});
