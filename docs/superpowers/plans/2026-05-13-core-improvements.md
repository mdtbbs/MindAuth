# MindAuth 核心改进实施计划 (P0-P2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完善MindAuth用户认证系统的核心基础设施，包括数据库索引、过期数据清理、登录频率限制、密码重置功能、代码拆分和安全机制。

**Architecture:** 保持现有功能不变，渐进式改进。先添加索引和清理机制（无破坏性），再添加新功能（密码重置），最后拆分代码结构。所有改动向后兼容。

**Tech Stack:** Express.js, better-sqlite3, bcrypt, cookie-parser, dotenv

---

## File Structure

**新增文件:**
```
src/
├── db/
│   └── index.js              # 数据库连接、表结构、索引、清理
├── middleware/
│   ├── requireAuth.js        # 用户认证中间件
│   ├── requireAdmin.js       # 管理员认证中间件
│   └── rateLimit.js          # 登录频率限制
├── routes/
│   ├── auth.js               # 注册/登录/登出/me
│   ├── password.js           # 密码重置
│   ├── admin.js              # 管理员相关
│   └── oauth.js              # authorize/token/verify
├── utils/
│   ├── token.js              # token生成
│   ├── validation.js         # 校验函数
│   └── email.js              # 邮件发送（stub）
│   └── cleanup.js            # 过期数据清理
├── config.js                 # 配置读取
├── server.js                 # 入口（精简后）
public/
├── js/
│   └── common.js             # 前端公共函数
```

**修改文件:**
- `src/server.js` → 精简为入口文件
- `public/app.js` → 提取公共函数到common.js，添加密码重置页面
- `public/index.html` → 添加密码重置页面模板
- `package.json` → 可能添加nodemailer依赖（可选）

---

### Task 1: 数据库索引

**Files:**
- Modify: `src/server.js` (在表创建后添加索引)

- [ ] **Step 1: 在server.js中添加索引创建语句**

在现有db.exec创建表语句之后（约第63行），添加索引创建：

```javascript
// Create indexes for performance
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_session ON users(session_token)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_codes_lookup ON auth_codes(code, client_id, used)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_codes_expires ON auth_codes(expires_at)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_clients_credentials ON clients(client_id, client_secret)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_clients_client_id ON clients(client_id)`);
```

- [ ] **Step 2: 重启服务器验证索引生效**

运行: `npm start`
检查: 服务器正常启动，无报错

- [ ] **Step 3: 提交**

```bash
git add src/server.js
git commit -m "perf: add database indexes for better query performance"
```

---

### Task 2: 过期数据清理机制

**Files:**
- Create: `src/utils/cleanup.js`
- Modify: `src/server.js` (引入并启动清理)

- [ ] **Step 1: 创建清理模块 src/utils/cleanup.js**

```javascript
const db = require('../db');

function cleanupExpiredData() {
  const now = new Date().toISOString();
  
  try {
    // Clean expired auth_codes
    const authCodesResult = db.prepare('DELETE FROM auth_codes WHERE expires_at < ?').run(now);
    
    // Clean expired admin_sessions
    const adminSessionsResult = db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(now);
    
    console.log(`Cleanup completed: removed ${authCodesResult.changes} auth_codes, ${adminSessionsResult.changes} admin_sessions`);
  } catch (err) {
    console.error('Cleanup error:', err);
  }
}

function startCleanupScheduler(intervalMs = 3600 * 1000) {
  // Run immediately on start
  cleanupExpiredData();
  
  // Schedule periodic cleanup
  const intervalId = setInterval(cleanupExpiredData, intervalMs);
  
  return intervalId;
}

module.exports = { cleanupExpiredData, startCleanupScheduler };
```

- [ ] **Step 2: 修改server.js引入清理模块**

在server.js顶部添加引入（约第7行后）：

```javascript
const { startCleanupScheduler } = require('./utils/cleanup');
```

在server.listen之后（约第385行后）添加：

```javascript
// Start cleanup scheduler
const cleanupInterval = startCleanupScheduler();
```

修改graceful shutdown部分（约第388行）：

```javascript
// Graceful shutdown
process.on('SIGINT', () => {
  clearInterval(cleanupInterval);
  db.close();
  process.exit();
});
```

- [ ] **Step 3: 测试清理功能**

运行: `npm start`
检查: 控制台输出 "Cleanup completed: removed X auth_codes, Y admin_sessions"

- [ ] **Step 4: 提交**

```bash
git add src/utils/cleanup.js src/server.js
git commit -m "feat: add expired data cleanup scheduler"
```

---

### Task 3: 提取数据库模块

**Files:**
- Create: `src/db/index.js`
- Modify: `src/server.js` (移除数据库相关代码)

- [ ] **Step 1: 创建 src/db/index.js**

```javascript
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../../users.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    session_token TEXT DEFAULT NULL,
    email_verified INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    client_id TEXT UNIQUE NOT NULL,
    client_secret TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS auth_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    client_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_token TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Create indexes
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_session ON users(session_token)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_codes_lookup ON auth_codes(code, client_id, used)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_codes_expires ON auth_codes(expires_at)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_clients_credentials ON clients(client_id, client_secret)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_clients_client_id ON clients(client_id)`);

module.exports = db;
```

