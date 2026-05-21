const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../db');
const { generateToken, generateShortToken } = require('../utils/token');
const { isValidEmail, isValidPassword, isValidUsername } = require('../utils/validation');
const requireAdmin = require('../middleware/requireAdmin');
const { createRateLimiter, resetRateLimit } = require('../middleware/rateLimit');

const ADMIN_SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const adminLoginRateLimiter = createRateLimiter({ maxAttempts: 3, windowMs: 15 * 60 * 1000 }); // 3 attempts per 15 min

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
      return res.status(400).json({ success: false, message: '密码至少6位' });
    }

    // Check if username/email already exists
    const existingUser = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
    if (existingUser) {
      return res.status(409).json({ success: false, message: '用户名或邮箱已存在' });
    }

    // Create admin account
    const passwordHash = await bcrypt.hash(password, 10);
    db.prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)').run(username, email, passwordHash, 'admin');

    res.status(201).json({ success: true, message: '管理员账号创建成功' });
  } catch (err) {
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
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(username, 'admin');

    if (!user) {
      return res.status(401).json({ success: false, message: '管理员账号不存在或密码错误' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ success: false, message: '管理员账号不存在或密码错误' });
    }

    // Reset rate limit on successful login
    const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    resetRateLimit(ip);

    // Create admin session
    const token = generateToken();
    const expiresAt = new Date(Date.now() + ADMIN_SESSION_MAX_AGE).toISOString();

    db.prepare('INSERT INTO admin_sessions (session_token, expires_at) VALUES (?, ?)').run(token, expiresAt);

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
router.post('/logout', (req, res) => {
  try {
    const token = req.cookies.admin_session;
    if (token) {
      db.prepare('DELETE FROM admin_sessions WHERE session_token = ?').run(token);
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
  try {
    // Get admin info from admin_sessions
    const token = req.cookies.admin_session;
    const session = db.prepare('SELECT * FROM admin_sessions WHERE session_token = ? AND expires_at > ?').get(token, new Date().toISOString());

    if (!session) {
      return res.status(401).json({ success: false, message: '会话已失效' });
    }

    // We don't have user_id in admin_sessions, so we need to track it
    // For now, return session info
    res.json({ success: true, admin: { session_valid: true } });
  } catch (err) {
    console.error('Get admin me error:', err);
    res.status(500).json({ success: false, message: '获取管理员信息失败' });
  }
});

// GET /clients - Get all clients
router.get('/clients', requireAdmin, (req, res) => {
  try {
    const clients = db.prepare('SELECT id, name, client_id, redirect_uri, created_at FROM clients').all();
    res.json({ success: true, clients });
  } catch (err) {
    console.error('Get clients error:', err);
    res.status(500).json({ success: false, message: '获取客户端列表失败' });
  }
});

// POST /clients - Create client
router.post('/clients', requireAdmin, (req, res) => {
  try {
    const { name, redirect_uri } = req.body;

    if (!name || !redirect_uri) {
      return res.status(400).json({ success: false, message: '名称和回调地址必填' });
    }

    const clientId = generateShortToken();
    const clientSecret = generateToken();

    db.prepare('INSERT INTO clients (name, client_id, client_secret, redirect_uri) VALUES (?, ?, ?, ?)').run(name, clientId, clientSecret, redirect_uri);
    res.status(201).json({ success: true, client_id: clientId, client_secret: clientSecret });
  } catch (err) {
    console.error('Create client error:', err);
    res.status(500).json({ success: false, message: '创建失败' });
  }
});

// DELETE /clients/:id - Delete client
router.delete('/clients/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM clients WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete client error:', err);
    res.status(500).json({ success: false, message: '删除失败' });
  }
});

// PUT /clients/:id - Update client
router.put('/clients/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { name, redirect_uri } = req.body;

    if (!name || !redirect_uri) {
      return res.status(400).json({ success: false, message: '名称和回调地址必填' });
    }

    db.prepare('UPDATE clients SET name = ?, redirect_uri = ? WHERE id = ?').run(name, redirect_uri, id);
    res.json({ success: true });
  } catch (err) {
    console.error('Update client error:', err);
    res.status(500).json({ success: false, message: '更新失败' });
  }
});

