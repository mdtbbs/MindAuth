const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { pool, transaction } = require('../db');
const { client } = require('../redis');
const { isValidPassword, isValidEmail, getPasswordValidationError, getUsernameValidationError } = require('../utils/validation');
const { generateToken, hashToken } = require('../utils/token');
const { sendVerificationEmail } = require('../utils/email');
const requireAuth = require('../middleware/requireAuth');
const { avatarUpload, bannerUpload } = require('../middleware/upload');
const notificationCenter = require('../modules/notifications/notificationCenter');
const { getClientIp } = require('../utils/request');
const { getUserAuditLogs, logUserAudit } = require('../utils/userAudit');
const sessionManager = require('../modules/sessions/sessionManager');

const BASE_URL = process.env.BASE_URL || 'http://localhost:4001';
const TOKEN_TTL = 3600; // 1 hour in seconds (Redis TTL)

const { safePublicPath, tryRemovePublicFile } = require('../utils/publicFiles');

// POST /change-password - Change password
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { old_password, new_password } = req.body;
    const user = req.user;

    if (!old_password || !new_password) {
      return res.status(400).json({ success: false, message: '旧密码和新密码必填' });
    }

    if (!isValidPassword(new_password)) {
      return res.status(400).json({ success: false, message: getPasswordValidationError(new_password) || '密码不符合要求' });
    }

    // Fetch password_hash separately (not included in req.user for security)
    const [userRows] = await pool.execute(
      'SELECT password_hash FROM users WHERE id = ?',
      [user.id]
    );
    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    const passwordHash = userRows[0].password_hash;

    // Verify old password
    const validPassword = await bcrypt.compare(old_password, passwordHash);
    if (!validPassword) {
      return res.status(401).json({ success: false, message: '旧密码错误' });
    }

    // Update password and revoke all sessions
    const newPasswordHash = await bcrypt.hash(new_password, 12);

    await transaction(async (conn) => {
      await conn.execute('UPDATE users SET password_hash = ? WHERE id = ?', [newPasswordHash, user.id]);
      // Note: user_sessions deleted via sessionManager below (outside transaction)
    });

    // Revoke all sessions — user AND admin — so a password change fully logs
    // the account out everywhere (an admin's admin_session must not survive)
    await sessionManager.revokeAllUserSessions(user.id);
    await sessionManager.revokeAdminSessionsForUser(user.id);

    // Password change notification
    await notificationCenter.create({
      user_id: user.id, type: 'password_changed', title: '密码已修改',
      content: '您的登录密码已被修改，请重新登录。',
      ip_address: getClientIp(req), user_agent: req.headers['user-agent'],
      sendEmail: true,
    }).catch(err => console.warn('[Account] password notification failed:', err.message));

    res.clearCookie('session', { path: '/' });

    logUserAudit({
      user_id: user.id,
      action: 'password_changed',
      ip_address: getClientIp(req),
      user_agent: req.headers['user-agent'],
    });

    res.json({ success: true, message: '密码已更新，请重新登录' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ success: false, message: '修改密码失败' });
  }
});

// POST /change-username - Change username
router.post('/change-username', requireAuth, async (req, res) => {
  try {
    const { new_username } = req.body;
    const user = req.user;

    // Validate format
    const validationError = getUsernameValidationError(new_username);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const trimmedUsername = new_username.trim();

    // Check rate limit (30 days) — query directly from DB since session cache
    // does not include username_changed_at
    const USERNAME_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
    const [tsRows] = await pool.execute(
      'SELECT username_changed_at FROM users WHERE id = ?',
      [user.id]
    );
    const lastChangedAt = tsRows[0]?.username_changed_at;
    if (lastChangedAt) {
      const lastChanged = new Date(lastChangedAt).getTime();
      const elapsed = Date.now() - lastChanged;
      if (elapsed < USERNAME_CHANGE_COOLDOWN_MS) {
        const daysLeft = Math.ceil((USERNAME_CHANGE_COOLDOWN_MS - elapsed) / (24 * 60 * 60 * 1000));
        return res.status(429).json({
          success: false,
          message: `用户名更改太频繁，请 ${daysLeft} 天后再试`,
        });
      }
    }

    // Check uniqueness
    const [existingRows] = await pool.execute(
      'SELECT id FROM users WHERE username = ? AND id != ?',
      [trimmedUsername, user.id]
    );
    if (existingRows.length > 0) {
      return res.status(409).json({ success: false, message: '该用户名已被其他用户使用' });
    }

    const oldUsername = user.username;

    await transaction(async (conn) => {
      await conn.execute(
        'UPDATE users SET username = ?, username_changed_at = NOW() WHERE id = ?',
        [trimmedUsername, user.id]
      );
    });

    // Revoke all sessions (like change-password)
    await sessionManager.revokeAllUserSessions(user.id);
    await sessionManager.revokeAdminSessionsForUser(user.id);

    // Notification
    await notificationCenter.create({
      user_id: user.id,
      type: 'username_changed',
      title: '用户名已修改',
      content: `您的用户名已从 "${oldUsername}" 更改为 "${trimmedUsername}"，请重新登录。`,
      ip_address: getClientIp(req),
      user_agent: req.headers['user-agent'],
      sendEmail: true,
    }).catch(err => console.warn('[Account] username notification failed:', err.message));

    res.clearCookie('session', { path: '/' });

    logUserAudit({
      user_id: user.id,
      action: 'username_changed',
      ip_address: getClientIp(req),
      user_agent: req.headers['user-agent'],
      details: { old_username: oldUsername, new_username: trimmedUsername },
    });

    res.json({ success: true, message: '用户名已更新，请重新登录' });
  } catch (err) {
    console.error('Change username error:', err);
    res.status(500).json({ success: false, message: '修改用户名失败' });
  }
});

