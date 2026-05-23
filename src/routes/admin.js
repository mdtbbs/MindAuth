const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { pool, transaction, isDuplicateError, getDuplicateField } = require('../db');
const { client } = require('../redis');
const { generateToken, generateShortToken } = require('../utils/token');
const { formatMySQLDateTime } = require('../utils/datetime');
const { isValidEmail, isValidPassword, isValidUsername, getPasswordValidationError } = require('../utils/validation');
const { getClientIp } = require('../utils/request');
const { requireAdmin, createAdminSession, deleteAdminSession, invalidateUserAdminSessions } = require('../middleware/requireAdmin');
const { createRateLimiter, resetRateLimit } = require('../middleware/rateLimit');

const ADMIN_SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const adminLoginRateLimiter = createRateLimiter({ maxAttempts: 3, windowMs: 15 * 60 * 1000, keyPrefix: 'admin' }); // 3 attempts per 15 min

// Timing-safe string comparison
function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// POST /create - Create admin account (requires ADMIN_SECRET)
router.post('/create', async (req, res) => {
  try {
    const { secret, username, email, password } = req.body;

    // Verify ADMIN_SECRET (timing-safe)
    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret) {
      return res.status(500).json({ success: false, message: '管理员创建功能未配置' });
    }

    if (!timingSafeCompare(secret, adminSecret)) {
      return res.status(401).json({ success: false, message: '创建密钥错误' });
    }

    // Validate input
    if (!username || !email || !password) {
      return res.status(400).json({ success: false, message: '用户名、邮箱和密码必填' });
    }

    if (!isValidUsername(username)) {
      return res.status(400).json({ success: false, message: '用户名需2-50字符' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: '邮箱格式不正确' });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({ success: false, message: getPasswordValidationError(password) || '密码不符合要求' });
    }

    // Check if username/email already exists
    const [existingRows] = await pool.execute('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
    if (existingRows.length > 0) {
      return res.status(409).json({ success: false, message: '用户名或邮箱已存在' });
    }

    // Create admin account
    const passwordHash = await bcrypt.hash(password, 10);
    await pool.execute('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)', [username, email, passwordHash, 'admin']);

    res.status(201).json({ success: true, message: '管理员账号创建成功' });
  } catch (err) {
    if (isDuplicateError(err)) {
      return res.status(409).json({ success: false, message: '用户名或邮箱已存在' });
    }
    console.error('Admin create error:', err);
    res.status(500).json({ success: false, message: '创建管理员失败' });
  }
});

// POST /login - Admin login (with username/password)
router.post('/login', adminLoginRateLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: '用户名和密码必填' });
    }

    // Find admin user
    const [userRows] = await pool.execute('SELECT * FROM users WHERE username = ? AND role = ?', [username, 'admin']);
    const user = userRows[0];

    if (!user) {
      return res.status(401).json({ success: false, message: '管理员账号不存在或密码错误' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ success: false, message: '管理员账号不存在或密码错误' });
    }

    // Reset rate limit on successful login
    await resetRateLimit(getClientIp(req), 'admin');

    // Create admin session in Redis
    const token = generateToken();
    await createAdminSession(token, user.id);

    res.cookie('admin_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: ADMIN_SESSION_MAX_AGE,
      sameSite: 'Strict',
      path: '/'
    });

    res.json({ success: true, user: { id: user.id, username: user.username, email: user.email } });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ success: false, message: '登录失败' });
  }
});

// POST /logout - Admin logout
router.post('/logout', async (req, res) => {
  try {
    const token = req.cookies.admin_session;
    if (token) {
      await deleteAdminSession(token);
    }
    res.clearCookie('admin_session', { path: '/' });
    res.json({ success: true });
  } catch (err) {
    console.error('Admin logout error:', err);
    res.status(500).json({ success: false, message: '登出失败' });
  }
});

