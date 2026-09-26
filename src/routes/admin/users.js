const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { pool, transaction } = require('../../db');
const { isValidUsername, getUsernameValidationError, isValidEmail, escapeHtml } = require('../../utils/validation');
const { requireAdmin, requireAdminPermission, invalidateUserAdminSessions, isAdminRole, ROLE_PERMISSIONS } = require('../../middleware/requireAdmin');
const { createRateLimiter } = require('../../middleware/rateLimit');
const { getClientIp } = require('../../utils/request');
const { createNotification } = require('../../utils/notify');
const config = require('../../config');
const sessionManager = require('../../modules/sessions/sessionManager');
const tokenStore = require('../../modules/oauth/tokenStore');
const auditWriter = require('../../modules/audit/auditWriter');
const emailPolicy = require('../../modules/emailPolicy/emailPolicyService');
const { generateToken, hashToken } = require('../../utils/token');
const { client } = require('../../redis');
const { sendVerificationEmail } = require('../../utils/email');
const { getEmailDomain } = emailPolicy;
const emailBaseUrl = process.env.BASE_URL || 'http://localhost:4001';
const emailVerificationTtl = 3600;
const sensitiveUserMutationLimiter = createRateLimiter({ maxAttempts: 30, windowMs: 60 * 60 * 1000, keyPrefix: 'ratelimit:admin_user_security' });

const BAN_DURATIONS = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  'permanent': null,
};

function calcBanExpiry(duration, expires_at) {
  if (expires_at) {
    const parsed = new Date(expires_at);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      const error = new Error('到期时间必须是有效的未来时间');
      error.code = 'INVALID_BAN_DURATION';
      throw error;
    }
    return parsed;
  }
  if (duration === 'permanent' || duration === undefined) return null;
  const custom = /^([1-9]\d{0,3})h$/.exec(String(duration));
  const ms = custom ? Number(custom[1]) * 60 * 60 * 1000 : BAN_DURATIONS[duration];
  if (ms === undefined || ms > 365 * 24 * 60 * 60 * 1000) {
    const error = new Error('封禁时长无效');
    error.code = 'INVALID_BAN_DURATION';
    throw error;
  }
  return new Date(Date.now() + ms);
}

// Rate limiters for sensitive admin operations
const passwordResetLimiter = createRateLimiter(config.adminSecurity.passwordReset);
const userDeleteLimiter = createRateLimiter(config.adminSecurity.userDelete);
const USER_ROLES = ['user', 'moderator', 'admin', 'super_admin', 'user_admin', 'security_admin', 'config_admin', 'readonly_admin'];

function isSuperAdmin(req) {
  return req.adminUser?.normalized_role === 'super_admin' || req.adminUser?.role === 'admin';
}

/**
 * Guard for per-user admin actions. Returns { status, message } when the
 * action must be rejected, or null when it is allowed.
 * - Admin-role targets may only be acted on by a super admin
 * - blockSelf: the acting admin cannot target their own account
 * - protectLastSuper: the last remaining super admin cannot be removed
 */
async function checkTargetGuard(req, targetId, { blockSelf = false, protectLastSuper = false } = {}) {
  const [rows] = await pool.execute('SELECT id, role FROM users WHERE id = ?', [targetId]);
  const target = rows[0];
  if (!target) return { status: 404, message: '用户不存在' };
  if (blockSelf && target.id === req.adminUser.id) {
    return { status: 400, message: '不能对自己的账号执行此操作' };
  }
  if (isAdminRole(target.role) && !isSuperAdmin(req)) {
    return { status: 403, message: '只有超级管理员可以操作管理员账号' };
  }
  if (protectLastSuper && (target.role === 'super_admin' || target.role === 'admin')) {
    const [cnt] = await pool.execute("SELECT COUNT(*) AS n FROM users WHERE role IN ('super_admin', 'admin')");
    if (cnt[0].n <= 1) return { status: 403, message: '不能移除最后一个超级管理员' };
  }
  return null;
}