- [ ] **Step 2: 修改server.js使用db模块**

删除server.js中的数据库设置代码（第12-63行），改为：

```javascript
const db = require('./db');
```

- [ ] **Step 3: 测试数据库模块**

运行: `npm start`
检查: 服务器正常启动，所有功能正常

- [ ] **Step 4: 提交**

```bash
git add src/db/index.js src/server.js
git commit -m "refactor: extract database module to separate file"
```

---

### Task 4: 提取工具函数模块

**Files:**
- Create: `src/utils/token.js`
- Create: `src/utils/validation.js`

- [ ] **Step 1: 创建 src/utils/token.js**

```javascript
const crypto = require('crypto');

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateShortToken() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = { generateToken, generateShortToken };
```

- [ ] **Step 2: 创建 src/utils/validation.js**

```javascript
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPassword(password) {
  return password && password.length >= 6;
}

function isValidUsername(username) {
  return username && username.length >= 2 && username.length <= 50;
}

module.exports = { isValidEmail, isValidPassword, isValidUsername };
```

- [ ] **Step 3: 修改server.js使用工具模块**

删除server.js中的generateToken和isValidEmail函数（第70-78行），改为引入：

```javascript
const { generateToken, generateShortToken } = require('./utils/token');
const { isValidEmail, isValidPassword } = require('./utils/validation');
```

- [ ] **Step 4: 测试**

运行: `npm start`
测试注册登录功能是否正常

- [ ] **Step 5: 提交**

```bash
git add src/utils/token.js src/utils/validation.js src/server.js
git commit -m "refactor: extract utility functions to separate modules"
```

---

### Task 5: 提取认证中间件

**Files:**
- Create: `src/middleware/requireAuth.js`
- Create: `src/middleware/requireAdmin.js`

- [ ] **Step 1: 创建 src/middleware/requireAuth.js**

```javascript
const db = require('../db');

function requireAuth(req, res, next) {
  const token = req.cookies.session;
  if (!token) {
    return res.status(401).json({ success: false, message: '未登录' });
  }

  const user = db.prepare('SELECT id, username, email, email_verified FROM users WHERE session_token = ?').get(token);
  if (!user) {
    return res.status(401).json({ success: false, message: '会话已失效' });
  }

  req.user = user;
  next();
}

module.exports = requireAuth;
```

- [ ] **Step 2: 创建 src/middleware/requireAdmin.js**

```javascript
const db = require('../db');

function requireAdmin(req, res, next) {
  const token = req.cookies.admin_session;
  if (!token) {
    return res.status(401).json({ success: false, message: '未登录管理员' });
  }

  const session = db.prepare('SELECT * FROM admin_sessions WHERE session_token = ? AND expires_at > ?').get(token, new Date().toISOString());
  if (!session) {
    return res.status(401).json({ success: false, message: '管理员会话已失效' });
  }

  req.isAdmin = true;
  next();
}

module.exports = requireAdmin;
```

- [ ] **Step 3: 修改server.js使用中间件**

删除server.js中的requireAuth和requireAdmin函数（第80-94行和第185-199行），改为引入：

```javascript
const requireAuth = require('./middleware/requireAuth');
const requireAdmin = require('./middleware/requireAdmin');
```

- [ ] **Step 4: 测试**

运行: `npm start`
测试登录后访问/api/me，测试管理员功能

- [ ] **Step 5: 提交**

```bash
git add src/middleware/requireAuth.js src/middleware/requireAdmin.js src/server.js
git commit -m "refactor: extract auth middlewares to separate files"
```

---

### Task 6: 登录频率限制

**Files:**
- Create: `src/middleware/rateLimit.js`
- Modify: `src/server.js` (在登录接口应用)

- [ ] **Step 1: 创建 src/middleware/rateLimit.js**

