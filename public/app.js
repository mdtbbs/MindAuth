// Proxy-based reactive store
const Store = new Proxy({ user: null }, {
  set(target, key, value) {
    target[key] = value;
    document.dispatchEvent(new CustomEvent('statechange', { detail: { key, value } }));
    return true;
  }
});

// HTML escape function for XSS prevention
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Views
const views = {
  login: `
    <div class="auth-container">
      <div class="auth-box">
        <div class="auth-header">
          <div class="auth-logo"><div class="auth-logo-dot"></div>MindAuth</div>
          <h1 class="auth-title">登录</h1>
          <p class="auth-subtitle">进入您的账户</p>
        </div>
        <form id="login-form" class="auth-form">
          <div class="form-group">
            <label class="form-label">用户名</label>
            <input class="form-input" type="text" id="username" name="username" required placeholder="请输入用户名">
          </div>
          <div class="form-group">
            <label class="form-label">密码</label>
            <input class="form-input" type="password" id="password" name="password" required placeholder="输入密码">
          </div>
          <button type="submit" class="btn-primary">继续</button>
        </form>
        <p class="auth-link">没有账户? <a href="#register">创建一个</a></p>
        <p class="auth-link"><a href="#reset-request">忘记密码?</a></p>
      </div>
    </div>
  `,

  register: `
    <div class="auth-container">
      <div class="auth-box">
        <div class="auth-header">
          <div class="auth-logo"><div class="auth-logo-dot"></div>MindAuth</div>
          <h1 class="auth-title">注册</h1>
          <p class="auth-subtitle">创建您的账户</p>
        </div>
        <form id="register-form" class="auth-form">
          <div class="form-group">
            <label class="form-label">用户名</label>
            <input class="form-input" type="text" id="username" name="username" required placeholder="2-50个字符">
          </div>
          <div class="form-group">
            <label class="form-label">邮箱地址</label>
            <input class="form-input" type="email" id="email" name="email" required placeholder="name@company.com">
          </div>
          <div class="form-group">
            <label class="form-label">密码</label>
            <input class="form-input" type="password" id="password" name="password" required minlength="8" placeholder="至少8位，含大小写字母和数字">
            <p class="password-hint" style="color: var(--text-muted); font-size: 0.6875rem; margin-top: 0.25rem;">需要: 大写+小写+数字，至少8位</p>
          </div>
          <button type="submit" class="btn-primary">创建账户</button>
        </form>
        <p class="auth-link">已有账户? <a href="#login">登录</a></p>
      </div>
    </div>
  `,

  dashboard: `
    <div class="dashboard-container">
      <header class="dashboard-header">
        <h1><div class="header-logo-dot"></div>MindAuth</h1>
        <button id="logout-btn" class="btn-secondary">退出</button>
      </header>
      <main class="dashboard-main">
        <h1 class="page-title">账户</h1>

        <div class="user-card">
          <div class="card-header">PROFILE</div>
          <div class="profile-row">
            <div class="profile-avatar" id="avatar-display">U</div>
            <div>
              <div class="profile-name" id="username-display"></div>
              <div class="profile-email" id="email-display"></div>
            </div>
          </div>
        </div>

        <div class="user-card">
          <div class="card-header">STATUS</div>
          <div class="user-info">
            <div class="user-info-item">
              <span class="user-info-label">邮箱验证</span>
              <span id="verified-badge"></span>
            </div>
            <div class="user-info-item">
              <span class="user-info-label">注册时间</span>
              <span class="user-info-value" id="created-display"></span>
            </div>
          </div>
          <div id="verification-actions" class="action-row" style="display: none;">
            <button id="send-verify-btn" class="btn-outline">发送验证邮件</button>
          </div>
        </div>

        <div class="user-card">
          <div class="card-header">LOGIN HISTORY</div>
          <div id="login-logs-container">
            <div class="empty-state">加载中...</div>
          </div>
        </div>

        <div class="user-card">
          <div class="card-header">AUTHORIZED APPS</div>
          <div id="authorizations-container">
            <div class="empty-state">加载中...</div>
          </div>
        </div>

        <div class="user-card">
          <div class="card-header">ACCOUNT</div>
          <div class="action-row">
            <a href="#account-settings" class="btn-outline">账户设置</a>
          </div>
        </div>
      </main>
    </div>
  `,

  accountSettings: `
    <div class="dashboard-container">
      <header class="dashboard-header">
        <h1><div class="header-logo-dot"></div>MindAuth</h1>
        <a href="#dashboard" class="btn-secondary" style="text-decoration: none;">返回</a>
      </header>
      <main class="dashboard-main">
        <h1 class="page-title">设置</h1>

        <div class="settings-card">
          <div class="card-header">CHANGE PASSWORD</div>
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

        <div class="settings-card">
          <div class="card-header">CHANGE EMAIL</div>
          <form id="change-email-form" class="auth-form">
            <div class="form-group">
              <label class="form-label">新邮箱地址</label>
              <input class="form-input" type="email" id="new_email" name="new_email" required placeholder="name@company.com">
            </div>
            <p style="color: var(--text-muted); font-size: 0.75rem; margin-bottom: 1rem;">更换邮箱需要验证新邮箱地址</p>
            <button type="submit" class="btn-primary">发送验证邮件</button>
          </form>
        </div>

        <div class="settings-card danger-zone">
          <div class="card-header">DELETE ACCOUNT</div>
          <p style="color: var(--text-muted); margin-bottom: 1rem; font-size: 0.8125rem;">删除账号将永久移除您的所有数据，此操作不可撤销。</p>
          <form id="delete-account-form" class="auth-form">
            <div class="form-group">
              <label class="form-label">输入密码确认</label>
              <input class="form-input" type="password" id="delete_password" name="password" required placeholder="输入密码确认删除">
            </div>
            <button type="submit" class="btn-outline btn-danger">确认删除账号</button>
          </form>
        </div>
      </main>
    </div>
  `,

  resetRequest: `
    <div class="auth-container">
      <div class="auth-box">
        <div class="auth-header">
          <div class="auth-logo"><div class="auth-logo-dot"></div>MindAuth</div>
          <h1 class="auth-title">重置密码</h1>
          <p class="auth-subtitle">输入邮箱获取重置链接</p>
        </div>
        <form id="reset-request-form" class="auth-form">
          <div class="form-group">
            <label class="form-label">邮箱地址</label>
            <input class="form-input" type="email" id="email" name="email" required placeholder="name@company.com">
          </div>
          <button type="submit" class="btn-primary">发送重置链接</button>
        </form>
        <p class="auth-link"><a href="#login">返回登录</a></p>
      </div>
    </div>
  `,

  resetPassword: `
    <div class="auth-container">
      <div class="auth-box">
        <div class="auth-header">
          <div class="auth-logo"><div class="auth-logo-dot"></div>MindAuth</div>
          <h1 class="auth-title">设置新密码</h1>
          <p class="auth-subtitle">请输入新密码</p>
        </div>
        <form id="reset-password-form" class="auth-form">
          <div class="form-group">
            <label class="form-label">新密码</label>
            <input class="form-input" type="password" id="new_password" name="new_password" required minlength="8" placeholder="至少8位，含大小写字母和数字">
            <p class="password-hint" style="color: var(--text-muted); font-size: 0.6875rem; margin-top: 0.25rem;">需要: 大写+小写+数字，至少8位</p>
          </div>
          <button type="submit" class="btn-primary">确认修改</button>
        </form>
      </div>
    </div>
  `,

  verifyEmail: `
    <div class="auth-container">
      <div class="auth-box">
        <div class="auth-header">
          <div class="auth-logo"><div class="auth-logo-dot"></div>MindAuth</div>
          <h1 class="auth-title">验证邮箱</h1>
        </div>
        <div id="verify-status">
          <div class="empty-state">正在验证...</div>
        </div>
      </div>
    </div>
  `
};

