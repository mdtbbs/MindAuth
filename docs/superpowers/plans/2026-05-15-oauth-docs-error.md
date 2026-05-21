# OAuth接入体验优化 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化第三方OAuth接入体验，提供清晰的接入文档和标准化的错误响应

**Architecture:** 独立静态页面方案 - docs.html和oauth-error.html复用现有style.css，oauth.js改用RFC6749标准错误格式

**Tech Stack:** Express, SQLite, 现有前端样式

---

### Task 1: 创建OAuth接入文档页面

**Files:**
- Create: `public/docs.html`

- [ ] **Step 1: 创建docs.html文档页面**

```html
<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OAuth 2.0 接入文档 - MindAuth</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="style.css">
  <style>
    .docs-container { max-width: 800px; margin: 0 auto; padding: 3rem 1.5rem; }
    .docs-header { margin-bottom: 2rem; }
    .docs-title { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.5rem; }
    .docs-subtitle { color: var(--text-muted); font-size: 0.8125rem; }
    .docs-section { margin-bottom: 2rem; }
    .docs-section-title { font-size: 0.875rem; font-weight: 600; margin-bottom: 1rem; color: var(--text); }
    .docs-section-desc { font-size: 0.8125rem; color: var(--text-secondary); margin-bottom: 1rem; }
    .endpoint-card { background: var(--bg-subtle); border: 1px solid var(--border); border-radius: var(--radius); padding: 1rem; margin-bottom: 1rem; }
    .endpoint-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
    .endpoint-method { font-size: 0.6875rem; font-weight: 600; padding: 0.25rem 0.5rem; background: var(--success); color: #fff; border-radius: 4px; }
    .endpoint-method.post { background: var(--warning); color: #18181b; }
    .endpoint-url { font-family: 'Geist Mono', monospace; font-size: 0.8125rem; color: var(--text); }
    .params-table { width: 100%; font-size: 0.75rem; }
    .params-table th { text-align: left; padding: 0.5rem; color: var(--text-muted); border-bottom: 1px solid var(--border); font-weight: 500; }
    .params-table td { padding: 0.5rem; color: var(--text-secondary); border-bottom: 1px solid var(--border); }
    .params-table td:first-child { font-family: 'Geist Mono', monospace; color: var(--text); }
    .code-block { background: var(--bg-muted); border: 1px solid var(--border); border-radius: var(--radius); padding: 1rem; margin-bottom: 1rem; overflow-x: auto; }
    .code-block pre { font-family: 'Geist Mono', monospace; font-size: 0.75rem; color: var(--text-secondary); white-space: pre-wrap; }
    .code-lang { font-size: 0.625rem; color: var(--text-muted); margin-bottom: 0.5rem; }
    .response-example { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem; }
    .highlight { color: var(--warning); }
    .note { font-size: 0.75rem; color: var(--text-muted); padding: 0.75rem; background: var(--bg-muted); border-radius: var(--radius); margin-top: 0.5rem; }
  </style>
</head>
<body>
  <div class="bg-pattern"></div>
  <button class="theme-toggle" onclick="toggleTheme()" title="切换主题">
    <span id="theme-icon">☀</span>
  </button>

  <div class="docs-container">
    <header class="docs-header">
      <div class="auth-logo"><div class="auth-logo-dot"></div>MindAuth</div>
      <h1 class="docs-title">OAuth 2.0 接入文档</h1>
      <p class="docs-subtitle">第三方应用接入指南</p>
    </header>

    <!-- 流程概述 -->
    <section class="docs-section">
      <h2 class="docs-section-title">接入流程</h2>
      <p class="docs-section-desc">MindAuth 使用标准 OAuth 2.0 授权码模式：</p>
      <div class="endpoint-card" style="font-size: 0.75rem; color: var(--text-secondary);">
        <p>1. 用户点击第三方应用的「登录」按钮</p>
        <p>2. 重定向到 <span class="highlight">/authorize</span> 端点</p>
        <p>3. 用户登录并授权（已登录则自动授权）</p>
        <p>4. 重定向回第三方应用，携带 <span class="highlight">code</span></p>
        <p>5. 第三方后端用 code 换取 <span class="highlight">access_token</span></p>
      </div>
    </section>

    <!-- 端点列表 -->
    <section class="docs-section">
      <h2 class="docs-section-title">API 端点</h2>

      <!-- authorize -->
      <div class="endpoint-card">
        <div class="endpoint-header">
          <span class="endpoint-method">GET</span>
          <span class="endpoint-url">/authorize</span>
        </div>
        <p class="docs-section-desc">授权端点，用户浏览器重定向到此URL发起授权请求</p>
        <table class="params-table">
          <thead><tr><th>参数</th><th>必需</th><th>说明</th></tr></thead>
          <tbody>
            <tr><td>client_id</td><td>是</td><td>应用客户端ID</td></tr>
            <tr><td>redirect_uri</td><td>是</td><td>回调地址，必须与管理后台配置一致</td></tr>
            <tr><td>state</td><td>推荐</td><td>防CSRF攻击，原样返回</td></tr>
            <tr><td>scope</td><td>可选</td><td>权限范围</td></tr>
          </tbody>
        </table>
        <p class="response-example">成功：重定向到 redirect_uri?code=xxx&state=xxx</p>
        <p class="response-example">失败：重定向到错误页面</p>
      </div>

      <!-- token -->
      <div class="endpoint-card">
        <div class="endpoint-header">
          <span class="endpoint-method post">POST</span>
          <span class="endpoint-url">/token</span>
        </div>
        <p class="docs-section-desc">Token交换端点，后端用授权码换取访问令牌</p>
        <table class="params-table">
          <thead><tr><th>参数</th><th>必需</th><th>说明</th></tr></thead>
          <tbody>
            <tr><td>code</td><td>是</td><td>授权码，5分钟内有效</td></tr>
            <tr><td>client_id</td><td>是</td><td>应用客户端ID</td></tr>
            <tr><td>client_secret</td><td>是</td><td>应用密钥</td></tr>
          </tbody>
        </table>
        <p class="response-example">返回：access_token, refresh_token, expires_in, user</p>
      </div>

      <!-- refresh -->
      <div class="endpoint-card">
        <div class="endpoint-header">
          <span class="endpoint-method post">POST</span>
          <span class="endpoint-url">/refresh</span>
        </div>
        <p class="docs-section-desc">刷新令牌端点，获取新的访问令牌</p>
        <table class="params-table">
          <thead><tr><th>参数</th><th>必需</th><th>说明</th></tr></thead>
          <tbody>
            <tr><td>refresh_token</td><td>是</td><td>刷新令牌</td></tr>
            <tr><td>client_id</td><td>是</td><td>应用客户端ID</td></tr>
            <tr><td>client_secret</td><td>是</td><td>应用密钥</td></tr>
          </tbody>
        </table>
        <p class="response-example">返回：access_token, expires_in, user</p>
      </div>

      <!-- verify -->
      <div class="endpoint-card">
        <div class="endpoint-header">
          <span class="endpoint-method post">POST</span>
          <span class="endpoint-url">/verify</span>
        </div>
        <p class="docs-section-desc">Session验证端点（同域场景）</p>
        <table class="params-table">
          <thead><tr><th>参数</th><th>必需</th><th>说明</th></tr></thead>
          <tbody>
            <tr><td>session_token</td><td>是</td><td>用户会话Token</td></tr>
          </tbody>
        </table>
        <p class="response-example">返回：user 信息</p>
      </div>
    </section>

    <!-- 示例代码 -->
    <section class="docs-section">
      <h2 class="docs-section-title">示例代码</h2>

      <div class="code-block">
        <p class="code-lang">JavaScript (发起授权)</p>
        <pre>// 构建授权URL并重定向
const authUrl = `/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}`;
window.location.href = authUrl;</pre>
      </div>

      <div class="code-block">
        <p class="code-lang">JavaScript (Token交换)</p>
        <pre>// 回调页面获取code后，后端交换token
const response = await fetch('/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    code: authCode,
    client_id: 'your_client_id',
    client_secret: 'your_client_secret'
  })
});
const data = await response.json();
// data.access_token, data.refresh_token, data.user</pre>
      </div>

      <div class="code-block">
        <p class="code-lang">Python (Token交换)</p>
        <pre>import requests

response = requests.post('/token', json={
    'code': auth_code,
    'client_id': 'your_client_id',
    'client_secret': 'your_client_secret'
})
data = response.json()
# data['access_token'], data['refresh_token'], data['user']</pre>
      </div>
    </section>

    <!-- 返回数据 -->
    <section class="docs-section">
      <h2 class="docs-section-title">返回数据格式</h2>
      <div class="code-block">
        <p class="code-lang">Token响应</p>
        <pre>{
  "success": true,
  "access_token": "xxx",
  "refresh_token": "xxx",
  "expires_in": 3600,
  "user": {
    "id": 1,
    "username": "user_name",
    "email": "user@example.com",
    "created_at": "2024-01-01"
  }
}</pre>
      </div>
      <div class="code-block">
        <p class="code-lang">错误响应</p>
        <pre>{
  "error": "invalid_grant",
  "error_description": "授权码无效或已过期"
}</pre>
      </div>
    </section>

    <!-- 注意事项 -->
    <section class="docs-section">
      <h2 class="docs-section-title">注意事项</h2>
      <div class="note">
        <p>• 授权码有效期为 5 分钟，且只能使用一次</p>
        <p>• access_token 有效期为 1 小时</p>
        <p>• refresh_token 有效期为 30 天</p>
        <p>• redirect_uri 必须与管理后台配置完全一致</p>
        <p>• 建议始终传递 state 参数防止 CSRF 攻击</p>
      </div>
    </section>
  </div>

  <script>
    function toggleTheme() {
      const html = document.documentElement;
      const current = html.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      document.getElementById('theme-icon').textContent = next === 'dark' ? '☀' : '☾';
      localStorage.setItem('theme', next);
    }
    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    document.getElementById('theme-icon').textContent = saved === 'dark' ? '☀' : '☾';
  </script>
</body>
</html>
```

