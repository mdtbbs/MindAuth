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
  login: null, // Dynamically loaded from LoginLayout template
  register: null, // Dynamically loaded from LoginLayout template
  logout: `
    <div class="auth-container">
      <div class="auth-box">
        <div class="auth-header">
          <div class="auth-logo"><div class="auth-logo-dot"></div>MindAuth</div>
          <h1 class="auth-title">退出登录</h1>
          <p class="auth-subtitle">正在退出...</p>
        </div>
        <div id="logout-status">
          <div class="empty-state">处理中...</div>
        </div>
      </div>
    </div>
  `,

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

// Form content for login/register views (injected into LoginLayout template)
const loginFormContent = `
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
`;

const registerFormContent = `
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
`;

/**
 * Inject form content into LoginLayout template HTML
 * @param {string} templateHtml - The LoginLayout template HTML
 * @param {string} formContent - The form HTML to inject
 * @param {string} title - The form title (e.g., "登录", "注册")
 * @returns {string} Complete HTML with injected content
 */
function injectLoginFormContent(templateHtml, formContent, title) {
  // Replace the form title in data-form-title attribute
  let html = templateHtml.replace(
    /(<[^>]*\bdata-form-title=")([^"]*)("[^>]*>)([^<]*)(<\/h3>)/i,
    `$1${title}$3${title}$5`
  );
  // Inject form content into data-form-content div
  // Use .*? to match content including HTML entities like &lt;
  html = html.replace(
    /(<div[^>]*\bdata-form-content[^>]*>).*?(<\/div>)/i,
    `$1${formContent}$2`
  );
  return html;
}