// Router
function router() {
  let hash = location.hash.slice(1) || 'login';

  // Extract query params from hash
  const hashParts = hash.split('?');
  const rawViewName = hashParts[0];
  const hashQueryParams = new URLSearchParams(hashParts[1] || '');

  // Convert kebab-case to camelCase for view lookup
  const viewName = rawViewName.replace(/-([a-z])/g, (match, letter) => letter.toUpperCase());

  // Handle verify-email view with token
  if (rawViewName === 'verify-email') {
    const token = hashQueryParams.get('token');
    if (token) {
      verifyEmailToken(token);
    }
    return;
  }

  // Also check URL query params (for direct /login?redirect=... links)
  const urlQueryParams = new URLSearchParams(window.location.search);

  // Merge: URL query params take precedence for redirect_uri/client_id
  const redirectUri = urlQueryParams.get('redirect') || urlQueryParams.get('redirect_uri') || hashQueryParams.get('redirect_uri') || 'http://localhost:4000/api/auth/callback';
  const clientId = urlQueryParams.get('client_id') || hashQueryParams.get('client_id');
  const state = urlQueryParams.get('state') || hashQueryParams.get('state');

  // Store redirect params for later use
  // 支持两种模式：
  // 1. OAuth模式：有 redirect_uri + client_id
  // 2. 简单重定向模式：只有 redirect 参数
  if (redirectUri) {
    sessionStorage.setItem('oauth_redirect_uri', redirectUri);
    if (clientId) {
      sessionStorage.setItem('oauth_client_id', clientId);
    }
    if (state) sessionStorage.setItem('oauth_state', state);
  }

  // Protect dashboard and account-settings
  if ((viewName === 'dashboard' || viewName === 'accountSettings') && !Store.user) {
    showToast('请先登录', 'warning');
    location.hash = 'login';
    return;
  }

  const app = document.getElementById('app');
  app.innerHTML = views[viewName] || views.login;

  // Setup password visibility toggles for all password fields
  setupAllPasswordToggles();

  // Populate dashboard data
  if (viewName === 'dashboard' && Store.user) {
    const username = Store.user.username || 'User';
    document.getElementById('avatar-display').textContent = username.charAt(0).toUpperCase();
    document.getElementById('username-display').textContent = username;
    document.getElementById('email-display').textContent = Store.user.email;
    document.getElementById('created-display').textContent = Store.user.created_at || '-';

    // Show verification status
    const verifiedBadge = document.getElementById('verified-badge');
    const verificationActions = document.getElementById('verification-actions');

    if (Store.user.email_verified) {
      verifiedBadge.innerHTML = '<span class="status-dot">已验证</span>';
    } else {
      verifiedBadge.innerHTML = '<span class="status-dot warn">未验证</span>';
      verificationActions.style.display = 'block';
    }

    // Load login logs
    loadLoginLogs();
    // Load authorizations
    loadAuthorizations();
  }
}