- [ ] **Step 2: 验证页面可访问**

启动服务器后访问 `http://localhost:4001/docs.html`，确认：
- 页面正常显示
- 黑白主题切换正常
- 所有端点信息清晰可见

---

### Task 2: 创建OAuth错误UI页面

**Files:**
- Create: `public/oauth-error.html`

- [ ] **Step 1: 创建oauth-error.html错误页面**

```html
<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>授权错误 - MindAuth</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="style.css">
  <style>
    .error-container { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 2rem; }
    .error-box { max-width: 400px; text-align: center; }
    .error-icon { font-size: 3rem; margin-bottom: 1rem; color: var(--error); }
    .error-title { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.5rem; }
    .error-desc { font-size: 0.8125rem; color: var(--text-secondary); margin-bottom: 2rem; }
    .error-code { font-family: 'Geist Mono', monospace; font-size: 0.6875rem; color: var(--text-muted); margin-bottom: 1.5rem; padding: 0.5rem; background: var(--bg-muted); border-radius: var(--radius); }
  </style>
</head>
<body>
  <div class="bg-pattern"></div>
  <button class="theme-toggle" onclick="toggleTheme()" title="切换主题">
    <span id="theme-icon">☀</span>
  </button>

  <div class="error-container">
    <div class="error-box">
      <div class="error-icon">✗</div>
      <h1 class="error-title" id="error-title">授权失败</h1>
      <p class="error-desc" id="error-desc">发生错误，无法完成授权</p>
      <p class="error-code" id="error-code"></p>
      <button class="btn-primary" onclick="goBack()">返回</button>
    </div>
  </div>

  <script>
    function toggleTheme() {
      const html = document.documentElement;
      const current = html.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      document.getElementById('theme-icon').textContent = next === 'dark' ? '☀' : '☾';
      localStorage.setItem('theme', next);
    }

    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    document.getElementById('theme-icon').textContent = saved === 'dark' ? '☀' : '☾';

    // 解析URL参数显示错误信息
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    const description = params.get('description');

    const errorMessages = {
      'invalid_client': '应用不存在',
      'invalid_redirect': '回调地址不匹配',
      'invalid_request': '请求参数错误',
      'server_error': '服务器错误'
    };

    if (error) {
      document.getElementById('error-title').textContent = errorMessages[error] || '授权失败';
      document.getElementById('error-desc').textContent = description || '发生错误，无法完成授权';
      document.getElementById('error-code').textContent = `错误码: ${error}`;
    }

    function goBack() {
      if (document.referrer) {
        window.history.back();
      } else {
        window.location.href = '/';
      }
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: 验证错误页面**

访问 `http://localhost:4001/oauth-error.html?error=invalid_client&description=应用不存在`，确认：
- 页面显示错误图标和信息
- 错误码正确显示
- 返回按钮正常工作
- 黑白主题切换正常