// POST /change-email - Request email change
router.post('/change-email', requireAuth, async (req, res) => {
  try {
    const { new_email } = req.body;
    const user = req.user;

    if (!new_email || !isValidEmail(new_email)) {
      return res.status(400).json({ success: false, message: '请输入有效的邮箱地址' });
    }

    // Check if email already used by another user
    const [existingRows] = await pool.execute('SELECT id FROM users WHERE email = ? AND id != ?', [new_email, user.id]);
    if (existingRows.length > 0) {
      return res.status(409).json({ success: false, message: '该邮箱已被其他用户使用' });
    }

    // Generate verification token — store only its hash server-side; the raw
    // token goes into the emailed link (verify endpoint looks up by hash)
    const token = generateToken();
    const tokenHash = hashToken(token);

    // Store verification token hash in Redis (replaces any existing) and MySQL (fallback)
    await client.setEx(`verify:${tokenHash}`, TOKEN_TTL, JSON.stringify({
      user_id: user.id,
      email: new_email
    }));
    try {
      const expiresAt = new Date(Date.now() + TOKEN_TTL * 1000).toISOString().slice(0, 19).replace('T', ' ');
      await pool.execute(
        'INSERT INTO email_verification_tokens (token, user_id, email, expires_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), email = VALUES(email), expires_at = VALUES(expires_at)',
        [tokenHash, user.id, new_email, expiresAt]
      );
    } catch (persistErr) {
      console.warn('[Account] MySQL token persist failed:', persistErr.message);
    }

    logUserAudit({
      user_id: user.id,
      action: 'email_change_requested',
      ip_address: getClientIp(req),
      user_agent: req.headers['user-agent'],
      details: { new_email },
    });

    // Send verification email to new address
    const verifyLink = `${BASE_URL}/#/verify-email?token=${token}`;
    await sendVerificationEmail(new_email, verifyLink);

    res.json({ success: true, message: '验证邮件已发送到新邮箱，请点击链接完成更换' });
  } catch (err) {
    console.error('Change email error:', err);
    res.status(500).json({ success: false, message: '更换邮箱失败' });
  }
});

