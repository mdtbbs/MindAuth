/**
 * GET /logout — SLO endpoint for cross-origin SPAs (e.g. MindFourm).
 *
 * Browser-initiated logout. Validates `redirect_uri` against the registered
 * value for the given `client_id` (strict equality) to prevent open redirect.
 * Idempotent: works whether or not the user has an active MindAuth session.
 *
 * Any validation failure silently redirects to /login — never to an untrusted
 * URI. This matches the security posture of /api/authorize error handling.
 *
 * Mounted at top-level /logout in app.js (NOT under /api) because the primary
 * caller (MindFourm) does a cross-origin browser navigation:
 *   window.location.href = `${mindauthUrl}/logout?redirect_uri=...&client_id=...`
 */

const sessionManager = require('../modules/sessions/sessionManager');
const oauthIssuer = require('../modules/oauth/oauthIssuer');

function sloLogoutHandler(req, res) {
  const safeFallback = () => res.redirect('/login');

  (async () => {
    const { redirect_uri, client_id } = req.query;

    // 1. Best-effort session revocation (idempotent — skip cleanly if no
    //    session cookie or if the cookie is invalid/expired).
    const token = req.cookies && req.cookies.session;
    if (token) {
      try {
        const authResult = await sessionManager.authenticateUserSession(token);
        if (authResult && authResult.user) {
          await sessionManager.revokeUserSession({ token, userId: authResult.user.id });
        }
      } catch {
        // Ignore session errors; we still want to proceed to redirect logic.
      }
      res.clearCookie('session', { path: '/' });
    }

    // 2. Validate redirect_uri + client_id (both required for safe redirect).
    if (!redirect_uri || !client_id) {
      return safeFallback();
    }

    let clientRow;
    try {
      clientRow = await oauthIssuer.lookupClient(client_id);
    } catch {
      // lookupClient throws OAuthError when client_id is unknown.
      return safeFallback();
    }

    // Strict equality — the redirect_uri must exactly match the registered value.
    if (typeof clientRow.redirect_uri !== 'string' || clientRow.redirect_uri !== redirect_uri) {
      return safeFallback();
    }

    // 3. Protocol safety (defence-in-depth: registration already enforces this,
    //    but a compromised/old registration row could still hold a non-http URI).
    let parsed;
    try {
      parsed = new URL(redirect_uri);
    } catch {
      return safeFallback();
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return safeFallback();
    }

    return res.redirect(redirect_uri);
  })().catch((err) => {
    console.error('GET /logout error:', err);
    return safeFallback();
  });
}

module.exports = { sloLogoutHandler };
