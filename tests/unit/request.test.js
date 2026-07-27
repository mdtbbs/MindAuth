/**
 * Unit tests for src/utils/request.js — client IP extraction.
 * Pure unit tests: fake req objects, no external services.
 *
 * Env is set BEFORE require so config picks up trusted-proxy settings
 * (node --test runs each file in its own process, so this cannot leak).
 */

process.env.TRUSTED_PROXY_ENABLED = 'true';
process.env.TRUSTED_PROXY_IPS = '10.0.0.1';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  getClientIp,
  isValidIpv4,
  isTrustedProxy,
  normalizeIpCandidate,
} = require('../../src/utils/request');

const TRUSTED_PROXY = '10.0.0.1';
const UNTRUSTED_REMOTE = '203.0.113.9';

function makeReq(remoteAddress, headers = {}) {
  return {
    headers,
    connection: { remoteAddress },
    socket: { remoteAddress },
    ip: remoteAddress,
  };
}

function withRequestModule(env, fn) {
  const prevEnabled = process.env.TRUSTED_PROXY_ENABLED;
  const prevIps = process.env.TRUSTED_PROXY_IPS;
  const prevCloudflare = process.env.TRUST_CLOUDFLARE;
  const prevAliyunAutoTrust = process.env.ALIYUN_ESA_AUTO_TRUST;

  if (env.enabled === undefined) delete process.env.TRUSTED_PROXY_ENABLED;
  else process.env.TRUSTED_PROXY_ENABLED = env.enabled;

  if (env.ips === undefined) delete process.env.TRUSTED_PROXY_IPS;
  else process.env.TRUSTED_PROXY_IPS = env.ips;

  if (env.cloudflare === undefined) delete process.env.TRUST_CLOUDFLARE;
  else process.env.TRUST_CLOUDFLARE = env.cloudflare;

  if (env.aliyunAutoTrust === undefined) delete process.env.ALIYUN_ESA_AUTO_TRUST;
  else process.env.ALIYUN_ESA_AUTO_TRUST = env.aliyunAutoTrust;

  delete require.cache[require.resolve('../../src/config')];
  delete require.cache[require.resolve('../../src/utils/aliyunEsaTrustedProxy')];
  delete require.cache[require.resolve('../../src/utils/request')];
  const mod = require('../../src/utils/request');

  try {
    fn(mod);
  } finally {
    if (prevEnabled === undefined) delete process.env.TRUSTED_PROXY_ENABLED;
    else process.env.TRUSTED_PROXY_ENABLED = prevEnabled;

    if (prevIps === undefined) delete process.env.TRUSTED_PROXY_IPS;
    else process.env.TRUSTED_PROXY_IPS = prevIps;

    if (prevCloudflare === undefined) delete process.env.TRUST_CLOUDFLARE;
    else process.env.TRUST_CLOUDFLARE = prevCloudflare;

    if (prevAliyunAutoTrust === undefined) delete process.env.ALIYUN_ESA_AUTO_TRUST;
    else process.env.ALIYUN_ESA_AUTO_TRUST = prevAliyunAutoTrust;

    delete require.cache[require.resolve('../../src/config')];
    delete require.cache[require.resolve('../../src/utils/aliyunEsaTrustedProxy')];
    delete require.cache[require.resolve('../../src/utils/request')];
  }
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

// ─── isTrustedProxy ──────────────────────────────────────────

test('isTrustedProxy true only for whitelisted remote address', () => {
  assert.equal(isTrustedProxy(makeReq(TRUSTED_PROXY)), true);
  assert.equal(isTrustedProxy(makeReq(`::ffff:${TRUSTED_PROXY}`)), true);
  assert.equal(isTrustedProxy(makeReq(UNTRUSTED_REMOTE)), false);
});

// ─── getClientIp: trusted proxy paths ────────────────────────

test('getClientIp reads IPv4 from X-Forwarded-For via trusted proxy', () => {
  const req = makeReq(TRUSTED_PROXY, { 'x-forwarded-for': '198.51.100.7' });
  assert.equal(getClientIp(req), '198.51.100.7');
});

test('getClientIp reads IPv6 from X-Forwarded-For via trusted proxy', () => {
  const req = makeReq(TRUSTED_PROXY, { 'x-forwarded-for': '2001:db8::1' });
  assert.equal(getClientIp(req), '2001:db8::1');
});

test('getClientIp takes first entry of X-Forwarded-For chain', () => {
  const req = makeReq(TRUSTED_PROXY, { 'x-forwarded-for': '2001:db8::1, 10.0.0.1' });
  assert.equal(getClientIp(req), '2001:db8::1');
});

test('getClientIp handles bracketed IPv6 with port in X-Forwarded-For', () => {
  const req = makeReq(TRUSTED_PROXY, { 'x-forwarded-for': '[2001:db8::1]:1234' });
  assert.equal(getClientIp(req), '2001:db8::1');
});

test('getClientIp handles IPv4 with port in X-Forwarded-For', () => {
  const req = makeReq(TRUSTED_PROXY, { 'x-forwarded-for': '198.51.100.7:52341' });
  assert.equal(getClientIp(req), '198.51.100.7');
});

test('getClientIp reads IPv6 from CF-Connecting-IP and X-Real-IP', () => {
  const cfReq = makeReq(TRUSTED_PROXY, { 'cf-connecting-ip': '2001:db8::cafe' });
  assert.equal(getClientIp(cfReq), '2001:db8::cafe');

  const realIpReq = makeReq(TRUSTED_PROXY, { 'x-real-ip': '2001:db8::beef' });
  assert.equal(getClientIp(realIpReq), '2001:db8::beef');
});

test('getClientIp header priority: CF-Connecting-IP > X-Real-IP > X-Forwarded-For', () => {
  const req = makeReq(TRUSTED_PROXY, {
    'cf-connecting-ip': '192.0.2.1',
    'x-real-ip': '192.0.2.2',
    'x-forwarded-for': '192.0.2.3',
  });
  assert.equal(getClientIp(req), '192.0.2.1');
});

test('getClientIp falls back to remote address when header value is garbage', () => {
  const req = makeReq(TRUSTED_PROXY, { 'x-forwarded-for': 'unknown, junk' });
  assert.equal(getClientIp(req), TRUSTED_PROXY);
});

// ─── getClientIp: untrusted paths ────────────────────────────

test('getClientIp ignores proxy headers from untrusted remote', () => {
  const req = makeReq(UNTRUSTED_REMOTE, {
    'x-forwarded-for': '1.2.3.4',
    'cf-connecting-ip': '2001:db8::1',
  });
  assert.equal(getClientIp(req), UNTRUSTED_REMOTE);
});

test('getClientIp strips IPv6-mapped prefix on fallback', () => {
  const req = makeReq(`::ffff:${UNTRUSTED_REMOTE}`);
  assert.equal(getClientIp(req), UNTRUSTED_REMOTE);
});

test('getClientIp trusts IPv6 loopback when whitelist uses 127.0.0.1', () => {
  withRequestModule({ enabled: 'true', ips: '127.0.0.1' }, ({ getClientIp: loopbackGetClientIp }) => {
    const req = makeReq('::1', { 'x-forwarded-for': '198.51.100.7' });
    assert.equal(loopbackGetClientIp(req), '198.51.100.7');
  });
});

test('getClientIp trusts IPv6-mapped loopback when whitelist uses 127.0.0.1', () => {
  withRequestModule({ enabled: 'true', ips: '127.0.0.1' }, ({ getClientIp: loopbackGetClientIp }) => {
    const req = makeReq('::ffff:127.0.0.1', { 'x-forwarded-for': '198.51.100.8' });
    assert.equal(loopbackGetClientIp(req), '198.51.100.8');
  });
});

test('getClientIp accepts IPv4 CIDR trusted proxy ranges', () => {
  withRequestModule({ enabled: 'true', ips: '172.16.0.0/12' }, ({ getClientIp: cidrGetClientIp }) => {
    const req = makeReq('172.16.8.23', { 'x-forwarded-for': '198.51.100.9' });
    assert.equal(cidrGetClientIp(req), '198.51.100.9');
  });
});

test('getClientIp ignores out-of-range CIDR trusted proxy entries', () => {
  withRequestModule({ enabled: 'true', ips: '172.16.0.0/12' }, ({ getClientIp: cidrGetClientIp }) => {
    const req = makeReq('173.16.8.23', { 'x-forwarded-for': '198.51.100.10' });
    assert.equal(cidrGetClientIp(req), '173.16.8.23');
  });
});

test('getClientIp trusts Cloudflare IPv6 proxy ranges when enabled', () => {
  withRequestModule({ enabled: 'true', ips: '', cloudflare: 'true' }, ({ getClientIp: cfGetClientIp }) => {
    const req = makeReq('2400:cb00::1234', { 'cf-connecting-ip': '203.0.113.77' });
    assert.equal(cfGetClientIp(req), '203.0.113.77');
  });
});

test('getClientIp accepts IPv6 trusted proxy addresses from TRUSTED_PROXY_IPS', () => {
  withRequestModule({ enabled: 'true', ips: '2001:db8:abcd::42' }, ({ getClientIp: ipv6GetClientIp }) => {
    const req = makeReq('2001:db8:abcd::42', { 'x-forwarded-for': '198.51.100.7' });
    assert.equal(ipv6GetClientIp(req), '198.51.100.7');
  });
});

test('getClientIp returns IPv6 remote address on fallback', () => {
  const req = makeReq('2001:db8::42');
  assert.equal(getClientIp(req), '2001:db8::42');
});

test('getClientIp trusts cached Aliyun ESA proxy entries when auto trust is enabled', () => {
  withRequestModule({ enabled: 'true', ips: '', cloudflare: 'false', aliyunAutoTrust: 'true' }, ({ getClientIp: esaGetClientIp }) => {
    const esaProxy = require('../../src/utils/aliyunEsaTrustedProxy');
    esaProxy._setCachedEntries(['203.0.113.0/24']);

    const req = makeReq('203.0.113.77', { 'x-forwarded-for': '198.51.100.11' });
    assert.equal(esaGetClientIp(req), '198.51.100.11');
  });
});

test('getClientIp ignores uncached Aliyun ESA proxies when auto trust is enabled', () => {
  withRequestModule({ enabled: 'true', ips: '', cloudflare: 'false', aliyunAutoTrust: 'true' }, ({ getClientIp: esaGetClientIp }) => {
    const esaProxy = require('../../src/utils/aliyunEsaTrustedProxy');
    esaProxy._setCachedEntries(['203.0.113.0/24']);

    const req = makeReq('198.51.100.77', { 'x-forwarded-for': '198.51.100.12' });
    assert.equal(esaGetClientIp(req), '198.51.100.77');
  });
});

test('getClientIp still falls back to explicit whitelist before Aliyun ESA cache', () => {
  withRequestModule({ enabled: 'true', ips: '127.0.0.1', cloudflare: 'false', aliyunAutoTrust: 'true' }, ({ getClientIp: mixedGetClientIp }) => {
    const esaProxy = require('../../src/utils/aliyunEsaTrustedProxy');
    esaProxy._setCachedEntries(['203.0.113.0/24']);

    const req = makeReq('127.0.0.1', { 'x-forwarded-for': '198.51.100.13' });
    assert.equal(mixedGetClientIp(req), '198.51.100.13');
  });
});

// ─── isValidIpv4 (backward compat) ───────────────────────────

test('isValidIpv4 still validates IPv4 only', () => {
  assert.equal(isValidIpv4('1.2.3.4'), true);
  assert.equal(isValidIpv4('1.2.3.4:80'), true); // port stripped by design
  assert.equal(isValidIpv4('2001:db8::1'), false);
  assert.equal(isValidIpv4('999.1.1.1'), false);
  assert.equal(isValidIpv4(''), false);
});
