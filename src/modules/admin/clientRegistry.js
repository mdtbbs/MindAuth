/** OAuth client registry and Public Client application workflow. */
const net = require('node:net');
const { pool, transaction } = require('../../db');
const { generateToken, generateShortToken } = require('../../utils/token');
const { hashClientSecret } = require('../../utils/secrets');
const { forumProfileUrl } = require('../../utils/forumProfileUrl');
const { writeAdminAudit } = require('../audit/auditWriter');
const { VALID_SCOPES, SCOPE_DESCRIPTIONS, normalizeScopes } = require('../oauth/scopes');
const tokenStore = require('../oauth/tokenStore');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);
const RESERVED_SCHEMES = new Set([
  'http', 'https', 'javascript', 'vbscript', 'data', 'file', 'blob', 'about',
  'ftp', 'ftps', 'mailto', 'tel', 'sms', 'intent', 'content', 'market',
  'android-app', 'chrome', 'chrome-extension', 'resource',
]);

function isPrivateIpv4(host) {
  if (net.isIP(host) !== 4) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || a >= 224;
}

function isPrivateOrInternalHost(hostname) {
  const host = String(hostname || '').toLowerCase().trim();
  if (!host) return true;
  if (LOOPBACK_HOSTS.has(host) || host === 'localhost' || host === '0.0.0.0' || host === '[::]') return true;
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return true;
  if (isPrivateIpv4(host)) return true;
  if (net.isIP(host.replace(/^\[|\]$/g, '')) === 6) {
    const ip = host.replace(/^\[|\]$/g, '').split('%')[0];
    if (ip === '::1' || ip === '::' || /^f[cd]/i.test(ip) || /^fe[89ab]/i.test(ip) || /^ff/i.test(ip)
      || /^2001:db8:/i.test(ip) || /^::ffff:/i.test(ip)) return true;
  }
  return ['metadata.google.internal', 'metadata', '169.254.169.254'].includes(host);
}

function validateRedirectUri(uri) {
  if (typeof uri !== 'string' || !uri.trim() || uri.length > 500) {
    return { valid: false, error: '回调地址必填且不能超过 500 个字符' };
  }
  let url;
  try { url = new URL(uri); } catch { return { valid: false, error: '回调地址格式不正确' }; }
  if (url.username || url.password || url.hash) return { valid: false, error: '回调地址不能包含用户凭证或 fragment' };

  if (url.protocol === 'https:') {
    if (isPrivateOrInternalHost(url.hostname)) return { valid: false, error: 'HTTPS 回调地址不能使用内部网络地址' };
    return { valid: true, redirect_type: 'web' };
  }

  const host = url.hostname.toLowerCase();
  if (url.protocol === 'http:') {
    if (LOOPBACK_HOSTS.has(host)) return { valid: true, redirect_type: 'loopback' };
    if (isPrivateOrInternalHost(host)) return { valid: false, error: '回调地址不能使用内部网络地址或 localhost' };
    // Retain existing public HTTP clients. New third-party applications should
    // use HTTPS; localhost is accepted only as an explicit loopback literal.
    return { valid: true, redirect_type: 'web' };
  }

  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (!/^[a-z][a-z0-9+.-]{1,31}$/.test(scheme) || RESERVED_SCHEMES.has(scheme)) {
    return { valid: false, error: '自定义回调协议不安全或格式不正确' };
  }
  if (url.origin !== 'null' || (!url.hostname && (!url.pathname || url.pathname === '/'))
    || (url.hostname && url.hostname === '.')) {
    return { valid: false, error: '自定义回调地址必须包含应用标识或回调路径' };
  }
  return { valid: true, redirect_type: 'custom_scheme' };
}

function parseScopes(value, fallback = []) {
  return normalizeScopes(value, fallback);
}

async function readRedirectUris(clientNumericId, executor = pool) {
  const [rows] = await executor.execute(
    'SELECT redirect_uri, redirect_type, created_at FROM oauth_client_redirect_uris WHERE oauth_client_id = ? ORDER BY id',
    [clientNumericId],
  );
  return rows;
}

