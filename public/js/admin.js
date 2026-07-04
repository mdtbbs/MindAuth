// Admin panel JavaScript

// View toggles
function toggleCreateView() {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('create-view').style.display = 'flex';
}

function toggleLoginView() {
  document.getElementById('create-view').style.display = 'none';
  document.getElementById('login-view').style.display = 'flex';
}

// Check admin session
async function checkAdminSession() {
  try {
    const result = await apiFetch('/api/admin/clients');
    return result.success === true;
  } catch {
    return false;
  }
}

// Show login view
function showLoginView() {
  document.getElementById('login-view').style.display = 'flex';
  document.getElementById('create-view').style.display = 'none';
  document.getElementById('dashboard-view').style.display = 'none';
}

// Show dashboard view
function showDashboardView() {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('create-view').style.display = 'none';
  document.getElementById('dashboard-view').style.display = 'block';
}

const smsAuditState = {
  page: 1,
  limit: 20,
  totalPages: 1,
};

const adminRoleLabels = {
  super_admin: '超级管理员',
  user_admin: '用户管理员',
  security_admin: '安全管理员',
  config_admin: '配置管理员',
  readonly_admin: '只读管理员',
  admin: '管理员',
  user: '用户',
  moderator: '版主',
};

const adminRoleOrder = {
  super_admin: 0,
  admin: 1,
  user_admin: 2,
  security_admin: 3,
  config_admin: 4,
  readonly_admin: 5,
};

function normalizeAdminRole(role) {
  if (role === 'admin') return 'super_admin';
  return role || 'readonly_admin';
}

function formatAdminRole(role) {
  const normalized = normalizeAdminRole(role);
  return adminRoleLabels[normalized] || normalized;
}

function roleValue(role) {
  return adminRoleOrder[normalizeAdminRole(role)] ?? 99;
}

function canGrantRole(adminRole, targetRole) {
  return roleValue(adminRole) <= roleValue(targetRole);
}

// Load clients list
async function loadClients() {
  try {
    const result = await apiFetch('/api/admin/clients');
    if (result.success) {
      renderClients(result.clients);
    } else {
      showToast(result.message || '加载失败', 'error');
    }
  } catch {
    showToast('加载失败', 'error');
  }
}

// Render clients list
function renderClients(clients) {
  const container = document.getElementById('clients-container');

  if (clients.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无已注册应用</div>';
    return;
  }

  container.innerHTML = clients.map(client => `
    <div class="client-card" data-id="${client.id}">
      <div class="client-name">${escapeHtml(client.name)}</div>
      <div class="client-info">
        <p>client_id: <code>${escapeHtml(client.client_id)}</code></p>
        <p>回调: ${escapeHtml(client.redirect_uri)}</p>
        <p>创建: ${client.created_at}</p>
      </div>
      <div class="client-actions">
        <button class="btn-sm edit-btn" data-id="${client.id}">编辑</button>
        <button class="btn-ghost danger delete-btn" data-id="${client.id}">删除</button>
      </div>
    </div>
  `).join('');
}

// HTML escape
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Load email configuration
async function loadEmailConfig() {
  try {
    const result = await apiFetch('/api/admin/email-config');
    if (result.success && result.config) {
      const form = document.getElementById('email-config-form');
      form.host.value = result.config.host || '';
      form.port.value = result.config.port || 587;
      form.user.value = result.config.user || '';
      form.password.value = '';
      // 显示密码状态提示
      if (result.config.hasPassword) {
        form.password.placeholder = '密码已设置，留空则保留原密码';
      } else {
        form.password.placeholder = '请输入SMTP密码';
      }
      form.from.value = result.config.from || '';
      form.secure.checked = result.config.secure === 1;

      const statusDiv = document.getElementById('email-config-status');
      if (result.config.host) {
        statusDiv.textContent = `最后更新: ${result.config.updated_at || '-'}`;
        statusDiv.style.color = '#22c55e';
      } else {
        statusDiv.textContent = '未配置SMTP，邮件将打印到控制台';
        statusDiv.style.color = '#eab308';
      }
    }
  } catch {
    console.error('Load email config error');
  }
}

