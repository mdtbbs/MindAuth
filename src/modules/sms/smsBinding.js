/**
 * smsBinding — Centralized SMS phone-binding lifecycle module.
 *
 * This is the ONLY seam for sending SMS codes, verifying them, binding phones
 * to user accounts, and managing the associated rate limits and audit trail.
 *
 * Design invariants:
 *   - All send/verify rate-limit checks go through Redis Lua scripts
 *   - SMS audit logging is centralized (one log per action)
 *   - Phone binding updates the users table atomically
 *   - Session cache is invalidated after phone bind (so req.user is fresh)
 *   - Notifications are sent after successful binding
 *
 * Low-level SMS sending is delegated to utils/aliyunSms.js.
 * Audit logging is delegated to utils/smsAudit.js.
 */

const { pool } = require('../../db');
const { client } = require('../../redis');
const { sendSmsCode, checkSmsCode } = require('../../utils/aliyunSms');
const { getClientIp } = require('../../utils/request');
const { logSmsAudit } = require('../../utils/smsAudit');
const { createNotification } = require('../../utils/notify');
const sessionManager = require('../sessions/sessionManager');

// ─── Constants ────────────────────────────────────────────────

const PHONE_RE = /^1[3-9]\d{9}$/;

// ─── Helpers ─────────────────────────────────────────────────

function normalizePhone(phone) {
  return String(phone || '').trim();
}

function isPhoneVerifiedForUser(user, phone) {
  return (user.phone_verified === 1 || user.phone_verified === true) && String(user.phone || '') === phone;
}

/**
 * Generic rate-limit hit using Redis Lua script (INCR + EXPIRE).
 * Returns the number of seconds the caller should wait (0 = allowed).
 */
async function hitLimit(key, max, ttlSeconds) {
  const waitSeconds = await client.eval(
    `
      local count = redis.call('INCR', KEYS[1])
      if count == 1 then
        redis.call('EXPIRE', KEYS[1], ARGV[2])
      end
      if count > tonumber(ARGV[1]) then
        local ttl = redis.call('TTL', KEYS[1])
        if ttl < 1 then
          redis.call('EXPIRE', KEYS[1], ARGV[2])
          ttl = tonumber(ARGV[2])
        end
        return ttl
      end
      return 0
    `,
    { keys: [key], arguments: [String(max), String(ttlSeconds)] }
  );
  return Number(waitSeconds || 0);
}

async function enforceSendLimits(userId, phone, ip) {
  const limits = [
    [`sms:send:ip:${ip}`, 3, 60 * 60],
    [`sms:send:user:${userId}`, 3, 5 * 60],
    [`sms:send:phone:${phone}`, 1, 60],
  ];
  for (const [key, max, ttl] of limits) {
    const waitSeconds = await hitLimit(key, max, ttl);
    if (waitSeconds > 0) return waitSeconds;
  }
  return 0;
}

async function enforceVerifyFailureLimit(userId, phone, ip) {
  const limits = [
    [`sms:verify:fail:user:${userId}:${phone}`, 5, 5 * 60],
    [`sms:verify:fail:phone:${phone}`, 10, 60 * 60],
    [`sms:verify:fail:ip:${ip}`, 20, 60 * 60],
  ];
  for (const [key, max, ttl] of limits) {
    const waitSeconds = await hitLimit(key, max, ttl);
    if (waitSeconds > 0) return waitSeconds;
  }
  return 0;
}

async function getVerifyFailureWaitSeconds(userId, phone, ip) {
  const limits = [
    [`sms:verify:fail:user:${userId}:${phone}`, 5],
    [`sms:verify:fail:phone:${phone}`, 10],
    [`sms:verify:fail:ip:${ip}`, 20],
  ];
  for (const [key, max] of limits) {
    const count = Number(await client.get(key) || 0);
    if (count < max) continue;
    const ttl = await client.ttl(key);
    return Math.max(ttl, 1);
  }
  return 0;
}

async function clearVerifyFailureLimits(userId, phone) {
  await client.del(`sms:verify:fail:user:${userId}:${phone}`);
}

// ─── Public interface ────────────────────────────────────────

