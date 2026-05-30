# MindAuth UI 重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 MindAuth 登录页面白屏问题和 Dashboard 布局错位问题，统一使用 shared-styles 组件系统和 MagicUI 动画风格。

**Architecture:** 修改前端 HTML 结构和 CSS 样式，将自定义类名替换为 shared-styles 定义的组件类，添加入场动画效果。

**Tech Stack:** 纯前端修改 (HTML/CSS/JS)，无需后端改动

---

## File Structure

| 文件 | 职责 |
|------|------|
| `public/app.js` | SPA 视图定义，需要重构 dashboard 和 accountSettings 视图的 HTML 结构 |
| `public/style.css` | 样式定义，需要删除冲突样式，添加 MagicUI 动画类 |
| `tests/specs/auth/auth.spec.js` | E2E 测试，验证重构后功能正常 |

---

### Task 1: 添加 Dashboard 卡片入场动画类

**Files:**
- Modify: `public/style.css:1879` (文件末尾)

- [ ] **Step 1: 在 style.css 末尾添加 MagicUI 动画类**

```css
/* ========== Dashboard Card Entrance Animations ========== */
.animate-fade-in-up {
  animation: fade-in-up 0.4s ease-out forwards;
  opacity: 0;
}

@keyframes fade-in-up {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Dashboard specific styles */
.admin-content {
  padding: 1.5rem;
  min-height: 100vh;
  background: var(--bg);
  max-width: 640px;
  margin: 0 auto;
}

.admin-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border);
}

.admin-title {
  font-size: 1.125rem;
  font-weight: 500;
  color: var(--text);
}

.card-header-title {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.05em;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--border-light);
}

.profile-section {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.status-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.status-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.status-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.status-value {
  font-size: 0.875rem;
  color: var(--text);
}

.action-row {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-light);
}
```

- [ ] **Step 2: 验证 CSS 语法正确**

运行: 无需运行，CSS 已添加到文件末尾

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -m "style: add Dashboard card entrance animations and layout classes"
```

---

### Task 2: 重构 Dashboard 视图 HTML 结构

**Files:**
- Modify: `public/app.js:37-96`

- [ ] **Step 1: 替换 views.dashboard 定义**

找到 `dashboard: ` 开头的字符串（第37行），替换为：

```javascript
  dashboard: `
    <div class="admin-content">
      <div class="admin-header">
        <div class="admin-title">账户</div>
        <button id="logout-btn" class="btn-secondary btn-sm">退出</button>
      </div>

      <div class="card card-lg animate-fade-in-up" style="animation-delay: 0s">
        <div class="card-header-title">PROFILE</div>
        <div class="profile-section">
          <div class="user-card-avatar" id="avatar-display">U</div>
          <div>
            <div class="user-card-name" id="username-display"></div>
            <div class="user-card-title" id="email-display"></div>
          </div>
        </div>
      </div>

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

      <div class="card card-lg animate-fade-in-up" style="animation-delay: 0.2s">
        <div class="card-header-title">LOGIN HISTORY</div>
        <div id="login-logs-container">
          <div class="empty-state">加载中...</div>
        </div>
      </div>

      <div class="card card-lg animate-fade-in-up" style="animation-delay: 0.3s">
        <div class="card-header-title">AUTHORIZED APPS</div>
        <div id="authorizations-container">
          <div class="empty-state">加载中...</div>
        </div>
      </div>

      <div class="card card-lg animate-fade-in-up" style="animation-delay: 0.4s">
        <div class="card-header-title">ACCOUNT</div>
        <div class="action-row">
          <a href="#account-settings" class="btn-outline">账户设置</a>
        </div>
      </div>
    </div>
  `,
```

- [ ] **Step 2: 更新 Dashboard 数据填充代码**

找到第394-416行的 Dashboard 数据填充代码，更新 avatar-display 的样式引用：

原代码（第395-396行）:
```javascript
    const username = Store.user.username || 'User';
    document.getElementById('avatar-display').textContent = username.charAt(0).toUpperCase();
```

保持不变，因为 `#avatar-display` ID 仍然存在。

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "refactor: use shared-styles classes for Dashboard layout"
```

---

### Task 3: 重构 accountSettings 视图

**Files:**
- Modify: `public/app.js:98-148`

- [ ] **Step 1: 替换 views.accountSettings 定义**

找到 `accountSettings: ` 开头的字符串（第98行），替换为：

```javascript
  accountSettings: `
    <div class="admin-content">
      <div class="admin-header">
        <div class="admin-title">设置</div>
        <a href="#dashboard" class="btn-secondary btn-sm" style="text-decoration: none;">返回</a>
      </div>

      <div class="card card-lg animate-fade-in-up" style="animation-delay: 0s">
        <div class="card-header-title">CHANGE PASSWORD</div>
        <form id="change-password-form" class="auth-form">
          <div class="form-group">
            <label class="form-label">当前密码</label>
            <input class="form-input" type="password" id="old_password" name="old_password" required placeholder="输入当前密码">
          </div>
          <div class="form-group">
            <label class="form-label">新密码</label>
            <input class="form-input" type="password" id="new_password" name="new_password" required minlength="8" placeholder="至少8位，含大小写字母和数字">
            <p class="password-hint" style="color: var(--text-muted); font-size: 0.6875rem; margin-top: 0.25rem;">需要: 大写+小写+数字，至少8位</p>
          </div>
          <button type="submit" class="btn-primary">确认修改</button>
        </form>
      </div>

      <div class="card card-lg animate-fade-in-up" style="animation-delay: 0.1s">
        <div class="card-header-title">CHANGE EMAIL</div>
        <form id="change-email-form" class="auth-form">
          <div class="form-group">
            <label class="form-label">新邮箱地址</label>
            <input class="form-input" type="email" id="new_email" name="new_email" required placeholder="name@company.com">
          </div>
          <p style="color: var(--text-muted); font-size: 0.75rem; margin-bottom: 1rem;">更换邮箱需要验证新邮箱地址</p>
          <button type="submit" class="btn-primary">发送验证邮件</button>
        </form>
      </div>

      <div class="card card-lg animate-fade-in-up danger-zone" style="animation-delay: 0.2s">
        <div class="card-header-title">DELETE ACCOUNT</div>
        <p style="color: var(--text-muted); margin-bottom: 1rem; font-size: 0.8125rem;">删除账号将永久移除您的所有数据，此操作不可撤销。</p>
        <form id="delete-account-form" class="auth-form">
          <div class="form-group">
            <label class="form-label">输入密码确认</label>
            <input class="form-input" type="password" id="delete_password" name="password" required placeholder="输入密码确认删除">
          </div>
          <button type="submit" class="btn-outline btn-danger">确认删除账号</button>
        </form>
      </div>
    </div>
  `,