```javascript
const loginAttempts = new Map();

function createRateLimiter(options = {}) {
  const maxAttempts = options.maxAttempts || 5;
  const windowMs = options.windowMs || 5 * 60 * 1000; // 5 minutes

  return function rateLimit(req, res, next) {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    const now = Date.now();
    const record = loginAttempts.get(ip);

    // Clean up old records periodically
    if (loginAttempts.size > 1000) {
      for (const [key, value] of loginAttempts.entries()) {
        if (now - value.firstAttempt > windowMs) {
          loginAttempts.delete(key);
        }
      }
    }

    if (!record) {
      loginAttempts.set(ip, { count: 1, firstAttempt: now });
      return next();
    }

    // Reset if window has passed
    if (now - record.firstAttempt >= windowMs) {
      loginAttempts.set(ip, { count: 1, firstAttempt: now });
      return next();
    }

    // Check if limit exceeded
    if (record.count >= maxAttempts) {
      const waitTime = Math.ceil((windowMs - (now - record.firstAttempt)) / 1000);
      return res.status(429).json({
        success: false,
        message: `尝试次数过多，请${waitTime}秒后重试`
      });
    }

    record.count++;
    return next();
  };
}

function resetRateLimit(ip) {
  loginAttempts.delete(ip);
}

module.exports = { createRateLimiter, resetRateLimit };
```

- [ ] **Step 2: 在server.js登录接口应用频率限制**

在登录接口开头（第134行附近）添加：

```javascript
const { createRateLimiter, resetRateLimit } = require('./middleware/rateLimit');
const loginRateLimiter = createRateLimiter({ maxAttempts: 5, windowMs: 5 * 60 * 1000 });
```

修改登录接口：

```javascript
// API: Login
app.post('/api/login', loginRateLimiter, async (req, res) => {
  const { username, password } = req.body;
  // ... existing validation ...

  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    if (!user) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }

    // Reset rate limit on successful login
    const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    resetRateLimit(ip);

    // ... rest of login logic ...
  }
});
```

- [ ] **Step 3: 测试频率限制**

运行: `npm start`
连续发送5次错误密码登录请求：
```bash
curl -X POST http://localhost:4001/api/login -H "Content-Type: application/json" -d '{"username":"test","password":"wrong"}'
```
第6次应返回429错误

- [ ] **Step 4: 提交**

```bash
git add src/middleware/rateLimit.js src/server.js
git commit -m "feat: add login rate limiting to prevent brute force"
```

---

### Task 7: 密码重置数据库表

**Files:**
- Modify: `src/db/index.js` (添加密码重置表)

- [ ] **Step 1: 在db/index.js添加密码重置token表**

在表创建部分添加：

```javascript
// Create password reset tokens table
db.exec(`
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Add index for reset tokens
db.exec(`CREATE INDEX IF NOT EXISTS idx_reset_tokens_token ON password_reset_tokens(token)`);
```

- [ ] **Step 2: 在cleanup.js添加清理逻辑**

修改 src/utils/cleanup.js，在cleanupExpiredData函数中添加：

```javascript
// Clean expired password reset tokens
const resetTokensResult = db.prepare('DELETE FROM password_reset_tokens WHERE expires_at < ?').run(now);
```

更新console.log：

```javascript
console.log(`Cleanup completed: removed ${authCodesResult.changes} auth_codes, ${adminSessionsResult.changes} admin_sessions, ${resetTokensResult.changes} reset_tokens`);
```

- [ ] **Step 3: 重启服务器验证表创建**

运行: `npm start`
检查: 无报错

- [ ] **Step 4: 提交**

```bash
git add src/db/index.js src/utils/cleanup.js
git commit -m "feat: add password_reset_tokens table and cleanup"
```

---

### Task 8: 邮件发送模块（Stub版本）

**Files:**
- Create: `src/utils/email.js`
- Modify: `package.json` (可选，添加nodemailer)

- [ ] **Step 1: 创建 src/utils/email.js (开发阶段stub)**

```javascript
/**
 * Email sending utility
 * In production, configure with actual SMTP settings
 * In development, logs emails to console
 */

const isDevelopment = process.env.NODE_ENV !== 'production';

async function sendPasswordResetEmail(email, resetLink) {
  if (isDevelopment) {
    // Development: log to console
    console.log('\n========== PASSWORD RESET EMAIL ==========');
    console.log(`To: ${email}`);
    console.log(`Reset Link: ${resetLink}`);
    console.log('==========================================\n');
    return { success: true };
  }

  // Production: would use nodemailer or external service
  // TODO: Configure SMTP when deploying
  throw new Error('Email service not configured for production');
}