async function syncRedirectUris(executor, clientNumericId, uris) {
  const normalized = [...new Set(uris)];
  for (const uri of normalized) {
    const result = validateRedirectUri(uri);
    if (!result.valid) throw new Error(result.error);
  }
  if (!normalized.length) throw new Error('至少需要一个 Redirect URI');
  if (normalized.length > 20) throw new Error('Redirect URI 最多 20 个');
  await executor.execute('DELETE FROM oauth_client_redirect_uris WHERE oauth_client_id = ?', [clientNumericId]);
  for (const uri of normalized) {
    const validation = validateRedirectUri(uri);
    await executor.execute(
      'INSERT INTO oauth_client_redirect_uris (oauth_client_id, redirect_uri, redirect_type) VALUES (?, ?, ?)',
      [clientNumericId, uri, validation.redirect_type],
    );
  }
  await executor.execute('UPDATE clients SET redirect_uri = ? WHERE id = ?', [normalized[0], clientNumericId]);
}

async function listClients() {
  const [clients] = await pool.execute(
    `SELECT id, name, description, website_url, client_id, client_secret, redirect_uri,
            require_pkce, client_type, party_type, status, owner_user_id,
            requested_scopes, approved_scopes, approved_at, approved_by, created_at, updated_at
     FROM clients ORDER BY created_at DESC`,
  );
  const redirectRows = clients.length
    ? (await pool.execute(`SELECT oauth_client_id, redirect_uri, redirect_type FROM oauth_client_redirect_uris WHERE oauth_client_id IN (${clients.map(() => '?').join(',')}) ORDER BY id`, clients.map(c => c.id)))[0]
    : [];
  const byClient = new Map();
  for (const row of redirectRows) {
    if (!byClient.has(row.oauth_client_id)) byClient.set(row.oauth_client_id, []);
    byClient.get(row.oauth_client_id).push({ redirect_uri: row.redirect_uri, redirect_type: row.redirect_type });
  }
  return clients.map((client) => ({
    ...client,
    client_secret_configured: Boolean(client.client_secret),
    client_secret: undefined,
    require_pkce: client.require_pkce === 1 || client.require_pkce === true,
    requested_scopes: parseScopes(client.requested_scopes),
    approved_scopes: parseScopes(client.approved_scopes),
    redirect_uris: byClient.get(client.id) || (client.redirect_uri ? [{ redirect_uri: client.redirect_uri, redirect_type: 'web' }] : []),
  }));
}

async function getClient(id) {
  const [rows] = await pool.execute(
    `SELECT id, name, description, website_url, client_id, client_secret, redirect_uri,
            require_pkce, client_type, party_type, status, owner_user_id,
            requested_scopes, approved_scopes, approved_at, approved_by, created_at, updated_at
     FROM clients WHERE id = ?`, [id],
  );
  if (!rows[0]) return null;
  const client = rows[0];
  return {
    ...client,
    client_secret_configured: Boolean(client.client_secret),
    client_secret: undefined,
    require_pkce: client.require_pkce === 1 || client.require_pkce === true,
    requested_scopes: parseScopes(client.requested_scopes),
    approved_scopes: parseScopes(client.approved_scopes),
    redirect_uris: await readRedirectUris(client.id),
  };
}

async function createClient(data, actor) {
  const { name, require_pkce } = data;
  const redirectUris = data.redirect_uris || [data.redirect_uri];
  for (const uri of redirectUris) {
    const validation = validateRedirectUri(uri);
    if (!validation.valid) throw new Error(validation.error);
  }
  if (!redirectUris.length) throw new Error('至少需要一个 Redirect URI');
  const redirectUri = redirectUris[0];
  const clientId = generateShortToken();
  const clientSecret = generateToken();
  const defaultScopes = ['openid', 'profile', 'email'];
  const clientNumericId = await transaction(async (conn) => {
    const [result] = await conn.execute(
      `INSERT INTO clients (name, client_id, client_secret, redirect_uri, require_pkce,
        client_type, party_type, status, requested_scopes, approved_scopes)
       VALUES (?, ?, ?, ?, ?, 'confidential', 'first_party', 'approved', ?, ?)`,
      [name, clientId, hashClientSecret(clientSecret), redirectUri, require_pkce ? 1 : 0,
        JSON.stringify(defaultScopes), JSON.stringify(defaultScopes)],
    );
    await syncRedirectUris(conn, result.insertId, redirectUris);
    return result.insertId;
  });
  await writeAdminAudit(actor.adminId, 'client.create', 'client', clientNumericId,
    { name, client_id: clientId, client_type: 'confidential', redirect_uris: redirectUris, require_pkce: Boolean(require_pkce) }, actor.ipAddress);
  return { client_id: clientId, client_secret: clientSecret };
}

