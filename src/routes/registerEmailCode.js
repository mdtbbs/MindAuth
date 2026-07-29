/**
 * Registration email verification code endpoint
 *
 * POST /send-code
 *   Validates the requested email, checks it is not already registered,
 *   rate-limits per IP, generates a 6-digit numeric code, stores the
 *   SHA-256 of the code in Redis (primary) and MySQL (fallback), and
 *   emails the plaintext code to the user.
 *
 * The code is consumed atomically by POST /api/register — that route
 * looks up the same Redis key / MySQL row and compares the presented
 * code's hash to the stored one.
 *
 * Redis key:  register_email_code:{sha256(lowercase-trimmed-email)}
 *             payload: { email, codeHash, failures, emailLower }
 *             TTL: 300 seconds (5 minutes)
 *
 * MySQL fallback: registration_email_codes table keyed by email_hash.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const { pool } = require('../db');
const { client } = require('../redis');
const { hashToken } = require('../utils/token');
const { isValidEmail } = require('../utils/validation');
const { sendRegistrationCodeEmail } = require('../utils/email');
const { createRateLimiter } = require('../middleware/rateLimit');
const config = require('../config');

const CODE_TTL = 300; // 5 minutes
const MAX_VERIFY_FAILURES = 5;
const EMAIL_COOLDOWN_MS = 60 * 1000; // 1 minute per-email cooldown
const isProduction = process.env.NODE_ENV === 'production';

// Per-IP rate limit (3 per 10 min) — matches config.rateLimit.registerSendCode.
const sendIpLimiter = createRateLimiter(config.rateLimit.registerSendCode);

// Per-email cooldown: stored in Redis with a dedicated key namespace.
// Ensures the same address cannot be spammed even from different IPs.
const EMAIL_COOLDOWN_PREFIX = 'register_email_cooldown:';

function emailKey(email) {
  return hashToken(email.toLowerCase().trim());
}

function generateCode() {
  // crypto.randomInt is available in Node 14.10+; safe range [100000, 999999]
  // gives exactly 6 digits. Using crypto (not Math.random) to avoid
  // predictable codes that an attacker could brute-force within the 5-min TTL.
  const min = 100000;
  const max = 999999;
  return crypto.randomInt(min, max + 1).toString();
}

async function persistCodeToMysql(emailHash, email, codeHash, ttlSeconds) {
  try {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
      .toISOString().slice(0, 19).replace('T', ' ');
    await pool.execute(
      'INSERT INTO registration_email_codes (email_hash, email, code_hash, expires_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE email = VALUES(email), code_hash = VALUES(code_hash), expires_at = VALUES(expires_at)',
      [emailHash, email, codeHash, expiresAt]
    );
  } catch (err) {
    console.warn('[RegisterEmailCode] MySQL persist failed:', err.message);
  }
}

router.post('/send-code', sendIpLimiter, async (req, res) => {
  try {
    const rawEmail = typeof req.body?.email === 'string' ? req.body.email : '';
    const email = rawEmail.trim();
    const emailLower = email.toLowerCase();

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_EMAIL',
        message: '邮箱格式不正确',
      });
    }

    // 1. Check whether email is already registered.
    //    Per product decision, this endpoint exposes the truth (clear error
    //    for "email already registered") rather than a generic message.
    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [emailLower]
    );
    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        code: 'EMAIL_ALREADY_REGISTERED',
        message: '该邮箱已注册，请直接登录',
      });
    }

    // 2. Per-email cooldown (1 minute) — prevents a single address from
    //    being spammed with registration emails from different IPs.
    const cooldownKey = `${EMAIL_COOLDOWN_PREFIX}${emailKey(email)}`;
    const cooldownOk = await client.set(cooldownKey, '1', 'EX', Math.ceil(EMAIL_COOLDOWN_MS / 1000), 'NX');
    if (cooldownOk !== 'OK') {
      const ttl = await client.ttl(cooldownKey);
      const waitSec = ttl > 0 ? ttl : 60;
      return res.status(429).json({
        success: false,
        code: 'EMAIL_COOLDOWN',
        message: `发送过于频繁，请${waitSec}秒后重试`,
      });
    }

    // 3. Generate code + store in Redis (primary) and MySQL (fallback).
    //    We store the code HASH, never the plaintext. The register endpoint
    //    hashes the presented code and compares.
    const code = generateCode();
    const codeHash = hashToken(code);
    const eHash = emailKey(email);

    await client.setEx(
      `register_email_code:${eHash}`,
      CODE_TTL,
      JSON.stringify({ email: emailLower, codeHash, failures: 0 })
    );
    await persistCodeToMysql(eHash, emailLower, codeHash, CODE_TTL);

    // 4. Send the email. If SMTP is unavailable, surface 503 and clean up
    //    the Redis/MySQL rows so a retry isn't blocked by a stale entry.
    try {
      await sendRegistrationCodeEmail(emailLower, code);
    } catch (sendErr) {
      await client.del(`register_email_code:${eHash}`).catch(() => {});
      try {
        await pool.execute('DELETE FROM registration_email_codes WHERE email_hash = ?', [eHash]);
      } catch {}
      await client.del(cooldownKey).catch(() => {});
      if (sendErr.message && sendErr.message.includes('邮件服务未配置')) {
        return res.status(503).json({
          success: false,
          code: 'SMTP_UNAVAILABLE',
          message: '邮件服务暂时不可用，请联系管理员配置 SMTP',
        });
      }
      return res.status(503).json({
        success: false,
        code: 'SMTP_SEND_FAILED',
        message: '验证码发送失败，请稍后重试',
      });
    }

    // In dev/test, return the code so automated tests can use it without
    // parsing console output. Production never returns the code.
    const body = { success: true, message: '验证码已发送到您的邮箱' };
    if (!isProduction) {
      body.code = code;
    }
    res.json(body);
  } catch (err) {
    console.error('[RegisterEmailCode] send-code error:', err);
    res.status(500).json({ success: false, message: '发送验证码失败' });
  }
});

module.exports = router;
module.exports._internal = { emailKey, generateCode, CODE_TTL, MAX_VERIFY_FAILURES };