// Load SMS configuration
async function loadSmsConfig() {
  try {
    const result = await apiFetch('/api/admin/sms-config');
    const form = document.getElementById('sms-config-form');
    const statusDiv = document.getElementById('sms-config-status');
    const statusBadge = document.getElementById('sms-status-badge');
    if (!form || !statusDiv || !statusBadge) return;

    if (result.success && result.config) {
      form.access_key_id.value = result.config.access_key_id || '';
      form.access_key_secret.value = '';
      form.sign_name.value = result.config.sign_name || '';
      form.template_code.value = result.config.template_code || '';
      form.enabled.checked = result.config.enabled === 1 || result.config.enabled === true;

      form.access_key_secret.placeholder = result.config.has_access_key_secret
        ? '密钥已设置，留空则保留原密钥'
        : 'Aliyun AccessKey Secret';

      statusBadge.style.display = 'block';
      statusBadge.innerHTML = form.enabled.checked
        ? '<span class="status-dot">已启用</span>'
        : '<span class="status-dot warn">未启用</span>';
      statusDiv.textContent = result.config.updated_at ? `最后更新: ${result.config.updated_at}` : '尚未配置短信服务';
      statusDiv.style.color = form.enabled.checked ? '#22c55e' : '#eab308';
    }
  } catch {
    console.error('Load SMS config error');
  }
}

// Handle admin login
document.getElementById('admin-login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  setButtonLoading(submitBtn, true);

  try {
    const formData = new FormData(e.target);
    const data = {
      username: formData.get('username'),
      password: formData.get('password')
    };

    const result = await apiFetch('/api/admin/login', {
      method: 'POST',
      body: data
    });

    if (result.success) {
      showDashboardView();
      loadStats();
      loadClients();
      loadEmailConfig();
      loadSmsConfig();
      loadSmsAuditLogs();
      loadUsers();
      showToast('登录成功', 'success');
    } else {
      showToast(result.message, 'error');
    }
  } finally {
    setButtonLoading(submitBtn, false);
  }
});

// Handle admin create
document.getElementById('admin-create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  setButtonLoading(submitBtn, true);

  try {
    const formData = new FormData(e.target);
    const data = {
      secret: formData.get('secret'),
      username: formData.get('username'),
      email: formData.get('email'),
      password: formData.get('password')
    };

    const result = await apiFetch('/api/admin/create', {
      method: 'POST',
      body: data
    });

    if (result.success) {
      showToast('创建成功，请登录', 'success');
      toggleLoginView();
      e.target.reset();
    } else {
      showToast(result.message, 'error');
    }
  } finally {
    setButtonLoading(submitBtn, false);
  }
});

// Handle logout
document.getElementById('logout-btn').addEventListener('click', async () => {
  await apiFetch('/api/admin/logout', { method: 'POST' });
  showLoginView();
  showToast('已退出', 'info');
});

// Handle create client
document.getElementById('create-client-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const data = {
    name: formData.get('name'),
    redirect_uri: formData.get('redirect_uri')
  };

  const result = await apiFetch('/api/admin/clients', {
    method: 'POST',
    body: data
  });

  if (result.success) {
    document.getElementById('new-client-id').textContent = result.client_id;
    document.getElementById('new-client-secret').textContent = result.client_secret;
    document.getElementById('secret-display').style.display = 'block';

    loadClients();
    e.target.reset();
    e.target.style.display = 'none';
    showToast('创建成功', 'success');
  } else {
    showToast(result.message, 'error');
  }
});

// Close secret display
document.getElementById('close-secret-btn').addEventListener('click', () => {
  document.getElementById('secret-display').style.display = 'none';
});

// Theme toggle button
document.getElementById('theme-toggle-btn').addEventListener('click', () => {
  const newTheme = toggleTheme();
  document.getElementById('theme-icon').textContent = getThemeIcon(newTheme);
});

// Toggle between login and create views
document.getElementById('toggle-create-view').addEventListener('click', toggleCreateView);
document.getElementById('toggle-login-view').addEventListener('click', toggleLoginView);

// Show create client form
document.getElementById('show-create-client-btn').addEventListener('click', () => {
  document.getElementById('create-client-form').style.display = 'flex';
});

