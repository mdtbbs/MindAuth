/**
 * Request utility functions
 */

const net = require('net');
const config = require('../config');
const { getCachedEntries: getAliyunEsaTrustedEntries, isEnabled: isAliyunEsaAutoTrustEnabled } = require('./aliyunEsaTrustedProxy');

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

const CLOUDFLARE_IPV6_RANGES = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32'
];

/**
 * Parse dotted-quad IPv4 → BigInt (32-bit), or null if invalid.
 * @param {string} ip
 * @returns {bigint|null}
 */
function ipv4ToBigInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const o = Number(p);
    if (o > 255) return null;
    n = (n << 8n) + BigInt(o);
  }
  return n;
}

/**
 * Parse IPv6 (incl. `::` compression and embedded IPv4) → BigInt (128-bit), or null.
 * @param {string} ip
 * @returns {bigint|null}
 */
function ipv6ToBigInt(ip) {
  ip = ip.split('%')[0];

  const v4 = ip.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const v4n = ipv4ToBigInt(v4[1]);
    if (v4n === null) return null;
    const hi = (v4n >> 16n) & 0xffffn;
    const lo = v4n & 0xffffn;
    ip = ip.slice(0, v4.index) + hi.toString(16) + ':' + lo.toString(16);
  }

  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];

  let groups;
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    n = (n << 16n) + BigInt(parseInt(g, 16));
  }
  return n;
}

/** Parse any IP → { fam: 4|6, n: BigInt } or null. */
function parseIp(ip) {
  if (typeof ip !== 'string') return null;
  if (ip.includes(':')) {
    const n = ipv6ToBigInt(ip);
    return n === null ? null : { fam: 6, n };
  }
  if (ip.includes('.')) {
    const n = ipv4ToBigInt(ip);
    return n === null ? null : { fam: 4, n };
  }
  return null;
}

/**
 * Check whether an IP is in a CIDR range. Supports IPv4 and IPv6.
 * @param {string} ip - IP address to check
 * @param {string} cidr - CIDR range (e.g., '192.168.0.0/16' or '2400:cb00::/32')
 * @returns {boolean} True if IP is within range
 */
function isIpInCidr(ip, cidr) {
  if (typeof cidr !== 'string' || !cidr.includes('/')) return false;
  const [range, bits] = cidr.split('/');
  const client = parseIp(ip);
  const network = parseIp(range);
  if (!client || !network || client.fam !== network.fam) return false;

  const width = client.fam === 4 ? 32 : 128;
  const prefix = Number(bits);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > width) return false;

  const mask = prefix === 0 ? 0n : (((1n << BigInt(prefix)) - 1n) << BigInt(width - prefix));
  return (client.n & mask) === (network.n & mask);
}

/**
 * Convert IPv4 address to number
 * @param {string} ip - IPv4 address
 * @returns {number|null} Numeric representation or null if invalid
 */
function ipToNumber(ip) {
  const n = ipv4ToBigInt(ip);
  return n === null ? null : Number(n);
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
 * Normalize and validate an IP candidate from a proxy header.
 * Accepts IPv4 and IPv6; strips ports and IPv6 brackets:
 *   '1.2.3.4'            → '1.2.3.4'
 *   '1.2.3.4:5678'       → '1.2.3.4'
 *   '2001:db8::1'        → '2001:db8::1'
 *   '[2001:db8::1]'      → '2001:db8::1'
 *   '[2001:db8::1]:1234' → '2001:db8::1'
 *   '::ffff:1.2.3.4'     → '1.2.3.4' (IPv6-mapped IPv4 normalized)
 *
 * @param {string} value - Raw header value (single IP entry)
 * @returns {string|null} Normalized IP, or null if invalid
 */
function normalizeIpCandidate(value) {
  if (!value || typeof value !== 'string') return null;
  let candidate = value.trim();

  // Bracketed IPv6, optionally with port: [2001:db8::1]:1234
  const bracketMatch = /^\[([^\]]+)\](?::\d+)?$/.exec(candidate);
  if (bracketMatch) {
    candidate = bracketMatch[1];
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(candidate)) {
    // IPv4 with port: 1.2.3.4:5678
    candidate = candidate.split(':')[0];
  }

  // Normalize IPv6-mapped IPv4 addresses (::ffff:1.2.3.4)
  const unmapped = candidate.replace(/^::ffff:/i, '');
  if (unmapped !== candidate && net.isIP(unmapped) === 4) {
    candidate = unmapped;
  }

  return net.isIP(candidate) !== 0 ? candidate : null;
}

/**
 * Normalize trusted-proxy list entries so loopback / mapped forms compare consistently.
 * @param {string} value
 * @returns {string|null}
 */
function normalizeTrustedProxyEntry(value) {
  const normalized = normalizeIpCandidate(value);
  if (!normalized) return null;
  if (normalized === '::1') return '127.0.0.1';
  return normalized;
}

/**
 * Check whether a trusted-proxy entry matches a remote address.
 * Supports exact IPs and CIDR ranges.
 * @param {string} remoteAddr
 * @param {string} trustedEntry
 * @returns {boolean}
 */
function matchesTrustedProxyEntry(remoteAddr, trustedEntry) {
  if (!remoteAddr || !trustedEntry) return false;

  if (trustedEntry.includes('/')) {
    return isIpInCidr(remoteAddr, trustedEntry);
  }

  const normalizedEntry = normalizeTrustedProxyEntry(trustedEntry);
  return normalizedEntry === remoteAddr;
}

/**
 * Check if request comes from a trusted proxy
 * @param {Express.Request} req - Express request object
 * @returns {boolean} True if request is from trusted proxy
 */
function isTrustedProxy(req) {
  const remoteAddr = req.connection?.remoteAddress || req.socket?.remoteAddress;
  const normalizedRemoteAddr = normalizeTrustedProxyEntry(remoteAddr);

  // If trusted proxy not enabled, don't trust any proxy headers
  if (!config.trustedProxy?.enabled) {
    return false;
  }

  // Check against explicit whitelist
  const trustedIps = (config.trustedProxy.ips || []).filter(Boolean);
  if (normalizedRemoteAddr && trustedIps.some((entry) => matchesTrustedProxyEntry(normalizedRemoteAddr, entry))) {
    return true;
  }

  // Check cached Aliyun ESA origin-protection entries if enabled
  if (normalizedRemoteAddr && isAliyunEsaAutoTrustEnabled()) {
    const esaEntries = getAliyunEsaTrustedEntries();
    if (esaEntries.some((entry) => matchesTrustedProxyEntry(normalizedRemoteAddr, entry))) {
      return true;
    }
  }

  // Check Cloudflare IP ranges if enabled
  if (config.trustedProxy.trustCloudflare) {
    for (const cidr of [...CLOUDFLARE_IPV4_RANGES, ...CLOUDFLARE_IPV6_RANGES]) {
      if (normalizedRemoteAddr && isIpInCidr(normalizedRemoteAddr, cidr)) {
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
    const cfIp = normalizeIpCandidate(req.headers['cf-connecting-ip']);
    if (cfIp) {
      return cfIp;
    }

    // X-Real-IP header (nginx, some proxies)
    const realIp = normalizeIpCandidate(req.headers['x-real-ip']);
    if (realIp) {
      return realIp;
    }

    // X-Forwarded-For header (standard proxy header)
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
      // Take first IP in the chain (original client)
      const firstIp = normalizeIpCandidate(forwardedFor.split(',')[0]);
      if (firstIp) {
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

module.exports = { getClientIp, isValidIpv4, isTrustedProxy, normalizeIpCandidate };