async function updateClient(id, data, actor) {
  const { name, redirect_uri, redirect_uris, require_pkce } = data;
  const uris = redirect_uris || (redirect_uri ? [redirect_uri] : null);
  await transaction(async (conn) => {
    const [rows] = await conn.execute('SELECT id FROM clients WHERE id = ? FOR UPDATE', [id]);
    if (!rows[0]) throw new Error('客户端不存在');
    const updates = [];
    const params = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (require_pkce !== undefined) { updates.push('require_pkce = ?'); params.push(require_pkce ? 1 : 0); }
    if (updates.length) await conn.execute(`UPDATE clients SET ${updates.join(', ')} WHERE id = ?`, [...params, id]);
    if (uris) await syncRedirectUris(conn, Number(id), uris);
  });
  await writeAdminAudit(actor.adminId, 'client.update', 'client', Number(id),
    { name, redirect_uris: uris, require_pkce }, actor.ipAddress);
  return { updated: true };
}

async function rotateSecret(id, actor) {
  const client = await getClient(id);
  if (!client) throw new Error('客户端不存在');
  if (client.client_type === 'public') throw new Error('Public Client 不配置 client_secret');
  const newSecret = generateToken();
  await pool.execute('UPDATE clients SET client_secret = ? WHERE id = ?', [hashClientSecret(newSecret), id]);
  await writeAdminAudit(actor.adminId, 'client.rotate_secret', 'client', Number(id), null, actor.ipAddress);
  return { client_secret: newSecret };
}

async function deleteClient(id, actor) {
  const client = await getClient(id);
  if (!client || client.status === 'deleted') return { deleted: false };
  const users = await revokeClientGrants(client.client_id, 'deleted');
  await writeAdminAudit(actor.adminId, 'client.delete', 'client', Number(id), null, actor.ipAddress);
  return { deleted: users !== null };
}

async function revokeClientGrants(clientId, status) {
  let users = [];
  await transaction(async (conn) => {
    const [rows] = await conn.execute('SELECT id FROM clients WHERE client_id = ? FOR UPDATE', [clientId]);
    if (!rows[0]) return;
    const [tokenUsers] = await conn.execute('SELECT DISTINCT user_id FROM refresh_tokens WHERE client_id = ?', [clientId]);
    users = tokenUsers.map(({ user_id }) => Number(user_id));
    await conn.execute('UPDATE clients SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE client_id = ?', [status, clientId]);
    await conn.execute('UPDATE refresh_tokens SET revoked = 1 WHERE client_id = ? AND revoked = 0', [clientId]);
    await conn.execute('DELETE FROM authorizations WHERE client_id = ?', [clientId]);
  });
  await Promise.all(users.map(userId => tokenStore.revokeAccessTokensForUserClient(userId, clientId)));
  return users;
}

async function listOwnerApplications(ownerUserId) {
  const [rows] = await pool.execute(
    `SELECT id, name, description, website_url, client_id, redirect_uri, require_pkce,
            client_type, party_type, status, requested_scopes, approved_scopes,
            approved_at, created_at, updated_at
     FROM clients WHERE owner_user_id = ? AND status <> 'deleted' ORDER BY updated_at DESC`, [ownerUserId],
  );
  const clients = [];
  for (const row of rows) {
    const redirects = await readRedirectUris(row.id);
    const [usage] = await pool.execute(
      'SELECT COUNT(*) AS authorization_count, MAX(last_used_at) AS last_used_at FROM authorizations WHERE client_id = ?',
      [row.client_id],
    );
    const [metrics] = await pool.execute(
      `SELECT COALESCE(SUM(request_count), 0) AS requests_30d FROM oauth_client_daily_metrics
       WHERE client_id = ? AND metric_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)`, [row.client_id],
    );
    const [recentErrors] = await pool.execute(
      `SELECT metric_date, error_count, last_error_at, last_error_code FROM oauth_client_daily_metrics
       WHERE client_id = ? AND error_count > 0 ORDER BY metric_date DESC LIMIT 10`, [row.client_id],
    );
    clients.push({ ...row, client_secret: undefined, require_pkce: true,
      requested_scopes: parseScopes(row.requested_scopes), approved_scopes: parseScopes(row.approved_scopes),
      redirect_uris: redirects, usage: { ...(usage[0] || { authorization_count: 0, last_used_at: null }),
        requests_30d: Number(metrics[0]?.requests_30d || 0), recent_errors: recentErrors } });
  }
  return clients;
}