// GET /users - Get all users
router.get('/', requireAdmin, requireAdminPermission('users.read'), async (req, res) => {
  try {
    const { search, role, page, limit, email_verified, ban_status, locked, created_from, created_to } = req.query;

    // Security: Validate pagination parameters are positive integers
    const defaultLimit = 50;
    const maxLimit = 100;

    let effectiveLimit = defaultLimit;
    if (limit) {
      const parsedLimit = parseInt(limit);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > maxLimit) {
        return res.status(400).json({ success: false, message: '分页参数无效' });
      }
      effectiveLimit = parsedLimit;
    }

    let effectivePage = 1;
    if (page) {
      const parsedPage = parseInt(page);
      if (!Number.isInteger(parsedPage) || parsedPage < 1) {
        return res.status(400).json({ success: false, message: '分页参数无效' });
      }
      effectivePage = parsedPage;
    }

    const conditions = [];
    const params = [];
    if (search) {
      const value = String(search).trim().slice(0, 150);
      const numericId = /^\d+$/.test(value) ? Number(value) : -1;
      conditions.push('(username LIKE ? OR email LIKE ? OR id = ? OR EXISTS (SELECT 1 FROM login_logs iplog WHERE iplog.user_id = users.id AND iplog.ip = ?))');
      params.push(`%${value}%`, `%${value}%`, numericId, value);
    }
    if (role) {
      if (role === 'admin') conditions.push("role IN ('admin', 'super_admin')");
      else { conditions.push('role = ?'); params.push(String(role)); }
    }
    if (email_verified === 'true' || email_verified === 'false') { conditions.push('email_verified = ?'); params.push(email_verified === 'true' ? 1 : 0); }
    if (['none', 'muted', 'banned'].includes(String(ban_status || ''))) { conditions.push('ban_status = ?'); params.push(ban_status); }
    if (locked === 'true') conditions.push('(lock_level > 0 AND (locked_until IS NULL OR locked_until > NOW()))');
    if (locked === 'false') conditions.push('(lock_level = 0 OR (locked_until IS NOT NULL AND locked_until <= NOW()))');
    if (created_from && /^\d{4}-\d{2}-\d{2}$/.test(String(created_from))) { conditions.push('created_at >= ?'); params.push(`${created_from} 00:00:00`); }
    if (created_to && /^\d{4}-\d{2}-\d{2}$/.test(String(created_to))) { conditions.push('created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(`${created_to} 00:00:00`); }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';

    let query = `SELECT id, username, email, email_verified, role, phone, phone_verified, ban_status, lock_level, locked_until, ban_expires_at, created_at,
      (SELECT MAX(created_at) FROM login_logs WHERE user_id = users.id) AS last_login_at,
      (SELECT ip FROM login_logs WHERE user_id = users.id ORDER BY created_at DESC LIMIT 1) AS last_ip
      FROM users${where} ORDER BY created_at DESC`;

    // 添加默认分页 - use query() instead of execute() for LIMIT/OFFSET
    // MySQL prepared statements have issues with LIMIT/OFFSET parameters
    // Values are validated above to be positive integers within bounds
    const offset = (effectivePage - 1) * effectiveLimit;
    query += ` LIMIT ${effectiveLimit} OFFSET ${offset}`;

    const [users] = await pool.query(query, params);

    // Get total count
    const [totalRows] = await pool.execute(`SELECT COUNT(*) as count FROM users${where}`, params);
    const total = totalRows[0].count;

    res.json({
      success: true,
      users,
      pagination: page && limit ? { page: effectivePage, limit: effectiveLimit, total, totalPages: Math.ceil(total / effectiveLimit) } : undefined
    });
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ success: false, message: '获取用户列表失败' });
  }
});

