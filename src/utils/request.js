/**
 * Request utility functions
 *
 * getClientIp() extracts the client's real IP by reading CDN / reverse-proxy
 * headers unconditionally, in the following priority:
 *
 *   1. ali-real-client-ip   (Aliyun ESA / DCDN)
 *   2. x-real-ip            (NGINX / generic CDN)
 *   3. cf-connecting-ip     (Cloudflare)
 *   4. x-forwarded-for      (standard, first entry)
 *   5. req.connection.remoteAddress / req.socket.remoteAddress (fallback)
 *
 * Each header value is normalized (brackets / ports / `::ffff:` mapping
 * stripped) and validated via `net.isIP()`; the first valid IP wins.
 *
 * Deployment requirement: the service MUST sit behind a CDN / reverse proxy
 * that OVERWRITES these headers on the way in (e.g. ESA, nginx with
 * `proxy_set_header Ali-Real-Client-IP $remote_addr;`). If a client can
 * reach the service directly, it can spoof any IP via these headers.
 */

const net = require('net');

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
 * Extract client IP address from request by reading CDN / reverse-proxy
 * headers in priority order. See module JSDoc for deployment requirements.
 *
 * @param {Express.Request} req - Express request object
 * @returns {string} Client IP address
 */
function getClientIp(req) {
  const candidates = [
    req.headers['ali-real-client-ip'],
    req.headers['x-real-ip'],
    req.headers['cf-connecting-ip'],
  ];

  for (const raw of candidates) {
    const ip = normalizeIpCandidate(raw);
    if (ip) return ip;
  }

  // X-Forwarded-For may contain a comma-separated chain; take the first entry
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const first = normalizeIpCandidate(xff.split(',')[0]);
    if (first) return first;
  }

  // Fallback to socket remote address
  const fallback = req.connection?.remoteAddress
    || req.socket?.remoteAddress
    || 'unknown';

  // Clean IPv6-mapped IPv4 addresses
  return fallback.replace(/^::ffff:/, '') || 'unknown';
}

module.exports = { getClientIp, isValidIpv4, normalizeIpCandidate };
