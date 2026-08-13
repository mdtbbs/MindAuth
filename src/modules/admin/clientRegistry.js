/**
 * clientRegistry — Centralized OAuth client management module.
 *
 * Single seam for creating, reading, updating, rotating secrets, and
 * deleting OAuth clients. All mutations write admin audit records.
 *
 * Design invariants:
 *   - Redirect URI validation includes SSRF protection (private IP blocking).
 *   - All mutations (create, update, rotate, delete) write audit logs.
 *   - Token generation uses the existing secure utilities.
 *   - Route adapters are thin HTTP wrappers over this module.
 */

const { pool } = require('../../db');
const { generateToken, generateShortToken } = require('../../utils/token');
const { hashClientSecret } = require('../../utils/secrets');
const { writeAdminAudit } = require('../audit/auditWriter');

// ─── Redirect URI validation ─────────────────────────────────

/**
 * Check if a hostname/IP is a private/internal address.
 * Blocks SSRF attacks targeting internal services.
 *
 * @param {string} hostname - Hostname or IP to check
 * @returns {boolean} True if private/internal
 */
function isPrivateOrInternalHost(hostname) {
  // Normalize hostname
  const host = hostname.toLowerCase().trim();

  // Block localhost variants
  const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'];
  if (blockedHosts.includes(host)) {
    return true;
  }

  // Check for localhost-like patterns
  if (host.endsWith('.localhost') || host.endsWith('.local') || host === 'local') {
    return true;
  }

  // Check private IP ranges (RFC 1918)
  // 10.0.0.0 - 10.255.255.255
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return true;
  }

  // 172.16.0.0 - 172.31.255.255
  const match172 = /^172\.(16|17|18|19|20|21|22|23|24|25|26|27|28|29|30|31)\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (match172) {
    return true;
  }

  // 192.168.0.0 - 192.168.255.255
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return true;
  }

  // 169.254.0.0 - 169.254.255.255 (Link-local)
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return true;
  }

  // Block internal metadata endpoints (AWS, GCP, Azure)
  const metadataHosts = ['metadata.google.internal', '169.254.169.254'];
  if (metadataHosts.includes(host)) {
    return true;
  }

  return false;
}

/**
 * Validate a redirect URI for format and security.
 *
 * Returns an object: { valid: boolean, error?: string }
 *   - valid=true  → URI is acceptable
 *   - valid=false → error contains a user-facing message
 *
 * @param {string} uri - The redirect URI to validate
 * @returns {{ valid: boolean, error?: string }}
 */
function validateRedirectUri(uri) {
  if (!uri) {
    return { valid: false, error: '回调地址必填' };
  }

  let url;
  try {
    url = new URL(uri);
  } catch {
    return { valid: false, error: '回调地址格式不正确' };
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return { valid: false, error: '回调地址必须使用 http 或 https 协议' };
  }

  if (isPrivateOrInternalHost(url.hostname)) {
    return { valid: false, error: '回调地址不能使用内部网络地址或 localhost' };
  }

  return { valid: true };
}

// ─── Client CRUD ─────────────────────────────────────────────

/**
 * List all OAuth clients.
 * @returns {Promise<Array>}
 */
async function listClients() {
  const [clients] = await pool.execute(
    'SELECT id, name, client_id, redirect_uri, require_pkce, created_at FROM clients'
  );
  return clients.map((c) => ({
    ...c,
    require_pkce: c.require_pkce === 1 || c.require_pkce === true,
  }));
}

/**
 * Get a single OAuth client by numeric ID.
 * @param {number} id
 * @returns {Promise<object|null>}
 */
async function getClient(id) {
  const [rows] = await pool.execute(
    'SELECT id, name, client_id, redirect_uri, require_pkce, created_at FROM clients WHERE id = ?',
    [id]
  );
  if (!rows[0]) return null;
  const c = rows[0];
  return { ...c, require_pkce: c.require_pkce === 1 || c.require_pkce === true };
}