// Dedicated administrator account directory. The legacy `admin` role is
// normalized in the response so the new UI never advertises the alias.
router.get('/admins', requireAdmin, requireAdminPermission('admins.read'), async (req, res) => {
  if (req.adminUser.normalized_role !== 'super_admin' && req.adminUser.role !== 'admin') {
    return res.status(403).json({ success: false, message: '只有超级管理员可以查看管理员账号' });
  }
  try {
    const [admins] = await pool.execute(`
      SELECT u.id, u.username, u.email, u.role, u.ban_status, u.lock_level, u.created_at,
        (SELECT MAX(l.created_at) FROM login_logs l WHERE l.user_id = u.id) AS last_login_at
      FROM users u WHERE u.role IN ('admin', 'super_admin', 'user_admin', 'security_admin', 'config_admin', 'readonly_admin')
      ORDER BY FIELD(u.role, 'super_admin', 'admin', 'user_admin', 'security_admin', 'config_admin', 'readonly_admin'), u.username ASC
    `);
    res.json({ success: true, admins: admins.map(item => ({ ...item, role: item.role === 'admin' ? 'super_admin' : item.role, permissions: ROLE_PERMISSIONS[item.role === 'admin' ? 'super_admin' : item.role] || [] })) });
  } catch (err) {
    console.error('List administrators error:', err.message);
    res.status(500).json({ success: false, message: '获取管理员列表失败' });
  }
});

// GET /users/:id - Get user details with related activity
router.get('/:id', requireAdmin, requireAdminPermission('users.read'), async (req, res) => {
  try {
    const { id } = req.params;

    const [userRows] = await pool.execute(
      `SELECT id, username, email, email_verified, role, avatar_url, banner_url, phone, phone_verified,
              phone_verified_at, ban_status, ban_reason, banned_by, ban_expires_at, lock_level, locked_until, created_at
       FROM users WHERE id = ?`,
      [id]
    );
    const user = userRows[0];

    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    const [authorizations] = await pool.execute(`
      SELECT a.id, a.client_id, c.name as client_name, a.scope, a.last_used_at, a.created_at
      FROM authorizations a
      LEFT JOIN clients c ON a.client_id = c.client_id
      WHERE a.user_id = ?
      ORDER BY a.last_used_at DESC
      LIMIT 20
    `, [id]);

    const [loginLogs] = await pool.execute(`
      SELECT id, ip, device, login_type, created_at
      FROM login_logs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `, [id]);

    const [smsLogs] = await pool.execute(`
      SELECT id, action, phone_masked, success, code, ip_address, created_at
      FROM sms_audit_logs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `, [id]);

    const [notifications] = await pool.execute(`
      SELECT id, type, title, content, is_read, created_at
      FROM user_notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `, [id]);

    const [auditLogs] = await pool.execute(`
      SELECT id, admin_id, action, target_type, target_id, details, ip_address, created_at
      FROM admin_audit_logs
      WHERE target_type = 'user' AND target_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `, [id]);

    const sessions = await sessionManager.listUserSessions(Number(id), null);

    res.json({
      success: true,
      user,
      authorizations,
      login_logs: loginLogs,
      sms_logs: smsLogs.map((log) => ({ ...log, success: log.success === 1 || log.success === true })),
      notifications: notifications.map((notification) => ({ ...notification, is_read: notification.is_read === 1 || notification.is_read === true })),
      audit_logs: auditLogs,
      sessions,
    });
  } catch (err) {
    console.error('Get user details error:', err);
    res.status(500).json({ success: false, message: '获取用户详情失败' });
  }
});

router.delete('/:id/sessions', requireAdmin, requireAdminPermission('sessions.revoke'), sensitiveUserMutationLimiter, async (req, res) => {
  const userId = Number(req.params.id);
  try {
    const result = await sessionManager.revokeAllUserSessions(userId);
    await auditWriter.writeAdminAudit(req.adminUser.id, 'admin.session.revoke_all', 'user', userId,
      { revoked_session_count: result.revokedCount }, getClientIp(req));
    res.json({ success: true, revoked_session_count: result.revokedCount });
  } catch (err) {
    console.error('Revoke all user sessions error:', err.message);
    res.status(500).json({ success: false, message: '注销用户会话失败' });
  }
});

