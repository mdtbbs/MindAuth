const express = require('express');
const router = express.Router();
const { pool } = require('../../db');
const { formatMySQLDateTime } = require('../../utils/datetime');
const { requireAdmin, requireAdminPermission } = require('../../middleware/requireAdmin');
const { createRateLimiter } = require('../../middleware/rateLimit');
const { getClientIp } = require('../../utils/request');

// Test send endpoints hit external mail/SMS providers — limit to prevent
// abuse as a spam relay / SMS cost drain even by authenticated admins
const testEmailLimiter = createRateLimiter({ maxAttempts: 5, windowMs: 10 * 60 * 1000, keyPrefix: 'ratelimit:admin_test_email' });
const testSmsLimiter = createRateLimiter({ maxAttempts: 5, windowMs: 10 * 60 * 1000, keyPrefix: 'ratelimit:admin_test_sms' });
const config = require('../../config');
const runtimeConfig = require('../../modules/config/runtimeConfig');
const auditWriter = require('../../modules/audit/auditWriter');
const { backgroundUpload } = require('../../middleware/upload');
const { tryRemovePublicFile } = require('../../utils/publicFiles');
const { encryptSecret } = require('../../utils/secrets');
const { client } = require('../../redis');

router.get('/overview', requireAdmin, requireAdminPermission('dashboard.read'), async (req, res) => {
  try {
    try {
      const cached = await client.get('admin:overview:v1');
      if (cached) return res.json(JSON.parse(cached));
    } catch { /* dashboard remains available when Redis is unavailable */ }
    const [users] = await pool.execute(`
      SELECT COUNT(*) AS total_users,
        COALESCE(SUM(created_at >= CURDATE()), 0) AS today_registrations,
        COALESCE(SUM(email_verified = 0 AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) AS unverified_new_users
      FROM users
    `);
    const [sessions] = await pool.execute(`
      SELECT
        (SELECT COUNT(*) FROM user_sessions WHERE expires_at > NOW()) AS web_sessions,
        (SELECT COUNT(*) FROM native_client_sessions WHERE revoked_at IS NULL AND last_active_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS native_sessions
    `);
    const [logins] = await pool.execute('SELECT COUNT(*) AS total FROM login_logs WHERE created_at >= CURDATE()');
    const [loginFailures] = await pool.execute("SELECT COUNT(*) AS total FROM user_audit_logs WHERE action = 'login_failed' AND created_at >= CURDATE()");
    const [loginFailures24h] = await pool.execute("SELECT COUNT(*) AS total FROM user_audit_logs WHERE action = 'login_failed' AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)");
    const [lockedToday] = await pool.execute("SELECT COUNT(*) AS total FROM user_audit_logs WHERE action = 'account_locked' AND created_at >= CURDATE()");
    const [emailBlocks] = await pool.execute('SELECT COUNT(*) AS total FROM email_policy_events WHERE created_at >= CURDATE()');
    const [securityCounts] = await pool.execute(`
      SELECT
        (SELECT COUNT(*) FROM clients WHERE party_type = 'third_party' AND status = 'pending') AS pending_applications,
        (SELECT COUNT(*) FROM users WHERE ban_status = 'banned' AND (ban_expires_at IS NULL OR ban_expires_at > NOW())) AS banned_users,
        (SELECT COUNT(*) FROM users WHERE lock_level > 0 AND (locked_until IS NULL OR locked_until > NOW())) AS locked_users,
        (SELECT COUNT(*) FROM ip_bans WHERE expires_at IS NULL OR expires_at > NOW()) AS active_ip_rules,
        (SELECT COUNT(*) FROM email_policy_events WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS email_policy_hits_24h
    `);

    const [failuresByIp, recentLocks, recentEmailHits, recentSecurityActions, recentBans] = await Promise.all([
      pool.execute(`SELECT ip_address, COUNT(*) AS failure_count, MAX(created_at) AS last_failed_at
        FROM user_audit_logs WHERE action = 'login_failed' AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        GROUP BY ip_address ORDER BY failure_count DESC LIMIT 10`),
      pool.execute(`SELECT a.user_id, u.username, a.ip_address, a.details, a.created_at
        FROM user_audit_logs a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.action = 'account_locked' AND a.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        ORDER BY a.created_at DESC LIMIT 10`),
      pool.execute(`SELECT e.id, e.email_domain, e.purpose, e.ip_address, e.created_at, r.pattern, r.policy
        FROM email_policy_events e LEFT JOIN email_domain_rules r ON r.id = e.rule_id
        WHERE e.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) ORDER BY e.created_at DESC LIMIT 10`),
      pool.execute(`SELECT a.id, a.admin_id, a.action, a.target_type, a.target_id, a.details, a.ip_address, a.created_at
        FROM admin_audit_logs a WHERE a.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
          AND (a.action LIKE 'user.%ban%' OR a.action IN ('user.unlock','admin.session.revoke','admin.session.revoke_all',
            'admin.authorization.revoke_all','email_policy.mode','email_rule.create','email_rule.update','email_rule.delete',
            'client.approved','client.rejected','client.suspended','client.delete','client.update'))
        ORDER BY a.created_at DESC LIMIT 10`),
      pool.execute(`SELECT a.target_id AS user_id, u.username, a.admin_id, a.details, a.created_at
        FROM admin_audit_logs a LEFT JOIN users u ON u.id = a.target_id
        WHERE a.action = 'user.ban' AND a.target_type = 'user' AND a.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        ORDER BY a.created_at DESC LIMIT 10`),
    ]);

    const [registered] = await pool.execute(`SELECT id, username, created_at FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) ORDER BY created_at DESC LIMIT 8`);
    const [successfulLogins] = await pool.execute(`SELECT l.id, u.username, l.ip, l.login_type, l.created_at FROM login_logs l JOIN users u ON u.id = l.user_id WHERE l.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) ORDER BY l.created_at DESC LIMIT 8`);
    const [failedLogins] = await pool.execute(`SELECT a.id, u.username, a.ip_address, a.created_at FROM user_audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE a.action = 'login_failed' AND a.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) ORDER BY a.created_at DESC LIMIT 8`);
    const [newApplications] = await pool.execute(`SELECT id, name, owner_user_id, status, created_at FROM clients WHERE party_type = 'third_party' AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) ORDER BY created_at DESC LIMIT 8`);
    const [newAuthorizations] = await pool.execute(`SELECT a.id, u.username, c.name AS client_name, a.created_at FROM authorizations a JOIN users u ON u.id = a.user_id JOIN clients c ON c.client_id = a.client_id WHERE a.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) ORDER BY a.created_at DESC LIMIT 8`);

    const activities = [
      ...registered.map(row => ({ event_type: '用户注册', subject: row.username, created_at: row.created_at, detail: `用户 ID ${row.id}` })),
      ...successfulLogins.map(row => ({ event_type: '登录成功', subject: row.username, created_at: row.created_at, detail: `${row.login_type} · ${row.ip}` })),
      ...failedLogins.map(row => ({ event_type: '登录失败', subject: row.username || '未识别账号', created_at: row.created_at, detail: row.ip_address || '未知 IP' })),
      ...newApplications.map(row => ({ event_type: 'OAuth 应用申请', subject: row.name, created_at: row.created_at, detail: `用户 ID ${row.owner_user_id || '—'} · ${row.status}` })),
      ...newAuthorizations.map(row => ({ event_type: 'OAuth 授权', subject: row.username, created_at: row.created_at, detail: row.client_name })),
      ...recentLocks[0].map(row => ({ event_type: '账号锁定', subject: row.username || `用户 ID ${row.user_id}`, created_at: row.created_at, detail: row.ip_address || '未知 IP' })),
      ...recentEmailHits[0].map(row => ({ event_type: '邮箱策略拦截', subject: row.email_domain, created_at: row.created_at, detail: `${row.purpose} · ${row.ip_address || '未知 IP'}` })),
      ...recentSecurityActions[0].map(row => ({
        event_type: row.action === 'user.ban' ? '管理员封禁' : row.action === 'client.approved' ? 'OAuth 应用审核' : '管理员安全操作',
        subject: `${row.target_type || '资源'} ${row.target_id || ''}`.trim(), created_at: row.created_at,
        detail: `${row.action} · 管理员 ${row.admin_id}`,
      })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 30);

    const summary = users[0] || {};
    const flags = securityCounts[0] || {};
    const response = { success: true, overview: {
      metrics: {
        total_users: Number(summary.total_users || 0), today_registrations: Number(summary.today_registrations || 0),
        active_sessions: Number(sessions[0]?.web_sessions || 0) + Number(sessions[0]?.native_sessions || 0),
        today_logins: Number(logins[0]?.total || 0), today_login_failures: Number(loginFailures[0]?.total || 0),
        today_risk_interceptions: Number(emailBlocks[0]?.total || 0) + Number(lockedToday[0]?.total || 0),
      },
      needs_attention: {
        pending_applications: Number(flags.pending_applications || 0), unverified_new_users: Number(summary.unverified_new_users || 0),
        locked_accounts: Number(flags.locked_users || 0), banned_users: Number(flags.banned_users || 0),
        email_policy_hits_24h: Number(flags.email_policy_hits_24h || 0), high_failure_ips: failuresByIp[0].length,
        login_failures_24h: Number(loginFailures24h[0]?.total || 0),
        active_ip_rules: Number(flags.active_ip_rules || 0),
      },
      high_failure_ips: failuresByIp[0], recent_locks: recentLocks[0], recent_email_hits: recentEmailHits[0],
      recent_security_actions: recentSecurityActions[0], recent_activity: activities,
      recent_bans: recentBans[0],
    } };
    res.json(response);
    client.setEx('admin:overview:v1', 30, JSON.stringify(response)).catch(() => {});
  } catch (err) {
    console.error('[AdminOverview] Failed:', err.message);
    res.status(500).json({ success: false, message: '获取后台总览失败' });
  }
});

// GET /stats - Dashboard statistics
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const todayStart = formatMySQLDateTime(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    const weekStart = formatMySQLDateTime(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
    const monthStart = formatMySQLDateTime(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));

    const [userStats] = await pool.execute(`
      SELECT
        COUNT(*) as total,
        SUM(created_at >= ?) as today,
        SUM(created_at >= ?) as week,
        SUM(created_at >= ?) as month,
        SUM(email_verified = 1) as verified
      FROM users
    `, [todayStart, weekStart, monthStart]);

    const [loginStats] = await pool.execute(`
      SELECT
        COUNT(*) as total,
        SUM(created_at >= ?) as today,
        SUM(created_at >= ?) as week,
        SUM(login_type = 'web') as web,
        SUM(login_type = 'oauth') as oauth,
        COUNT(DISTINCT user_id) as active_users
      FROM login_logs
      WHERE created_at >= ?
    `, [todayStart, weekStart, weekStart]);

    const [oauthStats] = await pool.execute(`
      SELECT
        (SELECT COUNT(*) FROM clients) as clients,
        (SELECT COUNT(*) FROM authorizations) as authorizations
    `);

    const [userGrowthRows] = await pool.execute(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM users WHERE created_at >= ?
      GROUP BY DATE(created_at) ORDER BY date ASC
    `, [weekStart]);

    const [loginTrendRows] = await pool.execute(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM login_logs WHERE created_at >= ?
      GROUP BY DATE(created_at) ORDER BY date ASC
    `, [weekStart]);

    const userGrowth = [];
    const loginTrend = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      userGrowth.push({ date: dateStr, count: userGrowthRows.find(r => r.date.toISOString().split('T')[0] === dateStr)?.count || 0 });
      loginTrend.push({ date: dateStr, count: loginTrendRows.find(r => r.date.toISOString().split('T')[0] === dateStr)?.count || 0 });
    }

    res.json({
      success: true,
      stats: {
        users: {
          total: userStats[0].total,
          today: userStats[0].today || 0,
          week: userStats[0].week || 0,
          month: userStats[0].month || 0,
          verified: userStats[0].verified || 0,
          active: loginStats[0].active_users || 0
        },
        logins: {
          today: loginStats[0].today || 0,
          week: loginStats[0].week || 0,
          web: loginStats[0].web || 0,
          oauth: loginStats[0].oauth || 0
        },
        oauth: { clients: oauthStats[0].clients, authorizations: oauthStats[0].authorizations },
        trends: { userGrowth, loginTrend }
      }
    });
  } catch (err) {
    console.error('Get stats error:', err);
    res.status(500).json({ success: false, message: '获取统计数据失败' });
  }
});

