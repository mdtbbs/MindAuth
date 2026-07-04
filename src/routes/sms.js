const express = require('express');
const router = express.Router();
const { pool, isDuplicateError, getDuplicateField } = require('../db');
const { client } = require('../redis');
const requireAuth = require('../middleware/requireAuth');
const { sendSmsCode, checkSmsCode } = require('../utils/aliyunSms');
const { getClientIp } = require('../utils/request');
const { notifyForumUserUpdated } = require('../utils/forumSync');
const { logSmsAudit } = require('../utils/smsAudit');
const { createNotification } = require('../utils/notify');

const PHONE_RE = /^1[3-9]\d{9}$/;

function normalizePhone(phone) {
  return String(phone || '').trim();
}

function isPhoneVerifiedForUser(user, phone) {
  return (user.phone_verified === 1 || user.phone_verified === true) && String(user.phone || '') === phone;
}

async function createPhoneSyncToken(user) {
  const syncToken = require('crypto').randomBytes(32).toString('hex');
  await client.setEx(`phone_sync:${syncToken}`, 5 * 60, JSON.stringify({
    user_id: user.id,
    phone_verified: true,
    phone_verified_at: user.phone_verified_at || new Date().toISOString(),
  }));
  return syncToken;
}

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
    {
      keys: [key],
      arguments: [String(max), String(ttlSeconds)],
    }
  );

  return Number(waitSeconds || 0);
}

async function enforceSendLimits(req, phone) {
  const ip = getClientIp(req);
  const limits = [
    [`sms:send:ip:${ip}`, 3, 60 * 60],
    [`sms:send:user:${req.user.id}`, 3, 5 * 60],
    [`sms:send:phone:${phone}`, 1, 60],
  ];

  for (const [key, max, ttl] of limits) {
    const waitSeconds = await hitLimit(key, max, ttl);
    if (waitSeconds > 0) {
      return waitSeconds;
    }
  }

  return 0;
}

async function enforceVerifyFailureLimit(req, phone) {
  const ip = getClientIp(req);
  const limits = [
    [`sms:verify:fail:user:${req.user.id}:${phone}`, 5, 5 * 60],
    [`sms:verify:fail:phone:${phone}`, 10, 60 * 60],
    [`sms:verify:fail:ip:${ip}`, 20, 60 * 60],
  ];

  for (const [key, max, ttl] of limits) {
    const waitSeconds = await hitLimit(key, max, ttl);
    if (waitSeconds > 0) {
      return waitSeconds;
    }
  }

  return 0;
}

async function getVerifyFailureWaitSeconds(req, phone) {
  const ip = getClientIp(req);
  const limits = [
    [`sms:verify:fail:user:${req.user.id}:${phone}`, 5],
    [`sms:verify:fail:phone:${phone}`, 10],
    [`sms:verify:fail:ip:${ip}`, 20],
  ];

  for (const [key, max] of limits) {
    const count = Number(await client.get(key) || 0);
    if (count < max) {
      continue;
    }

    const ttl = await client.ttl(key);
    return Math.max(ttl, 1);
  }

  return 0;
}

async function clearVerifyFailureLimits(req, phone) {
  await client.del(`sms:verify:fail:user:${req.user.id}:${phone}`);
}

router.post('/send', requireAuth, async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const audit = {
    user_id: req.user.id,
    action: 'send_code',
    phone,
    ip_address: getClientIp(req),
    user_agent: req.headers['user-agent'],
  };

  if (!PHONE_RE.test(phone)) {
    await logSmsAudit({ ...audit, success: false, code: 'INVALID_PHONE' });
    return res.status(400).json({ success: false, code: 'INVALID_PHONE', message: '手机号格式错误' });
  }

  try {
    if (isPhoneVerifiedForUser(req.user, phone)) {
      const syncToken = await createPhoneSyncToken(req.user);
      await logSmsAudit({ ...audit, success: true, code: 'PHONE_ALREADY_VERIFIED' });
      return res.json({
        success: true,
        code: 'PHONE_ALREADY_VERIFIED',
        message: '手机号已验证',
        phone_verified: true,
        phone_sync_token: syncToken,
      });
    }

    if (req.user.phone_verified && req.user.phone && req.user.phone !== phone) {
      await logSmsAudit({ ...audit, success: false, code: 'PHONE_ALREADY_BOUND' });
      return res.status(409).json({ success: false, code: 'PHONE_ALREADY_BOUND', message: '当前账号已绑定手机号，暂不支持换绑' });
    }

    const waitSeconds = await enforceSendLimits(req, phone);
    if (waitSeconds > 0) {
      await logSmsAudit({ ...audit, success: false, code: 'SMS_RATE_LIMITED' });
      return res.status(429).json({
        success: false,
        code: 'SMS_RATE_LIMITED',
        message: `发送太频繁，请${waitSeconds}秒后重试`,
      });
    }

    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE phone = ? AND id <> ? LIMIT 1',
      [phone, req.user.id]
    );

    if (existing.length > 0) {
      await logSmsAudit({ ...audit, success: false, code: 'PHONE_IN_USE' });
      return res.status(409).json({ success: false, code: 'PHONE_IN_USE', message: '该手机号已被其他用户使用' });
    }

    await sendSmsCode(phone);
    await logSmsAudit({ ...audit, success: true, code: 'SMS_SENT' });
    return res.json({ success: true, message: '验证码已发送' });
  } catch (err) {
    console.error('[SMS] send failed:', err);
    const status = err.code === 'SMS_NOT_CONFIGURED' ? 503 : 500;
    await logSmsAudit({ ...audit, success: false, code: err.code || 'SMS_SEND_FAILED' });
    return res.status(status).json({ success: false, code: err.code || 'SMS_SEND_FAILED', message: err.message || '发送失败，请稍后重试' });
  }
});