---

### Task 3: 修改oauth.js标准化错误响应

**Files:**
- Modify: `src/routes/oauth.js`

- [ ] **Step 1: 定义标准错误响应函数**

在文件顶部添加：

```javascript
// RFC6749 标准错误响应
function oauthError(res, statusCode, error, description) {
  return res.status(statusCode).json({
    error,
    error_description: description
  });
}

const ERROR_CODES = {
  INVALID_REQUEST: { code: 'invalid_request', status: 400 },
  UNAUTHORIZED_CLIENT: { code: 'unauthorized_client', status: 401 },
  INVALID_CLIENT: { code: 'invalid_client', status: 401 },
  INVALID_GRANT: { code: 'invalid_grant', status: 401 },
  ACCESS_DENIED: { code: 'access_denied', status: 403 }
};
```

- [ ] **Step 2: 修改 /authorize 端点错误响应**

将现有的 res.status(400).json({ success: false, message: '...' }) 替换为：

```javascript
// 第15-17行：缺少参数
if (!redirect_uri || !client_id) {
  return res.redirect(`/oauth-error.html?error=invalid_request&description=${encodeURIComponent('缺少必需参数')}`);
}

// 第21-23行：无效client_id
if (!client) {
  return res.redirect(`/oauth-error.html?error=invalid_client&description=${encodeURIComponent('无效的 client_id')}`);
}

// 第26-28行：redirect_uri不匹配
if (client.redirect_uri !== redirect_uri) {
  return res.redirect(`/oauth-error.html?error=invalid_redirect&description=${encodeURIComponent('redirect_uri 不匹配')}`);
}

// 第60-62行：服务器错误
res.redirect(`/oauth-error.html?error=server_error&description=${encodeURIComponent('授权失败')}`);
```

