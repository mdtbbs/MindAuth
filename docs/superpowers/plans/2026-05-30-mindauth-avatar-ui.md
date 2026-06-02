# MindAuth UI 升级实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-step. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现用户头像上传功能（头像+背景图）和 UI 现代化升级（极简科技风、轻量线框按钮、黑白主题、混合动画）

**Architecture:** 后端新增头像上传 API（multer 处理 multipart/form-data），数据库添加 avatar_url/banner_url 字段，前端更新 Dashboard/Settings 视图添加头像组件，更新 CSS 按钮风格和主题变量。

**Tech Stack:** Express.js, multer (文件上传), MySQL, Redis, 纯前端 SPA (HTML/CSS/JS)

---

## File Structure

| 文件 | 职责 |
|------|------|
| `src/routes/account.js` | 新增头像/背景上传 API (POST/DELETE) |
| `src/db/schema-mysql.js` | 数据库 schema 添加 avatar_url, banner_url 字段 |
| `src/middleware/upload.js` | multer 配置（文件大小、类型限制） |
| `public/uploads/avatars/` | 头像文件存储目录 |
| `public/uploads/banners/` | 背景图存储目录 |
| `public/app.js` | 更新 Dashboard 视图，添加头像上传组件 |
| `public/style.css` | 更新按钮风格、主题变量、动画 |
| `tests/specs/auth/auth.spec.js` | 新增头像上传测试 |

---

### Task 1: 安装 multer 依赖并创建 uploads 目录

**Files:**
- Create: `public/uploads/avatars/` (目录)
- Create: `public/uploads/banners/` (目录)
- Modify: `package.json`

- [ ] **Step 1: 安装 multer**

```bash
cd G:\MindProject\MindAuth && npm install multer
```

- [ ] **Step 2: 创建 uploads 目录**

```bash
mkdir -p public/uploads/avatars public/uploads/banners
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add multer for file upload and create uploads directories"
```

---

### Task 2: 数据库添加 avatar_url 和 banner_url 字段

**Files:**
- Modify: `src/db/schema-mysql.js`

- [ ] **Step 1: 在 users 表添加字段**

找到 `initSchema()` 函数中 users 表创建语句（约第9-25行），在 `created_at` 之后添加：

```javascript
// 在 users 表 CREATE TABLE 语句中添加：
avatar_url VARCHAR(500) DEFAULT NULL,
banner_url VARCHAR(500) DEFAULT NULL,
```

修改后的 users 表创建语句：

```javascript
await conn.execute(`
  CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    session_token VARCHAR(255) DEFAULT NULL,
    email_verified TINYINT(1) DEFAULT 0,
    role VARCHAR(50) DEFAULT 'user',
    avatar_url VARCHAR(500) DEFAULT NULL,
    banner_url VARCHAR(500) DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_users_session (session_token),
    INDEX idx_users_role (role),
    INDEX idx_users_email_verified (email_verified),
    INDEX idx_users_username (username),
    INDEX idx_users_email (email),
    INDEX idx_users_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);
```

- [ ] **Step 2: 添加 ALTER TABLE 语句处理已有数据库**

在 schema-mysql.js 的 initSchema 函数末尾（约第100行后）添加：

```javascript
// Add avatar_url and banner_url columns if they don't exist
try {
  await conn.execute('ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500) DEFAULT NULL');
} catch (alterErr) {
  if (alterErr.code !== 'ER_DUP_FIELDNAME') {
    console.error('Could not add avatar_url:', alterErr.message);
  }
}

try {
  await conn.execute('ALTER TABLE users ADD COLUMN banner_url VARCHAR(500) DEFAULT NULL');
} catch (alterErr) {
  if (alterErr.code !== 'ER_DUP_FIELDNAME') {
    console.error('Could not add banner_url:', alterErr.message);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/db/schema-mysql.js
git commit -m "feat: add avatar_url and banner_url fields to users table"
```

---

### Task 3: 创建 upload middleware

**Files:**
- Create: `src/middleware/upload.js`

- [ ] **Step 1: 创建 multer 配置文件**

```javascript
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 确保上传目录存在
const avatarsDir = path.join(__dirname, '../../public/uploads/avatars');
const bannersDir = path.join(__dirname, '../../public/uploads/banners');

if (!fs.existsSync(avatarsDir)) {
  fs.mkdirSync(avatarsDir, { recursive: true });
}
if (!fs.existsSync(bannersDir)) {
  fs.mkdirSync(bannersDir, { recursive: true });
}

// 文件过滤器
const imageFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('只支持 JPEG、PNG、GIF、WebP 格式的图片'), false);
  }
};