function validateApplication(data) {
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name || name.length > 120) throw new Error('应用名称为必填项且不能超过 120 个字符');
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  if (!description || description.length > 2000) throw new Error('应用说明为必填项且不能超过 2000 个字符');
  const websiteUrl = data.website_url ? String(data.website_url).trim() : null;
  if (websiteUrl) {
    let url;
    try { url = new URL(websiteUrl); } catch { throw new Error('应用主页 URL 无效'); }
    const isLoopbackHttp = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
    if ((!isLoopbackHttp && (url.protocol !== 'https:' || isPrivateOrInternalHost(url.hostname)))
      || url.username || url.password || url.hash || websiteUrl.length > 2048) {
      throw new Error('应用主页必须是 HTTPS 地址；开发环境可使用 localhost 或 loopback');
    }
  }
  if (!Array.isArray(data.requested_scopes)) throw new Error('requested_scopes 必须是 scope 数组');
  const redirectUris = Array.isArray(data.redirect_uris) ? data.redirect_uris.map(String) : [];
  if (redirectUris.length > 20) throw new Error('Redirect URI 最多 20 个');
  if (redirectUris.length < 1 || redirectUris.length > 20) throw new Error('请配置 1 至 20 个 Redirect URI');
  for (const uri of redirectUris) {
    const result = validateRedirectUri(uri);
    if (!result.valid) throw new Error(result.error);
    const parsed = new URL(uri);
    if (parsed.protocol === 'http:' && !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
      throw new Error('第三方应用的 HTTP 回调仅允许 localhost 或 loopback 地址');
    }
  }
  const requestedScopes = parseScopes(data.requested_scopes);
  if (!requestedScopes.length || requestedScopes.length !== new Set(data.requested_scopes || []).size) {
    throw new Error('至少申请一个有效且不重复的 scope');
  }
  if (requestedScopes.some(scope => !VALID_SCOPES.includes(scope))) throw new Error('申请了无效的 scope');
  return { name, description: description || null, websiteUrl, redirectUris: [...new Set(redirectUris)], requestedScopes };
}

async function createOwnerApplication(ownerUserId, data) {
  await assertPhoneVerifiedDeveloper(ownerUserId);
  const value = validateApplication(data);
  const clientId = generateShortToken();
  const id = await transaction(async (conn) => {
    const [result] = await conn.execute(
      `INSERT INTO clients (name, description, website_url, client_id, client_secret, redirect_uri,
         require_pkce, client_type, party_type, status, owner_user_id, requested_scopes, approved_scopes, approved_at)
       VALUES (?, ?, ?, ?, NULL, ?, 1, 'public', 'third_party', 'approved', ?, ?, ?, CURRENT_TIMESTAMP)`,
      [value.name, value.description, value.websiteUrl, clientId, value.redirectUris[0], ownerUserId,
        JSON.stringify(value.requestedScopes), JSON.stringify(value.requestedScopes)],
    );
    await syncRedirectUris(conn, result.insertId, value.redirectUris);
    return result.insertId;
  });
  return { id, client_id: clientId, client_type: 'public', party_type: 'third_party', status: 'approved',
    approved_scopes: value.requestedScopes, client_secret: null };
}

async function assertPhoneVerifiedDeveloper(ownerUserId) {
  const [users] = await pool.execute('SELECT phone_verified FROM users WHERE id = ? LIMIT 1', [ownerUserId]);
  if (!users[0] || !(users[0].phone_verified === 1 || users[0].phone_verified === true)) {
    const error = new Error('请先完成手机号验证，再创建开发者应用');
    error.code = 'PHONE_VERIFICATION_REQUIRED';
    error.statusCode = 403;
    throw error;
  }
}

