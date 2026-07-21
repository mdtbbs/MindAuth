// All view HTML templates used by the user SPA.
// Kept in a single module so that the router and auth handlers can share them
// without duplication. Mutable exports (views, authUiOverrides) are live-bound
// across importers, so runtime assignment (views.login = ...) works everywhere.

// Views
export const views = {
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
          <div class="empty-state">正在处理...</div>
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
          <h1 class="auth-title">重置密码</h1>
          <p class="auth-subtitle">输入新密码后即可完成重置。</p>
        </div>
        <form id="reset-password-form" class="auth-form">
          <div class="form-group">
            <label class="form-label">新密码</label>
            <input class="form-input" type="password" id="new_password" name="new_password" required minlength="8" placeholder="至少 8 位字符">
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
};

// Form content for login/register views (injected into LoginLayout template)
export const loginFormContent = `
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

export const registerFormContent = `
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

export const authUiOverrides = {
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