// 头像上传配置
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, avatarsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${req.user.id}_${Date.now()}${ext}`;
    cb(null, uniqueName);
  }
});

const avatarUpload = multer({
  storage: avatarStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB
});

// 背景图上传配置
const bannerStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, bannersDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${req.user.id}_${Date.now()}${ext}`;
    cb(null, uniqueName);
  }
});

const bannerUpload = multer({
  storage: bannerStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

module.exports = {
  avatarUpload,
  bannerUpload
};
```

- [ ] **Step 2: Commit**

```bash
git add src/middleware/upload.js
git commit -m "feat: add multer upload middleware for avatar and banner"
```

---

### Task 4: 添加头像上传 API

**Files:**
- Modify: `src/routes/account.js`

- [ ] **Step 1: 在 account.js 顶部添加导入**

在现有导入语句后（约第10行）添加：

```javascript
const { avatarUpload, bannerUpload } = require('../middleware/upload');
const path = require('path');
const fs = require('fs');
```

- [ ] **Step 2: 添加头像上传 API**

在 `module.exports` 之前添加：

```javascript
// POST /avatar - Upload avatar
router.post('/avatar', requireAuth, avatarUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请选择图片文件' });
    }

    const user = req.user;
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    // 删除旧头像文件（如果存在）
    const [oldRows] = await pool.execute('SELECT avatar_url FROM users WHERE id = ?', [user.id]);
    if (oldRows.length > 0 && oldRows[0].avatar_url) {
      const oldPath = path.join(__dirname, '../../public', oldRows[0].avatar_url);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    // 更新数据库
    await pool.execute('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, user.id]);

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

    // 获取旧头像路径
    const [rows] = await pool.execute('SELECT avatar_url FROM users WHERE id = ?', [user.id]);
    if (rows.length > 0 && rows[0].avatar_url) {
      const oldPath = path.join(__dirname, '../../public', rows[0].avatar_url);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    // 更新数据库
    await pool.execute('UPDATE users SET avatar_url = NULL WHERE id = ?', [user.id]);

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

    // 删除旧背景文件（如果存在）
    const [oldRows] = await pool.execute('SELECT banner_url FROM users WHERE id = ?', [user.id]);
    if (oldRows.length > 0 && oldRows[0].banner_url) {
      const oldPath = path.join(__dirname, '../../public', oldRows[0].banner_url);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    // 更新数据库
    await pool.execute('UPDATE users SET banner_url = ? WHERE id = ?', [bannerUrl, user.id]);

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

    // 获取旧背景路径
    const [rows] = await pool.execute('SELECT banner_url FROM users WHERE id = ?', [user.id]);
    if (rows.length > 0 && rows[0].banner_url) {
      const oldPath = path.join(__dirname, '../../public', rows[0].banner_url);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    // 更新数据库
    await pool.execute('UPDATE users SET banner_url = NULL WHERE id = ?', [user.id]);

    res.json({ success: true });
  } catch (err) {
    console.error('Banner delete error:', err);
    res.status(500).json({ success: false, message: '删除背景图失败' });
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/account.js
git commit -m "feat: add avatar and banner upload/delete API endpoints"
```

---

### Task 5: 更新 /api/me 返回头像信息

**Files:**
- Modify: `src/routes/auth.js`

- [ ] **Step 1: 找到 /api/me 路由**

搜索 `router.get('/me'` 或类似路由，更新 SELECT 语句添加 avatar_url 和 banner_url 字段。

- [ ] **Step 2: 更新查询语句**

找到返回用户信息的查询，将 SELECT 语句修改为包含 avatar_url 和 banner_url：

```javascript
// 示例（根据实际代码调整）：
const [rows] = await pool.execute(
  'SELECT id, username, email, email_verified, role, avatar_url, banner_url, created_at FROM users WHERE session_token = ?',
  [sessionToken]
);
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/auth.js
git commit -m "feat: include avatar_url and banner_url in /api/me response"
```

---

### Task 6: 更新 CSS 按钮风格和主题变量

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: 更新主题变量**

在文件开头的变量定义部分添加按钮相关变量：

```css
/* 在 :root 中添加 */
--btn-border-primary: rgba(255,107,53,0.3);
--btn-border: rgba(0,0,0,0.1);
--btn-hover-bg: var(--primary);
--btn-hover-color: #fff;

/* 在 [data-theme="dark"] 中添加 */
--btn-border-primary: rgba(255,107,53,0.3);
--btn-border: rgba(255,255,255,0.15);
--btn-hover-bg: var(--primary);
--btn-hover-color: #fff;
```

- [ ] **Step 2: 更新按钮样式**

替换现有的 .btn-primary 和 .btn-secondary 样式：

```css
/* 轻量线框按钮风格 */
.btn-primary {
  background: transparent;
  border: 1px solid var(--btn-border-primary);
  color: var(--primary);
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-primary:hover {
  background: var(--primary);
  color: #fff;
  transform: translateY(-1px);
}

.btn-secondary {
  background: transparent;
  border: 1px solid var(--btn-border);
  color: var(--text-secondary);
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-secondary:hover {
  border-color: var(--text-muted);
  color: var(--text);
  transform: translateY(-1px);
}

.btn-sm {
  padding: 6px 12px;
  font-size: 0.75rem;
}

.btn-danger {
  border-color: rgba(239,68,68,0.3);
  color: var(--error);
}

.btn-danger:hover {
  background: var(--error);
  color: #fff;
}
```

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -m "style: update button styles to lightweight outline style with theme support"
```

---

### Task 7: 更新 Dashboard 视图添加头像组件

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: 更新 dashboard 视图 HTML**

找到 `views.dashboard` 定义，替换为包含头像和背景图的版本：

```javascript
dashboard: `
  <div class="admin-content">
    <div class="admin-header">
      <div class="admin-title">账户</div>
      <button id="logout-btn" class="btn-secondary btn-sm">退出</button>
    </div>

    <!-- Profile Header with Banner and Avatar -->
    <div class="profile-header animate-fade-in-up" style="animation-delay: 0s">
      <div class="profile-banner" id="banner-display">
        <button class="banner-upload-btn" id="banner-upload-btn" title="更换背景图">更换背景</button>
      </div>
      <div class="profile-avatar-container">
        <div class="profile-avatar" id="avatar-display">
          <span id="avatar-letter">U</span>
          <img id="avatar-img" src="" alt="头像" style="display: none;">
        </div>
        <button class="avatar-upload-btn" id="avatar-upload-btn" title="更换头像">
          <span>📷</span>
        </button>
      </div>
      <div class="profile-info">
        <div class="profile-name" id="username-display"></div>
        <div class="profile-email" id="email-display"></div>
      </div>
    </div>
    <input type="file" id="avatar-file-input" accept="image/jpeg,image/png,image/gif,image/webp" style="display: none;">
    <input type="file" id="banner-file-input" accept="image/jpeg,image/png,image/gif,image/webp" style="display: none;">

    <!-- STATUS Card -->
    <div class="card card-lg animate-fade-in-up" style="animation-delay: 0.1s">
      <div class="card-header-title">STATUS</div>
      <div class="status-section">
        <div class="status-row">
          <span class="status-label">邮箱验证</span>
          <span id="verified-badge"></span>
        </div>
        <div class="status-row">
          <span class="status-label">注册时间</span>
          <span class="status-value" id="created-display"></span>
        </div>
      </div>
      <div id="verification-actions" class="action-row" style="display: none;">
        <button id="send-verify-btn" class="btn-outline">发送验证邮件</button>
      </div>
    </div>

    <!-- LOGIN HISTORY Card -->
    <div class="card card-lg animate-fade-in-up" style="animation-delay: 0.2s">
      <div class="card-header-title">LOGIN HISTORY</div>
      <div id="login-logs-container">
        <div class="empty-state">加载中...</div>
      </div>
    </div>

    <!-- AUTHORIZED APPS Card -->
    <div class="card card-lg animate-fade-in-up" style="animation-delay: 0.3s">
      <div class="card-header-title">AUTHORIZED APPS</div>
      <div id="authorizations-container">
        <div class="empty-state">加载中...</div>
      </div>
    </div>

    <!-- ACCOUNT Card -->
    <div class="card card-lg animate-fade-in-up" style="animation-delay: 0.4s">
      <div class="card-header-title">ACCOUNT</div>
      <div class="action-row">
        <a href="#account-settings" class="btn-outline">账户设置</a>
      </div>
    </div>
  </div>
`,
```

- [ ] **Step 2: Commit**

```bash
git add public/app.js
git commit -m "feat: add profile header with banner and avatar to Dashboard"
```

---

### Task 8: 添加头像上传 CSS 样式

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: 添加头像组件样式**

在文件末尾添加：

```css
/* ========== Profile Header Component ========== */
.profile-header {
  position: relative;
  margin-bottom: 1.5rem;
}

.profile-banner {
  height: 120px;
  background: linear-gradient(135deg, var(--bg-elevated), var(--bg-hover));
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  position: relative;
  overflow: hidden;
}

.profile-banner img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.banner-upload-btn {
  position: absolute;
  right: 8px;
  bottom: 8px;
  background: rgba(0,0,0,0.5);
  color: #fff;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.2);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.banner-upload-btn:hover {
  background: rgba(0,0,0,0.7);
}

[data-theme="light"] .banner-upload-btn {
  background: rgba(255,255,255,0.8);
  color: var(--text);
  border-color: var(--border);
}

[data-theme="light"] .banner-upload-btn:hover {
  background: rgba(255,255,255,0.95);
}

.profile-avatar-container {
  position: absolute;
  bottom: -40px;
  left: 20px;
}

.profile-avatar {
  width: 80px;
  height: 80px;
  background: var(--primary);
  border-radius: 50%;
  border: 3px solid var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 28px;
  font-weight: 600;
  overflow: hidden;
}

.profile-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-upload-btn {
  position: absolute;
  bottom: -4px;
  right: -4px;
  background: var(--bg-card);
  border-radius: 50%;
  width: 28px;
  height: 28px;
  border: 2px solid var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s ease;
}

.avatar-upload-btn:hover {
  transform: scale(1.1);
}

.profile-info {
  padding-top: 50px;
  padding-left: 110px;
}

.profile-name {
  font-size: 1.125rem;
  font-weight: 500;
  color: var(--text);
}

.profile-email {
  font-size: 0.875rem;
  color: var(--text-muted);
}

/* Responsive */
@media (max-width: 480px) {
  .profile-banner {
    height: 80px;
  }

  .profile-avatar {
    width: 60px;
    height: 60px;
    font-size: 20px;
  }

  .profile-avatar-container {
    bottom: -30px;
    left: 16px;
  }

  .profile-info {
    padding-top: 40px;
    padding-left: 90px;
  }

  .profile-name {
    font-size: 1rem;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add public/style.css
git commit -m "style: add profile header component styles for avatar and banner"
```

---

### Task 9: 添加头像上传 JavaScript 交互

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: 更新 Dashboard 数据填充逻辑**

找到 Dashboard 数据填充部分（约第410-432行），更新为处理头像：

```javascript
// Populate dashboard data
if (viewName === 'dashboard' && Store.user) {
  const username = Store.user.username || 'User';

  // 头像显示
  const avatarLetter = document.getElementById('avatar-letter');
  const avatarImg = document.getElementById('avatar-img');

  if (Store.user.avatar_url) {
    avatarLetter.style.display = 'none';
    avatarImg.style.display = 'block';
    avatarImg.src = Store.user.avatar_url;
  } else {
    avatarLetter.textContent = username.charAt(0).toUpperCase();
    avatarLetter.style.display = 'block';
    avatarImg.style.display = 'none';
  }

  // 背景图显示
  const bannerDisplay = document.getElementById('banner-display');
  if (Store.user.banner_url) {
    bannerDisplay.innerHTML = `<img src="${Store.user.banner_url}" alt="背景图"><button class="banner-upload-btn" id="banner-upload-btn" title="更换背景图">更换背景</button>`;
  }

  document.getElementById('username-display').textContent = username;
  document.getElementById('email-display').textContent = Store.user.email;
  document.getElementById('created-display').textContent = Store.user.created_at || '-';

  // ... 其余代码保持不变
}
```

- [ ] **Step 2: 添加头像上传事件处理**

在现有的事件监听部分添加：

```javascript
// Avatar upload handler
document.addEventListener('click', async (e) => {
  // Avatar upload button
  if (e.target.id === 'avatar-upload-btn' || e.target.closest('#avatar-upload-btn')) {
    const input = document.getElementById('avatar-file-input');
    input.click();
  }

  // Banner upload button
  if (e.target.id === 'banner-upload-btn' || e.target.closest('#banner-upload-btn')) {
    const input = document.getElementById('banner-file-input');
    input.click();
  }
});

// File input change handlers
document.addEventListener('change', async (e) => {
  if (e.target.id === 'avatar-file-input') {
    const file = e.target.files[0];
    if (!file) return;

    // 验证文件大小
    if (file.size > 2 * 1024 * 1024) {
      showToast('图片大小不能超过 2MB', 'error');
      return;
    }

    // 本地预览
    const reader = new FileReader();
    reader.onload = (ev) => {
      const avatarImg = document.getElementById('avatar-img');
      const avatarLetter = document.getElementById('avatar-letter');
      avatarImg.src = ev.target.result;
      avatarImg.style.display = 'block';
      avatarLetter.style.display = 'none';
    };
    reader.readAsDataURL(file);

    // 上传
    const formData = new FormData();
    formData.append('file', file);

    try {
      const result = await apiFetch('/api/account/avatar', {
        method: 'POST',
        body: formData,
        headers: {} // 不设置 Content-Type，让浏览器自动处理 multipart
      });

      if (result.success) {
        showToast('头像已更新', 'success');
        Store.user.avatar_url = result.avatar_url;
      } else {
        showToast(result.message || '上传失败', 'error');
      }
    } catch (err) {
      showToast('上传失败', 'error');
    }

    e.target.value = ''; // 清空 input
  }

  if (e.target.id === 'banner-file-input') {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      showToast('图片大小不能超过 5MB', 'error');
      return;
    }

    // 本地预览
    const reader = new FileReader();
    reader.onload = (ev) => {
      const bannerDisplay = document.getElementById('banner-display');
      bannerDisplay.innerHTML = `<img src="${ev.target.result}" alt="背景图"><button class="banner-upload-btn" id="banner-upload-btn" title="更换背景图">更换背景</button>`;
    };
    reader.readAsDataURL(file);

    // 上传
    const formData = new FormData();
    formData.append('file', file);

    try {
      const result = await apiFetch('/api/account/banner', {
        method: 'POST',
        body: formData,
        headers: {}
      });

      if (result.success) {
        showToast('背景图已更新', 'success');
        Store.user.banner_url = result.banner_url;
      } else {
        showToast(result.message || '上传失败', 'error');
      }
    } catch (err) {
      showToast('上传失败', 'error');
    }

    e.target.value = '';
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: add avatar and banner upload interaction logic"
```

---

### Task 10: 运行测试验证功能

**Files:**
- Test: `tests/specs/auth/auth.spec.js`

- [ ] **Step 1: 运行现有测试**

```bash
cd G:\MindProject\MindAuth && npx playwright test tests/specs/auth/auth.spec.js --reporter=list
```

Expected: 所有测试通过

- [ ] **Step 2: 手动验证头像上传**

1. 启动服务：`npm run dev`
2. 登录账户
3. 访问 Dashboard
4. 点击头像上传按钮
5. 选择图片上传
6. 验证头像显示正确
7. 点击更换背景按钮
8. 验证背景图显示正确

- [ ] **Step 3: 验证黑白主题切换**

点击主题切换按钮，验证：
- Light 主题：按钮边框浅色、卡片白色背景
- Dark 主题：按钮边框半透明、卡片半透明背景

---

### Task 11: 最终提交

- [ ] **Step 1: 检查所有修改**

```bash
git status
```

- [ ] **Step 2: 推送更改**

```bash
git push origin main
```

---

## Self-Review Checklist

✅ **Spec coverage:**
- 头像上传功能 → Task 1-5, 7-9
- 数据库字段 → Task 2
- 按钮风格 → Task 6
- 黑白主题 → Task 6
- 头像组件 → Task 7-8

✅ **Placeholder scan:** 无 TBD/TODO

✅ **Type consistency:** 所有 API 路径、字段名一致 (avatar_url, banner_url)

---

Plan complete and saved to `docs/superpowers/plans/2026-05-30-mindauth-avatar-ui.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?