// GET /email-config - Get email configuration
router.get('/email-config', requireAdmin, requireAdminPermission('email_config.read'), async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT host, port, user, password, `from`, secure, updated_at FROM email_config WHERE id = 1');
    const emailConfig = rows[0];

    if (!emailConfig) {
      return res.json({ success: true, config: null });
    }

    res.json({
      success: true,
      config: {
        host: emailConfig.host,
        port: emailConfig.port,
        user: emailConfig.user,
        from: emailConfig.from,
        secure: emailConfig.secure,
        updated_at: emailConfig.updated_at,
        hasPassword: !!emailConfig.password
      }
    });
  } catch (err) {
    console.error('Get email config error:', err);
    res.status(500).json({ success: false, message: '获取邮件配置失败' });
  }
});

// PUT /email-config - Update email configuration
router.put('/email-config', requireAdmin, requireAdminPermission('email_config.write'), async (req, res) => {
  try {
    const { host, port, user, password, from, secure } = req.body;

    if (!host || !port || !user || !from) {
      return res.status(400).json({ success: false, message: '主机、端口、用户名和发件人必填' });
    }

    let finalPassword = password ? encryptSecret(password) : '';
    if (!password) {
      const [rows] = await pool.execute('SELECT password FROM email_config WHERE id = 1');
      finalPassword = rows[0]?.password ? encryptSecret(rows[0].password) : '';
    }

    await pool.execute(`
      UPDATE email_config SET host = ?, port = ?, user = ?, password = ?, \`from\` = ?, secure = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `, [host, port, user, finalPassword, from, secure ? 1 : 0]);

    await auditWriter.writeAdminAudit(req.adminUser.id, 'config.email', 'config', null, null, getClientIp(req));
    runtimeConfig.invalidate();
    res.json({ success: true, message: '配置已保存' });
  } catch (err) {
    console.error('Update email config error:', err);
    res.status(500).json({ success: false, message: '保存邮件配置失败' });
  }
});

