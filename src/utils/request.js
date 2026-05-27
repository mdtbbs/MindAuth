/**
 * Request utility functions
 */

const config = require('../config');

// Cloudflare IP ranges (as of 2024)
// See: https://www.cloudflare.com/ips/
const CLOUDFLARE_IPV4_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22'
];

/**
 * Check if an IP address is within a CIDR range
 * @param {string} ip - IP address to check
 * @param {string} cidr - CIDR range (e.g., '192.168.0.0/16')
 * @returns {boolean} True if IP is within range
 */
function isIpInCidr(ip, cidr) {
  const [range, bits] = cidr.split('/');
  const mask = parseInt(bits) || 32;

  // Convert IP to number
  const ipNum = ipToNumber(ip);
  const rangeNum = ipToNumber(range);

  if (ipNum === null || rangeNum === null) return false;

  // Calculate network mask
  const networkMask = ~((1 << (32 - mask)) - 1);

  return (ipNum & networkMask) === (rangeNum & networkMask);
}

/**
 * Convert IPv4 address to number
 * @param {string} ip - IPv4 address
 * @returns {number|null} Numeric representation or null if invalid
 */
function ipToNumber(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  const nums = parts.map(p => parseInt(p, 10));
  if (nums.some(n => n < 0 || n > 255 || isNaN(n))) return null;

  return (nums[0] << 24) + (nums[1] << 16) + (nums[2] << 8) + nums[3];
}

/**
 * Validate IP address format (IPv4)
 * @param {string} ip - IP address to validate
 * @returns {boolean} True if valid IPv4
 */
function isValidIpv4(ip) {
  if (!ip || typeof ip !== 'string') return false;

  // Remove any port number
  const cleanIp = ip.split(':')[0];

  const parts = cleanIp.split('.');
  if (parts.length !== 4) return false;

  return parts.every(part => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255 && part === String(num);
  });
}

/**
 * Check if request comes from a trusted proxy
 * @param {Express.Request} req - Express request object
 * @returns {boolean} True if request is from trusted proxy
 */
function isTrustedProxy(req) {
  const remoteAddr = req.connection?.remoteAddress || req.socket?.remoteAddress;

  // Handle IPv6-mapped IPv4 addresses (::ffff:192.168.1.1)
  const cleanRemoteAddr = remoteAddr?.replace(/^::ffff:/, '') || '';

  // If trusted proxy not enabled, don't trust any proxy headers
  if (!config.trustedProxy?.enabled) {
    return false;
  }

  // Check against explicit whitelist
  const trustedIps = config.trustedProxy.ips || [];
  if (trustedIps.includes(cleanRemoteAddr)) {
    return true;
  }

  // Check Cloudflare IP ranges if enabled
  if (config.trustedProxy.trustCloudflare) {
    for (const cidr of CLOUDFLARE_IPV4_RANGES) {
      if (isIpInCidr(cleanRemoteAddr, cidr)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Extract client IP address from request with security validation
 * Only trusts proxy headers when request comes from a trusted proxy
 * @param {Express.Request} req - Express request object
 * @returns {string} Client IP address
 */
function getClientIp(req) {
  // Only read proxy headers if request comes from trusted proxy
  if (isTrustedProxy(req)) {
    // Cloudflare specific header (highest priority)
    const cfIp = req.headers['cf-connecting-ip'];
    if (cfIp && isValidIpv4(cfIp.trim())) {
      return cfIp.trim();
    }

    // X-Real-IP header (nginx, some proxies)
    const realIp = req.headers['x-real-ip'];
    if (realIp && isValidIpv4(realIp.trim())) {
      return realIp.trim();
    }

    // X-Forwarded-For header (standard proxy header)
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
      // Take first IP in the chain (original client)
      const firstIp = forwardedFor.split(',')[0].trim();
      if (isValidIpv4(firstIp)) {
        return firstIp;
      }
    }
  }

  // Fallback to Express req.ip or connection remote address
  const fallbackIp = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';

  // Clean IPv6-mapped IPv4 addresses
  const cleanIp = fallbackIp.replace(/^::ffff:/, '');

  return cleanIp || 'unknown';
}

module.exports = { getClientIp, isValidIpv4, isTrustedProxy };