// GET /me - Get current admin info
router.get('/me', requireAdmin, (req, res) => {
  res.json({ success: true, admin: { session_valid: true } });
});

// GET /clients - Get all clients
router.get('/clients', requireAdmin, async (req, res) => {
  try {
    const [clients] = await pool.execute('SELECT id, name, client_id, redirect_uri, created_at FROM clients');
    res.json({ success: true, clients });
  } catch (err) {
    console.error('Get clients error:', err);
    res.status(500).json({ success: false, message: '获取客户端列表失败' });
  }
});

// POST /clients - Create client
router.post('/clients', requireAdmin, async (req, res) => {
  try {
    const { name, redirect_uri } = req.body;

    if (!name || !redirect_uri) {
      return res.status(400).json({ success: false, message: '名称和回调地址必填' });
    }

    const clientId = generateShortToken();
    const clientSecret = generateToken();

    await pool.execute('INSERT INTO clients (name, client_id, client_secret, redirect_uri) VALUES (?, ?, ?, ?)', [name, clientId, clientSecret, redirect_uri]);
    res.status(201).json({ success: true, client_id: clientId, client_secret: clientSecret });
  } catch (err) {
    console.error('Create client error:', err);
    res.status(500).json({ success: false, message: '创建失败' });
  }
});

// DELETE /clients/:id - Delete client
router.delete('/clients/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.execute('DELETE FROM clients WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete client error:', err);
    res.status(500).json({ success: false, message: '删除失败' });
  }
});

// PUT /clients/:id - Update client
router.put('/clients/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, redirect_uri } = req.body;

    if (!name || !redirect_uri) {
      return res.status(400).json({ success: false, message: '名称和回调地址必填' });
    }

    await pool.execute('UPDATE clients SET name = ?, redirect_uri = ? WHERE id = ?', [name, redirect_uri, id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Update client error:', err);
    res.status(500).json({ success: false, message: '更新失败' });
  }
});

// GET /email-config - Get email configuration
router.get('/email-config', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT host, port, user, password, `from`, secure, updated_at FROM email_config WHERE id = 1');
    const config = rows[0];

    if (!config) {
      return res.json({ success: true, config: null });
    }

    res.json({
      success: true,
      config: {
        host: config.host,
        port: config.port,
        user: config.user,
        from: config.from,
        secure: config.secure,
        updated_at: config.updated_at,
        hasPassword: !!config.password  // 前端可显示"密码已设置"
        // password 不返回（安全）
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

    // 如果密码为空，保留原密码
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

    const { sendEmail } = require('../utils/email');
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

// GET /users - Get all users
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const { search, role, page, limit } = req.query;

    let query = 'SELECT id, username, email, email_verified, role, created_at FROM users';
    let params = [];

    if (search) {
      query += ' WHERE username LIKE ? OR email LIKE ?';
      params = [`%${search}%`, `%${search}%`];
    }

    if (role) {
      if (params.length > 0) {
        query += ' AND role = ?';
      } else {
        query += ' WHERE role = ?';
      }
      params.push(role);
    }

    query += ' ORDER BY created_at DESC';

    // Pagination support
    if (page && limit) {
      const offset = (parseInt(page) - 1) * parseInt(limit);
      query += ' LIMIT ? OFFSET ?';
      params.push(parseInt(limit), offset);
    }

    const [users] = await pool.execute(query, params);

    // Get total count for pagination
    let totalQuery = 'SELECT COUNT(*) as count FROM users';
    let totalParams = [];
    if (search) {
      totalQuery += ' WHERE username LIKE ? OR email LIKE ?';
      totalParams = [`%${search}%`, `%${search}%`];
    }
    if (role) {
      if (totalParams.length > 0) {
        totalQuery += ' AND role = ?';
      } else {
        totalQuery += ' WHERE role = ?';
      }
      totalParams.push(role);
    }
    const [totalRows] = await pool.execute(totalQuery, totalParams);
    const total = totalRows[0].count;

    res.json({
      success: true,
      users,
      pagination: page && limit ? { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) } : undefined
    });
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ success: false, message: '获取用户列表失败' });
  }
});