async function sendVerificationEmail(email, verifyLink) {
  if (isDevelopment) {
    console.log('\n========== VERIFICATION EMAIL ==========');
    console.log(`To: ${email}`);
    console.log(`Verify Link: ${verifyLink}`);
    console.log('========================================\n');
    return { success: true };
  }

  throw new Error('Email service not configured for production');
}

module.exports = { sendPasswordResetEmail, sendVerificationEmail };
```

- [ ] **Step 2: 提交**

```bash
git add src/utils/email.js
git commit -m "feat: add email utility module (stub for development)"
```

---

### Task 9: 密码重置API

**Files:**
- Create: `src/routes/password.js`
- Modify: `src/server.js` (挂载路由)

- [ ] **Step 1: 创建 src/routes/password.js**

```javascript
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db');
const { generateToken } = require('../utils/token');
const { isValidPassword, isValidEmail } = require('../utils/validation');
const { sendPasswordResetEmail } = require('../utils/email');

const BASE_URL = process.env.BASE_URL || 'http://localhost:4001';
const RESET_TOKEN_EXPIRY = 60 * 60 * 1000; // 1 hour

// Request password reset
router.post('/reset-request', async (req, res) => {
  const { email } = req.body;

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ success: false, message: '请输入有效的邮箱地址' });
  }

  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);

  // Don't reveal whether user exists (security)
  if (!user) {
    return res.json({ success: true, message: '如果邮箱存在，重置链接已发送' });
  }

  // Generate reset token
  const token = generateToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY).toISOString();

  db.prepare(`
    INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)
  `).run(user.id, token, expiresAt);

  // Send email
  const resetLink = `${BASE_URL}/#/reset-password?token=${token}`;
  await sendPasswordResetEmail(user.email, resetLink);

  res.json({ success: true, message: '如果邮箱存在，重置链接已发送' });
});

// Execute password reset
router.post('/reset', async (req, res) => {
  const { token, new_password } = req.body;

  if (!token) {
    return res.status(400).json({ success: false, message: '缺少重置令牌' });
  }

  if (!new_password || !isValidPassword(new_password)) {
    return res.status(400).json({ success: false, message: '密码至少6位' });
  }

  const record = db.prepare(`
    SELECT user_id FROM password_reset_tokens 
    WHERE token = ? AND used = 0 AND expires_at > ?
  `).get(token, new Date().toISOString());

  if (!record) {
    return res.status(400).json({ success: false, message: '链接无效或已过期' });
  }

  // Update password
  const passwordHash = await bcrypt.hash(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, record.user_id);

  // Mark token as used
  db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE token = ?').run(token);

  // Clear all sessions (force re-login)
  db.prepare('UPDATE users SET session_token = NULL WHERE id = ?').run(record.user_id);

  res.json({ success: true, message: '密码已更新，请重新登录' });
});

module.exports = router;
```

- [ ] **Step 2: 在server.js挂载password路由**

在路由定义部分添加：

```javascript
const passwordRoutes = require('./routes/password');
app.use('/api/password', passwordRoutes);
```

- [ ] **Step 3: 测试密码重置流程**

运行: `npm start`

测试请求重置：
```bash
curl -X POST http://localhost:4001/api/password/reset-request -H "Content-Type: application/json" -d '{"email":"test@example.com"}'
```

查看控制台输出的重置链接，用该链接测试：
```bash
curl -X POST http://localhost:4001/api/password/reset -H "Content-Type: application/json" -d '{"token":"YOUR_TOKEN","new_password":"newpass123"}'
```

- [ ] **Step 4: 提交**

```bash
git add src/routes/password.js src/server.js
git commit -m "feat: add password reset API endpoints"
```

---

### Task 10: 前端密码重置页面

**Files:**
- Modify: `public/app.js` (添加重置页面和逻辑)
- Modify: `public/index.html` (添加重置链接入口)
- Create: `public/js/common.js` (提取公共函数)

- [ ] **Step 1: 创建 public/js/common.js**

```javascript
// Common utilities for frontend

async function apiFetch(endpoint, options = {}) {
  const res = await fetch(endpoint, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return res.json();
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => toast.classList.remove('show'), 3000);
}

module.exports = { apiFetch, showToast };
// Also expose globally for direct script usage
window.apiFetch = apiFetch;
window.showToast = showToast;
```

- [ ] **Step 2: 在index.html添加忘记密码链接**

修改登录表单部分，在"没有账号？注册"链接后添加：

```html
<p class="auth-link">
  <a href="#reset-request">忘记密码？</a>
