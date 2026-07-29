/**
 * Unit tests for registration email-code helpers.
 *
 * Pure functions — no external dependencies, no Redis/MySQL.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { _internal } = require('../../src/routes/registerEmailCode');
const { hashToken } = require('../../src/utils/token');

describe('registerEmailCode helpers', () => {
  describe('emailKey', () => {
    it('is deterministic for the same email (case-insensitive, trimmed)', () => {
      const a = _internal.emailKey('  Alice.Example@TEST.com ');
      const b = _internal.emailKey('alice.example@test.com');
      const c = _internal.emailKey('ALICE.EXAMPLE@test.com  ');
      assert.strictEqual(a, b);
      assert.strictEqual(b, c);
    });

    it('differs for different emails', () => {
      const a = _internal.emailKey('alice@example.com');
      const b = _internal.emailKey('bob@example.com');
      assert.notStrictEqual(a, b);
    });

    it('returns a hex string of length 64 (SHA-256)', () => {
      const key = _internal.emailKey('test@example.com');
      assert.match(key, /^[a-f0-9]{64}$/);
    });
  });

  describe('generateCode', () => {
    it('returns a 6-digit numeric string', () => {
      for (let i = 0; i < 50; i++) {
        const code = _internal.generateCode();
        assert.match(code, /^\d{6}$/);
        const num = parseInt(code, 10);
        assert.ok(num >= 100000 && num <= 999999, `${num} out of range`);
      }
    });

    it('does not always return the same value', () => {
      const codes = new Set();
      for (let i = 0; i < 20; i++) {
        codes.add(_internal.generateCode());
      }
      assert.ok(codes.size > 1, 'expected multiple distinct codes');
    });
  });

  describe('code lookup keying', () => {
    it('emailKey is compatible with hashToken (the register route reuses hashToken)', () => {
      const email = 'user@example.com';
      const fromHelper = _internal.emailKey(email);
      const fromToken = hashToken(email.toLowerCase().trim());
      assert.strictEqual(fromHelper, fromToken);
    });
  });

  describe('constants', () => {
    it('CODE_TTL is 300 seconds (5 minutes)', () => {
      assert.strictEqual(_internal.CODE_TTL, 300);
    });

    it('MAX_VERIFY_FAILURES is 5', () => {
      assert.strictEqual(_internal.MAX_VERIFY_FAILURES, 5);
    });
  });
});