router.delete('/:id/sessions/:sessionId', requireAdmin, requireAdminPermission('sessions.revoke'), sensitiveUserMutationLimiter, async (req, res) => {
  const userId = Number(req.params.id);
  const rawSessionId = String(req.params.sessionId || '');
  try {
    let result;
    if (rawSessionId.startsWith('native:')) {
      result = await sessionManager.revokeNativeClientSession({ sessionId: rawSessionId.slice(7), userId });
    } else {
      const sessionId = Number(rawSessionId);
      if (!Number.isSafeInteger(sessionId) || sessionId < 1) return res.status(400).json({ success: false, message: '会话 ID 无效' });
      result = await sessionManager.revokeUserSession({ sessionId, userId });
    }
    if (!result.revoked) return res.status(404).json({ success: false, message: '会话不存在或已注销' });
    await auditWriter.writeAdminAudit(req.adminUser.id, 'admin.session.revoke', 'user', userId,
      { session_id: rawSessionId }, getClientIp(req));
    res.json({ success: true });
  } catch (err) {
    console.error('Revoke user session error:', err.message);
    res.status(500).json({ success: false, message: '注销会话失败' });
  }
});

router.delete('/:id/authorizations', requireAdmin, requireAdminPermission('authorizations.revoke'), sensitiveUserMutationLimiter, async (req, res) => {
  const userId = Number(req.params.id);
  try {
    const [rows] = await pool.execute('SELECT client_id FROM authorizations WHERE user_id = ?', [userId]);
    const oauthIssuer = require('../../modules/oauth/oauthIssuer');
    let revoked = 0;
    for (const row of rows) {
      const result = await oauthIssuer.revokeAuthorization({ userId, clientId: row.client_id });
      if (result.revoked) revoked += 1;
    }
    await auditWriter.writeAdminAudit(req.adminUser.id, 'admin.authorization.revoke_all', 'user', userId,
      { authorization_count: revoked }, getClientIp(req));
    res.json({ success: true, revoked_count: revoked });
  } catch (err) {
    console.error('Revoke user authorizations error:', err.message);
    res.status(500).json({ success: false, message: '撤销用户授权失败' });
  }
});

async function issueVerificationEmail(userId, email) {
  const previous = await client.sMembers(`verify_by_user:${userId}`).catch(() => []);
  if (previous.length) await Promise.all(previous.map(tokenHash => client.del(`verify:${tokenHash}`).catch(() => {})));
  await client.del(`verify_by_user:${userId}`).catch(() => {});
  await pool.execute('DELETE FROM email_verification_tokens WHERE user_id = ?', [userId]);
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + emailVerificationTtl * 1000).toISOString().slice(0, 19).replace('T', ' ');
  await client.setEx(`verify:${tokenHash}`, emailVerificationTtl, JSON.stringify({ user_id: userId, email }));
  await client.sAdd(`verify_by_user:${userId}`, tokenHash);
  await pool.execute('INSERT INTO email_verification_tokens (token, user_id, email, expires_at) VALUES (?, ?, ?, ?)', [tokenHash, userId, email, expiresAt]);
  try { await sendVerificationEmail(email, `${emailBaseUrl}/#/verify-email?token=${token}`); }
  catch (err) {
    await client.del(`verify:${tokenHash}`).catch(() => {});
    await client.sRem(`verify_by_user:${userId}`, tokenHash).catch(() => {});
    await pool.execute('DELETE FROM email_verification_tokens WHERE token = ?', [tokenHash]).catch(() => {});
    throw err;
  }
}