</p>
```

在script引入部分添加common.js：

```html
<script src="js/common.js"></script>
<script src="app.js"></script>
```

- [ ] **Step 3: 在app.js添加密码重置页面视图**

在views对象中添加新视图：

```javascript
const views = {
  // ... existing views ...

  resetRequest: `
    <div class="auth-container">
      <h1>重置密码</h1>
      <form id="reset-request-form" class="auth-form">
        <div class="form-group">
          <label for="email">邮箱</label>
          <input type="email" id="email" name="email" required>
        </div>
        <button type="submit" class="btn-primary">发送重置链接</button>
      </form>
      <p class="auth-link"><a href="#login">返回登录</a></p>
    </div>
  `,

  resetPassword: `
    <div class="auth-container">
      <h1>设置新密码</h1>
      <form id="reset-password-form" class="auth-form">
        <div class="form-group">
          <label for="new_password">新密码</label>
          <input type="password" id="new_password" name="new_password" required minlength="6">
        </div>
        <button type="submit" class="btn-primary">确认</button>
      </form>
    </div>
  `
};
```

- [ ] **Step 4: 在app.js添加密码重置表单处理**

在submit事件处理器中添加：

```javascript
if (form.id === 'reset-request-form') {
  const formData = new FormData(form);
  const result = await apiFetch('/api/password/reset-request', {
    method: 'POST',
    body: { email: formData.get('email') }
  });

  showToast(result.message, result.success ? 'success' : 'error');
  if (result.success) {
    setTimeout(() => location.hash = 'login', 2000);
  }
}

if (form.id === 'reset-password-form') {
  const token = new URLSearchParams(location.hash.split('?')[1]).get('token');
  const formData = new FormData(form);

  const result = await apiFetch('/api/password/reset', {
    method: 'POST',
    body: { token, new_password: formData.get('new_password') }
  });

  showToast(result.message, result.success ? 'success' : 'error');
  if (result.success) {
    setTimeout(() => location.hash = 'login', 2000);
  }
}
```

修改router函数支持reset-password路由：

```javascript
function router() {
  let hash = location.hash.slice(1) || 'login';
  const hashParts = hash.split('?');
  const viewName = hashParts[0];

  // ... existing code ...

  const app = document.getElementById('app');
  app.innerHTML = views[viewName] || views.login;

  // ... rest of router ...
}
```

- [ ] **Step 5: 测试前端密码重置流程**

运行: `npm start`
打开浏览器访问 http://localhost:4001
1. 点击"忘记密码？"
2. 输入邮箱，提交
3. 查看控制台输出的链接
4. 复制链接在浏览器打开
5. 输入新密码，提交
6. 自动跳转登录页

- [ ] **Step 6: 提交**

```bash
git add public/js/common.js public/app.js public/index.html
git commit -m "feat: add password reset frontend pages"
```

---

### Task 11: 提取认证路由

**Files:**
- Create: `src/routes/auth.js`
- Modify: `src/server.js` (移除认证相关路由)

- [ ] **Step 1: 创建 src/routes/auth.js**

```javascript
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db');
const { generateToken } = require('../utils/token');
const { isValidEmail, isValidPassword, isValidUsername } = require('../utils/validation');
const requireAuth = require('../middleware/requireAuth');

const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

// Register
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ success: false, message: '所有字段必填' });
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

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)').run(username, email, passwordHash);

    res.status(201).json({ success: true });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      if (err.message.includes('username')) {
        return res.status(409).json({ success: false, message: '用户名已存在' });
      }
      if (err.message.includes('email')) {
        return res.status(409).json({ success: false, message: '邮箱已被注册' });
      }
    }
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: '注册失败' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: '用户名和密码必填' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    if (!user) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }

    const token = generateToken();
    db.prepare('UPDATE users SET session_token = ? WHERE id = ?').run(token, user.id);

    res.cookie('session', token, {
      httpOnly: false,
      maxAge: SESSION_MAX_AGE,
      sameSite: 'Lax',
      path: '/'
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: '登录失败' });
  }
});

// Get current user
router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// Logout
router.post('/logout', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET session_token = NULL WHERE id = ?').run(req.user.id);

  res.clearCookie('session', { path: '/' });
  res.json({ success: true });
});

