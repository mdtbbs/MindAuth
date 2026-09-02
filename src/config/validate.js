/**
 * Configuration validation
 *
 * Validates that all required configuration is present and correct
 * before the application starts. In production, strict checks are
 * enforced. In development/test, we only warn about missing values.
 */

const fs = require('fs');
const path = require('path');
const { getEncryptionKey } = require('../utils/secrets');

/**
 * Validate the application configuration.
 * Throws on fatal misconfiguration in production.
 * Logs warnings in development/test.
 *
 * @param {object} config - The config object from src/config/index.js
 */
function validateConfig(config) {
  const errors = [];
  const warnings = [];
  const isProduction = config.server.isProduction;

  // --- Production-only strict checks ---

  if (isProduction) {
    // BASE_URL must be set and not localhost
    if (!config.server.baseUrl) {
      errors.push('BASE_URL is required in production');
    } else if (
      config.server.baseUrl.includes('localhost') ||
      config.server.baseUrl.includes('127.0.0.1')
    ) {
      errors.push('BASE_URL must not point to localhost in production');
    }

    // ADMIN_SECRET must be set and at least 32 characters
    if (!config.admin.secret) {
      errors.push('ADMIN_SECRET is required in production');
    } else if (config.admin.secret.length < (config.adminSecurity.minSecretLength || 32)) {
      errors.push(
        `ADMIN_SECRET must be at least ${config.adminSecurity.minSecretLength || 32} characters in production (got ${config.admin.secret.length})`
      );
    }

    // ALLOWED_ORIGINS must not be wildcard in production
    if (config.server.allowedOrigins.includes('*')) {
      errors.push('ALLOWED_ORIGINS=* is not allowed in production when credentials are enabled');
    }

    // Memory Redis stores sessions, OAuth tokens, and rate limits in process
    // memory — data loss on restart and no cross-instance sharing
    if (process.env.USE_MEMORY_REDIS === '1' || process.env.USE_MEMORY_REDIS === 'true') {
      errors.push('USE_MEMORY_REDIS must not be enabled in production');
    }

    try {
      if (!getEncryptionKey()) errors.push('SECRETS_ENCRYPTION_KEY is required in production');
    } catch (err) {
      errors.push(err.message);
    }
    if (!process.env.NATIVE_AUTH_HMAC_SECRET) {
      errors.push('NATIVE_AUTH_HMAC_SECRET is required in production');
    }
    if (!process.env.NATIVE_MINDFOURM_CLIENT_SECRET) {
      errors.push('NATIVE_MINDFOURM_CLIENT_SECRET is required in production');
    }
  }

  // --- MySQL config ---
  if (!config.mysql.host) {
    errors.push('MYSQL_HOST is required');
  }
  if (!config.mysql.database) {
    errors.push('MYSQL_DATABASE is required');
  }

  // --- Redis config ---
  if (!config.redis.host) {
    errors.push('REDIS_HOST is required');
  }

  // --- QQ OAuth ---
  if (config.qq?.enabled) {
    if (!config.qq.clientId || !config.qq.clientSecret || !config.qq.redirectUri) {
      errors.push('QQ OAuth is enabled but QQ_CLIENT_ID, QQ_CLIENT_SECRET, or QQ_REDIRECT_URI is missing');
    }
    try {
      const qqRedirect = new URL(config.qq.redirectUri);
      if (isProduction && qqRedirect.protocol !== 'https:') {
        errors.push('QQ_REDIRECT_URI must use HTTPS in production');
      }
    } catch {
      errors.push('QQ_REDIRECT_URI is not a valid URL');
    }
    if (!Number.isFinite(config.qq.timeoutMs) || config.qq.timeoutMs < 1000 || config.qq.timeoutMs > 30000) {
      errors.push('QQ_HTTP_TIMEOUT_MS must be between 1000 and 30000 milliseconds');
    }
  }

  const uploadsDir = path.join(__dirname, '../../public/uploads');
  try {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    // Check subdirectories
    const subdirs = ['avatars', 'banners'];
    for (const sub of subdirs) {
      const subPath = path.join(uploadsDir, sub);
      if (!fs.existsSync(subPath)) {
        fs.mkdirSync(subPath, { recursive: true });
      }
    }
    // Verify writability by attempting to create and remove a temp file
    const testFile = path.join(uploadsDir, '.write-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
  } catch (err) {
    if (isProduction) {
      errors.push(`Upload directory is not writable: ${uploadsDir} (${err.message})`);
    } else {
      warnings.push(`Upload directory may not be writable: ${uploadsDir} (${err.message})`);
    }
  }

  // --- Log warnings ---
  for (const w of warnings) {
    console.warn(`[config] WARNING: ${w}`);
  }

  // --- Throw on errors ---
  if (errors.length > 0) {
    const msg = `Configuration validation failed:\n  - ${errors.join('\n  - ')}`;
    throw new Error(msg);
  }
}

module.exports = { validateConfig };