// DELETE / - Delete account
router.delete('/', requireAuth, async (req, res) => {
  try {
    const { password } = req.body;
    const user = req.user;

    if (!password) {
      return res.status(400).json({ success: false, message: '请输入密码确认删除' });
    }

    // Fetch password_hash separately (not included in req.user for security)
    const [userRows] = await pool.execute(
      'SELECT password_hash FROM users WHERE id = ?',
      [user.id]
    );
    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    const passwordHash = userRows[0].password_hash;

    // Verify password
    const validPassword = await bcrypt.compare(password, passwordHash);
    if (!validPassword) {
      return res.status(401).json({ success: false, message: '密码错误' });
    }

    // Revoke all user sessions BEFORE deleting MySQL rows (so sessionManager can find them for Redis cleanup)
    await sessionManager.revokeAllUserSessions(user.id);
    await sessionManager.revokeAdminSessionsForUser(user.id);

    // Delete user and all related data atomically
    await transaction(async (conn) => {
      await conn.execute('DELETE FROM authorizations WHERE user_id = ?', [user.id]);
      await conn.execute('DELETE FROM refresh_tokens WHERE user_id = ?', [user.id]);
      await conn.execute('DELETE FROM login_logs WHERE user_id = ?', [user.id]);
      await conn.execute('DELETE FROM user_notifications WHERE user_id = ?', [user.id]);
      await conn.execute('DELETE FROM user_field_values WHERE user_id = ?', [user.id]);
      const [result] = await conn.execute('DELETE FROM users WHERE id = ?', [user.id]);
      if (result.affectedRows === 0) {
        throw new Error('USER_NOT_FOUND');
      }
    });

    logUserAudit({
      user_id: user.id,
      action: 'account_deleted',
      ip_address: getClientIp(req),
      user_agent: req.headers['user-agent'],
    });

    res.clearCookie('session', { path: '/' });
    res.json({ success: true, message: '账号已删除' });
  } catch (err) {
    if (err.message === 'USER_NOT_FOUND') {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    console.error('Delete account error:', err);
    res.status(500).json({ success: false, message: '删除账号失败' });
  }
});

// POST /avatar - Upload avatar
router.post('/avatar', requireAuth, avatarUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请选择图片文件' });
    }

    const user = req.user;
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    // 删除旧头像文件（如果存在），并校验路径防止穿越
    const [oldRows] = await pool.execute('SELECT avatar_url FROM users WHERE id = ?', [user.id]);
    if (oldRows.length > 0 && oldRows[0].avatar_url) {
      tryRemovePublicFile(oldRows[0].avatar_url);
    }

    // 更新数据库
    await pool.execute('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, user.id]);

    // 会话缓存中存有完整用户资料，需失效以便 /api/me 返回最新头像
    await sessionManager.invalidateUserSessionCache(req.cookies.session);

    logUserAudit({
      user_id: user.id,
      action: 'avatar_changed',
      ip_address: getClientIp(req),
      user_agent: req.headers['user-agent'],
      details: { kind: 'avatar' },
    });

    res.json({ success: true, avatar_url: avatarUrl });
  } catch (err) {
    console.error('Avatar upload error:', err);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: '图片大小不能超过 2MB' });
    }
    res.status(500).json({ success: false, message: '上传头像失败' });
  }
});

// DELETE /avatar - Delete avatar
router.delete('/avatar', requireAuth, async (req, res) => {
  try {
    const user = req.user;

    // 获取旧头像路径，并校验路径防止穿越
    const [rows] = await pool.execute('SELECT avatar_url FROM users WHERE id = ?', [user.id]);
    if (rows.length > 0 && rows[0].avatar_url) {
      tryRemovePublicFile(rows[0].avatar_url);
    }

    // 更新数据库
    await pool.execute('UPDATE users SET avatar_url = NULL WHERE id = ?', [user.id]);

    // 会话缓存中存有完整用户资料，需失效以便 /api/me 返回最新头像
    await sessionManager.invalidateUserSessionCache(req.cookies.session);

    res.json({ success: true });
  } catch (err) {
    console.error('Avatar delete error:', err);
    res.status(500).json({ success: false, message: '删除头像失败' });
  }
});

// POST /banner - Upload banner
router.post('/banner', requireAuth, bannerUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请选择图片文件' });
    }

    const user = req.user;
    const bannerUrl = `/uploads/banners/${req.file.filename}`;

    // 删除旧背景文件（如果存在），并校验路径防止穿越
    const [oldRows] = await pool.execute('SELECT banner_url FROM users WHERE id = ?', [user.id]);
    if (oldRows.length > 0 && oldRows[0].banner_url) {
      tryRemovePublicFile(oldRows[0].banner_url);
    }

    // 更新数据库
    await pool.execute('UPDATE users SET banner_url = ? WHERE id = ?', [bannerUrl, user.id]);

    // 会话缓存中存有完整用户资料，需失效以便 /api/me 返回最新横幅
    await sessionManager.invalidateUserSessionCache(req.cookies.session);

    logUserAudit({
      user_id: user.id,
      action: 'avatar_changed',
      ip_address: getClientIp(req),
      user_agent: req.headers['user-agent'],
      details: { kind: 'banner' },
    });

    res.json({ success: true, banner_url: bannerUrl });
  } catch (err) {
    console.error('Banner upload error:', err);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: '图片大小不能超过 5MB' });
    }
    res.status(500).json({ success: false, message: '上传背景图失败' });
  }
});

// DELETE /banner - Delete banner
router.delete('/banner', requireAuth, async (req, res) => {
  try {
    const user = req.user;

    // 获取旧背景路径，并校验路径防止穿越
    const [rows] = await pool.execute('SELECT banner_url FROM users WHERE id = ?', [user.id]);
    if (rows.length > 0 && rows[0].banner_url) {
      tryRemovePublicFile(rows[0].banner_url);
    }

    // 更新数据库
    await pool.execute('UPDATE users SET banner_url = NULL WHERE id = ?', [user.id]);

    // 会话缓存中存有完整用户资料，需失效以便 /api/me 返回最新横幅
    await sessionManager.invalidateUserSessionCache(req.cookies.session);

    res.json({ success: true });
  } catch (err) {
    console.error('Banner delete error:', err);
    res.status(500).json({ success: false, message: '删除背景图失败' });
  }
});