async function updateOwnerApplication(ownerUserId, id, data) {
  const value = validateApplication(data);
  let scopesChanged = false;
  let clientId;
  let affectedUsers = [];
  await transaction(async (conn) => {
    const [rows] = await conn.execute(`SELECT id, client_id, status, client_type, party_type, requested_scopes
      FROM clients WHERE id = ? AND owner_user_id = ? FOR UPDATE`, [id, ownerUserId]);
    const client = rows[0];
    if (!client) throw new Error('应用不存在');
    if (client.status === 'deleted') throw new Error('应用不存在');
    if (client.client_type !== 'public' || client.party_type !== 'third_party') throw new Error('只能修改自助创建的 Public Client');
    clientId = client.client_id;
    const previousScopes = parseScopes(client.requested_scopes).sort();
    const nextScopes = [...value.requestedScopes].sort();
    scopesChanged = previousScopes.length !== nextScopes.length || previousScopes.some((scope, index) => scope !== nextScopes[index]);
    await conn.execute(
      `UPDATE clients SET name = ?, description = ?, website_url = ?, requested_scopes = ?, approved_scopes = ?,
         status = CASE WHEN status IN ('draft', 'pending') THEN 'approved' ELSE status END,
         approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP), approved_by = NULL
       WHERE id = ?`,
      [value.name, value.description, value.websiteUrl, JSON.stringify(value.requestedScopes), JSON.stringify(value.requestedScopes), id],
    );
    await syncRedirectUris(conn, Number(id), value.redirectUris);
    if (scopesChanged) {
      const [tokenRows] = await conn.execute('SELECT DISTINCT user_id FROM refresh_tokens WHERE client_id = ?', [clientId]);
      affectedUsers = tokenRows.map(({ user_id }) => Number(user_id));
      const [grants] = await conn.execute('SELECT user_id, scope FROM authorizations WHERE client_id = ?', [clientId]);
      for (const grant of grants) {
        const remaining = String(grant.scope || '').split(/\s+/).filter(scope => value.requestedScopes.includes(scope));
        if (remaining.length) {
          await conn.execute('UPDATE authorizations SET scope = ? WHERE user_id = ? AND client_id = ?',
            [remaining.join(' '), grant.user_id, clientId]);
        } else {
          await conn.execute('DELETE FROM authorizations WHERE user_id = ? AND client_id = ?', [grant.user_id, clientId]);
        }
      }
      await conn.execute('UPDATE refresh_tokens SET revoked = 1 WHERE client_id = ? AND revoked = 0', [clientId]);
    }
  });
  if (scopesChanged) {
    await Promise.all(affectedUsers.map(userId => tokenStore.revokeAccessTokensForUserClient(userId, clientId)));
  }
  return { updated: true };
}

async function submitOwnerApplication(ownerUserId, id) {
  const [result] = await pool.execute(
    `UPDATE clients SET status = 'approved', approved_scopes = requested_scopes,
       approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP), approved_by = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND owner_user_id = ? AND client_type = 'public' AND party_type = 'third_party'
       AND status IN ('draft', 'rejected')`, [id, ownerUserId],
  );
  if (!result.affectedRows) throw new Error('应用不存在或当前状态不能启用');
  return { submitted: true, status: 'approved' };
}

async function deactivateOwnerApplication(ownerUserId, id) {
  const [rows] = await pool.execute(
    `SELECT id, client_id, status, client_type, party_type FROM clients WHERE id = ? AND owner_user_id = ? LIMIT 1`,
    [id, ownerUserId],
  );
  const client = rows[0];
  if (!client || client.client_type !== 'public' || client.party_type !== 'third_party') throw new Error('应用不存在');
  if (client.status !== 'approved') throw new Error('只有已批准的应用可以停用');

  await revokeClientGrants(client.client_id, 'suspended');
  return { deactivated: true, status: 'suspended' };
}

async function deleteOwnerApplication(ownerUserId, id) {
  const [rows] = await pool.execute(
    'SELECT client_id, status, client_type, party_type FROM clients WHERE id = ? AND owner_user_id = ? LIMIT 1', [id, ownerUserId],
  );
  const client = rows[0];
  if (!client || client.status === 'deleted' || client.client_type !== 'public' || client.party_type !== 'third_party') {
    throw new Error('应用不存在');
  }
  await revokeClientGrants(client.client_id, 'deleted');
  return { deleted: true };
}