// Router
async function router() {
  // Get hash, remove # prefix and any leading /
  let hash = (location.hash.slice(1) || 'login').replace(/^\/+/, '');

  // Extract query params from hash
  const hashParts = hash.split('?');
  const rawViewName = hashParts[0];
  const hashQueryParams = new URLSearchParams(hashParts[1] || '');

  // Convert kebab-case to camelCase for view lookup
  const viewName = rawViewName.replace(/-([a-z])/g, (match, letter) => letter.toUpperCase());

  // Handle logout view - call logout API and redirect
  if (rawViewName === 'logout') {
    const app = document.getElementById('app');
    app.innerHTML = views.logout;

    const statusDiv = document.getElementById('logout-status');
    try {
      const result = await apiFetch('/api/logout', { method: 'POST' });
      Store.user = null;

      if (result.success) {
        statusDiv.innerHTML = `
          <div class="verify-success">
            <div class="verify-icon">✓</div>
            <h2>已退出登录</h2>
            <p style="color: var(--text-muted);">感谢使用 MindAuth</p>
            <p id="logout-redirect-hint" style="color: var(--text-muted); margin-top: 0.5rem;">
              <span id="logout-countdown">5</span> 秒后返回上一页
            </p>
          </div>
          <p class="auth-link"><a href="#login">重新登录</a></p>
        `;

        // 5秒倒计时后返回上一页
        let countdown = 5;
        const countdownEl = document.getElementById('logout-countdown');
        const timer = setInterval(() => {
          countdown--;
          if (countdownEl) countdownEl.textContent = countdown;
          if (countdown <= 0) {
            clearInterval(timer);
            // 检查是否有上一页可以返回
            const hasReferrer = document.referrer && document.referrer.includes(window.location.host);
            if (hasReferrer) {
              window.history.back();
            } else {
              window.location.hash = 'login';
            }
          }
        }, 1000);
      } else {
        statusDiv.innerHTML = `
          <div class="verify-error">
            <div class="verify-icon error">✗</div>
            <h2>退出失败</h2>
            <p style="color: var(--text-muted);">${escapeHtml(result.message || '未知错误')}</p>
          </div>
          <p class="auth-link"><a href="#login">返回登录</a></p>
        `;
      }
    } catch (err) {
      statusDiv.innerHTML = `
        <div class="verify-error">
          <div class="verify-icon error">✗</div>
          <h2>网络错误</h2>
          <p style="color: var(--text-muted);">无法连接到服务器</p>
        </div>
        <p class="auth-link"><a href="#login">返回登录</a></p>
      `;
    }
    return;
  }

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
  const redirectUri = urlQueryParams.get('redirect') || urlQueryParams.get('redirect_uri') || hashQueryParams.get('redirect_uri');
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

  // Redirect logged-in users away from auth pages
  if ((viewName === 'login' || viewName === 'register') && Store.user) {
    // Check if there's a pending OAuth redirect
    const pendingRedirectUri = sessionStorage.getItem('oauth_redirect_uri');
    const pendingClientId = sessionStorage.getItem('oauth_client_id');

    if (pendingRedirectUri && pendingClientId) {
      // OAuth mode: redirect to authorize endpoint
      const pendingState = sessionStorage.getItem('oauth_state');
      const authorizeUrl = `/api/authorize?redirect_uri=${encodeURIComponent(pendingRedirectUri)}&client_id=${pendingClientId}${pendingState ? '&state=' + encodeURIComponent(pendingState) : ''}`;
      window.location.href = authorizeUrl;
    } else {
      // No pending redirect: go to dashboard
      location.hash = 'dashboard';
    }
    return;
  }

  const app = document.getElementById('app');

  // Dynamically load login/register templates
  if ((viewName === 'login' || viewName === 'register') && !views[viewName]) {
    try {
      const templateHtml = await SharedLoader.loadTemplate('login-layout');
      const formContent = viewName === 'login' ? loginFormContent : registerFormContent;
      const title = viewName === 'login' ? '登录' : '注册';
      views[viewName] = injectLoginFormContent(templateHtml, formContent, title);
    } catch (err) {
      console.error('Failed to load template:', err);
      app.innerHTML = '<div class="empty-state">加载失败，请刷新页面</div>';
      return;
    }
  }

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

  // Clear previous errors
  clearFormErrors(form);

  // Set loading state
  setButtonLoading(submitBtn, true);

  try {
    if (form.id === 'login-form') {
      const formData = new FormData(form);
      const data = {
        username: formData.get('username'),
        password: formData.get('password')
      };

      // Validate fields
      if (!data.username) {
        showFieldError('username', '请输入用户名');
        setButtonLoading(submitBtn, false);
        return;
      }
      if (!data.password) {
        showFieldError('password', '请输入密码');
        setButtonLoading(submitBtn, false);
        return;
      }

      const result = await apiFetch('/api/login', { method: 'POST', body: data });

      if (result.success) {
        showToast('登录成功', 'success');
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
        // Show toast for all login errors (for test compatibility)
        showToast(result.message, 'error');
        // Also show field-specific error for better UX
        if (result.message.includes('用户名') || result.message.includes('账户')) {
          showFieldError('username', result.message);
        } else if (result.message.includes('密码')) {
          showFieldError('password', result.message);
        }
      }
    }

    if (form.id === 'register-form') {
      const formData = new FormData(form);
      const data = {
        username: formData.get('username'),
        email: formData.get('email'),
        password: formData.get('password')
      };

      // Validate fields
      if (!data.username) {
        showFieldError('username', '请输入用户名');
        setButtonLoading(submitBtn, false);
        return;
      }
      if (!data.email) {
        showFieldError('email', '请输入邮箱地址');
        setButtonLoading(submitBtn, false);
        return;
      }
      if (!data.password) {
        showFieldError('password', '请输入密码');
        setButtonLoading(submitBtn, false);
        return;
      }

      const result = await apiFetch('/api/register', { method: 'POST', body: data });

      if (result.success) {
        showToast(result.message || '注册成功，请登录', 'success');
        setTimeout(() => location.hash = 'login', 2000);
      } else {
        // Show specific field errors
        if (result.message.includes('用户名')) {
          showFieldError('username', result.message);
        } else if (result.message.includes('邮箱')) {
          showFieldError('email', result.message);
        } else if (result.message.includes('密码')) {
          showFieldError('password', result.message);
        } else {
          showToast(result.message || '注册失败', 'error');
        }
      }
    }

    if (form.id === 'reset-request-form') {
      const formData = new FormData(form);
      const email = formData.get('email');

      if (!email) {
        showFieldError('email', '请输入邮箱地址');
        setButtonLoading(submitBtn, false);
        return;
      }

      const result = await apiFetch('/api/password/reset-request', {
        method: 'POST',
        body: { email }
      });

      if (result.success) {
        showToast(result.message, 'success');
        setTimeout(() => location.hash = 'login', 2000);
      } else {
        showFieldError('email', result.message);
      }
    }

    if (form.id === 'reset-password-form') {
      const token = new URLSearchParams(location.hash.split('?')[1]).get('token');
      const formData = new FormData(form);
      const newPassword = formData.get('new_password');

      if (!newPassword) {
        showFieldError('new_password', '请输入新密码');
        setButtonLoading(submitBtn, false);
        return;
      }

      const result = await apiFetch('/api/password/reset', {
        method: 'POST',
        body: { token, new_password: newPassword }
      });

      if (result.success) {
        showToast(result.message, 'success');
        setTimeout(() => location.hash = 'login', 2000);
      } else {
        showFieldError('new_password', result.message);
      }
    }

    if (form.id === 'change-password-form') {
      const formData = new FormData(form);
      const data = {
        old_password: formData.get('old_password'),
        new_password: formData.get('new_password')
      };

      // Validate fields
      if (!data.old_password) {
        showFieldError('old_password', '请输入当前密码');
        setButtonLoading(submitBtn, false);
        return;
      }
      if (!data.new_password) {
        showFieldError('new_password', '请输入新密码');
        setButtonLoading(submitBtn, false);
        return;
      }

      const result = await apiFetch('/api/account/change-password', {
        method: 'POST',
        body: data
      });

      if (result.success) {
        showToast(result.message, 'success');
        Store.user = null;
        setTimeout(() => location.hash = 'login', 2000);
      } else {
        if (result.message.includes('当前密码') || result.message.includes('原密码')) {
          showFieldError('old_password', result.message);
        } else {
          showToast(result.message, 'error');
        }
      }
    }

    if (form.id === 'change-email-form') {
      const formData = new FormData(form);
      const newEmail = formData.get('new_email');

      if (!newEmail) {
        showFieldError('new_email', '请输入新邮箱地址');
        setButtonLoading(submitBtn, false);
        return;
      }

      const result = await apiFetch('/api/account/change-email', {
        method: 'POST',
        body: { new_email: newEmail }
      });

      if (result.success) {
        showToast(result.message, 'success');
        form.reset();
      } else {
        showFieldError('new_email', result.message);
      }
    }

    if (form.id === 'delete-account-form') {
      const formData = new FormData(form);
      const password = formData.get('password');

      if (!password) {
        showFieldError('delete_password', '请输入密码确认');
        setButtonLoading(submitBtn, false);
        return;
      }

      if (!confirm('确定要删除账号吗？此操作不可撤销！')) {
        setButtonLoading(submitBtn, false);
        return;
      }

      const result = await apiFetch('/api/account', {
        method: 'DELETE',
        body: { password }
      });

      if (result.success) {
        showToast(result.message, 'success');
        Store.user = null;
        location.hash = 'login';
      } else {
        showFieldError('delete_password', result.message);
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