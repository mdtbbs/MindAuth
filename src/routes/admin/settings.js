const express = require('express');
const router = express.Router();
const { pool } = require('../../db');
const { formatMySQLDateTime } = require('../../utils/datetime');
const { requireAdmin } = require('../../middleware/requireAdmin');
const config = require('../../config');

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
router.get('/email-config', requireAdmin, async (req, res) => {
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
router.put('/email-config', requireAdmin, async (req, res) => {
  try {
    const { host, port, user, password, from, secure } = req.body;

    if (!host || !port || !user || !from) {
      return res.status(400).json({ success: false, message: '主机、端口、用户名和发件人必填' });
    }

    let finalPassword = password;
    if (!password) {
      const [rows] = await pool.execute('SELECT password FROM email_config WHERE id = 1');
      finalPassword = rows[0]?.password || '';
    }

    await pool.execute(`
      UPDATE email_config SET host = ?, port = ?, user = ?, password = ?, \`from\` = ?, secure = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `, [host, port, user, finalPassword, from, secure ? 1 : 0]);

    res.json({ success: true, message: '配置已保存' });
  } catch (err) {
    console.error('Update email config error:', err);
    res.status(500).json({ success: false, message: '保存邮件配置失败' });
  }
});

// POST /test-email - Send test email
router.post('/test-email', requireAdmin, async (req, res) => {
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
    res.status(500).json({ success: false, message: '发送失败: ' + err.message });
  }
});

// GET /config - Get system configuration
router.get('/config', requireAdmin, async (req, res) => {
  try {
    const [configs] = await pool.execute('SELECT key, value, description FROM system_config');
    const [emailRows] = await pool.execute('SELECT host, port, user, `from`, secure FROM email_config WHERE id = 1');
    const emailConfig = emailRows[0] || {};

    res.json({ success: true, system: configs, email: emailConfig });
  } catch (err) {
    console.error('Get config error:', err);
    res.status(500).json({ success: false, message: '获取配置失败' });
  }
});

// PUT /config/:key - Update system configuration
router.put('/config/:key', requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    await pool.execute('UPDATE system_config SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?', [value, key]);

    res.json({ success: true, message: '配置已更新' });
  } catch (err) {
    console.error('Update config error:', err);
    res.status(500).json({ success: false, message: '更新配置失败' });
  }
});

module.exports = router;