// GET /users/:id - Get user details with authorizations
router.get('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const [userRows] = await pool.execute('SELECT id, username, email, email_verified, role, created_at FROM users WHERE id = ?', [id]);
    const user = userRows[0];

    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    // Get authorization records
    const [authorizations] = await pool.execute(`
      SELECT a.client_id, c.name as client_name, a.last_used_at, a.created_at
      FROM authorizations a
      LEFT JOIN clients c ON a.client_id = c.id
      WHERE a.user_id = ?
      ORDER BY a.last_used_at DESC
    `, [id]);

    res.json({ success: true, user, authorizations });
  } catch (err) {
    console.error('Get user details error:', err);
    res.status(500).json({ success: false, message: '获取用户详情失败' });
  }
});

// POST /users/:id/reset-password - Reset user password
router.post('/users/:id/reset-password', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const [userRows] = await pool.execute('SELECT * FROM users WHERE id = ?', [id]);
    const user = userRows[0];

    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    // Generate temporary password
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hashedPassword, id]);

    // Invalidate all sessions and refresh tokens for this user
    await pool.execute('UPDATE users SET session_token = NULL WHERE id = ?', [id]);
    await pool.execute('DELETE FROM refresh_tokens WHERE user_id = ?', [id]);

    res.json({
      success: true,
      message: '密码已重置，用户需使用临时密码重新登录',
      tempPassword
    });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ success: false, message: '重置密码失败' });
  }
});

// PUT /users/:id - Update user
router.put('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { role, email_verified, username } = req.body;

    if (role && !['user', 'moderator', 'admin'].includes(role)) {
      return res.status(400).json({ success: false, message: '无效的角色' });
    }

    // Get current user role before update
    const [currentRows] = await pool.execute('SELECT role FROM users WHERE id = ?', [id]);
    const currentRole = currentRows[0]?.role;

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
      if (!isValidUsername(username)) {
        return res.status(400).json({ success: false, message: '用户名需2-50字符' });
      }
      updates.push('username = ?');
      params.push(username.trim());
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: '无更新内容' });
    }

    params.push(id);
    await pool.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    // If role changed from admin to non-admin, invalidate admin sessions
    if (role && currentRole === 'admin' && role !== 'admin') {
      await invalidateUserAdminSessions(parseInt(id));
    }

    res.json({ success: true, message: '用户信息已更新' });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ success: false, message: '更新用户失败' });
  }
});

// DELETE /users/:id - Delete user (with transaction)
router.delete('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    await transaction(async (conn) => {
      // Delete user's related data first
      await conn.execute('DELETE FROM authorizations WHERE user_id = ?', [id]);
      await conn.execute('DELETE FROM refresh_tokens WHERE user_id = ?', [id]);
      await conn.execute('DELETE FROM login_logs WHERE user_id = ?', [id]);

      // Delete user
      const [result] = await conn.execute('DELETE FROM users WHERE id = ?', [id]);

      if (result.affectedRows === 0) {
        throw new Error('USER_NOT_FOUND');
      }
    });

    res.json({ success: true, message: '用户已删除' });
  } catch (err) {
    if (err.message === 'USER_NOT_FOUND') {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    console.error('Delete user error:', err);
    res.status(500).json({ success: false, message: '删除用户失败' });
  }
});