// Handle client actions
document.getElementById('clients-container').addEventListener('click', async (e) => {
  const id = e.target.dataset.id;

  if (e.target.classList.contains('delete-btn')) {
    if (!confirm('确定要删除此应用吗？')) return;

    const result = await apiFetch(`/api/admin/clients/${id}`, { method: 'DELETE' });
    if (result.success) {
      loadClients();
      showToast('已删除', 'success');
    } else {
      showToast('删除失败', 'error');
    }
  }

  if (e.target.classList.contains('edit-btn')) {
    const card = e.target.closest('.client-card');
    const currentName = card.querySelector('.client-name').textContent;
    const currentUri = card.querySelector('.client-info p:nth-child(2)').textContent.replace('回调: ', '');

    showEditModal('编辑应用', [
      { id: 'name', label: '应用名称', value: currentName },
      { id: 'redirect_uri', label: '回调地址', value: currentUri, type: 'url' }
    ], async (values) => {
      if (!values.name || !values.redirect_uri) {
        showToast('名称和回调地址必填', 'error');
        return;
      }

      const result = await apiFetch(`/api/admin/clients/${id}`, {
        method: 'PUT',
        body: { name: values.name, redirect_uri: values.redirect_uri }
      });

      if (result.success) {
        loadClients();
        showToast('已更新', 'success');
      } else {
        showToast('更新失败', 'error');
      }
    });
  }
});

// Handle email config form
document.getElementById('email-config-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const data = {
    host: formData.get('host'),
    port: parseInt(formData.get('port')) || 587,
    user: formData.get('user'),
    password: formData.get('password'),
    from: formData.get('from'),
    secure: formData.get('secure') === 'on'
  };

  const result = await apiFetch('/api/admin/email-config', {
    method: 'PUT',
    body: data
  });

  showToast(result.message, result.success ? 'success' : 'error');
  if (result.success) {
    loadEmailConfig();
  }
});

// Handle SMS config form
document.getElementById('sms-config-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const data = {
    access_key_id: formData.get('access_key_id'),
    access_key_secret: formData.get('access_key_secret'),
    sign_name: formData.get('sign_name'),
    template_code: formData.get('template_code'),
    enabled: formData.get('enabled') === 'on'
  };

  const result = await apiFetch('/api/admin/sms-config', {
    method: 'PUT',
    body: data
  });

  showToast(result.message, result.success ? 'success' : 'error');
  if (result.success) {
    loadSmsConfig();
  }
});

// Handle test SMS
document.getElementById('test-sms-btn').addEventListener('click', async () => {
  showModal('发送测试短信', `
    <div class="form-group">
      <label class="form-label">测试手机号</label>
      <input class="form-input" type="tel" id="modal-test-phone" inputmode="numeric" maxlength="11" placeholder="13800138000">
    </div>
  `, async (overlay) => {
    const phoneInput = overlay.querySelector('#modal-test-phone');
    const phone = phoneInput.value.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      showToast('请输入有效的 11 位中国大陆手机号', 'error');
      return;
    }

    const form = document.getElementById('sms-config-form');
    const formData = new FormData(form);
    const data = {
      access_key_id: formData.get('access_key_id'),
      access_key_secret: formData.get('access_key_secret'),
      sign_name: formData.get('sign_name'),
      template_code: formData.get('template_code'),
      enabled: formData.get('enabled') === 'on'
    };

    const saveResult = await apiFetch('/api/admin/sms-config', {
      method: 'PUT',
      body: data
    });
    if (!saveResult.success) {
      showToast(saveResult.message, 'error');
      return;
    }

    const result = await apiFetch('/api/admin/test-sms', {
      method: 'POST',
      body: { phone }
    });

    showToast(result.message, result.success ? 'success' : 'error');
    if (result.success) {
      loadSmsConfig();
    }
  }, '发送', '取消');
});