// GET /email-config - Get email configuration
router.get('/email-config', requireAdmin, (req, res) => {
  try {
    const config = db.prepare('SELECT host, port, user, "from", secure, updated_at FROM email_config WHERE id = 1').get();
    res.json({ success: true, config });
  } catch (err) {
    console.error('Get email config error:', err);
    res.status(500).json({ success: false, message: '获取邮件配置失败' });
  }
});

// PUT /email-config - Update email configuration
router.put('/email-config', requireAdmin, (req, res) => {
  try {
    const { host, port, user, password, from, secure } = req.body;

    if (!host || !port || !user || !from) {
      return res.status(400).json({ success: false, message: '主机、端口、用户名和发件人必填' });
    }

    db.prepare(`
      UPDATE email_config SET host = ?, port = ?, user = ?, password = ?, "from" = ?, secure = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run(host, port, user, password || '', from, secure ? 1 : 0);

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
    const result = await sendEmail(email, '测试邮件', `
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
router.get('/users', requireAdmin, (req, res) => {
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

    const users = db.prepare(query).all(...params);

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
    const total = db.prepare(totalQuery).get(...totalParams).count;

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
router.get('/users/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;

    const user = db.prepare('SELECT id, username, email, email_verified, role, created_at FROM users WHERE id = ?').get(id);

    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    // Get authorization records
    const authorizations = db.prepare(`
      SELECT a.client_id, c.name as client_name, a.last_used_at, a.created_at
      FROM authorizations a
      LEFT JOIN clients c ON a.client_id = c.id
      WHERE a.user_id = ?
      ORDER BY a.last_used_at DESC
    `).all(id);

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

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);

    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    // Generate temporary password
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashedPassword, id);

    // Invalidate all sessions for this user
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(id);

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
router.put('/users/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { role, email_verified, username } = req.body;

    // Prevent modifying own admin role (prevent self-lockout)
    // Note: We'd need user_id in admin_sessions to implement this properly

    if (role && !['user', 'moderator', 'admin'].includes(role)) {
      return res.status(400).json({ success: false, message: '无效的角色' });
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
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    res.json({ success: true, message: '用户信息已更新' });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ success: false, message: '更新用户失败' });
  }
});

// DELETE /users/:id - Delete user
router.delete('/users/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;

    // Delete user's related data first
    db.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM auth_codes WHERE user_id = ?').run(id);

    // Delete user
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    res.json({ success: true, message: '用户已删除' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ success: false, message: '删除用户失败' });
  }
});

