/**
 * Configuration validation
 *
 * Validates that all required configuration is present and correct
 * before the application starts. In production, strict checks are
 * enforced. In development/test, we only warn about missing values.
 */

const fs = require('fs');
const path = require('path');

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

  // --- Trusted proxy config ---
  const proxyEnabled = config.trustedProxy?.enabled === true;
  const trustedProxyIps = config.trustedProxy?.ips || [];
  const trustCloudflare = config.trustedProxy?.trustCloudflare === true;
  const aliyunEsaAutoTrust = process.env.ALIYUN_ESA_AUTO_TRUST === 'true';

  if (isProduction) {
    if (!proxyEnabled) {
      warnings.push('TRUSTED_PROXY_ENABLED=false in production — if the app is behind ESA/nginx, client IPs will fall back to the proxy address (often 127.0.0.1)');
    } else if (trustedProxyIps.length === 0 && !trustCloudflare && !aliyunEsaAutoTrust) {
      warnings.push('TRUSTED_PROXY_ENABLED=true but no trusted proxy sources are configured — set TRUSTED_PROXY_IPS / TRUST_CLOUDFLARE, or enable ALIYUN_ESA_AUTO_TRUST for ESA');
    }

    if (aliyunEsaAutoTrust && !process.env.ALIYUN_ESA_SITE_ID) {
      warnings.push('ALIYUN_ESA_AUTO_TRUST=true but ALIYUN_ESA_SITE_ID is missing — ESA trusted proxy auto-matching will stay empty');
    }
  }

  // --- Upload directory ---
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