// POST /test-email - Send test email
router.post('/test-email', requireAdmin, requireAdminPermission('email_config.write'), testEmailLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: '邮箱地址必填' });
    }

    const { sendEmail } = require('../../utils/email');
    await sendEmail(email, '测试邮件', `
      <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #3b82f6;">测试邮件</h2>
        <p>这是一封测试邮件，用于验证您的SMTP配置是否正确。</p>
        <p style="color: #666; font-size: 12px;">发送时间: ${new Date().toISOString()}</p>
      </div>
    `);

    res.json({ success: true, message: '测试邮件已发送，请检查邮箱' });
  } catch (err) {
    console.error('Test email error:', err);
    res.status(500).json({ success: false, message: '测试邮件发送失败，请检查 SMTP 配置' });
  }
});

// GET /sms-config - Get Aliyun SMS configuration
router.get('/sms-config', requireAdmin, requireAdminPermission('sms_config.read'), async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT enabled, access_key_id, access_key_secret, sign_name, template_code, updated_at FROM sms_config WHERE id = 1'
    );
    const smsConfig = rows[0];

    if (!smsConfig) {
      return res.json({ success: true, config: null });
    }

    res.json({
      success: true,
      config: {
        enabled: smsConfig.enabled,
        access_key_id: smsConfig.access_key_id,
        sign_name: smsConfig.sign_name,
        template_code: smsConfig.template_code,
        updated_at: smsConfig.updated_at,
        has_access_key_secret: !!smsConfig.access_key_secret
      }
    });
  } catch (err) {
    console.error('Get SMS config error:', err);
    res.status(500).json({ success: false, message: '获取短信配置失败' });
  }
});