router.post('/:id/email-verification/send', requireAdmin, requireAdminPermission('users.write'), sensitiveUserMutationLimiter, async (req, res) => {
  const userId = Number(req.params.id);
  try {
    const [rows] = await pool.execute('SELECT email, email_verified FROM users WHERE id = ? LIMIT 1', [userId]);
    if (!rows[0]) return res.status(404).json({ success: false, message: '用户不存在' });
    if (rows[0].email_verified) return res.status(400).json({ success: false, message: '邮箱已验证' });
    const decision = await emailPolicy.checkEmail(rows[0].email, { purpose: 'verification', userId, ipAddress: getClientIp(req) });
    if (!decision.allowed) return res.status(400).json({ success: false, code: 'EMAIL_DOMAIN_BLOCKED', message: '暂不支持使用该邮箱' });
    await issueVerificationEmail(userId, rows[0].email);
    await auditWriter.writeAdminAudit(req.adminUser.id, 'user.email_verification_resend', 'user', userId, null, getClientIp(req));
    res.json({ success: true, message: '验证邮件已发送' });
  } catch (err) {
    console.error('Admin resend verification email error:', err.message);
    res.status(503).json({ success: false, message: '验证邮件发送失败，请检查邮件配置' });
  }
});

router.put('/:id/email', requireAdmin, requireAdminPermission('users.write'), sensitiveUserMutationLimiter, async (req, res) => {
  const userId = Number(req.params.id);
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const override = req.body?.override_policy === true;
  if (!isValidEmail(email)) return res.status(400).json({ success: false, message: '邮箱格式不正确' });
  if (override && !isSuperAdmin(req)) return res.status(403).json({ success: false, message: '只有超级管理员可以覆盖邮箱策略' });
  try {
    const guard = await checkTargetGuard(req, userId);
    if (guard) return res.status(guard.status).json({ success: false, message: guard.message });
    const decision = await emailPolicy.checkEmail(email, { purpose: 'admin_change_email', userId, ipAddress: getClientIp(req), override });
    if (!decision.allowed) return res.status(400).json({ success: false, code: 'EMAIL_DOMAIN_BLOCKED', message: '暂不支持使用该邮箱' });
    const [duplicates] = await pool.execute('SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1', [email, userId]);
    if (duplicates.length) return res.status(409).json({ success: false, message: '该邮箱已被其他用户使用' });
    await issueVerificationEmail(userId, email);
    await auditWriter.writeAdminAudit(req.adminUser.id, 'user.email_change_requested', 'user', userId,
      { email_domain: getEmailDomain(email), override_policy: override }, getClientIp(req));
    res.json({ success: true, message: '验证邮件已发送；用户完成验证后邮箱才会更新' });
  } catch (err) {
    console.error('Admin request email change error:', err.message);
    res.status(503).json({ success: false, message: '更换邮箱请求失败，请检查邮件配置' });
  }
});

