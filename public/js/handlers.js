// Event listeners for the user SPA: form submits, click delegation, file uploads.
// Uses window globals (apiFetch, showToast, setButtonLoading, showFieldError,
// clearFormErrors) set by common.js.

import { Store, scheduleHashNavigation } from './state.js';
import { router } from './router.js';
import { checkAuth } from './auth.js';
import { loadNotifications, loadAuthorizations } from './dashboard.js';

export function setupEventHandlers() {
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

  // Logout handler + misc click delegation
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

      // 妤犲矁鐦夐弬鍥︽槅婢堆冪毈
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
}