// PUT /sms-config - Update Aliyun SMS configuration
router.put('/sms-config', requireAdmin, requireAdminPermission('sms_config.write'), async (req, res) => {
  try {
    const { enabled, access_key_id, access_key_secret, sign_name, template_code } = req.body;

    if (enabled && (!access_key_id || !sign_name || !template_code)) {
      return res.status(400).json({ success: false, message: '启用短信时 AccessKey ID、短信签名和模板 Code 必填' });
    }

    let finalAccessKeySecret = access_key_secret ? encryptSecret(access_key_secret) : '';
    if (!access_key_secret) {
      const [rows] = await pool.execute('SELECT access_key_secret FROM sms_config WHERE id = 1');
      finalAccessKeySecret = rows[0]?.access_key_secret ? encryptSecret(rows[0].access_key_secret) : '';
    }

    if (enabled && !finalAccessKeySecret) {
      return res.status(400).json({ success: false, message: '启用短信时 AccessKey Secret 必填' });
    }

    await pool.execute(`
      UPDATE sms_config
      SET enabled = ?, access_key_id = ?, access_key_secret = ?, sign_name = ?, template_code = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `, [
      enabled ? 1 : 0,
      access_key_id || '',
      finalAccessKeySecret,
      sign_name || '',
      template_code || ''
    ]);

    await auditWriter.writeAdminAudit(req.adminUser.id, 'config.sms', 'config', null, null, getClientIp(req));
    runtimeConfig.invalidate();
    res.json({ success: true, message: '短信配置已保存' });
  } catch (err) {
    console.error('Update SMS config error:', err);
    res.status(500).json({ success: false, message: '保存短信配置失败' });
  }
});

