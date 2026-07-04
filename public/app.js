// Proxy-based reactive store
const Store = new Proxy({ user: null }, {
  set(target, key, value) {
    target[key] = value;
    document.dispatchEvent(new CustomEvent('statechange', { detail: { key, value } }));
    return true;
  }
});

let pendingHashNavigation = null;

function clearPendingHashNavigation() {
  if (pendingHashNavigation) {
    clearTimeout(pendingHashNavigation);
    pendingHashNavigation = null;
  }
}

function scheduleHashNavigation(hash, delayMs) {
  clearPendingHashNavigation();
  pendingHashNavigation = setTimeout(() => {
    pendingHashNavigation = null;
    location.hash = hash;
  }, delayMs);
}

// Handle non-hash URLs: redirect /login to #/login, /register to #/register
// This allows MindAuth to work with direct URL paths like /login?redirect=...
(function handleDirectUrls() {
  const path = window.location.pathname;
  const search = window.location.search;

  // Supported direct paths: /login, /register, /logout
  const supportedPaths = ['login', 'register', 'logout'];

  for (const supportedPath of supportedPaths) {
    if (path === '/' + supportedPath || path === supportedPath) {
      // Redirect to hash format after all scripts have loaded
      // Use setTimeout to ensure this runs after DOMContentLoaded handlers
      setTimeout(() => {
        const newHash = '/#/' + supportedPath + (search || '');
        // Use replace to avoid adding history entry
        window.location.replace(newHash);
      }, 0);
      return; // Stop IIFE execution, don't run rest of the script yet
    }
  }
})();

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
          <h1 class="auth-title">MindAuth 账号中心</h1>
          <p class="auth-subtitle">Mindustry 社区统一认证服务</p>
        </div>
        <div id="logout-status">
          <div class="empty-state">婢跺嫮鎮婃稉?..</div>
        </div>
      </div>
    </div>
  `,

  dashboard: `
    <div class="admin-content">
      <div class="admin-header">
        <div class="admin-title">账号中心</div>
        <button id="logout-btn" class="btn-secondary btn-sm">退出登录</button>
      </div>

      <!-- Profile Header with Banner and Avatar -->
      <div class="profile-header animate-fade-in-up" style="animation-delay: 0s">
        <div class="profile-banner" id="banner-display">
        <button class="banner-upload-btn" id="banner-upload-btn" title="更换封面">更换封面</button>
        </div>
        <div class="profile-avatar-container">
          <div class="profile-avatar" id="avatar-display">
            <span id="avatar-letter">U</span>
            <img id="avatar-img" src="" alt="婢舵潙鍎? style="display: none;">
          </div>
        <button class="avatar-upload-btn" id="avatar-upload-btn" title="更换头像">
            <span>棣冩懖</span>
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
            <span class="status-label">账号状态</span>
            <span id="verified-badge"></span>
          </div>
          <div class="status-row">
            <span class="status-label">濞夈劌鍞介弮鍫曟？</span>
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
        <a href="#account-settings" class="btn-outline">账号设置</a>
        </div>
      </div>
    </div>
  `,

  accountSettings: `
    <div class="admin-content">
      <div class="admin-header">
        <div class="admin-title">鐠佸墽鐤?/div>
        <a href="#dashboard" class="btn-secondary btn-sm" style="text-decoration: none;">返回/a>
      </div>

      <div class="card card-lg animate-fade-in-up" style="animation-delay: 0s">
        <div class="card-header-title">CHANGE PASSWORD</div>
        <form id="change-password-form" class="auth-form">
          <div class="form-group">
            <label class="form-label">旧密码</label>
            <input class="form-input" type="password" id="old_password" name="old_password" required placeholder="请输入旧密码">
          </div>
          <div class="form-group">
            <label class="form-label">新密码</label>
            <input class="form-input" type="password" id="new_password" name="new_password" required minlength="8" placeholder="请输入新密码（至少8位）">
            <p class="password-hint" style="color: var(--text-muted); font-size: 0.6875rem; margin-top: 0.25rem;">需要包含：大写字母 + 小写字母 + 数字</p>
          </div>
          <button type="submit" class="btn-primary">绾喛顓绘穱顔芥暭</button>
        </form>
      </div>

      <div class="card card-lg animate-fade-in-up" style="animation-delay: 0.1s">
        <div class="card-header-title">CHANGE EMAIL</div>
        <form id="change-email-form" class="auth-form">
          <div class="form-group">
            <label class="form-label">新邮箱</label>
            <input class="form-input" type="email" id="new_email" name="new_email" required placeholder="name@company.com">
          </div>
          <p style="color: var(--text-muted); font-size: 0.75rem; margin-bottom: 1rem;">我们需要向新邮箱发送验证邮件才能完成邮箱变更</p>
          <button type="submit" class="btn-primary">发送验证邮件</button>
        </form>
      </div>

      <div class="card card-lg animate-fade-in-up danger-zone" style="animation-delay: 0.2s">
        <div class="card-header-title">DELETE ACCOUNT</div>
        <p style="color: var(--text-muted); margin-bottom: 1rem; font-size: 0.8125rem;">删除账号后，所有关联数据将被清除，此操作不可撤销。请输入密码确认。</p>
        <form id="delete-account-form" class="auth-form">
          <div class="form-group">
        <label class="form-label">确认密码（删除后不可恢复）</label>
        <input class="form-input" type="password" id="delete_password" name="password" required placeholder="确认密码（删除后不可恢复）">
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
        <h1 class="auth-title">注册新账号</h1>
        <p class="auth-subtitle">填写以下信息创建您的账号</p>
        </div>
        <form id="reset-request-form" class="auth-form">
          <div class="form-group">
        <label class="form-label">验证码</label>
            <input class="form-input" type="email" id="email" name="email" required placeholder="name@company.com">
          </div>
        <button type="submit" class="btn-primary">注册</button>
        </form>
        <p class="auth-link">没有账户？ <a href="#register">创建一个</a></p>
      </div>
    </div>
  `,

  resetPassword: `
    <div class="auth-container">
      <div class="auth-box">
        <div class="auth-header">
          <div class="auth-logo"><div class="auth-logo-dot"></div>MindAuth</div>
        <h1 class="auth-title">重置密码</h1>
        <p class="auth-subtitle">请输入您的注册邮箱</p>
        </div>
        <form id="reset-password-form" class="auth-form">
          <div class="form-group">
        <label class="form-label">新密码</label>
        <input class="form-input" type="password" id="new_password" name="new_password" required minlength="8" placeholder="请输入新密码（至少8位）">
        <p class="password-hint" style="color: var(--text-muted); font-size: 0.6875rem; margin-top: 0.25rem;">需要包含：大写字母 + 小写字母 + 数字</p>
          </div>
          <button type="submit" class="btn-primary">绾喛顓绘穱顔芥暭</button>
        </form>
      </div>
    </div>
  `,

  verifyEmail: `
    <div class="auth-container">
      <div class="auth-box">
        <div class="auth-header">
          <div class="auth-logo"><div class="auth-logo-dot"></div>MindAuth</div>
          <h1 class="auth-title">妤犲矁鐦夐柇顔绢唸</h1>
        </div>
        <div id="verify-status">
          <div class="empty-state">濮濓絽婀宀冪槈...</div>
        </div>
      </div>
    </div>
  `
};

// Form content for login/register views (injected into LoginLayout template)
const loginFormContent = `
  <form id="login-form" class="auth-form">
    <div class="form-group">
        <label class="form-label">邮箱地址</label>
        <input class="form-input" type="text" id="username" name="username" required placeholder="请输入用户名">
    </div>
    <div class="form-group">
        <label class="form-label">密码</label>
        <input class="form-input" type="password" id="password" name="password" required placeholder="请输入密码">
    </div>
    <button type="submit" class="btn-primary">缂佈呯敾</button>
  </form>
        <p class="auth-link">没有账户？ <a href="#register">创建一个</a></p>
        <p class="auth-link"><a href="#reset-request">忘记密码</a></p>