/**
 * Create a new OAuth client.
 *
 * @param {{ name: string, redirect_uri: string, require_pkce?: boolean }} data
 * @param {{ adminId: number, ipAddress?: string }} actor
 * @returns {Promise<{ client_id: string, client_secret: string }>}
 */
async function createClient(data, actor) {
  const { name, redirect_uri, require_pkce } = data;
  const clientId = generateShortToken();
  const clientSecret = generateToken();
  const pkceFlag = require_pkce ? 1 : 0;

  await pool.execute(
    'INSERT INTO clients (name, client_id, client_secret, redirect_uri, require_pkce) VALUES (?, ?, ?, ?, ?)',
    [name, clientId, hashClientSecret(clientSecret), redirect_uri, pkceFlag]
  );

  await writeAdminAudit(
    actor.adminId,
    'client.create',
    'client',
    null,
    { name, client_id: clientId, require_pkce: pkceFlag },
    actor.ipAddress
  );

  return { client_id: clientId, client_secret: clientSecret };
}

/**
 * Update an existing OAuth client.
 *
 * @param {number} id - Client numeric ID
 * @param {{ name: string, redirect_uri: string, require_pkce?: boolean }} data
 * @param {{ adminId: number, ipAddress?: string }} actor
 * @returns {Promise<{ updated: boolean }>}
 */
async function updateClient(id, data, actor) {
  const { name, redirect_uri, require_pkce } = data;

  // Only update require_pkce when explicitly provided (so PATCH-style partial
  // updates that omit it don't accidentally flip the flag).
  if (require_pkce !== undefined) {
    const pkceFlag = require_pkce ? 1 : 0;
    await pool.execute(
      'UPDATE clients SET name = ?, redirect_uri = ?, require_pkce = ? WHERE id = ?',
      [name, redirect_uri, pkceFlag, id]
    );
    await writeAdminAudit(
      actor.adminId,
      'client.update',
      'client',
      parseInt(id),
      { name, redirect_uri, require_pkce: pkceFlag },
      actor.ipAddress
    );
  } else {
    await pool.execute(
      'UPDATE clients SET name = ?, redirect_uri = ? WHERE id = ?',
      [name, redirect_uri, id]
    );
    await writeAdminAudit(
      actor.adminId,
      'client.update',
      'client',
      parseInt(id),
      { name, redirect_uri },
      actor.ipAddress
    );
  }

  return { updated: true };
}

/**
 * Rotate the client secret for an OAuth client.
 *
 * @param {number} id - Client numeric ID
 * @param {{ adminId: number, ipAddress?: string }} actor
 * @returns {Promise<{ client_secret: string }>}
 */
async function rotateSecret(id, actor) {
  const newSecret = generateToken();
  await pool.execute('UPDATE clients SET client_secret = ? WHERE id = ?', [hashClientSecret(newSecret), id]);

  await writeAdminAudit(
    actor.adminId,
    'client.rotate_secret',
    'client',
    parseInt(id),
    null,
    actor.ipAddress
  );

  return { client_secret: newSecret };
}

/**
 * Delete an OAuth client.
 *
 * @param {number} id - Client numeric ID
 * @param {{ adminId: number, ipAddress?: string }} actor
 * @returns {Promise<{ deleted: boolean }>}
 */
async function deleteClient(id, actor) {
  const [result] = await pool.execute('DELETE FROM clients WHERE id = ?', [id]);

  await writeAdminAudit(
    actor.adminId,
    'client.delete',
    'client',
    parseInt(id),
    null,
    actor.ipAddress
  );

  return { deleted: result.affectedRows > 0 };
}

// ─── Exports ─────────────────────────────────────────────────

module.exports = {
  createClient,
  updateClient,
  rotateSecret,
  deleteClient,
  listClients,
  getClient,
  validateRedirectUri,
  // Exposed for testing
  _isPrivateOrInternalHost: isPrivateOrInternalHost,
};