async function listPublicApplications() {
  const [rows] = await pool.execute(
    `SELECT c.client_id, c.name, c.description, c.website_url, c.client_type, c.party_type,
            c.requested_scopes, c.approved_scopes, c.owner_user_id, u.username AS developer_name,
            (SELECT COUNT(DISTINCT a.user_id) FROM authorizations a WHERE a.client_id = c.client_id) AS authorization_count
     FROM clients c LEFT JOIN users u ON u.id = c.owner_user_id
     WHERE c.status = 'approved' AND c.client_type = 'public'
     ORDER BY c.party_type = 'first_party' DESC, c.created_at DESC LIMIT 100`,
  );
  return rows.map(publicApplicationView);
}

async function getPublicApplication(clientId) {
  const [rows] = await pool.execute(
    `SELECT c.client_id, c.name, c.description, c.website_url, c.client_type, c.party_type, c.status,
            c.requested_scopes, c.approved_scopes, c.owner_user_id, u.username AS developer_name,
            (SELECT COUNT(DISTINCT a.user_id) FROM authorizations a WHERE a.client_id = c.client_id) AS authorization_count
     FROM clients c LEFT JOIN users u ON u.id = c.owner_user_id WHERE c.client_id = ? LIMIT 1`, [clientId],
  );
  const row = rows[0];
  if (!row || row.client_type !== 'public') return null;
  if (row.status !== 'approved') return { client_id: row.client_id, available: false };
  return { ...publicApplicationView(row), available: true };
}

function publicApplicationView(row) {
  const scopeNames = parseScopes(row.approved_scopes ?? row.requested_scopes);
  return {
    client_id: row.client_id,
    name: row.name,
    description: row.description || '',
    website_url: row.website_url || null,
    client_type: row.client_type,
    party_type: row.party_type,
    official: row.party_type === 'first_party',
    developer_name: row.developer_name || null,
    developer_url: row.owner_user_id ? forumProfileUrl(row.owner_user_id) : null,
    authorization_count: Number(row.authorization_count || 0),
    scopes: scopeNames.map(scope => ({ scope, ...SCOPE_DESCRIPTIONS[scope] })),
  };
}

async function reviewClient(id, { status, approvedScopes }, actor) {
  if (!['approved', 'rejected', 'suspended', 'pending'].includes(status)) throw new Error('无效的审核状态');
  const client = await getClient(id);
  if (!client) throw new Error('客户端不存在');
  if (client.status === 'deleted') throw new Error('已删除的客户端不能恢复');
  const requestedValues = Array.isArray(approvedScopes) ? approvedScopes : [];
  if (requestedValues.some(scope => typeof scope !== 'string' || !VALID_SCOPES.includes(scope))
    || new Set(requestedValues).size !== requestedValues.length) throw new Error('批准的 scopes 包含无效或重复值');
  const scopes = parseScopes(requestedValues);
  if (status === 'approved' && scopes.some(scope => !client.requested_scopes.includes(scope))) {
    throw new Error('批准的 scopes 必须来自应用申请列表');
  }
  if (status === 'approved' && scopes.length === 0) throw new Error('至少批准一个 scope');
  await pool.execute(
    `UPDATE clients SET status = ?, approved_scopes = IF(? = 'suspended', approved_scopes, ?), approved_at = IF(? = 'approved', CURRENT_TIMESTAMP, NULL),
       approved_by = IF(? = 'approved', ?, NULL) WHERE id = ?`,
    [status, status, JSON.stringify(status === 'approved' ? scopes : []), status, status, actor.adminId, id],
  );
  await writeAdminAudit(actor.adminId, `client.${status}`, 'client', Number(id), { approved_scopes: scopes }, actor.ipAddress);
  return { updated: true };
}

module.exports = {
  createClient, updateClient, rotateSecret, deleteClient, listClients, getClient,
  listOwnerApplications, createOwnerApplication, updateOwnerApplication,
  submitOwnerApplication, reviewClient, validateRedirectUri, isPrivateOrInternalHost,
  deactivateOwnerApplication, deleteOwnerApplication, listPublicApplications, getPublicApplication,
  validateApplication, assertPhoneVerifiedDeveloper,
  _isPrivateOrInternalHost: isPrivateOrInternalHost,
};
