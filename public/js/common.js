// Common utilities for frontend

// Helper to get cookie value
function getCookie(name) {
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [key, value] = cookie.trim().split('=');
    if (key === name) return value;
  }
  return null;
}

// Helper to get/refresh CSRF token
async function ensureCsrfToken() {
  // Check if we already have a CSRF cookie
  let token = getCookie('csrf_token');
  if (!token) {
    // Fetch new token from server
    try {
      const res = await fetch('/api/csrf-token', { credentials: 'include' });
      const data = await res.json();
      token = data.csrf_token;
    } catch {
      // If CSRF endpoint fails, continue without token (server will reject if needed)
      return null;
    }
  }
  return token;
}

async function apiFetch(endpoint, options = {}) {
  try {
    const method = (options.method || 'GET').toUpperCase();

    // Add CSRF token for POST/PUT/DELETE requests
    if (['POST', 'PUT', 'DELETE'].includes(method)) {
      const csrfToken = await ensureCsrfToken();
      options.headers = {
        ...options.headers,
        'X-CSRF-Token': csrfToken || ''
      };
    }

    const res = await fetch(endpoint, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    if (!res.ok) {
      // Try to parse error response, fallback to generic message
      const errorData = await res.json().catch(() => ({ success: false, message: '请求失败' }));
      return errorData;
    }

    return res.json();
  } catch (err) {
    // Network error or JSON parse error
    return { success: false, message: '网络错误，请稍后重试' };
  }
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ========== Password Visibility Toggle ==========
function setupPasswordToggle(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;

  // Create wrapper if not already wrapped
  let wrapper = input.parentElement;
  if (!wrapper.classList.contains('password-field-wrapper')) {
    wrapper = document.createElement('div');
    wrapper.className = 'password-field-wrapper';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);
  }

  // Check if toggle button already exists
  if (wrapper.querySelector('.password-toggle-btn')) return;

  // Create toggle button
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'password-toggle-btn';
  toggleBtn.innerHTML = '👁';
  toggleBtn.title = '显示/隐藏密码';
  toggleBtn.setAttribute('aria-label', '显示或隐藏密码');

  toggleBtn.addEventListener('click', () => {
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    toggleBtn.innerHTML = isPassword ? '👁‍🗨' : '👁';
    toggleBtn.title = isPassword ? '隐藏密码' : '显示密码';
  });

  wrapper.appendChild(toggleBtn);
}

// Setup all password fields on page
function setupAllPasswordToggles() {
  const passwordInputs = document.querySelectorAll('input[type="password"]');
  passwordInputs.forEach(input => {
    if (input.id) {
      setupPasswordToggle(input.id);
    }
  });
}

// ========== Button Loading State ==========
function setButtonLoading(button, loading) {
  if (!button) return;

  if (loading) {
    button.classList.add('btn-loading');
    button.disabled = true;
    button.dataset.originalText = button.textContent;
  } else {
    button.classList.remove('btn-loading');
    button.disabled = false;
    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
    }
  }
}

// ========== Modal Component ==========
function showModal(title, bodyContent, onConfirm, confirmText = '确认', cancelText = '取消') {
  // Remove existing modal if any
  const existingModal = document.querySelector('.modal-overlay');
  if (existingModal) existingModal.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';

  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3 class="modal-title">${title}</h3>
        <button type="button" class="modal-close-btn" aria-label="关闭">×</button>
      </div>
      <div class="modal-body">${bodyContent}</div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary modal-cancel-btn">${cancelText}</button>
        <button type="button" class="btn-primary modal-confirm-btn">${confirmText}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close handlers
  const closeModal = () => overlay.remove();
  overlay.querySelector('.modal-close-btn').addEventListener('click', closeModal);
  overlay.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  // Confirm handler
  overlay.querySelector('.modal-confirm-btn').addEventListener('click', () => {
    if (onConfirm) onConfirm(overlay);
    closeModal();
  });

  // Focus first input if exists
  const firstInput = overlay.querySelector('input');
  if (firstInput) firstInput.focus();

  return overlay;
}

function showEditModal(title, fields, onSave) {
  const fieldsHtml = fields.map(f => `
    <div class="form-group">
      <label class="form-label">${f.label}</label>
      <input class="form-input" type="${f.type || 'text'}"
             id="modal-${f.id}"
             value="${f.value || ''}"
             ${f.placeholder ? `placeholder="${f.placeholder}"` : ''}>
    </div>
  `).join('');

  return showModal(title, fieldsHtml, (overlay) => {
    const values = {};
    fields.forEach(f => {
      values[f.id] = overlay.querySelector(`#modal-${f.id}`).value;
    });
    if (onSave) onSave(values);
  }, '保存', '取消');
}

// Also expose globally for direct script usage
window.apiFetch = apiFetch;
window.showToast = showToast;
window.setupPasswordToggle = setupPasswordToggle;
window.setupAllPasswordToggles = setupAllPasswordToggles;
window.setButtonLoading = setButtonLoading;
window.showModal = showModal;
window.showEditModal = showEditModal;