/**
 * Send an SMS verification code to a phone number.
 *
 * Validates the phone, checks rate limits, checks for duplicate bindings,
 * and delegates actual sending to utils/aliyunSms.
 *
 * @param {object} user - req.user (must have id, phone, phone_verified)
 * @param {string} rawPhone - raw phone from request body
 * @param {object} req - Express request (for IP and audit context)
 * @returns {Promise<object>} - { success, code?, message?, phone_verified?, waitSeconds? }
 */
async function sendCode(user, rawPhone, req) {
  const phone = normalizePhone(rawPhone);
  const ip = getClientIp(req);
  const audit = {
    user_id: user.id,
    action: 'send_code',
    phone,
    ip_address: ip,
    user_agent: req.headers['user-agent'],
  };

  if (!PHONE_RE.test(phone)) {
    await logSmsAudit({ ...audit, success: false, code: 'INVALID_PHONE' });
    return { success: false, code: 'INVALID_PHONE', status: 400, message: '手机号格式错误' };
  }

  try {
    if (isPhoneVerifiedForUser(user, phone)) {
      await logSmsAudit({ ...audit, success: true, code: 'PHONE_ALREADY_VERIFIED' });
      return { success: true, code: 'PHONE_ALREADY_VERIFIED', message: '手机号已验证', phone_verified: true };
    }

    if (user.phone_verified && user.phone && user.phone !== phone) {
      await logSmsAudit({ ...audit, success: false, code: 'PHONE_ALREADY_BOUND' });
      return { success: false, code: 'PHONE_ALREADY_BOUND', status: 409, message: '当前账号已绑定手机号，暂不支持换绑' };
    }

    const waitSeconds = await enforceSendLimits(user.id, phone, ip);
    if (waitSeconds > 0) {
      await logSmsAudit({ ...audit, success: false, code: 'SMS_RATE_LIMITED' });
      return { success: false, code: 'SMS_RATE_LIMITED', status: 429, message: `发送太频繁，请${waitSeconds}秒后重试` };
    }

    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE phone = ? AND id <> ? LIMIT 1',
      [phone, user.id]
    );
    if (existing.length > 0) {
      await logSmsAudit({ ...audit, success: false, code: 'PHONE_IN_USE' });
      return { success: false, code: 'PHONE_IN_USE', status: 409, message: '该手机号已被其他用户使用' };
    }

    await sendSmsCode(phone);
    await logSmsAudit({ ...audit, success: true, code: 'SMS_SENT' });
    return { success: true, message: '验证码已发送' };
  } catch (err) {
    console.error('[SmsBinding] send failed:', err);
    const status = err.code === 'SMS_NOT_CONFIGURED' ? 503 : 500;
    await logSmsAudit({ ...audit, success: false, code: err.code || 'SMS_SEND_FAILED' });
    return { success: false, code: err.code || 'SMS_SEND_FAILED', status, message: err.message || '发送失败，请稍后重试' };
  }
}

/**
 * Verify an SMS code and bind the phone to the user's account.
 *
 * @param {object} user - req.user
 * @param {string} rawPhone
 * @param {string} rawCode
 * @param {object} req - Express request
 * @returns {Promise<object>} - { success, code?, message?, phone_verified? }
 */