```

- [ ] **Step 2: Commit**

```bash
git add public/app.js
git commit -m "refactor: use shared-styles classes for accountSettings layout"
```

---

### Task 4: 清理旧的 Dashboard 样式定义

**Files:**
- Modify: `public/style.css:364-430, 1138-1156, 1592-1639`

- [ ] **Step 1: 删除冲突的 .user-card 样式**

找到第1592-1639行的 `.user-card` 相关样式（在 Entrance Animations 部分），删除以下代码：

```css
/* 删除这些行 (1592-1639) */
.user-card,
.settings-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  padding: var(--card-padding-lg);
  margin-bottom: 1rem;
  transition: box-shadow 0.2s ease;
}

.user-card:hover,
.settings-card:hover {
  box-shadow: var(--shadow-card-hover);
}

[data-theme="light"] .user-card:hover,
[data-theme="light"] .settings-card:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}

/* Entrance Animations */
.user-card,
.settings-card {
  animation: fade-in-up 0.4s ease-out;
}

@keyframes fade-in-up {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

注意：保留第1627-1658行的其他动画定义（logo-pulse, status-blink 等），只删除 `.user-card` 和 `.settings-card` 相关的定义。

- [ ] **Step 2: 删除旧的 dashboard-container 样式**

找到第364-430行，删除以下代码：

```css
/* 删除这些行 */
.dashboard-container {
  min-height: 100vh;
  background: var(--bg);
}

.dashboard-header {
  height: var(--header-height);
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1.5rem;
  position: sticky;
  top: 0;
  z-index: 10;
}

[data-theme="dark"] .dashboard-header {
  background: var(--bg);
  border-bottom-color: var(--border);
}

[data-theme="light"] .dashboard-header {
  background: rgba(250,250,250,0.95);
  backdrop-filter: blur(8px);
}

.dashboard-header h1 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text);
}

.header-logo-dot {
  width: 8px;
  height: 8px;
  background: var(--primary);
  border-radius: 50%;
}

.dashboard-main {
  padding: 1.5rem;
  max-width: 640px;
  margin: 0 auto;
}

.page-title {
  font-size: 1.125rem;
  font-weight: 500;
  color: var(--text);
  margin-bottom: 1.5rem;
}
```

- [ ] **Step 3: 删除响应式中的旧样式**

找到第1138-1156行，删除以下代码：

```css
/* 删除这些行 */
  .dashboard-header {
    padding: 0 1rem;
  }
  .dashboard-header h1 {
    font-size: 0.875rem;
  }
  .dashboard-main {
    padding: 1rem;
  }
```

- [ ] **Step 4: Commit**

```bash
git add public/style.css
git commit -m "refactor: remove old dashboard styles that conflict with shared-styles"
```

---

### Task 5: 运行测试验证功能

**Files:**
- Test: `tests/specs/auth/auth.spec.js`

- [ ] **Step 1: 运行 Playwright 测试**

```bash
cd G:\MindProject\MindAuth && npx playwright test tests/specs/auth/auth.spec.js --reporter=list
```

Expected: 所有 27 个测试通过

- [ ] **Step 2: 手动验证登录页面**

访问: http://localhost:4001/#login

Expected:
- 页面正常显示，无白屏
- 有入场动画效果（品牌区从左滑入，表单区从右滑入）

- [ ] **Step 3: 手动验证 Dashboard**

1. 登录账户
2. 访问 http://localhost:4001/#dashboard

Expected:
- 卡片布局正确，全宽显示
- 卡片依次入场动画
- PROFILE 卡片显示用户头像和名字
- STATUS 卡片显示验证状态

- [ ] **Step 4: 验证深色模式**

点击主题切换按钮

Expected:
- 深色模式下样式正确
- 卡片背景、文字颜色正确切换

---

### Task 6: 最终提交

- [ ] **Step 1: 检查所有修改**

```bash
git status
```

Expected: 只有 public/app.js 和 public/style.css 被修改

- [ ] **Step 2: 推送更改**

```bash
git push origin main
```

---

## Self-Review Checklist

✅ **Spec coverage:**
- 登录页面动画修复 → Task 1 (已在之前添加)
- Dashboard 布局重构 → Task 2
- accountSettings 重构 → Task 3
- 清理冲突样式 → Task 4
- 验证测试 → Task 5

✅ **Placeholder scan:** 无 TBD/TODO

✅ **Type consistency:** 所有 ID 选择器保持不变 (`#avatar-display`, `#username-display` 等)

---

Plan complete and saved to `docs/superpowers/plans/2026-05-30-mindauth-ui-refactor.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?