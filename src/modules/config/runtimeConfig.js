/**
 * runtimeConfig — Centralized runtime configuration module.
 *
 * Provides a unified interface for reading and writing DB-backed runtime
 * configuration (system_config table) with optional in-memory caching and
 * Redis-backed invalidation.
 *
 * Design invariants:
 *   - Environment-based config (src/config/index.js) remains the authority
 *     for static settings (ports, DB credentials, etc.)
 *   - This module manages *dynamic* settings stored in system_config
 *   - Cache is invalidated on admin updates (set())
 *   - get() reads cache → DB fallback; set() writes DB → invalidates cache
 *
 * The cache is per-process (a Map), which is fine for single-instance deploys.
 * For multi-instance setups, admin updates should also publish a Redis message.
 */

const { pool } = require('../../db');

// ─── Constants ────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── State ───────────────────────────────────────────────────

const cache = new Map();
let lastFullLoad = 0;

// ─── Internal helpers ────────────────────────────────────────

async function loadAll() {
  const [rows] = await pool.execute('SELECT `key`, `value` FROM system_config');
  const now = Date.now();
  for (const row of rows) {
    cache.set(row.key, { value: row.value, loadedAt: now });
  }
  lastFullLoad = now;
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.loadedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

// ─── Public interface ────────────────────────────────────────

/**
 * Get a single runtime config value.
 * Reads from in-memory cache first, falls back to DB.
 *
 * @param {string} key
 * @returns {Promise<string|null>}
 */
async function get(key) {
  const cached = getCached(key);
  if (cached !== undefined) return cached;

  const [rows] = await pool.execute(
    'SELECT `value` FROM system_config WHERE `key` = ?',
    [key]
  );
  const value = rows[0]?.value ?? null;
  cache.set(key, { value, loadedAt: Date.now() });
  return value;
}

/**
 * Get multiple runtime config values at once.
 *
 * @param {string[]} keys
 * @returns {Promise<Object<string, string|null>>}
 */
async function getMany(keys) {
  // Check cache first
  const result = {};
  const missing = [];
  for (const key of keys) {
    const cached = getCached(key);
    if (cached !== undefined) {
      result[key] = cached;
    } else {
      missing.push(key);
    }
  }

  if (missing.length === 0) return result;

  // Load missing from DB
  const placeholders = missing.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT \`key\`, \`value\` FROM system_config WHERE \`key\` IN (${placeholders})`,
    missing
  );

  const found = new Set();
  for (const row of rows) {
    result[row.key] = row.value;
    cache.set(row.key, { value: row.value, loadedAt: Date.now() });
    found.add(row.key);
  }

  // Keys not in DB → null
  for (const key of missing) {
    if (!found.has(key)) {
      result[key] = null;
      cache.set(key, { value: null, loadedAt: Date.now() });
    }
  }

  return result;
}

/**
 * Set a runtime config value. Writes to DB and invalidates cache.
 *
 * @param {string} key
 * @param {string} value
 * @returns {Promise<{ updated: boolean }>}
 */
async function set(key, value) {
  const [result] = await pool.execute(
    'UPDATE system_config SET `value` = ?, updated_at = CURRENT_TIMESTAMP WHERE `key` = ?',
    [value, key]
  );
  const updated = result.affectedRows > 0;

  // Invalidate cache for this key
  cache.delete(key);

  return { updated };
}

/**
 * Invalidate cached values.
 *
 * @param {string[]} [keys] - specific keys to invalidate; if omitted, clears all
 */
function invalidate(keys) {
  if (!keys || keys.length === 0) {
    cache.clear();
    lastFullLoad = 0;
    return;
  }
  for (const key of keys) {
    cache.delete(key);
  }
}

/**
 * Load all config values into cache (pre-warm).
 * Useful at startup or after bulk updates.
 *
 * @returns {Promise<void>}
 */
async function preload() {
  await loadAll();
}

// ─── Exports ─────────────────────────────────────────────────

module.exports = {
  get,
  getMany,
  set,
  invalidate,
  preload,
  // Exposed for testing
  _cache: cache,
  _CACHE_TTL_MS: CACHE_TTL_MS,
};