- [ ] **Step 3: 修改 /token 端点错误响应**

将现有错误响应替换为标准格式：

```javascript
// 第70-72行：缺少参数
if (!code || !client_id || client_secret) {
  return oauthError(res, 400, 'invalid_request', '缺少必需参数');
}

// 第75-78行：无效client
if (!client) {
  return oauthError(res, 401, 'invalid_client', '无效的 client_id 或 client_secret');
}

// 第81-84行：无效code
if (!authCode) {
  return oauthError(res, 401, 'invalid_grant', '无效、过期或已使用的授权码');
}

// 第109-111行：服务器错误
oauthError(res, 500, 'server_error', 'Token交换失败');
```

- [ ] **Step 4: 修改 /refresh 端点错误响应**

```javascript
// 第119-121行：缺少参数
if (!refresh_token || !client_id || !client_secret) {
  return oauthError(res, 400, 'invalid_request', '缺少必需参数');
}

// 第124-127行：无效client
if (!client) {
  return oauthError(res, 401, 'invalid_client', '无效的 client_id 或 client_secret');
}

// 第135-137行：无效refresh_token
if (!storedToken) {
  return oauthError(res, 401, 'invalid_grant', '无效或已过期的 refresh_token');
}

// 第153-155行：服务器错误
oauthError(res, 500, 'server_error', '刷新Token失败');
```

- [ ] **Step 5: 验证API错误响应格式**

使用curl或浏览器测试：
```bash
curl -X POST http://localhost:4001/api/token -H "Content-Type: application/json" -d '{"code":"invalid"}'
```

预期返回：
```json
{"error":"invalid_request","error_description":"缺少必需参数"}
```

---

### Task 4: 完整测试验证

- [ ] **Step 1: 测试文档页面**

访问 `/docs.html`，确认：
- 所有端点信息正确
- 示例代码可复制
- 主题切换正常

- [ ] **Step 2: 测试错误页面**

测试不同错误场景：
- `/oauth-error.html?error=invalid_client` → 显示「应用不存在」
- `/oauth-error.html?error=invalid_redirect` → 显示「回调地址不匹配」
- `/oauth-error.html?error=invalid_request` → 显示「请求参数错误」

- [ ] **Step 3: 测试API错误响应**

```bash
# 缺少参数
curl -X POST http://localhost:4001/api/token -d '{}'
# 预期: {"error":"invalid_request","error_description":"缺少必需参数"}

# 无效client
curl -X POST http://localhost:4001/api/token -d '{"code":"x","client_id":"invalid","client_secret":"x"}'
# 预期: {"error":"invalid_client","error_description":"无效的 client_id 或 client_secret"}
```

- [ ] **Step 4: 提交代码**

```bash
git add public/docs.html public/oauth-error.html src/routes/oauth.js
git commit -m "feat: 添加OAuth接入文档和标准化错误响应"
```

---

## 完成标准

- [ ] docs.html 可访问，内容清晰
- [ ] oauth-error.html 正确显示各类错误
- [ ] API错误响应符合RFC6749格式
- [ ] 所有页面支持黑白主题切换