async function verifyCode(user, rawPhone, rawCode, req) {
  const phone = normalizePhone(rawPhone);
  const code = String(rawCode || '').trim();
  const token = req.cookies.session;
  const ip = getClientIp(req);
  const audit = {
    user_id: user.id,
    action: 'verify_code',
    phone,
    ip_address: ip,
    user_agent: req.headers['user-agent'],
  };

  if (!PHONE_RE.test(phone) || !/^\d{6}$/.test(code)) {
    await logSmsAudit({ ...audit, success: false, code: 'INVALID_SMS_PARAMS' });
    return { success: false, code: 'INVALID_SMS_PARAMS', status: 400, message: '手机号或验证码格式错误' };
  }

  try {
    if (isPhoneVerifiedForUser(user, phone)) {
      await logSmsAudit({ ...audit, success: true, code: 'PHONE_ALREADY_VERIFIED' });
      return { success: true, message: '手机号已验证', phone_verified: true };
    }

    if (user.phone_verified && user.phone && user.phone !== phone) {
      await logSmsAudit({ ...audit, success: false, code: 'PHONE_ALREADY_BOUND' });
      return { success: false, code: 'PHONE_ALREADY_BOUND', status: 409, message: '当前账号已绑定手机号，暂不支持换绑' };
    }

    // Pre-check verify failure limits
    const preCheckWait = await getVerifyFailureWaitSeconds(user.id, phone, ip);
    if (preCheckWait > 0) {
      await logSmsAudit({ ...audit, success: false, code: 'SMS_VERIFY_RATE_LIMITED' });
      return { success: false, code: 'SMS_VERIFY_RATE_LIMITED', status: 429, message: `验证失败次数过多，请${preCheckWait}秒后重试` };
    }

    const result = await checkSmsCode(phone, code);
    if (!result.success) {
      const waitSeconds = await enforceVerifyFailureLimit(user.id, phone, ip);
      if (waitSeconds > 0) {
        await logSmsAudit({ ...audit, success: false, code: 'SMS_VERIFY_RATE_LIMITED' });
        return { success: false, code: 'SMS_VERIFY_RATE_LIMITED', status: 429, message: `验证失败次数过多，请${waitSeconds}秒后重试` };
      }
      await logSmsAudit({ ...audit, success: false, code: 'INVALID_SMS_CODE' });
      return { success: false, code: 'INVALID_SMS_CODE', status: 400, message: '验证码错误或已过期' };
    }

    // Check phone uniqueness
    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE phone = ? AND id <> ? LIMIT 1',
      [phone, user.id]
    );
    if (existing.length > 0) {
      await logSmsAudit({ ...audit, success: false, code: 'PHONE_IN_USE' });
      return { success: false, code: 'PHONE_IN_USE', status: 409, message: '该手机号已被其他用户使用' };
    }

    // Bind phone
    await pool.execute(
      'UPDATE users SET phone = ?, phone_verified = 1, phone_verified_at = CURRENT_TIMESTAMP WHERE id = ?',
      [phone, user.id]
    );

    // Invalidate session cache so req.user is fresh on next request.
    // Must go through sessionManager — cache keys are keyed by token HASH.
    await sessionManager.invalidateUserSessionCache(token);

    await clearVerifyFailureLimits(user.id, phone);
    await logSmsAudit({ ...audit, success: true, code: 'PHONE_BOUND' });

    // Notification
    const maskedPhone = phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
    await createNotification({
      user_id: user.id,
      type: 'phone_bound',
      title: '手机号已绑定',
      content: `手机号 ${maskedPhone} 已成功绑定`,
      ip_address: ip,
      user_agent: req.headers['user-agent'],
    }).catch(err => console.warn('[SmsBinding] phone notification failed:', err.message));

    return { success: true, message: '手机号绑定成功', phone_verified: true };
  } catch (err) {
    // Handle unique constraint race condition
    const { isDuplicateError, getDuplicateField } = require('../../db');
    if (isDuplicateError(err) && getDuplicateField(err) === 'phone') {
      await logSmsAudit({ ...audit, success: false, code: 'PHONE_IN_USE' });
      return { success: false, code: 'PHONE_IN_USE', status: 409, message: '该手机号已被其他用户使用' };
    }
    console.error('[SmsBinding] verify failed:', err);
    const status = err.code === 'SMS_NOT_CONFIGURED' ? 503 : 500;
    await logSmsAudit({ ...audit, success: false, code: err.code || 'SMS_VERIFY_FAILED' });
    return { success: false, code: err.code || 'SMS_VERIFY_FAILED', status, message: err.message || '验证失败，请稍后重试' };
  }
}

/**
 * Get SMS/phone status for a user.
 *
 * @param {object} user - req.user
 * @returns {{ phone_verified: boolean, phone_masked: string|null }}
 */
function getStatus(user) {
  const { maskPhone } = require('../../utils/phone');
  return {
    phone_verified: user.phone_verified === 1 || user.phone_verified === true,
    phone_masked: maskPhone(user.phone),
  };
}

// ─── Exports ─────────────────────────────────────────────────

module.exports = {
  sendCode,
  verifyCode,
  getStatus,
  // Exposed for testing
  _normalizePhone: normalizePhone,
  _isPhoneVerifiedForUser: isPhoneVerifiedForUser,
  _enforceSendLimits: enforceSendLimits,
  _enforceVerifyFailureLimit: enforceVerifyFailureLimit,
  _getVerifyFailureWaitSeconds: getVerifyFailureWaitSeconds,
  _clearVerifyFailureLimits: clearVerifyFailureLimits,
  PHONE_RE,
};
