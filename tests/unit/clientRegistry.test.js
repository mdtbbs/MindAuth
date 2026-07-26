/**
 * Unit tests for clientRegistry.validateRedirectUri — the SSRF guard that
 * blocks OAuth redirect URIs pointing at localhost, private ranges, or cloud
 * metadata endpoints. Pure function; no DB/Redis required.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validateRedirectUri } = require('../../src/modules/admin/clientRegistry');

test('accepts a normal public https URL', () => {
  assert.equal(validateRedirectUri('https://forum.example.com/callback').valid, true);
});

test('accepts a public http URL', () => {
  assert.equal(validateRedirectUri('http://app.example.org/oauth/cb').valid, true);
});

test('rejects empty / missing URI', () => {
  assert.equal(validateRedirectUri('').valid, false);
  assert.equal(validateRedirectUri(undefined).valid, false);
});

test('rejects malformed URLs', () => {
  assert.equal(validateRedirectUri('not-a-url').valid, false);
});

test('rejects non-http(s) protocols', () => {
  assert.equal(validateRedirectUri('ftp://example.com/x').valid, false);
  assert.equal(validateRedirectUri('javascript:alert(1)').valid, false);
});

test('blocks localhost and loopback (SSRF)', () => {
  for (const uri of [
    'http://localhost/cb',
    'http://127.0.0.1/cb',
    'http://[::1]/cb',
    'http://0.0.0.0/cb',
    'https://api.localhost/cb',
  ]) {
    assert.equal(validateRedirectUri(uri).valid, false, `${uri} must be blocked`);
  }
});

test('blocks RFC1918 private ranges (SSRF)', () => {
  for (const uri of [
    'http://10.0.0.5/cb',
    'http://172.16.4.9/cb',
    'http://172.31.255.1/cb',
    'http://192.168.1.100/cb',
  ]) {
    assert.equal(validateRedirectUri(uri).valid, false, `${uri} must be blocked`);
  }
});

test('allows public IPs adjacent to private ranges', () => {
  // 172.32.x is outside the 172.16-31 private block
  assert.equal(validateRedirectUri('http://172.32.0.1/cb').valid, true);
  assert.equal(validateRedirectUri('http://11.0.0.1/cb').valid, true);
});

test('blocks link-local and cloud metadata endpoints (SSRF)', () => {
  for (const uri of [
    'http://169.254.169.254/latest/meta-data',
    'http://metadata.google.internal/computeMetadata/v1',
    'http://169.254.1.1/cb',
  ]) {
    assert.equal(validateRedirectUri(uri).valid, false, `${uri} must be blocked`);
  }
});