`;

const registerFormContent = `
  <form id="register-form" class="auth-form">
    <div class="form-group">
        <label class="form-label">邮箱地址</label>
      <input class="form-input" type="text" id="username" name="username" required placeholder="2-50娑擃亜鐡х粭?>
    </div>
    <div class="form-group">
        <label class="form-label">验证码</label>
      <input class="form-input" type="email" id="email" name="email" required placeholder="name@company.com">
    </div>
    <div class="form-group">
        <label class="form-label">密码</label>
        <input class="form-input" type="password" id="password" name="password" required minlength="8" placeholder="请输入密码（至少8位）">
        <p class="password-hint" style="color: var(--text-muted); font-size: 0.6875rem; margin-top: 0.25rem;">需要包含：大写字母 + 小写字母 + 数字</p>
    </div>
        <button type="submit" class="btn-primary">继续</button>
  </form>
        <p class="auth-link">已有账户？ <a href="#login">返回登录</a></p>
`;

const authUiOverrides = {
  forms: {
    login: `
      <form id="login-form" class="auth-form">
        <div class="form-group">
          <label class="form-label">用户名</label>
          <input class="form-input" type="text" id="username" name="username" required placeholder="请输入用户名">
        </div>
        <div class="form-group">
          <label class="form-label">密码</label>
          <input class="form-input" type="password" id="password" name="password" required placeholder="请输入密码">
        </div>
        <button type="submit" class="btn-primary">登录</button>
      </form>
      <p class="auth-link">没有账号？ <a href="#register">去注册</a></p>
      <p class="auth-link"><a href="#reset-request">忘记密码</a></p>
    `,
    register: `
      <form id="register-form" class="auth-form">
        <div class="form-group">
          <label class="form-label">用户名</label>
          <input class="form-input" type="text" id="username" name="username" required placeholder="2-50 个字符">
        </div>
        <div class="form-group">
          <label class="form-label">邮箱</label>
          <input class="form-input" type="email" id="email" name="email" required placeholder="name@company.com">
        </div>
        <div class="form-group">
          <label class="form-label">密码</label>
          <input class="form-input" type="password" id="password" name="password" required minlength="8" placeholder="至少 8 位字符">
          <p class="password-hint" style="color: var(--text-muted); font-size: 0.6875rem; margin-top: 0.25rem;">建议包含字母、数字和符号。</p>
        </div>
        <button type="submit" class="btn-primary">注册</button>
      </form>
      <p class="auth-link">已有账号？ <a href="#login">去登录</a></p>
    `,
  },
  views: {
    logout: `
      <div class="auth-container">
        <div class="auth-box">
          <div class="auth-header">
            <div class="auth-logo"><div class="auth-logo-dot"></div>MindAuth</div>
            <h1 class="auth-title">退出登录</h1>
            <p class="auth-subtitle">正在处理退出请求。</p>
          </div>
          <div id="logout-status">
            <div class="empty-state">正在退出...</div>
          </div>
        </div>
      </div>
    `,
    resetRequest: `
      <div class="auth-container">
        <div class="auth-box">
          <div class="auth-header">
            <div class="auth-logo"><div class="auth-logo-dot"></div>MindAuth</div>
            <h1 class="auth-title">重置密码</h1>
            <p class="auth-subtitle">输入邮箱后，我们会发送重置链接。</p>
          </div>
          <form id="reset-request-form" class="auth-form">
            <div class="form-group">
              <label class="form-label">邮箱</label>
              <input class="form-input" type="email" id="email" name="email" required placeholder="name@company.com">
            </div>
            <button type="submit" class="btn-primary">发送重置邮件</button>
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
            <p class="auth-subtitle">输入新密码后即可完成重置。</p>
          </div>
          <form id="reset-password-form" class="auth-form">
            <div class="form-group">
              <label class="form-label">新密码</label>
              <input class="form-input" type="password" id="new_password" name="new_password" required minlength="8" placeholder="至少 8 位字符">
              <p class="password-hint" style="color: var(--text-muted); font-size: 0.6875rem; margin-top: 0.25rem;">建议包含字母、数字和符号。</p>
            </div>
            <button type="submit" class="btn-primary">保存新密码</button>
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
    `,
    dashboard: `
      <div class="auth-shell">
        <div class="auth-shell-top">
          <div>
            <div class="auth-shell-kicker">MindAuth</div>
            <h1 class="auth-shell-title">账号中心</h1>
            <p class="auth-shell-desc">查看登录状态、授权应用和账号资料。</p>
          </div>
          <button id="logout-btn" class="btn-secondary btn-sm">退出登录</button>
        </div>

        <div class="dashboard-grid">
          <section class="card card-lg panel-surface profile-panel">
            <div class="profile-cover" id="banner-display">
              <button class="banner-upload-btn" id="banner-upload-btn" title="更换背景图">更换背景</button>
            </div>
            <div class="profile-head">
              <div class="profile-avatar-wrap">
                <div class="profile-avatar" id="avatar-display">
                  <span id="avatar-letter">U</span>
                  <img id="avatar-img" src="" alt="头像" style="display:none;">
                </div>
                <button class="avatar-upload-btn" id="avatar-upload-btn" title="更换头像">+</button>
              </div>
              <div class="profile-meta">
                <div class="profile-name" id="username-display"></div>
                <div class="profile-email" id="email-display"></div>
              </div>
            </div>
            <input type="file" id="avatar-file-input" accept="image/jpeg,image/png,image/gif,image/webp" style="display:none;">
            <input type="file" id="banner-file-input" accept="image/jpeg,image/png,image/gif,image/webp" style="display:none;">
          </section>

          <section class="card card-lg panel-surface">
            <div class="card-header-title">账号状态</div>
            <div class="status-stack">
              <div class="status-row">
                <span class="status-label">邮箱验证</span>
                <span id="verified-badge"></span>
              </div>
              <div class="status-row">
                <span class="status-label">邮箱验证</span>
                <span class="status-value" id="created-display"></span>
              </div>
            </div>
            <div id="verification-actions" class="action-row" style="display:none; margin-top:1rem;">
              <button id="send-verify-btn" class="btn-outline">发送验证邮件</button>
            </div>
          </section>

          <section class="card card-lg panel-surface">
            <div class="card-header-title">登录记录</div>
            <div id="login-logs-container"><div class="empty-state">暂无记录</div></div>
          </section>

          <section class="card card-lg panel-surface notification-panel">
            <div class="card-header-row">
              <div class="card-header-title">通知中心 <span id="notification-count" class="notification-count" style="display:none;">0</span></div>
              <button id="mark-all-notifications-read-btn" class="btn-secondary btn-sm">全部已读</button>
            </div>
            <div id="notifications-container"><div class="empty-state">暂无通知</div></div>
          </section>

          <section class="card card-lg panel-surface">
            <div class="card-header-title">已授权应用</div>
            <div id="authorizations-container"><div class="empty-state">暂无授权应用</div></div>
          </section>

          <section class="card card-lg panel-surface">
            <div class="card-header-title">账号设置</div>
            <div class="action-row">
              <a href="#account-settings" class="btn-outline">进入设置</a>
            </div>
          </section>
        </div>
      </div>
    `,
    accountSettings: `
      <div class="auth-shell">
        <div class="auth-shell-top">
          <div>
            <div class="auth-shell-kicker">MindAuth</div>
            <h1 class="auth-shell-title">账号设置</h1>
            <p class="auth-shell-desc">修改密码、邮箱或删除账号。</p>
          </div>
          <a href="#dashboard" class="btn-secondary btn-sm" style="text-decoration:none;">返回</a>
        </div>

        <div class="dashboard-grid">
          <section class="card card-lg panel-surface">
            <div class="card-header-title">修改密码</div>
            <form id="change-password-form" class="auth-form auth-form-tight">
              <div class="form-group">
                <label class="form-label">当前密码</label>
                <input class="form-input" type="password" id="old_password" name="old_password" required placeholder="输入当前密码">
              </div>
              <div class="form-group">
                <label class="form-label">新密码</label>
                <input class="form-input" type="password" id="new_password" name="new_password" required minlength="8" placeholder="至少 8 位字符">
                <p class="password-hint">建议包含字母、数字和符号。</p>
              </div>
              <button type="submit" class="btn-primary">保存密码</button>
            </form>
          </section>

          <section class="card card-lg panel-surface">
            <div class="card-header-title">修改邮箱</div>
            <form id="change-email-form" class="auth-form auth-form-tight">
              <div class="form-group">
                <label class="form-label">新邮箱</label>
                <input class="form-input" type="email" id="new_email" name="new_email" required placeholder="name@company.com">
              </div>
              <button type="submit" class="btn-primary">保存邮箱</button>
            </form>
          </section>

          <section class="card card-lg panel-surface danger-zone">
            <div class="card-header-title">删除账号</div>
            <p class="danger-note">此操作不可恢复，请先确认是否真的需要删除。</p>
            <form id="delete-account-form" class="auth-form auth-form-tight">
              <div class="form-group">
                <label class="form-label">确认密码</label>
                <input class="form-input" type="password" id="delete_password" name="password" required placeholder="再次输入密码">
              </div>
              <button type="submit" class="btn-outline btn-danger">确认删除账号</button>
            </form>
          </section>
        </div>
      </div>
    `,
  },
};

/**
 * Inject form content into LoginLayout template HTML
 * @param {string} templateHtml - The LoginLayout template HTML
 * @param {string} formContent - The form HTML to inject
 * @param {string} title - The form title (e.g., "返回登录", "注册")
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
  clearPendingHashNavigation();

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
    app.innerHTML = authUiOverrides.views.logout || views.logout;

// 登录后 redirect_uri 跳转
    const urlQueryParams = new URLSearchParams(window.location.search);
    const hashQueryParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
    const redirectUri = urlQueryParams.get('redirect') || urlQueryParams.get('redirect_uri') || hashQueryParams.get('redirect') || hashQueryParams.get('redirect_uri');

    const statusDiv = document.getElementById('logout-status');
    try {
      const result = await apiFetch('/api/logout', { method: 'POST' });
      Store.user = null;

      if (result.success) {
        statusDiv.innerHTML = `
          <div class="verify-success">
            <div class="verify-icon">✓/div>
            <h2>瀹告煡鈧偓閸戣櫣娅ヨぐ?/h2>
            <p style="color: var(--text-muted);">您已退出 MindAuth</p>
            <p id="logout-redirect-hint" style="color: var(--text-muted); margin-top: 0.5rem;">
              <span id="logout-countdown">3</span> 缁夋帒鎮楃捄瀹犳祮
            </p>
          </div>
        <p class="auth-link"><a href="#login">返回登录</a></p>
        `;
      } else {
        // Even if the API reports failure, keep the same logout confirmation flow.
        statusDiv.innerHTML = `
            <h2>瀹告煡鈧偓閸戣櫣娅ヨぐ?/h2>
            <p style="color: var(--text-muted);">您已退出 MindAuth</p>
            <p id="logout-redirect-hint" style="color: var(--text-muted); margin-top: 0.5rem;">
              <span id="logout-countdown">3</span> 缁夋帒鎮楃捄瀹犳祮
            </p>
          </div>
        <p class="auth-link"><a href="#login">返回登录</a></p>
        `;
      }

      // 3缁夋帒鈧帟顓搁弮璺烘倵鐠哄疇娴?
      let countdown = 3;
      const countdownEl = document.getElementById('logout-countdown');
      const timer = setInterval(() => {
        countdown--;
        if (countdownEl) countdownEl.textContent = countdown;
        if (countdown <= 0) {
          clearInterval(timer);
// 简单重定向模式 redirect_uri 跳转
          if (redirectUri) {
            window.location.href = redirectUri;
          } else {
            // Fall back to history if we came from a same-site page.
            const hasReferrer = document.referrer && document.referrer.includes(window.location.host);
            if (hasReferrer) {
              window.history.back();
            } else {
              window.location.hash = 'login';
            }
          }
        }
      }, 1000);
    } catch (err) {
      // 缂冩垹绮堕柨娆掝嚖娑旂喕顫嬫稉鐑樺灇閸旂噦绱濋惄瀛樺复鐠哄疇娴?
      Store.user = null;
      if (redirectUri) {
        window.location.href = redirectUri;
      } else {
        window.location.hash = 'login';
      }
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
  // Note: hash query params may use either 'redirect' or 'redirect_uri' as the param name
  const redirectUri = urlQueryParams.get('redirect') || urlQueryParams.get('redirect_uri') || hashQueryParams.get('redirect') || hashQueryParams.get('redirect_uri');
  const clientId = urlQueryParams.get('client_id') || hashQueryParams.get('client_id');
  const state = urlQueryParams.get('state') || hashQueryParams.get('state');

  // Store redirect params for later use
// 1. OAuth 登录 redirect_uri + client_id
// 2. 登录后 redirect 跳转
  if (redirectUri) {
    sessionStorage.setItem('oauth_redirect_uri', redirectUri);
    if (clientId) {
      sessionStorage.setItem('oauth_client_id', clientId);
    }
    if (state) sessionStorage.setItem('oauth_state', state);
  }

  // Protect dashboard and account-settings
  if ((viewName === 'dashboard' || viewName === 'accountSettings') && !Store.user) {
    showToast('鐠囧嘲鍘涢惂璇茬秿', 'warning');
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
      const formContent = authUiOverrides.forms[viewName] || (viewName === 'login' ? loginFormContent : registerFormContent);
      const title = viewName === 'login' ? '鐧诲綍' : '娉ㄥ唽';
      views[viewName] = injectLoginFormContent(templateHtml, formContent, title);
    } catch (err) {
      console.error('Failed to load template:', err);
  app.innerHTML = '<div class="empty-state">加载失败，请刷新页面</div>';
      return;
    }
  }

  app.innerHTML = authUiOverrides.views[viewName] || views[viewName] || views.login;

  // Setup password visibility toggles for all password fields
  setupAllPasswordToggles();

  // Populate dashboard data
  if (viewName === 'dashboard' && Store.user) {
    const username = Store.user.username || 'User';

    // 婢舵潙鍎氶弰鍓с仛
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

    // Banner display
    const bannerDisplay = document.getElementById('banner-display');
    if (Store.user.banner_url) {
      bannerDisplay.innerHTML = `<img src="${Store.user.banner_url}" alt="Banner"><button class="banner-upload-btn" id="banner-upload-btn" title="更换封面">更换封面</button>`;
    }

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
    // Load notifications
    loadNotifications();
    // Load authorizations
    loadAuthorizations();
  }
}

// Event delegation for forms
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearPendingHashNavigation();
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
          await checkAuth();
          location.hash = 'dashboard';
        }
      } else {
        // Show toast for all login errors (for test compatibility)
        showToast(result.message, 'error');
        // Also show field-specific error for better UX
        if (result.message.includes('用户名') || result.message.includes('账号')) {
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
        showFieldError('email', '请输入邮箱');
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
        scheduleHashNavigation('login', 2000);
      } else {
        // Show specific field errors
        if (result.message.includes('用户名') || result.message.includes('账号')) {
          showFieldError('username', result.message);
        } else if (result.message.includes('邮箱')) {
          showFieldError('email', result.message);
        } else if (result.message.includes('密码')) {
          showFieldError('password', result.message);
        } else {
          showToast(result.message || '濞夈劌鍞芥径杈Е', 'error');
        }
      }
    }

    if (form.id === 'reset-request-form') {
      const formData = new FormData(form);
      const email = formData.get('email');

      if (!email) {
        showFieldError('email', '请输入邮箱');
        setButtonLoading(submitBtn, false);
        return;
      }

      const result = await apiFetch('/api/password/reset-request', {
        method: 'POST',
        body: { email }
      });

      if (result.success) {
        showToast(result.message, 'success');
        scheduleHashNavigation('login', 2000);
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
        scheduleHashNavigation('login', 2000);
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
        scheduleHashNavigation('login', 2000);
      } else {
        if (result.message.includes('密码')) {
          showToast(result.message, 'error');
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
        showFieldError('new_email', '请输入新邮箱');
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
        showFieldError('delete_password', '请输入确认密码');
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

  if (e.target.id === 'mark-all-notifications-read-btn') {
    const result = await apiFetch('/api/notifications/read-all', { method: 'PATCH' });
    showToast(result.message || (result.success ? '已全部标为已读' : '操作失败'), result.success ? 'success' : 'error');
    if (result.success) {
      loadNotifications();
    }
  }

  if (e.target.classList.contains('notification-read-btn')) {
    const id = e.target.dataset.id;
    const result = await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
    if (result.success) {
      loadNotifications();
    } else {
      showToast(result.message || '操作失败', 'error');
    }
  }

  if (e.target.classList.contains('notification-delete-btn')) {
    const id = e.target.dataset.id;
    const result = await apiFetch(`/api/notifications/${id}`, { method: 'DELETE' });
    showToast(result.message || (result.success ? '通知已删除' : '删除失败'), result.success ? 'success' : 'error');
    if (result.success) {
      loadNotifications();
    }
  }

  // Revoke authorization
  if (e.target.classList.contains('revoke-auth-btn')) {
    const clientId = e.target.dataset.clientId;
    if (!confirm('确认撤销该授权？')) return;

    const result = await apiFetch(`/api/authorizations/${clientId}`, { method: 'DELETE' });
    showToast(result.message, result.success ? 'success' : 'error');
    if (result.success) {
      loadAuthorizations();
    }
  }

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

    // 妤犲矁鐦夐弬鍥︽婢堆冪毈
    if (file.size > 2 * 1024 * 1024) {
      showToast('头像文件不能超过 2MB', 'error');
      e.target.value = '';
      return;
    }

// 上传文件
    const reader = new FileReader();
    reader.onload = (ev) => {
      const avatarImg = document.getElementById('avatar-img');
      const avatarLetter = document.getElementById('avatar-letter');
      avatarImg.src = ev.target.result;
      avatarImg.style.display = 'block';
      avatarLetter.style.display = 'none';
    };
    reader.readAsDataURL(file);

    // 娑撳﹣绱?
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

    e.target.value = ''; // 濞撳懐鈹?input
  }

  if (e.target.id === 'banner-file-input') {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
  showToast('封面文件不能超过 5MB', 'error');
      e.target.value = '';
      return;
    }

// 上传文件
    const reader = new FileReader();
    reader.onload = (ev) => {
      const bannerDisplay = document.getElementById('banner-display');
      bannerDisplay.innerHTML = `<img src="${ev.target.result}" alt="Banner"><button class="banner-upload-btn" id="banner-upload-btn" title="更换封面">更换封面</button>`;
    };
    reader.readAsDataURL(file);

    // 娑撳﹣绱?
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
      container.innerHTML = '<div class="empty-state">暂无授权应用</div>';
    }
  } catch (err) {
      container.innerHTML = '<div class="empty-state">暂无登录记录</div>';
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
          <span class="auth-time">授权时间 ${new Date(auth.last_used_at).toLocaleDateString()}</span>
          </div>
          <button class="revoke-auth-btn btn-ghost danger" data-client-id="${escapeHtml(auth.client_id)}">撤销授权</button>
        </div>
      `).join('');
    } else {
      container.innerHTML = '<div class="empty-state">暂无授权应用</div>';
    }
  } catch (err) {
      container.innerHTML = '<div class="empty-state">暂无登录记录</div>';
  }
}

