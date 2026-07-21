// Hash router for the user SPA.
// Uses window globals (apiFetch, showToast, SharedLoader, setupAllPasswordToggles)
// set by common.js and shared-loader.js.

import { Store, clearPendingHashNavigation } from './state.js';
import { escapeHtml, injectLoginFormContent } from './utils.js';
import { views, authUiOverrides, loginFormContent, registerFormContent } from './templates.js';
import { verifyEmailToken } from './auth.js';
import { loadLoginLogs, loadNotifications, loadAuthorizations } from './dashboard.js';

export async function router() {
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
            <h2>瀹告煡鈧偓閸戣櫣娅ヨぐ?/h2>
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
            <h2>瀹告煡鈧偓閸戣櫣娅ヨぐ?/h2>
            <p style="color: var(--text-muted);">您已退出 MindAuth</p>
            <p id="logout-redirect-hint" style="color: var(--text-muted); margin-top: 0.5rem;">
              <span id="logout-countdown">3</span> 缁夋帒鎮楃捄瀹犳祮
            </p>
          </div>
        <p class="auth-link"><a href="#login">返回登录</a></p>
        `;
      }

      // 3缁夋帒鈧帟顓搁弮璺烘倵鐠哄疇娴?
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