router.post('/verify', requireAuth, async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const code = String(req.body?.code || '').trim();
  const token = req.cookies.session;
  const audit = {
    user_id: req.user.id,
    action: 'verify_code',
    phone,
    ip_address: getClientIp(req),
    user_agent: req.headers['user-agent'],
  };

  if (!PHONE_RE.test(phone) || !/^\d{6}$/.test(code)) {
    await logSmsAudit({ ...audit, success: false, code: 'INVALID_SMS_PARAMS' });
    return res.status(400).json({ success: false, code: 'INVALID_SMS_PARAMS', message: '手机号或验证码格式错误' });
  }

  try {
    if (isPhoneVerifiedForUser(req.user, phone)) {
      const syncToken = await createPhoneSyncToken(req.user);
      await logSmsAudit({ ...audit, success: true, code: 'PHONE_ALREADY_VERIFIED' });
      return res.json({
        success: true,
        message: '手机号已验证',
        phone_verified: true,
        phone_sync_token: syncToken,
      });
    }

    if (req.user.phone_verified && req.user.phone && req.user.phone !== phone) {
      await logSmsAudit({ ...audit, success: false, code: 'PHONE_ALREADY_BOUND' });
      return res.status(409).json({ success: false, code: 'PHONE_ALREADY_BOUND', message: '当前账号已绑定手机号，暂不支持换绑' });
    }

    const preCheckWaitSeconds = await getVerifyFailureWaitSeconds(req, phone);
    if (preCheckWaitSeconds > 0) {
      await logSmsAudit({ ...audit, success: false, code: 'SMS_VERIFY_RATE_LIMITED' });
      return res.status(429).json({
        success: false,
        code: 'SMS_VERIFY_RATE_LIMITED',
        message: `验证失败次数过多，请${preCheckWaitSeconds}秒后重试`,
      });
    }

    const result = await checkSmsCode(phone, code);
    if (!result.success) {
      const waitSeconds = await enforceVerifyFailureLimit(req, phone);
      if (waitSeconds > 0) {
        await logSmsAudit({ ...audit, success: false, code: 'SMS_VERIFY_RATE_LIMITED' });
        return res.status(429).json({
          success: false,
          code: 'SMS_VERIFY_RATE_LIMITED',
          message: `验证失败次数过多，请${waitSeconds}秒后重试`,
        });
      }
      await logSmsAudit({ ...audit, success: false, code: 'INVALID_SMS_CODE' });
      return res.status(400).json({ success: false, code: 'INVALID_SMS_CODE', message: '验证码错误或已过期' });
    }

    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE phone = ? AND id <> ? LIMIT 1',
      [phone, req.user.id]
    );

    if (existing.length > 0) {
      await logSmsAudit({ ...audit, success: false, code: 'PHONE_IN_USE' });
      return res.status(409).json({ success: false, code: 'PHONE_IN_USE', message: '该手机号已被其他用户使用' });
    }

    await pool.execute(
      'UPDATE users SET phone = ?, phone_verified = 1, phone_verified_at = CURRENT_TIMESTAMP WHERE id = ?',
      [phone, req.user.id]
    );

    const syncToken = await createPhoneSyncToken({
      id: req.user.id,
      phone_verified_at: new Date().toISOString(),
    });

    if (token) {
      await client.del(`session:${token}`);
    }
    await clearVerifyFailureLimits(req, phone);
    notifyForumUserUpdated(req.user.id).catch(err => console.warn('[SMS] forum sync failed:', err.message));
    await logSmsAudit({ ...audit, success: true, code: 'PHONE_BOUND' });

    // Phone bound notification
    await createNotification({
      user_id: req.user.id, type: 'phone_bound', title: '手机号已绑定',
      content: `手机号 ${phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')} 已成功绑定`,
      ip_address: getClientIp(req), user_agent: req.headers['user-agent'],
    }).catch(err => console.warn('[SMS] phone notification failed:', err.message));

    return res.json({
      success: true,
      message: '手机号绑定成功',
      phone_verified: true,
      phone_sync_token: syncToken,
    });
  } catch (err) {
    if (isDuplicateError(err) && getDuplicateField(err) === 'phone') {
      await logSmsAudit({ ...audit, success: false, code: 'PHONE_IN_USE' });
      return res.status(409).json({ success: false, code: 'PHONE_IN_USE', message: '该手机号已被其他用户使用' });
    }

    console.error('[SMS] verify failed:', err);
    const status = err.code === 'SMS_NOT_CONFIGURED' ? 503 : 500;
    await logSmsAudit({ ...audit, success: false, code: err.code || 'SMS_VERIFY_FAILED' });
    return res.status(status).json({ success: false, code: err.code || 'SMS_VERIFY_FAILED', message: err.message || '验证失败，请稍后重试' });
  }
});

router.post('/sync-status', async (req, res) => {
  const syncToken = String(req.body?.phone_sync_token || '').trim();

  if (!/^[a-f0-9]{64}$/.test(syncToken)) {
    return res.status(400).json({ success: false, code: 'INVALID_SYNC_TOKEN', message: '同步令牌无效' });
  }

  try {
    const payload = await client.get(`phone_sync:${syncToken}`);
    if (!payload) {
      return res.status(401).json({ success: false, code: 'SYNC_TOKEN_EXPIRED', message: '同步令牌已过期' });
    }

    await client.del(`phone_sync:${syncToken}`);
    return res.json({ success: true, ...JSON.parse(payload) });
  } catch (err) {
    console.error('[SMS] sync status failed:', err);
    return res.status(500).json({ success: false, code: 'SYNC_STATUS_FAILED', message: '同步手机号状态失败' });
  }
});

module.exports = router;