// Handle test email
document.getElementById('test-email-btn').addEventListener('click', async () => {
  showModal('发送测试邮件', `
    <div class="form-group">
      <label class="form-label">测试邮箱地址</label>
      <input class="form-input" type="email" id="modal-test-email" placeholder="test@example.com">
    </div>
  `, async (overlay) => {
    const email = overlay.querySelector('#modal-test-email').value;
    if (!email) {
      showToast('请输入邮箱地址', 'error');
      return;
    }

    const form = document.getElementById('email-config-form');
    const formData = new FormData(form);
    const data = {
      host: formData.get('host'),
      port: parseInt(formData.get('port')) || 587,
      user: formData.get('user'),
      password: formData.get('password'),
      from: formData.get('from'),
      secure: formData.get('secure') === 'on'
    };

    await apiFetch('/api/admin/email-config', {
      method: 'PUT',
      body: data
    });

    const result = await apiFetch('/api/admin/test-email', {
      method: 'POST',
      body: { email }
    });

    showToast(result.message, result.success ? 'success' : 'error');
  }, '发送', '取消');
});

function toMySQLDateTime(value) {
  if (!value) return '';
  return value.replace('T', ' ') + ':00';
}

function buildSmsAuditQuery() {
  const params = new URLSearchParams();
  params.set('page', String(smsAuditState.page));
  params.set('limit', String(smsAuditState.limit));

  const userId = document.getElementById('sms-audit-user-id').value.trim();
  const action = document.getElementById('sms-audit-action').value;
  const success = document.getElementById('sms-audit-success').value;
  const phoneLast4 = document.getElementById('sms-audit-phone-last4').value.trim();
  const code = document.getElementById('sms-audit-code').value.trim();
  const ip = document.getElementById('sms-audit-ip').value.trim();
  const startDate = toMySQLDateTime(document.getElementById('sms-audit-start-date').value);
  const endDate = toMySQLDateTime(document.getElementById('sms-audit-end-date').value);

  if (userId) params.set('user_id', userId);
  if (action) params.set('action', action);
  if (success) params.set('success', success);
  if (phoneLast4) params.set('phone_last4', phoneLast4);
  if (code) params.set('code', code);
  if (ip) params.set('ip_address', ip);
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);

  return params.toString();
}

async function loadSmsAuditLogs() {
  const container = document.getElementById('sms-audit-container');
  if (!container) return;

  container.innerHTML = '<div class="empty-state">加载中...</div>';
  try {
    const result = await apiFetch(`/api/admin/sms-audit-logs?${buildSmsAuditQuery()}`);
    if (!result.success) {
      container.innerHTML = `<div class="empty-state">${escapeHtml(result.message || '加载失败')}</div>`;
      return;
    }

    smsAuditState.totalPages = Math.max(result.pagination?.totalPages || 1, 1);
    renderSmsAuditLogs(result.logs || [], result.pagination);
  } catch {
    container.innerHTML = '<div class="empty-state">加载失败</div>';
  }
}

function renderSmsAuditLogs(logs, pagination) {
  const container = document.getElementById('sms-audit-container');
  const pageInfo = document.getElementById('sms-audit-page-info');
  const prevBtn = document.getElementById('sms-audit-prev-btn');
  const nextBtn = document.getElementById('sms-audit-next-btn');

  if (!logs.length) {
    container.innerHTML = '<div class="empty-state">暂无短信审计日志</div>';
  } else {
    container.innerHTML = `
      <div style="overflow-x: auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Action</th>
              <th>Phone</th>
              <th>Result</th>
              <th>Code</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            ${logs.map(log => `
              <tr>
                <td class="mono">${escapeHtml(formatLogTime(log.created_at))}</td>
                <td>${log.user_id ? `${escapeHtml(log.username || '-') } <span class="mono">#${log.user_id}</span>` : '-'}</td>
                <td><span class="tag">${escapeHtml(formatSmsAction(log.action))}</span></td>
                <td class="mono">${escapeHtml(log.phone_masked || '-')}</td>
                <td><span class="status-dot ${log.success ? '' : 'warn'}">${log.success ? '成功' : '失败'}</span></td>
                <td class="mono">${escapeHtml(log.code || '-')}</td>
                <td class="mono">${escapeHtml(log.ip_address || '-')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  pageInfo.textContent = `第 ${pagination?.page || smsAuditState.page} 页 / 共 ${smsAuditState.totalPages} 页`;
  prevBtn.disabled = smsAuditState.page <= 1;
  nextBtn.disabled = smsAuditState.page >= smsAuditState.totalPages;
}

function formatSmsAction(action) {
  if (action === 'send_code') return '发送';
  if (action === 'verify_code') return '验证';
  return action || '-';
}

function formatLogTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

document.getElementById('sms-audit-search-btn').addEventListener('click', () => {
  smsAuditState.page = 1;
  loadSmsAuditLogs();
});
document.getElementById('sms-audit-refresh-btn').addEventListener('click', loadSmsAuditLogs);
document.getElementById('sms-audit-prev-btn').addEventListener('click', () => {
  if (smsAuditState.page > 1) {
    smsAuditState.page -= 1;
    loadSmsAuditLogs();
  }
});
document.getElementById('sms-audit-next-btn').addEventListener('click', () => {
  if (smsAuditState.page < smsAuditState.totalPages) {
    smsAuditState.page += 1;
    loadSmsAuditLogs();
  }
});
document.getElementById('sms-audit-phone-last4').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
});

