/**
 * CORS origin resolution.
 *
 * The browser decides whether a page may read a cross-origin response based
 * on the `Access-Control-Allow-Origin` header, so that decision must be made
 * from server-side configuration only.
 *
 * In particular we never compare the request `Origin` with `req.headers.host`:
 * on raw requests the Host header is fully attacker-controlled, and trusting
 * it let any origin pair itself with a forged Host (e.g. `Host: evil.example`
 * + `Origin: https://evil.example`) to obtain `Access-Control-Allow-Origin`
 * together with `Access-Control-Allow-Credentials`.
 */

/**
 * Normalize an origin string to its canonical `scheme://host[:port]` form.
 * Returns null for anything that is not a plain http(s) origin.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeOrigin(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Decide whether a request Origin may receive CORS headers.
 *
 * - Requests without an `Origin` header are not CORS requests at all
 *   (non-browser clients, same-origin navigations) and stay allowed.
 * - Otherwise the Origin must match the configured allowlist or the
 *   service's own canonical origin (derived from `BASE_URL`).
 *
 * @param {string|undefined} origin - the request `Origin` header
 * @param {{ allowedOrigins?: string[], selfOrigin?: string|null }} options
 * @returns {boolean}
 */
function isOriginAllowed(origin, { allowedOrigins = [], selfOrigin = null } = {}) {
  if (!origin) return true;
  if (allowedOrigins.includes('*')) return true;

  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  const allowed = new Set(
    allowedOrigins.map(normalizeOrigin).filter(Boolean)
  );
  if (selfOrigin) {
    const self = normalizeOrigin(selfOrigin);
    if (self) allowed.add(self);
  }
  return allowed.has(normalized);
}

module.exports = { isOriginAllowed, normalizeOrigin };