// POST /test-sms - Send test SMS
router.post('/test-sms', requireAdmin, requireAdminPermission('sms_config.write'), testSmsLimiter, async (req, res) => {
  try {
    const phone = String(req.body?.phone || '').trim();

    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return res.status(400).json({ success: false, message: '请输入有效的 11 位中国大陆手机号' });
    }

    const { sendSmsCode } = require('../../utils/aliyunSms');
    const result = await sendSmsCode(phone);

    await auditWriter.writeAdminAudit(
      req.adminUser.id, 'config.sms.test', 'config', null,
      { phone_last4: phone.slice(-4), bizId: result.bizId || null },
      getClientIp(req)
    );

    res.json({ success: true, message: '测试短信已发送', bizId: result.bizId || null });
  } catch (err) {
    console.error('Test SMS error:', err);
    res.status(err.code === 'SMS_NOT_CONFIGURED' ? 503 : 500).json({
      success: false,
      code: err.code || 'SMS_TEST_FAILED',
      message: '测试短信发送失败：' + (err.message || '未知错误')
    });
  }
});

// GET /config - Get system configuration
router.get('/config', requireAdmin, requireAdminPermission('config.read'), async (req, res) => {
  try {
    const [configs] = await pool.execute('SELECT `key`, `value`, description FROM system_config');
    const [emailRows] = await pool.execute('SELECT host, port, user, `from`, secure FROM email_config WHERE id = 1');
    const emailConfig = emailRows[0] || {};

    res.json({ success: true, system: configs, email: emailConfig });
  } catch (err) {
    console.error('Get config error:', err);
    res.status(500).json({ success: false, message: '获取配置失败' });
  }
});

// POST /auth-background - Upload the auth page custom background image
router.post('/auth-background', requireAdmin, requireAdminPermission('config.write'), backgroundUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请选择要上传的图片' });
    }

    const backgroundUrl = `/uploads/backgrounds/${req.file.filename}`;

    // Remove the previous background file (if any) before switching
    const oldUrl = await runtimeConfig.get('auth_background_url');
    if (oldUrl) tryRemovePublicFile(oldUrl);

    await runtimeConfig.set('auth_background_url', backgroundUrl);

    await auditWriter.writeAdminAudit(req.adminUser.id, 'config.system', 'config', 0, { key: 'auth_background_url', value: backgroundUrl }, getClientIp(req));
    res.json({ success: true, background_url: backgroundUrl, message: '登录页背景已更新' });
  } catch (err) {
    console.error('Upload auth background error:', err);
    res.status(500).json({ success: false, message: '背景上传失败' });
  }
});

// DELETE /auth-background - Reset the auth page background to the default grid
router.delete('/auth-background', requireAdmin, requireAdminPermission('config.write'), async (req, res) => {
  try {
    const oldUrl = await runtimeConfig.get('auth_background_url');
    if (oldUrl) tryRemovePublicFile(oldUrl);

    await runtimeConfig.set('auth_background_url', '');

    await auditWriter.writeAdminAudit(req.adminUser.id, 'config.system', 'config', 0, { key: 'auth_background_url', value: '' }, getClientIp(req));
    res.json({ success: true, message: '已恢复默认背景' });
  } catch (err) {
    console.error('Reset auth background error:', err);
    res.status(500).json({ success: false, message: '恢复默认背景失败' });
  }
});

// PUT /config/:key - Update system configuration
router.put('/config/:key', requireAdmin, requireAdminPermission('config.write'), async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    await runtimeConfig.set(key, value);

    await auditWriter.writeAdminAudit(req.adminUser.id, 'config.system', 'config', 0, { key, value }, getClientIp(req));
    res.json({ success: true, message: '配置已更新' });
  } catch (err) {
    console.error('Update config error:', err);
    res.status(500).json({ success: false, message: '更新配置失败' });
  }
});

module.exports = router;