// POST /users/:id/reset-password - Reset user password (rate limited)
router.post('/:id/reset-password', requireAdmin, requireAdminPermission('users.reset_password'), passwordResetLimiter, async (req, res) => {
  try {
    const { id } = req.params;

    const [userRows] = await pool.execute('SELECT * FROM users WHERE id = ?', [id]);
    const user = userRows[0];

    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    const tempPassword = crypto.randomBytes(8).toString('hex');
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hashedPassword, id]);
    await pool.execute('DELETE FROM refresh_tokens WHERE user_id = ?', [id]);

    // Revoke all user sessions via sessionManager
    await sessionManager.revokeAllUserSessions(parseInt(id));

    // Try to send temporary password via email
    // Security: Escape all dynamic content in HTML email
    const { sendEmail } = require('../../utils/email');
    const escapedUsername = escapeHtml(user.username);
    const escapedEmail = escapeHtml(user.email);
    const emailSent = await sendEmail(
      user.email,
      '密码已重置',
      `<div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #3b82f6;">密码已重置</h2>
        <p>您好 ${escapedUsername}，您的密码已被管理员重置。</p>
        <p>临时密码：<strong style="font-size: 18px; background: #f3f4f6; padding: 8px 12px; border-radius: 4px;">${tempPassword}</strong></p>
        <p>请使用此临时密码登录，并尽快修改密码。</p>
        <p style="color: #666; font-size: 12px;">如果您没有请求重置密码，请联系管理员。</p>
      </div>`
    );

    // Security: In production, NEVER return temporary password in API response
    // In development mode without email config, log to console instead
    if (config.server.isProduction) {
      // Production: Never expose password, even if email failed
      if (emailSent.mode === 'console') {
        // Never write the temporary password to logs — if email is not
        // configured the admin must re-run the reset after fixing SMTP
        console.warn(`[SECURITY] Password reset for user ${user.username} (${id}) - email not configured, temp password NOT delivered.`);
      }
      res.json({
        success: true,
        message: '密码已重置，临时密码已发送到用户邮箱'
      });
    } else {
      // Development: Allow returning password only when email not configured
      if (emailSent.mode === 'console') {
        res.json({
          success: true,
          message: '密码已重置（邮件未配置，临时密码仅在开发环境显示）',
          tempPassword,
          emailMode: 'development'
        });
      } else {
        res.json({
          success: true,
          message: '密码已重置，临时密码已发送到用户邮箱'
        });
      }
    }
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ success: false, message: '重置密码失败' });
  }
});

// PUT /users/:id - Update user
router.put('/:id', requireAdmin, requireAdminPermission('users.write'), async (req, res) => {
  try {
    const { id } = req.params;
    const { role, email_verified, username } = req.body;

    if (role && !USER_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: '无效的角色' });
    }

    const [currentRows] = await pool.execute('SELECT role FROM users WHERE id = ?', [id]);
    const currentRole = currentRows[0]?.role;

    if (!currentRows[0]) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    if (role && (isAdminRole(role) || isAdminRole(currentRole)) && !isSuperAdmin(req)) {
      return res.status(403).json({ success: false, message: '只有超级管理员可以调整管理员角色' });
    }

    // Guard against demoting the last super admin (or yourself) out of the
    // super-admin role, which would lock the system out of super access.
    const demotingAdmin = role && isAdminRole(currentRole) && !isAdminRole(role);
    const demotingSuperAdmin = role && ['super_admin', 'admin'].includes(currentRole) && !['super_admin', 'admin'].includes(role);
    if (demotingAdmin || demotingSuperAdmin) {
      if (parseInt(id) === req.adminUser.id) {
        return res.status(400).json({ success: false, message: '不能降级自己的管理员角色' });
      }
      if (demotingSuperAdmin) {
        const [cnt] = await pool.execute("SELECT COUNT(*) AS n FROM users WHERE role IN ('super_admin', 'admin')");
        if (cnt[0].n <= 1) {
          return res.status(403).json({ success: false, message: '不能降级最后一个超级管理员' });
        }
      }
    }

    const updates = [];
    const params = [];

    if (role) {
      updates.push('role = ?');
      params.push(role);
    }

    if (email_verified !== undefined) {
      updates.push('email_verified = ?');
      params.push(email_verified ? 1 : 0);
    }

    if (username) {
      const usernameError = getUsernameValidationError(username);
      if (usernameError) {
        return res.status(400).json({ success: false, message: usernameError });
      }
      // Check uniqueness before update
      const [existingRows] = await pool.execute(
        'SELECT id FROM users WHERE username = ? AND id != ?',
        [username.trim(), id]
      );
      if (existingRows.length > 0) {
        return res.status(409).json({ success: false, message: '该用户名已被其他用户使用' });
      }
      updates.push('username = ?');
      params.push(username.trim());
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: '无更新内容' });
    }

    params.push(id);
    await pool.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    if (role && isAdminRole(currentRole) && !isAdminRole(role)) {
      await invalidateUserAdminSessions(parseInt(id));
    }

    await auditWriter.writeAdminAudit(
      req.adminUser.id, 'user.update', 'user', parseInt(id),
      { updated_fields: Object.keys(req.body).filter(key => ['role', 'email_verified', 'username'].includes(key)) }, getClientIp(req),
    );
    if (role) await auditWriter.writeAdminAudit(req.adminUser.id, 'user.role.update', 'user', parseInt(id), { from: currentRole, to: role }, getClientIp(req));
    if (email_verified !== undefined) await auditWriter.writeAdminAudit(req.adminUser.id, 'user.email_verification_status', 'user', parseInt(id), { email_verified: Boolean(email_verified) }, getClientIp(req));

    res.json({ success: true, message: '用户信息已更新' });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ success: false, message: '更新用户失败' });
  }
});