// GET /stats - Dashboard statistics
router.get('/stats', requireAdmin, (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // User statistics
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const usersToday = db.prepare('SELECT COUNT(*) as count FROM users WHERE created_at >= ?').get(todayStart).count;
    const usersThisWeek = db.prepare('SELECT COUNT(*) as count FROM users WHERE created_at >= ?').get(weekStart).count;
    const usersThisMonth = db.prepare('SELECT COUNT(*) as count FROM users WHERE created_at >= ?').get(monthStart).count;
    const verifiedUsers = db.prepare('SELECT COUNT(*) as count FROM users WHERE email_verified = 1').get().count;

    // Login statistics
    const loginsToday = db.prepare('SELECT COUNT(*) as count FROM login_logs WHERE created_at >= ?').get(todayStart).count;
    const loginsThisWeek = db.prepare('SELECT COUNT(*) as count FROM login_logs WHERE created_at >= ?').get(weekStart).count;

    // Login type breakdown
    const webLogins = db.prepare('SELECT COUNT(*) as count FROM login_logs WHERE login_type = ?').get('web').count;
    const oauthLogins = db.prepare('SELECT COUNT(*) as count FROM login_logs WHERE login_type = ?').get('oauth').count;

    // Active users (logged in within last 7 days)
    const activeUsers = db.prepare(`
      SELECT COUNT(DISTINCT user_id) as count FROM login_logs WHERE created_at >= ?
    `).get(weekStart).count;

    // OAuth statistics
    const totalClients = db.prepare('SELECT COUNT(*) as count FROM clients').get().count;
    const totalAuthorizations = db.prepare('SELECT COUNT(*) as count FROM authorizations').get().count;

    // User growth trend (last 7 days, daily)
    const userGrowth = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dayStartISO = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate()).toISOString();
      const dayEndISO = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1).toISOString();
      const count = db.prepare('SELECT COUNT(*) as count FROM users WHERE created_at >= ? AND created_at < ?').get(dayStartISO, dayEndISO).count;
      userGrowth.push({
        date: dayStart.toISOString().split('T')[0],
        count
      });
    }

    // Login trend (last 7 days, daily)
    const loginTrend = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dayStartISO = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate()).toISOString();
      const dayEndISO = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1).toISOString();
      const count = db.prepare('SELECT COUNT(*) as count FROM login_logs WHERE created_at >= ? AND created_at < ?').get(dayStartISO, dayEndISO).count;
      loginTrend.push({
        date: dayStart.toISOString().split('T')[0],
        count
      });
    }

    res.json({
      success: true,
      stats: {
        users: {
          total: totalUsers,
          today: usersToday,
          week: usersThisWeek,
          month: usersThisMonth,
          verified: verifiedUsers,
          active: activeUsers
        },
        logins: {
          today: loginsToday,
          week: loginsThisWeek,
          web: webLogins,
          oauth: oauthLogins
        },
        oauth: {
          clients: totalClients,
          authorizations: totalAuthorizations
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
router.get('/authorizations', requireAdmin, (req, res) => {
  try {
    const { page, limit, user_id } = req.query;
    const offset = (parseInt(page) || 1 - 1) * (parseInt(limit) || 50);

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
    params.push(parseInt(limit) || 50, offset);

    const authorizations = db.prepare(query).all(...params);

    res.json({ success: true, authorizations });
  } catch (err) {
    console.error('Get authorizations error:', err);
    res.status(500).json({ success: false, message: '获取授权记录失败' });
  }
});

// DELETE /authorizations/:id - Revoke authorization
router.delete('/authorizations/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM authorizations WHERE id = ?').run(id);
    res.json({ success: true, message: '授权已撤销' });
  } catch (err) {
    console.error('Delete authorization error:', err);
    res.status(500).json({ success: false, message: '撤销授权失败' });
  }
});

// GET /login-logs - Get login history
router.get('/login-logs', requireAdmin, (req, res) => {
  try {
    const { page, limit, user_id, login_type } = req.query;
    const offset = (parseInt(page) || 1 - 1) * (parseInt(limit) || 100);

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
    params.push(parseInt(limit) || 100, offset);

    const logs = db.prepare(query).all(...params);

    res.json({ success: true, logs });
  } catch (err) {
    console.error('Get login logs error:', err);
    res.status(500).json({ success: false, message: '获取登录日志失败' });
  }
});

// GET /config - Get system configuration
router.get('/config', requireAdmin, (req, res) => {
  try {
    const configs = db.prepare('SELECT key, value, description FROM system_config').all();
    const emailConfig = db.prepare('SELECT host, port, user, "from", secure FROM email_config WHERE id = 1').get();

    res.json({ success: true, system: configs, email: emailConfig || {} });
  } catch (err) {
    console.error('Get config error:', err);
    res.status(500).json({ success: false, message: '获取配置失败' });
  }
});

// PUT /config/:key - Update system configuration
router.put('/config/:key', requireAdmin, (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    db.prepare('UPDATE system_config SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?').run(value, key);

    res.json({ success: true, message: '配置已更新' });
  } catch (err) {
    console.error('Update config error:', err);
    res.status(500).json({ success: false, message: '更新配置失败' });
  }
});

module.exports = router;