module.exports = router;
```

- [ ] **Step 2: 修改server.js移除认证路由，挂载auth路由**

删除server.js中的注册、登录、me、登出接口（约第96-181行），改为：

```javascript
const authRoutes = require('./routes/auth');
app.use('/api', authRoutes);
```

- [ ] **Step 3: 测试**

运行: `npm start`
测试注册、登录、获取用户信息、登出

- [ ] **Step 4: 提交**

```bash
git add src/routes/auth.js src/server.js
git commit -m "refactor: extract auth routes to separate file"
```

---

### Task 12: 提取管理员路由

**Files:**
- Create: `src/routes/admin.js`
- Modify: `src/server.js` (移除管理员相关路由)

- [ ] **Step 1: 创建 src/routes/admin.js**

```javascript
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { generateToken } = require('../utils/token');
const requireAdmin = require('../middleware/requireAdmin');

const ADMIN_SESSION_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

// Admin login
router.post('/login', (req, res) => {
  const { password } = req.body;
  const adminSecret = process.env.ADMIN_SECRET;

  if (!adminSecret) {
    return res.status(500).json({ success: false, message: '管理员密码未配置' });
  }

  if (password !== adminSecret) {
    return res.status(401).json({ success: false, message: '密码错误' });
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_EXPIRY).toISOString();

  db.prepare('INSERT INTO admin_sessions (session_token, expires_at) VALUES (?, ?)').run(token, expiresAt);

  res.cookie('admin_session', token, {
    httpOnly: true,
    maxAge: ADMIN_SESSION_EXPIRY,
    sameSite: 'Strict',
    path: '/'
  });

  res.json({ success: true });
});

// Admin logout
router.post('/logout', (req, res) => {
  const token = req.cookies.admin_session;
  if (token) {
    db.prepare('DELETE FROM admin_sessions WHERE session_token = ?').run(token);
  }
  res.clearCookie('admin_session', { path: '/' });
  res.json({ success: true });
});

// Get all clients
router.get('/clients', requireAdmin, (req, res) => {
  const clients = db.prepare('SELECT id, name, client_id, redirect_uri, created_at FROM clients').all();
  res.json(clients);
});

// Create client
router.post('/clients', requireAdmin, (req, res) => {
  const { name, redirect_uri } = req.body;

  if (!name || !redirect_uri) {
    return res.status(400).json({ success: false, message: '名称和回调地址必填' });
  }

  const clientId = crypto.randomBytes(16).toString('hex');
  const clientSecret = crypto.randomBytes(32).toString('hex');

  try {
    db.prepare('INSERT INTO clients (name, client_id, client_secret, redirect_uri) VALUES (?, ?, ?, ?)').run(name, clientId, clientSecret, redirect_uri);
    res.status(201).json({ success: true, client_id: clientId, client_secret: clientSecret });
  } catch (err) {
    console.error('Create client error:', err);
    res.status(500).json({ success: false, message: '创建失败' });
  }
});

// Delete client
router.delete('/clients/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM clients WHERE id = ?').run(id);
  res.json({ success: true });
});

// Update client
router.put('/clients/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { name, redirect_uri } = req.body;

  if (!name || !redirect_uri) {
    return res.status(400).json({ success: false, message: '名称和回调地址必填' });
  }

  db.prepare('UPDATE clients SET name = ?, redirect_uri = ? WHERE id = ?').run(name, redirect_uri, id);
  res.json({ success: true });
});

module.exports = router;
```

- [ ] **Step 2: 修改server.js移除管理员路由，挂载admin路由**

删除server.js中的管理员相关接口（约第183-283行），改为：

```javascript
const adminRoutes = require('./routes/admin');
app.use('/api/admin', adminRoutes);
```

- [ ] **Step 3: 测试**

运行: `npm start`
测试管理员登录、创建客户端、查看客户端、删除客户端

- [ ] **Step 4: 提交**

```bash
git add src/routes/admin.js src/server.js
git commit -m "refactor: extract admin routes to separate file"
```

---

### Task 13: 提取OAuth路由

**Files:**
- Create: `src/routes/oauth.js`
- Modify: `src/server.js` (移除OAuth相关路由)

- [ ] **Step 1: 创建 src/routes/oauth.js**

```javascript
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { generateShortToken } = require('../utils/token');

const AUTH_CODE_EXPIRY = 5 * 60 * 1000; // 5 minutes