// Load users
async function loadUsers() {
  try {
    const search = document.getElementById('user-search').value;
    const role = document.getElementById('user-role-filter').value;

    let url = '/api/admin/users';
    const params = [];
    if (search) params.push(`search=${encodeURIComponent(search)}`);
    if (role) params.push(`role=${role}`);
    if (params.length > 0) url += '?' + params.join('&');

    const result = await apiFetch(url);
    if (result.success) {
      renderUsers(result.users);
    } else {
      showToast(result.message || '加载失败', 'error');
    }
  } catch {
    showToast('加载失败', 'error');
  }
}

// Render users
function renderUsers(users) {
  const container = document.getElementById('users-container');

  if (users.length === 0) {
    container.innerHTML = '<div class="empty-state empty-state-polished"><div class="empty-state-title">暂无用户</div><div class="empty-state-desc">调整搜索条件后再试。</div></div>';
    return;
  }

  container.innerHTML = users.map(user => `
    <div class="user-row" data-id="${user.id}">
      <div class="user-row-info">
        <div class="user-row-name">${escapeHtml(user.username)} <span class="mono muted">#${user.id}</span></div>
        <div class="user-row-email">${escapeHtml(user.email)}</div>
      </div>
      <div class="user-row-meta">
        <span class="tag ${normalizeAdminRole(user.role) === 'super_admin' ? 'admin' : ''}">${escapeHtml(formatAdminRole(user.role))}</span>
        <span class="status-dot ${user.email_verified ? '' : 'warn'}">${user.email_verified ? 'Verified' : 'Unverified'}</span>
        ${user.ban_status && user.ban_status !== 'none' ? `<span class="tag warn">${escapeHtml(user.ban_status)}</span>` : ''}
      </div>
      <div class="user-row-actions">
        <button class="btn-sm detail-user-btn" data-id="${user.id}">详情</button>
        <button class="btn-sm edit-user-btn" data-id="${user.id}">编辑</button>
        <button class="btn-ghost danger delete-user-btn" data-id="${user.id}">删除</button>
      </div>
    </div>
  `).join('');
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function renderDetailList(items, renderItem, emptyText) {
  if (!items || items.length === 0) {
    return `<div class="empty-state compact">${emptyText}</div>`;
  }
  return `<div class="detail-list">${items.map(renderItem).join('')}</div>`;
}

function renderUserDetailModal(data) {
  const user = data.user;
  const body = `
    <div class="admin-user-detail">
      <div class="detail-hero">
        <div>
          <div class="detail-title">${escapeHtml(user.username)} <span class="mono muted">#${user.id}</span></div>
          <div class="detail-subtitle">${escapeHtml(user.email || '-')}</div>
        </div>
        <div class="detail-tags">
          <span class="tag ${normalizeAdminRole(user.role) === 'super_admin' ? 'admin' : ''}">${escapeHtml(formatAdminRole(user.role))}</span>
          <span class="status-dot ${user.email_verified ? '' : 'warn'}">${user.email_verified ? '邮箱已验证' : '邮箱未验证'}</span>
          <span class="status-dot ${user.phone_verified ? '' : 'warn'}">${user.phone_verified ? '手机已验证' : '手机未验证'}</span>
        </div>
      </div>

      <div class="detail-grid">
        <div class="detail-metric"><span>注册时间</span><strong>${escapeHtml(formatDateTime(user.created_at))}</strong></div>
        <div class="detail-metric"><span>账号状态</span><strong>${escapeHtml(user.ban_status || 'none')}</strong></div>
        <div class="detail-metric"><span>锁定等级</span><strong>${escapeHtml(String(user.lock_level || 0))}</strong></div>
        <div class="detail-metric"><span>手机号</span><strong>${escapeHtml(user.phone || '-')}</strong></div>
      </div>

      <div class="detail-section">
        <div class="detail-section-title">登录记录</div>
        ${renderDetailList(data.login_logs, (log) => `
          <div class="detail-item">
            <div><strong>${escapeHtml(log.login_type || 'web')}</strong><span>${escapeHtml(log.device || '-')}</span></div>
            <div class="detail-item-meta">${escapeHtml(log.ip || '-')} · ${escapeHtml(formatDateTime(log.created_at))}</div>
          </div>
        `, '暂无登录记录')}
      </div>

      <div class="detail-section">
        <div class="detail-section-title">授权应用</div>
        ${renderDetailList(data.authorizations, (auth) => `
          <div class="detail-item">
            <div><strong>${escapeHtml(auth.client_name || auth.client_id || '-')}</strong><span>${escapeHtml(auth.scope || '')}</span></div>
            <div class="detail-item-meta">${escapeHtml(formatDateTime(auth.last_used_at || auth.created_at))}</div>
          </div>
        `, '暂无授权应用')}
      </div>

      <div class="detail-section">
        <div class="detail-section-title">短信日志</div>
        ${renderDetailList(data.sms_logs, (log) => `
          <div class="detail-item">
            <div><strong>${escapeHtml(formatSmsAction(log.action))}</strong><span>${escapeHtml(log.phone_masked || '-')}</span></div>
            <div class="detail-item-meta">${log.success ? '成功' : '失败'} · ${escapeHtml(log.code || '-')} · ${escapeHtml(formatDateTime(log.created_at))}</div>
          </div>
        `, '暂无短信日志')}
      </div>

      <div class="detail-section">
        <div class="detail-section-title">通知</div>
        ${renderDetailList(data.notifications, (notification) => `
          <div class="detail-item">
            <div><strong>${escapeHtml(notification.title || '-')}</strong><span>${escapeHtml(notification.content || '')}</span></div>
            <div class="detail-item-meta">${notification.is_read ? '已读' : '未读'} · ${escapeHtml(formatDateTime(notification.created_at))}</div>
          </div>
        `, '暂无通知')}
      </div>

      <div class="detail-section">
        <div class="detail-section-title">会话</div>
        ${renderDetailList(data.sessions, (session) => `
          <div class="detail-item">
            <div><strong>${escapeHtml(session.device_info || '-')}</strong><span>${escapeHtml(session.ip_address || '-')}</span></div>
            <div class="detail-item-meta">活跃于 ${escapeHtml(formatDateTime(session.last_active_at))}</div>
          </div>
        `, '暂无会话')}
      </div>

      <div class="detail-section">
        <div class="detail-section-title">后台审计</div>
        ${renderDetailList(data.audit_logs, (log) => `
          <div class="detail-item">
            <div><strong>${escapeHtml(log.action || '-')}</strong><span>${escapeHtml(log.ip_address || '-')}</span></div>
            <div class="detail-item-meta">${escapeHtml(formatDateTime(log.created_at))}</div>
          </div>
        `, '暂无审计记录')}
      </div>
    </div>
  `;

  showModal('用户详情', body, null, '关闭', '关闭');
  const modal = document.querySelector('.modal-content');
  if (modal) modal.classList.add('modal-content-wide');
}

async function openUserDetail(id) {
  const result = await apiFetch(`/api/admin/users/${id}`);
  if (!result.success) {
    showToast(result.message || '加载用户详情失败', 'error');
    return;
  }
  renderUserDetailModal(result);
}

// Handle user search
document.getElementById('user-search-btn').addEventListener('click', loadUsers);
document.getElementById('user-search').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') loadUsers();
});
document.getElementById('user-role-filter').addEventListener('change', loadUsers);

