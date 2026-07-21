// Authentication helpers: initial session check + email verification flow.
// Uses window globals (apiFetch) set by common.js.

import { Store } from './state.js';
import { escapeHtml } from './utils.js';
import { authUiOverrides } from './templates.js';

// Check auth status on load
export async function checkAuth() {
  try {
    const result = await apiFetch('/api/me');
    Store.user = result.success && result.id ? result : null;
  } catch {
    Store.user = null;
  }
}

// Verify email token
export async function verifyEmailToken(token) {
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