// Authorize endpoint (for third-party redirect)
router.get('/authorize', (req, res) => {
  const { redirect_uri, client_id, state } = req.query;

  if (!redirect_uri || !client_id) {
    return res.status(400).json({ success: false, message: '缺少参数' });
  }

  // Verify client exists
  const client = db.prepare('SELECT * FROM clients WHERE client_id = ?').get(client_id);
  if (!client) {
    return res.status(400).json({ success: false, message: '无效的 client_id' });
  }

  // Verify redirect_uri matches
  if (client.redirect_uri !== redirect_uri) {
    return res.status(400).json({ success: false, message: 'redirect_uri 不匹配' });
  }

  // Check if user is logged in
  const token = req.cookies.session;
  const user = token ? db.prepare('SELECT id, username, email FROM users WHERE session_token = ?').get(token) : null;

  if (!user) {
    // Not logged in - redirect to login page with parameters
    const stateParam = state ? `&state=${encodeURIComponent(state)}` : '';
    return res.redirect(`/#/login?redirect_uri=${encodeURIComponent(redirect_uri)}&client_id=${client_id}${stateParam}`);
  }

  // User is logged in - generate code
  const code = generateShortToken();
  const expiresAt = new Date(Date.now() + AUTH_CODE_EXPIRY).toISOString();

  db.prepare('INSERT INTO auth_codes (code, client_id, user_id, expires_at) VALUES (?, ?, ?, ?)').run(code, client_id, user.id, expiresAt);

  // Redirect back to third-party with code and state
  const stateParam = state ? `&state=${encodeURIComponent(state)}` : '';
  res.redirect(`${redirect_uri}?code=${code}${stateParam}`);
});

// Token exchange (third-party backend calls this)
router.post('/token', (req, res) => {
  const { code, client_id, client_secret } = req.body;

  if (!code || !client_id || !client_secret) {
    return res.status(400).json({ success: false, message: '缺少参数' });
  }

  // Verify client
  const client = db.prepare('SELECT * FROM clients WHERE client_id = ? AND client_secret = ?').get(client_id, client_secret);
  if (!client) {
    return res.status(401).json({ success: false, message: '无效的 client_id 或 client_secret' });
  }

  // Verify code
  const authCode = db.prepare('SELECT * FROM auth_codes WHERE code = ? AND client_id = ? AND used = 0 AND expires_at > ?').get(code, client_id, new Date().toISOString());
  if (!authCode) {
    return res.status(401).json({ success: false, message: '无效或已使用的 code' });
  }

  // Mark code as used
  db.prepare('UPDATE auth_codes SET used = 1 WHERE id = ?').run(authCode.id);

  // Get user info
  const user = db.prepare('SELECT id, username, email, created_at FROM users WHERE id = ?').get(authCode.user_id);

  res.json({ success: true, user });
});

// Verify session token (for same-domain scenarios)
router.post('/verify', (req, res) => {
  const { session_token } = req.body;

  if (!session_token) {
    return res.status(400).json({ success: false, message: '缺少 session_token' });
  }

  const user = db.prepare('SELECT id, username, email, created_at FROM users WHERE session_token = ?').get(session_token);

  if (!user) {
    return res.status(401).json({ success: false, message: '无效的 session_token' });
  }

  res.json({ success: true, user });
});

module.exports = router;
```

- [ ] **Step 2: 修改server.js移除OAuth路由，挂载oauth路由**

删除server.js中的OAuth相关接口（约第285-370行），改为：

```javascript
const oauthRoutes = require('./routes/oauth');
app.use('/api', oauthRoutes);
```

- [ ] **Step 3: 测试**

运行: `npm start`
测试完整的OAuth流程（使用test_flow.js或手动测试）

- [ ] **Step 4: 提交**

```bash
git add src/routes/oauth.js src/server.js
git commit -m "refactor: extract OAuth routes to separate file"
```

---

### Task 14: 精简server.js入口文件

**Files:**
- Modify: `src/server.js` (最终精简版)

- [ ] **Step 1: 整理server.js为干净的入口文件**

最终server.js应该只有以下内容：

```javascript
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const db = require('./db');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const oauthRoutes = require('./routes/oauth');
const passwordRoutes = require('./routes/password');
const { createRateLimiter, resetRateLimit } = require('./middleware/rateLimit');
const { startCleanupScheduler } = require('./utils/cleanup');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// Create rate limiter for login
const loginRateLimiter = createRateLimiter({ maxAttempts: 5, windowMs: 5 * 60 * 1000 });