// GET /stats - Dashboard statistics (optimized)
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const todayStart = formatMySQLDateTime(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    const weekStart = formatMySQLDateTime(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
    const monthStart = formatMySQLDateTime(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
    const trendStart = formatMySQLDateTime(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));

    // Combined user statistics query (single query)
    const [userStats] = await pool.execute(`
      SELECT
        COUNT(*) as total,
        SUM(created_at >= ?) as today,
        SUM(created_at >= ?) as week,
        SUM(created_at >= ?) as month,
        SUM(email_verified = 1) as verified
      FROM users
    `, [todayStart, weekStart, monthStart]);

    // Combined login statistics query (single query)
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

    // OAuth statistics (single query)
    const [oauthStats] = await pool.execute(`
      SELECT
        (SELECT COUNT(*) FROM clients) as clients,
        (SELECT COUNT(*) FROM authorizations) as authorizations
    `);

    // User growth trend - single GROUP BY query
    const [userGrowthRows] = await pool.execute(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as count
      FROM users
      WHERE created_at >= ?
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [trendStart]);

    // Login trend - single GROUP BY query
    const [loginTrendRows] = await pool.execute(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as count
      FROM login_logs
      WHERE created_at >= ?
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [trendStart]);

    // Fill in missing dates for trends (last 7 days)
    const userGrowth = [];
    const loginTrend = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];

      const userCount = userGrowthRows.find(r => r.date.toISOString().split('T')[0] === dateStr)?.count || 0;
      const loginCount = loginTrendRows.find(r => r.date.toISOString().split('T')[0] === dateStr)?.count || 0;

      userGrowth.push({ date: dateStr, count: userCount });
      loginTrend.push({ date: dateStr, count: loginCount });
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
        oauth: {
          clients: oauthStats[0].clients,
          authorizations: oauthStats[0].authorizations
        },
        trends: {
          userGrowth,
          loginTrend
        }
      }
    });
  } catch (err) {
    console.error('Get stats error:', err);
    res.status(500).json({ success: false, message: '获取统计数据失败' });
  }
});

// GET /authorizations - Get all authorization records
router.get('/authorizations', requireAdmin, async (req, res) => {
  try {
    const { page, limit, user_id } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 50;
    const offset = (pageNum - 1) * limitNum;

    let query = `
      SELECT a.id, a.user_id, u.username, a.client_id, c.name as client_name, a.last_used_at, a.created_at
      FROM authorizations a
      JOIN users u ON a.user_id = u.id
      JOIN clients c ON a.client_id = c.id
    `;
    let params = [];

    if (user_id) {
      query += ' WHERE a.user_id = ?';
      params.push(parseInt(user_id));
    }

    query += ' ORDER BY a.last_used_at DESC LIMIT ? OFFSET ?';
    params.push(limitNum, offset);

    const [authorizations] = await pool.execute(query, params);

    res.json({ success: true, authorizations });
  } catch (err) {
    console.error('Get authorizations error:', err);
    res.status(500).json({ success: false, message: '获取授权记录失败' });
  }
});

// DELETE /authorizations/:id - Revoke authorization
router.delete('/authorizations/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.execute('DELETE FROM authorizations WHERE id = ?', [id]);
    res.json({ success: true, message: '授权已撤销' });
  } catch (err) {
    console.error('Delete authorization error:', err);
    res.status(500).json({ success: false, message: '撤销授权失败' });
  }
});

// GET /login-logs - Get login history
router.get('/login-logs', requireAdmin, async (req, res) => {
  try {
    const { page, limit, user_id, login_type } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 100;
    const offset = (pageNum - 1) * limitNum;

    let query = `
      SELECT l.id, l.user_id, u.username, l.ip, l.device, l.login_type, l.created_at
      FROM login_logs l
      JOIN users u ON l.user_id = u.id
    `;
    let params = [];

    const conditions = [];
    if (user_id) {
      conditions.push('l.user_id = ?');
      params.push(parseInt(user_id));
    }
    if (login_type) {
      conditions.push('l.login_type = ?');
      params.push(login_type);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY l.created_at DESC LIMIT ? OFFSET ?';
    params.push(limitNum, offset);

    const [logs] = await pool.execute(query, params);

    res.json({ success: true, logs });
  } catch (err) {
    console.error('Get login logs error:', err);
    res.status(500).json({ success: false, message: '获取登录日志失败' });
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