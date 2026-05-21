// Common utilities for frontend

async function apiFetch(endpoint, options = {}) {
  try {
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

// Also expose globally for direct script usage
window.apiFetch = apiFetch;
window.showToast = showToast;