// DELETE /users/:id - Delete user (rate limited for security)
router.delete('/:id', requireAdmin, requireAdminPermission('users.delete'), userDeleteLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = parseInt(id);

    const guard = await checkTargetGuard(req, userId, { blockSelf: true, protectLastSuper: true });
    if (guard) return res.status(guard.status).json({ success: false, message: guard.message });

    // Revoke all sessions (user + admin) BEFORE deletion so Redis keys are cleaned up
    // while we still have the session data to find them
    await sessionManager.revokeAllUserSessions(userId);
    await sessionManager.revokeAdminSessionsForUser(userId);

    await transaction(async (conn) => {
      await conn.execute('DELETE FROM authorizations WHERE user_id = ?', [id]);
      await conn.execute('DELETE FROM refresh_tokens WHERE user_id = ?', [id]);
      await conn.execute('DELETE FROM login_logs WHERE user_id = ?', [id]);
      await conn.execute('DELETE FROM user_sessions WHERE user_id = ?', [id]);
      const [result] = await conn.execute('DELETE FROM users WHERE id = ?', [id]);

      if (result.affectedRows === 0) {
        throw new Error('USER_NOT_FOUND');
      }
    });

    await auditWriter.writeAdminAudit(
      req.adminUser.id, 'user.delete', 'user', parseInt(id),
      null, getClientIp(req),
    );

    res.json({ success: true, message: '用户已删除' });
  } catch (err) {
    if (err.message === 'USER_NOT_FOUND') {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    console.error('Delete user error:', err);
    res.status(500).json({ success: false, message: '删除用户失败' });
  }
});

// POST /users/:id/ban - Ban user
router.post('/:id/ban', requireAdmin, requireAdminPermission('users.ban'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, duration, expires_at } = req.body;
    if (typeof reason !== 'string' || !reason.trim()) return res.status(400).json({ success: false, message: '请填写封禁原因' });
    const banExpires = calcBanExpiry(duration, expires_at);

    const guard = await checkTargetGuard(req, parseInt(id), { blockSelf: true, protectLastSuper: true });
    if (guard) return res.status(guard.status).json({ success: false, message: guard.message });

    const [result] = await pool.execute(
      'UPDATE users SET ban_status = ?, ban_reason = ?, banned_by = ?, ban_expires_at = ? WHERE id = ?',
      ['banned', reason.trim().slice(0, 500), req.adminUser.id, banExpires, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: '用户不存在' });

    // Revoke all user sessions so the banned user is immediately logged out
    await sessionManager.revokeAllUserSessions(parseInt(id));
    await sessionManager.revokeAdminSessionsForUser(parseInt(id));
    const [oauthClients] = await pool.execute(
      'SELECT DISTINCT client_id FROM refresh_tokens WHERE user_id = ?',
      [id]
    );
    await Promise.all(oauthClients.map(({ client_id }) => tokenStore.revokeAccessTokensForUserClient(parseInt(id), client_id)));
    await pool.execute('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', [id]);

    await createNotification({
      user_id: parseInt(id), type: 'account_banned', title: '账号已被封禁',
      content: `原因：${reason.trim().slice(0, 500)}`,
      sendEmail: true,
    });
    await auditWriter.writeAdminAudit(req.adminUser.id, 'user.ban', 'user', parseInt(id), { reason: reason.trim().slice(0, 500), duration, expires_at }, getClientIp(req));
    res.json({ success: true, message: '用户已被封禁', ban_expires_at: banExpires });
  } catch (err) {
    if (err.code === 'INVALID_BAN_DURATION') return res.status(400).json({ success: false, message: err.message });
    console.error('Ban user error:', err);
    res.status(500).json({ success: false, message: '封禁失败' });
  }
});

