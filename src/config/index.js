/**
 * Centralized configuration management
 * All environment variables and constants are managed here
 */

const config = {
  // Server configuration
  server: {
    port: parseInt(process.env.PORT) || 4001,
    baseUrl: process.env.BASE_URL || 'http://localhost:4001',
    cdnUrl: process.env.CDN_URL || '',
    isProduction: process.env.NODE_ENV === 'production',
    allowedOrigins: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
      : ['http://localhost:3000', 'http://localhost:4000', 'http://localhost:4001'],
    version: process.env.npm_package_version || '1.0.0'
  },

  // MySQL database configuration
  mysql: {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || 'mindauth',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'mindauth',
    poolSize: parseInt(process.env.MYSQL_POOL_SIZE) || 10
  },

  // Redis configuration
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    database: parseInt(process.env.REDIS_DB) || 0
  },

  // SMTP configuration (fallback when database config not set)
  smtp: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM,
    secure: process.env.SMTP_SECURE === 'true'
  },

  // Admin configuration
  admin: {
    secret: process.env.ADMIN_SECRET,
    sessionMaxAge: 24 * 60 * 60 * 1000 // 24 hours
  },

  // Session configuration
  session: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    cacheTtl: 1800 // 30 minutes
  },

  // Token TTLs (in seconds)
  tokenTtl: {
    accessToken: 3600,      // 1 hour
    refreshToken: 30 * 24 * 60 * 60, // 30 days
    authCode: 300,          // 5 minutes
    emailVerification: 3600, // 1 hour
    passwordReset: 3600     // 1 hour
  },

  // Rate limiting defaults — every limiter gets its own key namespace so
  // endpoints can never consume or reset each other's counters
  rateLimit: {
    login: { maxAttempts: 5, windowMs: 5 * 60 * 1000, keyPrefix: 'ratelimit:login' },          // 5 per 5 min
    register: { maxAttempts: 5, windowMs: 60 * 60 * 1000, keyPrefix: 'ratelimit:register' },   // 5 per hour
    adminLogin: { maxAttempts: 3, windowMs: 15 * 60 * 1000, keyPrefix: 'ratelimit:admin_login' } // 3 per 15 min
  },

  // Trusted proxy configuration for IP extraction
  // When behind a trusted proxy/CDN, specify which IPs are trusted
  // This prevents IP spoofing attacks that bypass rate limits
  trustedProxy: {
    // Enable proxy header trust (set to true when behind CDN/reverse proxy)
    enabled: process.env.TRUSTED_PROXY_ENABLED === 'true' || false,
    // Whitelist of trusted proxy IPs or CIDR ranges (comma-separated)
    // Only accept proxy headers from these sources
    ips: process.env.TRUSTED_PROXY_IPS
      ? process.env.TRUSTED_PROXY_IPS.split(',').map(ip => ip.trim())
      : [],
    // Cloudflare IP ranges (auto-trust if using Cloudflare)
    // See: https://www.cloudflare.com/ips/
    trustCloudflare: process.env.TRUST_CLOUDFLARE === 'true' || false
  },

  // Admin security settings
  adminSecurity: {
    // Minimum length for ADMIN_SECRET in production
    minSecretLength: parseInt(process.env.ADMIN_SECRET_MIN_LENGTH) || 32,
    // Rate limits for admin operations (per IP)
    userDelete: { maxAttempts: 10, windowMs: 60 * 60 * 1000, keyPrefix: 'ratelimit:admin_user_delete' },       // 10 per hour
    passwordReset: { maxAttempts: 20, windowMs: 60 * 60 * 1000, keyPrefix: 'ratelimit:admin_password_reset' }, // 20 per hour
    clientCreate: { maxAttempts: 20, windowMs: 60 * 60 * 1000, keyPrefix: 'ratelimit:admin_client_create' }    // 20 per hour
  }
};

module.exports = config;