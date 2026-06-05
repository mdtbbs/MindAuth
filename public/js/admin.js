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

// Load XenForo configuration
async function loadXenForoConfig() {
  try {
    const result = await apiFetch('/api/admin/xenforo-config');
    const form = document.getElementById('xenforo-config-form');
    const statusBadge = document.getElementById('xenforo-status-badge');

    // Set callback URL hint
    const baseUrl = window.location.origin;
    document.getElementById('xf-callback-url').textContent = `${baseUrl}/api/xenforo/callback`;

    if (result.success && result.config) {
      form.base_url.value = result.config.base_url || '';
      form.client_id.value = result.config.client_id || '';
      form.client_secret.value = '';
      form.enabled.checked = result.config.enabled === 1;
      form.sync_avatar.checked = result.config.sync_avatar === 1;
      form.sync_user_group.checked = result.config.sync_user_group === 1;

      // 显示 client_secret 状态提示
      if (result.config.has_client_secret) {
        form.client_secret.placeholder = '密钥已设置，留空则保留原密钥';
      } else {
        form.client_secret.placeholder = '请输入 XenForo OAuth Client Secret';
      }

      // 显示启用状态
      if (result.config.enabled) {
        statusBadge.style.display = 'block';
        statusBadge.innerHTML = '<span class="status-dot">已启用</span>';
      } else {
        statusBadge.style.display = 'block';
        statusBadge.innerHTML = '<span class="status-dot warn">未启用</span>';
      }
    }
  } catch {
    console.error('Load XenForo config error');
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
      loadXenForoConfig();
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

// Handle XenForo config form
document.getElementById('xenforo-config-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const data = {
    base_url: formData.get('base_url'),
    client_id: formData.get('client_id'),
    client_secret: formData.get('client_secret'),
    enabled: formData.get('enabled') === 'on',
    sync_avatar: formData.get('sync_avatar') === 'on',
    sync_user_group: formData.get('sync_user_group') === 'on'
  };

  const result = await apiFetch('/api/admin/xenforo-config', {
    method: 'PUT',
    body: data
  });

  showToast(result.message, result.success ? 'success' : 'error');
  if (result.success) {
    loadXenForoConfig();
  }
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
    container.innerHTML = '<div class="empty-state">暂无用户</div>';
    return;
  }

  container.innerHTML = users.map(user => `
    <div class="user-row" data-id="${user.id}">
      <div class="user-row-info">
        <div class="user-row-name">${escapeHtml(user.username)}</div>
        <div class="user-row-email">${escapeHtml(user.email)}</div>
      </div>
      <div class="user-row-meta">
        <span class="tag ${user.role === 'admin' ? 'admin' : ''}">${user.role === 'admin' ? 'Admin' : 'User'}</span>
        <span class="status-dot ${user.email_verified ? '' : 'warn'}">${user.email_verified ? 'Verified' : 'Unverified'}</span>
      </div>
      <div class="user-row-actions">
        <button class="btn-sm edit-user-btn" data-id="${user.id}">编辑</button>
        <button class="btn-ghost danger delete-user-btn" data-id="${user.id}">删除</button>
      </div>
    </div>
  `).join('');
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
    const currentRole = card.querySelector('.tag').classList.contains('admin') ? 'admin' : 'user';

    showModal('编辑用户', `
      <div class="form-group">
        <label class="form-label">角色</label>
        <select class="form-input" id="modal-role">
          <option value="user" ${currentRole === 'user' ? 'selected' : ''}>用户</option>
          <option value="admin" ${currentRole === 'admin' ? 'selected' : ''}>管理员</option>
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
    loadXenForoConfig();
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