// Mount routes
// Note: rate limiter should be applied directly in login route, not here
app.use('/api', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', oauthRoutes);
app.use('/api/password', passwordRoutes);

// SPA fallback - serve index.html for all non-api routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ success: false, message: '服务器错误' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

// Start cleanup scheduler
const cleanupInterval = startCleanupScheduler();

// Graceful shutdown
process.on('SIGINT', () => {
  clearInterval(cleanupInterval);
  db.close();
  process.exit();
});
```

注意：需要修改auth.js中的登录接口应用rate limiter

- [ ] **Step 2: 修改auth.js应用rate limiter**

在auth.js中引入rateLimit并在login路由中使用：

```javascript
const { createRateLimiter, resetRateLimit } = require('../middleware/rateLimit');

const loginRateLimiter = createRateLimiter({ maxAttempts: 5, windowMs: 5 * 60 * 1000 });

// Login route with rate limiter
router.post('/login', loginRateLimiter, async (req, res) => {
  // ... existing login logic ...

  // On successful login, reset rate limit
  const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  resetRateLimit(ip);

  // ... rest of login ...
});
```

同时从server.js中移除rate limiter相关代码。

- [ ] **Step 3: 测试完整功能**

运行: `npm start`
测试所有功能：
- 用户注册登录
- 密码重置
- 管理员登录和客户端管理
- OAuth流程

- [ ] **Step 4: 提交**

```bash
git add src/server.js src/routes/auth.js
git commit -m "refactor: finalize server.js as clean entry point"
```

---

### Task 15: 提取前端公共函数

**Files:**
- Modify: `public/app.js` (使用common.js)
- Modify: `public/js/admin.js` (使用common.js)

- [ ] **Step 1: 修改app.js使用common.js的函数**

删除app.js中的apiFetch和showToast函数定义，它们已通过common.js全局暴露。

- [ ] **Step 2: 修改admin.js使用common.js的函数**

删除admin.js中的apiFetch和showToast函数定义。

在admin.html中添加common.js引入：

```html
<script src="js/common.js"></script>
<script src="js/admin.js"></script>
```

- [ ] **Step 3: 测试前端**

运行: `npm start`
打开用户中心和管理后台，测试所有功能

- [ ] **Step 4: 提交**

```bash
git add public/app.js public/js/admin.js public/admin.html
git commit -m "refactor: use common.js for shared frontend utilities"
```

---

### Task 16: 添加.env配置项

**Files:**
- Modify: `.env.example` (添加新配置项说明)

- [ ] **Step 1: 更新.env.example**

```env
PORT=4001

# Admin password for managing third-party applications
ADMIN_SECRET=admin123

# Base URL for password reset links
BASE_URL=http://localhost:4001

# Email configuration (for production)
# SMTP_HOST=smtp.example.com
# SMTP_PORT=587
# SMTP_USER=your@email.com
# SMTP_PASS=your_password
```

- [ ] **Step 2: 提交**

```bash
git add .env.example
git commit -m "docs: update .env.example with new configuration options"
```

---

### Task 17: 最终验证

- [ ] **Step 1: 运行服务器并验证所有功能**

```bash
npm start
```

验证清单：
- [ ] 服务器启动，显示 "Server running at http://localhost:4001"
- [ ] 控制台显示 "Cleanup completed: ..."
- [ ] 用户注册成功
- [ ] 用户登录成功
- [ ] 登录失败5次后被限制
- [ ] /api/me 返回用户信息
- [ ] 用户登出成功
- [ ] 密码重置请求发送（控制台显示链接）
- [ ] 密码重置执行成功
- [ ] 管理员登录成功
- [ ] 创建客户端成功
- [ ] OAuth authorize 流程正常
- [ ] OAuth token 交换正常

- [ ] **Step 2: 最终提交**

```bash
git add -A
git commit -m "feat: complete P0-P2 improvements for MindAuth"
```

---

## Summary

**完成后的项目结构：**

```
MindAuth/
├── src/
│   ├── server.js          # 入口 (~50行)
│   ├── db/
│   │   └── index.js       # 数据库 + 表 + 索引
│   ├── middleware/
│   │   ├── requireAuth.js
│   │   ├── requireAdmin.js
│   │   └── rateLimit.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── admin.js
│   │   ├── oauth.js
│   │   └── password.js
│   └── utils/
│   │   ├── token.js
│   │   ├── validation.js
│   │   ├── email.js
│   │   └── cleanup.js
├── public/
│   ├── index.html
│   ├── admin.html
│   ├── style.css
│   ├── app.js
│   └── js/
│   │   ├── common.js
│   │   └── admin.js
├── docs/
│   └── superpowers/
│   │   └── plans/
│   │       └── 2026-05-13-core-improvements.md
├── package.json
├── .env
├── .env.example
└── users.db
```

**已实现的改进：**
- P0: 数据库索引、过期数据清理
- P1: 登录频率限制、密码重置
- P2: 代码拆分、前端公共函数提取

**待后续计划（P3）：**
- OAuth流程完善（access_token/refresh_token）
- 多设备登录支持
- 用户管理后台