// Event delegation for forms
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');

  // Set loading state
  setButtonLoading(submitBtn, true);

  try {
    if (form.id === 'login-form') {
      const formData = new FormData(form);
      const data = {
        username: formData.get('username'),
        password: formData.get('password')
      };

      const result = await apiFetch('/api/login', { method: 'POST', body: data });

      if (result.success) {
        await checkAuth();

        // Check redirect after login
        const redirectUri = sessionStorage.getItem('oauth_redirect_uri');
        const clientId = sessionStorage.getItem('oauth_client_id');

        if (redirectUri) {
          // Clear stored params
          const state = sessionStorage.getItem('oauth_state');
          sessionStorage.removeItem('oauth_redirect_uri');
          sessionStorage.removeItem('oauth_client_id');
          sessionStorage.removeItem('oauth_state');

          if (clientId) {
            // OAuth mode: redirect to authorize endpoint
            const authorizeUrl = `/api/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&client_id=${clientId}${state ? '&state=' + encodeURIComponent(state) : ''}`;
            window.location.href = authorizeUrl;
          } else {
            // Simple redirect mode: redirect directly
            const finalRedirect = state ? `${redirectUri}?state=${encodeURIComponent(state)}` : redirectUri;
            window.location.href = finalRedirect;
          }
        } else {
          location.hash = 'dashboard';
        }
      } else {
        showToast(result.message, 'error');
      }
    }

    if (form.id === 'register-form') {
      const formData = new FormData(form);
      const data = {
        username: formData.get('username'),
        email: formData.get('email'),
        password: formData.get('password')
      };

      const result = await apiFetch('/api/register', { method: 'POST', body: data });

      showToast(result.message || '注册失败', result.success ? 'success' : 'error');
      if (result.success) {
        setTimeout(() => location.hash = 'login', 2000);
      }
    }

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

    if (form.id === 'change-password-form') {
      const formData = new FormData(form);
      const data = {
        old_password: formData.get('old_password'),
        new_password: formData.get('new_password')
      };

      const result = await apiFetch('/api/account/change-password', {
        method: 'POST',
        body: data
      });

      showToast(result.message, result.success ? 'success' : 'error');
      if (result.success) {
        Store.user = null;
        setTimeout(() => location.hash = 'login', 2000);
      }
    }

    if (form.id === 'change-email-form') {
      const formData = new FormData(form);
      const data = { new_email: formData.get('new_email') };

      const result = await apiFetch('/api/account/change-email', {
        method: 'POST',
        body: data
      });

      showToast(result.message, result.success ? 'success' : 'error');
      if (result.success) {
        form.reset();
      }
    }

    if (form.id === 'delete-account-form') {
      if (!confirm('确定要删除账号吗？此操作不可撤销！')) {
        setButtonLoading(submitBtn, false);
        return;
      }

      const formData = new FormData(form);
      const data = { password: formData.get('password') };

      const result = await apiFetch('/api/account', {
        method: 'DELETE',
        body: data
      });

      showToast(result.message, result.success ? 'success' : 'error');
      if (result.success) {
        Store.user = null;
        location.hash = 'login';
      }
    }
  } finally {
    setButtonLoading(submitBtn, false);
  }
});