function renderNotificationItem(notification) {
  return `
    <div class="notification-item ${notification.is_read ? 'read' : 'unread'}" data-id="${notification.id}">
      <div class="notification-main">
        <div class="notification-title">${escapeHtml(notification.title || '-')}</div>
        <div class="notification-content">${escapeHtml(notification.content || '')}</div>
        <div class="notification-meta">${escapeHtml(notification.type || '-')} · ${escapeHtml(formatDateTime(notification.created_at))}</div>
      </div>
      <div class="notification-actions">
        <button class="btn-sm notification-read-btn" data-id="${notification.id}" ${notification.is_read ? 'disabled' : ''}>${notification.is_read ? '已读' : '标为已读'}</button>
        <button class="btn-ghost danger btn-sm notification-delete-btn" data-id="${notification.id}">删除</button>
      </div>
    </div>
  `;
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

async function refreshNotificationCount() {
  const badge = document.getElementById('notification-count');
  if (!badge) return;
  try {
    const result = await apiFetch('/api/notifications/unread-count');
    if (result.success) {
      const count = Number(result.count || 0);
      if (count > 0) {
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.style.display = 'inline-flex';
      } else {
        badge.style.display = 'none';
      }
    }
  } catch {}
}

async function loadNotifications() {
  const container = document.getElementById('notifications-container');
  if (!container) return;

  container.innerHTML = '<div class="empty-state">加载中...</div>';
  try {
    const result = await apiFetch('/api/notifications?limit=10');
    if (result.success && result.notifications && result.notifications.length > 0) {
      container.innerHTML = result.notifications.map(renderNotificationItem).join('');
    } else {
      container.innerHTML = '<div class="empty-state">暂无通知</div>';
    }
    await refreshNotificationCount();
  } catch {
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
  app.innerHTML = authUiOverrides.views.verifyEmail;

  const result = await apiFetch('/api/email-verification/verify', {
    method: 'POST',
    body: { token }
  });

  const statusDiv = document.getElementById('verify-status');
  if (result.success) {
    statusDiv.innerHTML = `
      <div class="verify-success">
        <div class="verify-icon">✓</div>
        <h2>邮箱验证成功</h2>
        <p style="color: var(--text-muted);">你现在可以继续使用账户。</p>
      </div>
      <p class="auth-link"><a href="#login">返回登录</a></p>
    `;
  } else {
    statusDiv.innerHTML = `
      <div class="verify-error">
        <div class="verify-icon error">!</div>
        <h2>邮箱验证失败</h2>
        <p style="color: var(--text-muted);">${escapeHtml(result.message)}</p>
      </div>
      <p class="auth-link"><a href="#login">返回登录</a></p>
    `;
  }
}

// Initialize
window.addEventListener('hashchange', router);

// Handle both cases: DOMContentLoaded already fired or not yet
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    router();
  });
} else {
  // DOMContentLoaded already fired, run immediately
  (async () => {
    await checkAuth();
    router();
  })();
}