// Handle user actions
document.getElementById('users-container').addEventListener('click', async (e) => {
  const id = e.target.dataset.id;

  if (e.target.classList.contains('detail-user-btn')) {
    await openUserDetail(id);
  }

  if (e.target.classList.contains('delete-user-btn')) {
    if (!confirm('确定要删除此用户吗？')) return;

    const result = await apiFetch(`/api/admin/users/${id}`, { method: 'DELETE' });
    if (result.success) {
      loadUsers();
      showToast('已删除', 'success');
    } else {
      showToast(result.message || '删除失败', 'error');
    }
  }

  if (e.target.classList.contains('edit-user-btn')) {
    const card = e.target.closest('.user-row');
    const isVerified = card.querySelector('.status-dot').classList.contains('warn') === false;
    const roleLabel = card.querySelector('.tag').textContent.trim();
    const roleEntry = Object.entries(adminRoleLabels).find(([, label]) => label === roleLabel);
    const currentRole = roleEntry ? roleEntry[0] : 'user';

    showModal('编辑用户', `
      <div class="form-group">
        <label class="form-label">角色</label>
        <select class="form-input" id="modal-role">
          <option value="user" ${currentRole === 'user' ? 'selected' : ''}>用户</option>
          <option value="moderator" ${currentRole === 'moderator' ? 'selected' : ''}>版主</option>
          <option value="super_admin" ${normalizeAdminRole(currentRole) === 'super_admin' ? 'selected' : ''}>超级管理员</option>
          <option value="user_admin" ${currentRole === 'user_admin' ? 'selected' : ''}>用户管理员</option>
          <option value="security_admin" ${currentRole === 'security_admin' ? 'selected' : ''}>安全管理员</option>
          <option value="config_admin" ${currentRole === 'config_admin' ? 'selected' : ''}>配置管理员</option>
          <option value="readonly_admin" ${currentRole === 'readonly_admin' ? 'selected' : ''}>只读管理员</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">邮箱验证</label>
        <select class="form-input" id="modal-verified">
          <option value="yes" ${isVerified ? 'selected' : ''}>已验证</option>
          <option value="no" ${!isVerified ? 'selected' : ''}>未验证</option>
        </select>
      </div>
    `, async (overlay) => {
      const newRole = overlay.querySelector('#modal-role').value;
      const emailVerified = overlay.querySelector('#modal-verified').value === 'yes';

      const result = await apiFetch(`/api/admin/users/${id}`, {
        method: 'PUT',
        body: { role: newRole, email_verified: emailVerified }
      });

      if (result.success) {
        loadUsers();
        showToast('已更新', 'success');
      } else {
        showToast(result.message || '更新失败', 'error');
      }
    }, '保存', '取消');
  }
});

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  const isLoggedIn = await checkAdminSession();
  if (isLoggedIn) {
    showDashboardView();
    loadStats();
    loadClients();
    loadEmailConfig();
    loadSmsAuditLogs();
    loadUsers();
  } else {
    showLoginView();
  }

  // Setup password visibility toggles
  setupAllPasswordToggles();
});

// Load statistics
async function loadStats() {
  try {
    const result = await apiFetch('/api/admin/stats');
    if (result.success) {
      renderStats(result.stats);
    }
  } catch {
    console.error('Load stats error');
  }
}

// Render statistics
function renderStats(stats) {
  document.getElementById('stat-users-total').textContent = stats.users.total;
  document.getElementById('stat-users-today').textContent = stats.users.today;
  document.getElementById('stat-users-week').textContent = stats.users.week;
  document.getElementById('stat-users-active').textContent = stats.users.active;
  document.getElementById('stat-users-verified').textContent = stats.users.verified;
  document.getElementById('stat-logins-today').textContent = stats.logins.today;

  renderTrendChart('chart-user-growth', stats.trends.userGrowth);
  renderTrendChart('chart-login-trend', stats.trends.loginTrend);
}

// Render trend chart
function renderTrendChart(containerId, data) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const maxCount = Math.max(...data.map(d => d.count), 1);

  container.innerHTML = data.map(d => `
    <div class="chart-bar" style="height: ${Math.max((d.count / maxCount) * 100, 5)}%">
      <span class="chart-value">${d.count}</span>
    </div>
  `).join('');
}