// Logout handler
document.addEventListener('click', async (e) => {
  if (e.target.id === 'logout-btn') {
    const result = await apiFetch('/api/logout', { method: 'POST' });
    if (result.success) {
      Store.user = null;
      location.hash = 'login';
    }
  }

  if (e.target.id === 'send-verify-btn') {
    const result = await apiFetch('/api/email-verification/send', { method: 'POST' });
    showToast(result.message, result.success ? 'success' : 'error');
  }

  // Revoke authorization
  if (e.target.classList.contains('revoke-auth-btn')) {
    const clientId = e.target.dataset.clientId;
    if (!confirm('确定要撤销此应用的授权吗？')) return;

    const result = await apiFetch(`/api/authorizations/${clientId}`, { method: 'DELETE' });
    showToast(result.message, result.success ? 'success' : 'error');
    if (result.success) {
      loadAuthorizations();
    }
  }
});

// Load login logs
async function loadLoginLogs() {
  const container = document.getElementById('login-logs-container');
  try {
    const result = await apiFetch('/api/login-logs');
    if (result.success && result.logs.length > 0) {
      container.innerHTML = result.logs.map(log => `
        <div class="log-item">
          <div>
            <span class="log-type ${log.login_type === 'oauth' ? 'oauth' : ''}">${log.login_type === 'oauth' ? 'OAuth' : 'Web'}</span>
            <span class="log-ip">${escapeHtml(log.ip)}</span>
          </div>
          <span class="log-time">${new Date(log.created_at).toLocaleString()}</span>
        </div>
      `).join('');
    } else {
      container.innerHTML = '<div class="empty-state">暂无登录记录</div>';
    }
  } catch (err) {
    container.innerHTML = '<div class="empty-state">加载失败</div>';
  }
}

// Load authorizations
async function loadAuthorizations() {
  const container = document.getElementById('authorizations-container');
  try {
    const result = await apiFetch('/api/authorizations');
    if (result.success && result.authorizations.length > 0) {
      container.innerHTML = result.authorizations.map(auth => `
        <div class="auth-item">
          <div class="auth-info">
            <span class="auth-name">${escapeHtml(auth.name)}</span>
            <span class="auth-time">授权: ${new Date(auth.last_used_at).toLocaleDateString()}</span>
          </div>
          <button class="revoke-auth-btn btn-ghost danger" data-client-id="${escapeHtml(auth.client_id)}">撤销</button>
        </div>
      `).join('');
    } else {
      container.innerHTML = '<div class="empty-state">暂无授权应用</div>';
    }
  } catch (err) {
    container.innerHTML = '<div class="empty-state">加载失败</div>';
  }
}

// Check auth status on load
async function checkAuth() {
  try {
    const result = await apiFetch('/api/me');
    Store.user = result.success && result.id ? result : null;
  } catch {
    Store.user = null;
  }
}

// Verify email token
async function verifyEmailToken(token) {
  const app = document.getElementById('app');
  app.innerHTML = views.verifyEmail;

  const result = await apiFetch('/api/email-verification/verify', {
    method: 'POST',
    body: { token }
  });

  const statusDiv = document.getElementById('verify-status');
  if (result.success) {
    statusDiv.innerHTML = `
      <div class="verify-success">
        <div class="verify-icon">✓</div>
        <h2>验证成功</h2>
        <p style="color: var(--text-muted);">您的邮箱已验证</p>
      </div>
      <p class="auth-link"><a href="#login">前往登录</a></p>
    `;
  } else {
    statusDiv.innerHTML = `
      <div class="verify-error">
        <div class="verify-icon error">✗</div>
        <h2>验证失败</h2>
        <p style="color: var(--text-muted);">${escapeHtml(result.message)}</p>
      </div>
      <p class="auth-link"><a href="#login">返回</a></p>
    `;
  }
}

// Initialize
window.addEventListener('hashchange', router);
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  router();
});