// POST /users/:id/mute - Mute user
router.post('/:id/mute', requireAdmin, requireAdminPermission('users.ban'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, duration, expires_at } = req.body;
    if (typeof reason !== 'string' || !reason.trim()) return res.status(400).json({ success: false, message: '请填写禁言原因' });
    const banExpires = calcBanExpiry(duration, expires_at);

    const guard = await checkTargetGuard(req, parseInt(id), { blockSelf: true });
    if (guard) return res.status(guard.status).json({ success: false, message: guard.message });

    const [result] = await pool.execute(
      'UPDATE users SET ban_status = ?, ban_reason = ?, banned_by = ?, ban_expires_at = ? WHERE id = ?',
      ['muted', reason.trim().slice(0, 500), req.adminUser.id, banExpires, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: '用户不存在' });

    await auditWriter.writeAdminAudit(req.adminUser.id, 'user.mute', 'user', parseInt(id), { reason: reason.trim().slice(0, 500), duration, expires_at }, getClientIp(req));
    res.json({ success: true, message: '用户已被禁言', ban_expires_at: banExpires });
  } catch (err) {
    if (err.code === 'INVALID_BAN_DURATION') return res.status(400).json({ success: false, message: err.message });
    console.error('Mute user error:', err);
    res.status(500).json({ success: false, message: '禁言失败' });
  }
});

// DELETE /users/:id/ban - Unban/unmute user
router.delete('/:id/ban', requireAdmin, requireAdminPermission('users.ban'), async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.execute(
      "UPDATE users SET ban_status = 'none', ban_reason = NULL, banned_by = NULL, ban_expires_at = NULL WHERE id = ?",
      [id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: '用户不存在' });

    await createNotification({
      user_id: parseInt(id), type: 'account_unbanned', title: '账号已解封',
      content: '您的账号已被解封', sendEmail: true,
    });
    await auditWriter.writeAdminAudit(req.adminUser.id, 'user.unban', 'user', parseInt(id), null, getClientIp(req));
    res.json({ success: true, message: '用户已解封' });
  } catch (err) {
    console.error('Unban user error:', err);
    res.status(500).json({ success: false, message: '解封失败' });
  }
});

// POST /users/:id/unlock - Unlock account (reset lock_level)
router.post('/:id/unlock', requireAdmin, requireAdminPermission('users.unlock'), async (req, res) => {
  try {
    const { id } = req.params;

    const guard = await checkTargetGuard(req, parseInt(id));
    if (guard) return res.status(guard.status).json({ success: false, message: guard.message });

    const [result] = await pool.execute(
      'UPDATE users SET lock_level = 0, locked_until = NULL WHERE id = ?',
      [id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: '用户不存在' });

    await auditWriter.writeAdminAudit(req.adminUser.id, 'user.unlock', 'user', parseInt(id), null, getClientIp(req));
    await auditWriter.writeUserAudit(
      parseInt(id), 'account_unlocked', getClientIp(req),
      { unlocked_by: req.adminUser.id },
    );
    res.json({ success: true, message: '账号已解锁' });
  } catch (err) {
    console.error('Unlock user error:', err);
    res.status(500).json({ success: false, message: '解锁失败' });
  }
});

module.exports = router;