// GET /fields - Get user's custom field values
router.get('/fields', requireAuth, async (req, res) => {
  try {
    const [fields] = await pool.execute(
      'SELECT id, field_key, field_label, field_type, is_required, options FROM user_fields ORDER BY sort_order ASC'
    );
    const [values] = await pool.execute(
      'SELECT field_id, value FROM user_field_values WHERE user_id = ?',
      [req.user.id]
    );
    const valueMap = {};
    for (const v of values) valueMap[v.field_id] = v.value;

    res.json({
      success: true,
      fields: fields.map((f) => ({
        field_key: f.field_key,
        field_label: f.field_label,
        field_type: f.field_type,
        is_required: f.is_required === 1,
        options: f.options ? (typeof f.options === 'string' ? JSON.parse(f.options) : f.options) : null,
        value: valueMap[f.id] || null,
      })),
    });
  } catch (err) {
    console.error('[Account] fields get error:', err);
    res.status(500).json({ success: false, message: '获取字段失败' });
  }
});

// PUT /fields - Update user's custom field values
router.put('/fields', requireAuth, async (req, res) => {
  try {
    const { values } = req.body;
    if (!values || typeof values !== 'object') {
      return res.status(400).json({ success: false, message: 'values 须为对象' });
    }

    const [fields] = await pool.execute('SELECT id, field_key, field_type FROM user_fields');
    const fieldMap = {};
    for (const f of fields) fieldMap[f.field_key] = f;

    for (const [key, value] of Object.entries(values)) {
      const field = fieldMap[key];
      if (!field) continue;

      if (value === null || value === '') {
        await pool.execute('DELETE FROM user_field_values WHERE user_id = ? AND field_id = ?', [req.user.id, field.id]);
      } else {
        await pool.execute(
          'INSERT INTO user_field_values (user_id, field_id, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = ?',
          [req.user.id, field.id, String(value), String(value)]
        );
      }
    }

    res.json({ success: true, message: '字段已更新' });
  } catch (err) {
    console.error('[Account] fields update error:', err);
    res.status(500).json({ success: false, message: '更新字段失败' });
  }
});

// GET /audit-logs - Get current user's security audit log
router.get('/audit-logs', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const logs = await getUserAuditLogs(req.user.id, limit);
    res.json({ success: true, logs });
  } catch (err) {
    console.error('[Account] audit-logs error:', err);
    res.status(500).json({ success: false, message: '获取安全日志失败' });
  }
});

// ===== 社交绑定 =====
const socialLogin = require('../modules/social/socialLogin');
const { logUserAudit: logAudit } = require('../utils/userAudit');

// GET /bindings - 列出当前用户的社交绑定
router.get('/bindings', requireAuth, async (req, res) => {
  try {
    const bindings = await socialLogin.listBindings(req.user.id);
    return res.json({ success: true, bindings });
  } catch (err) {
    console.error('[Account] list bindings failed:', err.message);
    return res.status(500).json({ success: false, message: '获取绑定失败' });
  }
});

// DELETE /bindings/:id - 解绑
router.delete('/bindings/:id', requireAuth, async (req, res) => {
  try {
    const bindingId = parseInt(req.params.id, 10);
    if (!bindingId || Number.isNaN(bindingId)) {
      return res.status(400).json({ success: false, code: 'INVALID_ID', message: '无效的绑定 ID' });
    }

    await socialLogin.unbindQq(bindingId, req.user.id);

    logAudit({
      user_id: req.user.id,
      action: 'social_unbind',
      ip_address: getClientIp(req),
      user_agent: req.headers['user-agent'] || '',
      details: { binding_id: bindingId },
    });

    return res.json({ success: true });
  } catch (err) {
    if (err.code === 'BINDING_NOT_FOUND') {
      return res.status(404).json({ success: false, code: 'BINDING_NOT_FOUND', message: '绑定不存在' });
    }
    if (err.code === 'CANNOT_UNBIND_LAST_LOGIN') {
      return res.status(400).json({ success: false, code: 'CANNOT_UNBIND_LAST_LOGIN', message: err.message });
    }
    console.error('[Account] unbind failed:', err.message);
    return res.status(500).json({ success: false, message: '解绑失败' });
  }
});

module.exports = router;
