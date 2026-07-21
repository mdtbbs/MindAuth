// Dashboard data-loading helpers: login logs, authorizations, notifications.
// Uses window globals (apiFetch) set by common.js.

import { escapeHtml } from './utils.js';

// Load login logs
export async function loadLoginLogs() {
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
export async function loadAuthorizations() {
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

export function renderNotificationItem(notification) {
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

export function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export async function refreshNotificationCount() {
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

export async function loadNotifications() {
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
