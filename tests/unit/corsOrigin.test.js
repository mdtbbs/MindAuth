/**
 * Unit tests for CORS origin resolution.
 *
 * The Host-header forgery bypass this locks down: the old same-origin check
 * compared `new URL(origin).host` with `req.headers.host`, so a caller who
 * could set the Host header paired it with a matching Origin and received
 * `Access-Control-Allow-Origin` + `Access-Control-Allow-Credentials`.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isOriginAllowed, normalizeOrigin } = require('../../src/utils/corsOrigin');

test('requests without an Origin header are allowed (not CORS at all)', () => {
  assert.equal(isOriginAllowed(undefined, { allowedOrigins: [] }), true);
  assert.equal(isOriginAllowed('', { allowedOrigins: [] }), true);
});

test('origin matching a configured allowlist entry is allowed', () => {
  assert.equal(
    isOriginAllowed('https://app.example.com', { allowedOrigins: ['https://app.example.com'] }),
    true,
  );
  assert.equal(
    isOriginAllowed('https://app.example.com', { allowedOrigins: ['https://app.example.com', 'https://other.example'] }),
    true,
  );
});

test('the service own origin (BASE_URL) is always allowed', () => {
  assert.equal(
    isOriginAllowed('http://localhost:4001', { allowedOrigins: [], selfOrigin: 'http://localhost:4001' }),
    true,
  );
});

test('unknown origin is rejected even when a forged Host matches it', () => {
  // `Host: evil.example` + `Origin: https://evil.example` — the shape that
  // used to pass the same-origin check.
  assert.equal(
    isOriginAllowed('https://evil.example', { allowedOrigins: ['https://app.example.com'], selfOrigin: 'https://auth.example.com' }),
    false,
  );
});

test('scheme and port are part of the comparison', () => {
  const options = { allowedOrigins: ['https://app.example.com'], selfOrigin: 'https://auth.example.com' };
  assert.equal(isOriginAllowed('http://app.example.com', options), false, 'scheme downgrade must not match');
  assert.equal(isOriginAllowed('https://app.example.com:8443', options), false, 'port must match');
});

test('malformed or non-http(s) origins are rejected', () => {
  assert.equal(isOriginAllowed('not a url', { allowedOrigins: ['https://app.example.com'] }), false);
  assert.equal(isOriginAllowed('null', { allowedOrigins: ['https://app.example.com'] }), false);
  assert.equal(isOriginAllowed('file:///etc/passwd', { allowedOrigins: ['file:///etc/passwd'] }), false);
});

test('normalizeOrigin canonicalizes and rejects junk', () => {
  assert.equal(normalizeOrigin('https://App.Example.com'), 'https://app.example.com');
  assert.equal(normalizeOrigin('https://app.example.com/oauth/callback'), 'https://app.example.com');
  assert.equal(normalizeOrigin('ftp://app.example.com'), null);
  assert.equal(normalizeOrigin(42), null);
});
