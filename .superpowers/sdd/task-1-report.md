# Task 1 Report: Freeze the external contract with tests

## What I Implemented

Created 3 new contract test files and modified 1 existing file to lock down the current behavior of MindAuth's external API contract before any refactoring begins.

### Files Created

1. **`tests/specs/oauth/oauth-contract.spec.js`** — 29 tests
   - OIDC Discovery endpoint structure and current behavior (endpoints lack `/api` prefix — documented as known issue)
   - `POST /api/token` response shape (success + error cases)
   - `POST /api/refresh` response shape (success, rotation, replay detection, errors)
   - `POST /api/introspect` response shape (RFC 7662 compliance)
   - `GET /api/userinfo` response shape (OIDC claims)
   - `GET /api/user` compatibility endpoint response shape
   - `POST /api/revoke` response shape (RFC 7009 compliance)
   - `POST /api/verify` session verification response shape

2. **`tests/specs/security/security-contract.spec.js`** — 35 tests
   - CSRF protection: state-changing routes require valid CSRF token
   - CSRF wrong token returns 403
   - CSRF exempt paths: `/api/token`, `/api/refresh`, `/api/revoke`, `/api/verify`, `/api/introspect`, `/api/register`, `/api/login`, `/api/admin/login`, `/api/challenge/random`, `/api/challenge/verify`
   - CSRF cookie behavior (set on all responses, readable by JS)
   - IP ban CRUD: create exact IP ban, create CIDR ban, reject invalid IP/CIDR, update, delete
   - Redirect URI rejection: localhost, 127.0.0.1, private IPs (10.x, 172.16.x, 192.168.x), invalid URL, non-http protocol
   - Redirect URI rejection on client update

3. **`tests/specs/auth/session-contract.spec.js`** — 10 tests
   - `GET /api/sessions` requires auth, returns sessions with `is_current` flag
   - Multi-device login: same user can have concurrent sessions with different tokens
   - Logout invalidates current session but not others
   - Password change revokes ALL sessions (all devices must re-login)
   - Password reset requires valid token and CSRF
   - `DELETE /api/sessions/:id` specific session termination
   - Current session termination clears cookie

### Files Modified

4. **`tests/specs/oauth/oauth-flow.spec.js`** — Added 5 tests
   - Fixed redirect_uri to use correct port (4500 instead of 4000)
   - Added redirect URI rejection tests: localhost, 127.0.0.1, private IP 192.168.x, invalid URL format, non-http protocol

## Test Results

**74 new contract tests — ALL PASSING**

| File | Tests | Status |
|------|-------|--------|
| oauth-contract.spec.js | 29 | ✅ All pass |
| security-contract.spec.js | 35 | ✅ All pass |
| session-contract.spec.js | 10 | ✅ All pass |
| oauth-flow.spec.js (new tests) | 5 | ✅ All pass |
| **Total new tests** | **74** | **✅** |

Note: The existing UI-based test `完整OAuth授权流程` in oauth-flow.spec.js fails in the worktree due to the worktree not having `public/` files available for browser rendering. This is a pre-existing environment issue, not a regression from my changes.

## Known Issues Documented in Tests

1. **OIDC Discovery endpoints lack `/api` prefix** — The `/.well-known/openid-configuration` returns endpoints like `/authorize` instead of `/api/authorize`. Tests capture this current behavior with comments noting it should be fixed during refactor.

2. **Session termination doesn't fully invalidate terminated sessions** — `DELETE /api/sessions/:id` removes the session from `user_sessions` tracking and Redis cache, but the MySQL fallback in `requireAuth` still allows the terminated session to authenticate via `users.session_token`. Tests document this as current behavior.

3. **`/api/password/reset` requires CSRF** — Unlike other token-based endpoints, the password reset endpoint is not in the CSRF exempt list, requiring a CSRF token even though the user may not have an active session.

## Files Changed

```
tests/specs/oauth/oauth-contract.spec.js     (NEW — 29 tests)
tests/specs/security/security-contract.spec.js (NEW — 35 tests)
tests/specs/auth/session-contract.spec.js     (NEW — 10 tests)
tests/specs/oauth/oauth-flow.spec.js          (MODIFIED — +5 tests, fixed redirect_uri)
```

## Self-Review Findings

- All tests use API-level testing (`request` fixture) for speed and reliability
- Multi-device tests use `playwright.request.newContext()` for isolated API contexts
- CSRF tests properly handle the double-submit cookie pattern
- Admin tests properly pass both admin session cookies and CSRF tokens
- IP ban tests clean up after themselves in `afterAll`
- Client creation tests track created client IDs for cleanup
- Rate limits are cleared before tests that need them
- The `REDIRECT_URI` was corrected from port 4000 to port 4500 to match the actual seeded client data

## Environment Note

Tests must be run with `PLAYWRIGHT_PORT=4501` because port 4001 is occupied by another application (QQ) on this machine. The Playwright config already supports this via `process.env.PLAYWRIGHT_PORT`.
