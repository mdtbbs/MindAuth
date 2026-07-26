/**
 * Normalise legacy hash routes (/#/login, /#/register, etc.) to new path routes.
 *
 * The old vanilla-JS SPA uses hash-based routing. The new React frontend uses
 * proper path-based routing. This module detects hash fragments on page load
 * and redirects to the equivalent path route so that bookmarks and links
 * shared before the migration continue to work.
 *
 * Mapping:
 *   /#/login              → /login
 *   /#/register           → /register
 *   /#/dashboard          → /dashboard
 *   /#/account-settings   → /account-settings
 *   /#/reset-request      → /reset-request
 *   /#/reset-password?token=abc → /reset-password?token=abc
 *   /#/verify-email?token=abc   → /verify-email?token=abc
 */

interface RouteMapping {
  hash: string;
  path: string;
}

const ROUTE_MAP: RouteMapping[] = [
  { hash: '#/login', path: '/login' },
  { hash: '#/register', path: '/register' },
  { hash: '#/dashboard', path: '/dashboard' },
  { hash: '#/account-settings', path: '/account-settings' },
  { hash: '#/reset-request', path: '/reset-request' },
  { hash: '#/reset-password', path: '/reset-password' },
  { hash: '#/verify-email', path: '/verify-email' },
];

/**
 * Check for a legacy hash route and redirect to the equivalent path route.
 * Call this once at application startup, before rendering.
 *
 * @returns `true` if a redirect was performed.
 */
export function normalizeLegacyHashRoutes(): boolean {
  const hash = window.location.hash;
  if (!hash || hash === '#') return false;

  // Strip query string from hash for matching; the legacy SPA used both
  // "#login" and "#/login" forms, so the leading slash is optional
  const [hashPath, hashQuery] = hash.split('?');
  const normalisedHash = hashPath.replace(/^#\/?/, '');

  for (const mapping of ROUTE_MAP) {
    const mappingPath = mapping.path.replace(/^\//, '');
    if (normalisedHash === mappingPath) {
      const newPath = hashQuery
        ? `${mapping.path}?${hashQuery}`
        : mapping.path;

      // Use replace so the hash URL doesn't stay in browser history
      window.history.replaceState(null, '', newPath);
      return true;
    }
  }

  return false;
}
