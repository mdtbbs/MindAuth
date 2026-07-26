/**
 * Unit tests for utils/token — token generation and hashing.
 * hashToken is used to store password-reset / email-verification tokens as
 * hashes server-side (raw value only in the emailed link).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { generateToken, generateShortToken, hashToken } = require('../../src/utils/token');

test('generateToken returns 64 hex chars (32 bytes)', () => {
  const t = generateToken();
  assert.match(t, /^[0-9a-f]{64}$/);
});

test('generateShortToken returns 32 hex chars (16 bytes)', () => {
  assert.match(generateShortToken(), /^[0-9a-f]{32}$/);
});

test('hashToken is SHA-256 hex and deterministic', () => {
  const raw = 'some-raw-token';
  const expected = crypto.createHash('sha256').update(raw).digest('hex');
  assert.equal(hashToken(raw), expected);
  assert.equal(hashToken(raw), hashToken(raw));
  assert.match(hashToken(raw), /^[0-9a-f]{64}$/);
});

test('hashToken differs from the raw token (never stored plaintext)', () => {
  const raw = generateToken();
  assert.notEqual(hashToken(raw), raw);
});
