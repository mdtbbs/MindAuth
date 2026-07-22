### Task 9 Report: Refactor admin/security modules

**Status:** DONE

## What was implemented

### New modules created

1. **`src/modules/audit/auditWriter.js`** — Centralized audit logging
   - `writeAdminAudit(adminId, action, targetType, targetId, details, ipAddress)` — writes admin audit records
   - `writeUserAudit(userId, action, ipAddress, details)` — writes user audit records
   - Delegates to existing `logAudit` and `logUserAudit` utilities
   - Failures logged but never thrown (audit loss > request failure)

2. **`src/modules/security/ipBanMatcher.js`** — Centralized IP ban matching
   - `isBanned(ip)` — returns `{ banned: boolean, reason?: string }`
   - `refreshCache()` — clears Redis cache for re-loading
   - `clearCache()` — clears cache without reload
   - Extracted `ipToLong`, `isInSubnet`, `loadIpBans` from middleware
   - Redis-backed cache with 5-min TTL; fails open on errors
   - Exposes internals for testing: `_ipToLong`, `_isInSubnet`, `_loadIpBans`

3. **`src/modules/admin/clientRegistry.js`** — Centralized OAuth client management
   - `createClient(data, actor)` — creates client + writes audit log
   - `updateClient(id, data, actor)` — updates client + writes audit log
   - `rotateSecret(id, actor)` — rotates secret + writes audit log
   - `deleteClient(id, actor)` — deletes client + writes audit log
   - `listClients()` — returns all clients with normalized `require_pkce`
   - `getClient(id)` — returns single client or null
   - `validateRedirectUri(uri)` — format + SSRF validation (returns `{ valid, error }`)
   - Extracted `isPrivateOrInternalHost` (private IP blocking for SSRF protection)

### Files modified

| File | Changes |
|------|---------|
| `src/routes/admin/clients.js` | Thin adapter over `clientRegistry`; removed inline `isPrivateOrInternalHost` and DB calls |
| `src/routes/admin/users.js` | Replaced `logAudit`/`logUserAudit` with `auditWriter` calls; sessionManager calls preserved |
| `src/routes/admin/settings.js` | Replaced `logAudit` with `auditWriter`; `runtimeConfig.invalidate()` preserved |
| `src/routes/admin/ipBans.js` | Uses `ipBanMatcher.refreshCache()` + `auditWriter`; removed old middleware import |
| `src/routes/admin/challenges.js` | Replaced `logAudit` with `auditWriter`; challengeManager unchanged |
| `src/routes/admin/userFields.js` | Replaced `logAudit` with `auditWriter` |
| `src/middleware/ipBan.js` | Thin adapter over `ipBanMatcher.isBanned()`; backward-compat `invalidateIpBanCache` export |
| `src/routes/admin/logs.js` | Read-only — unchanged |
| `src/routes/admin/auditLogs.js` | Read-only — unchanged |
| `src/routes/admin/smsAuditLogs.js` | Read-only — unchanged |

### How each module works

**auditWriter**: Thin facade over the existing `logAudit` (admin_audit_logs table) and `logUserAudit` (user_audit_logs table). Provides a stable interface so route adapters don't import low-level utilities directly. All mutations in admin routes now flow through this single seam.

**ipBanMatcher**: Extracted the IP-to-long conversion, CIDR subnet matching, and Redis-backed caching from the middleware. The middleware is now a 15-line adapter that calls `isBanned(ip)` and returns 403 if banned. The admin ipBans route calls `refreshCache()` after mutations instead of `invalidateIpBanCache()`.

**clientRegistry**: All OAuth client CRUD + redirect URI validation centralized here. Every mutation writes an admin audit record through `auditWriter`. The `validateRedirectUri` function returns a structured `{ valid, error }` result that route adapters use for error responses.

## Test results

### Unit tests (`npm run test:unit`)

- **ipBan middleware tests: 6/6 PASS** — all CIDR matching tests pass through the refactored middleware → ipBanMatcher chain
- **aliyunSms tests: 12/12 PASS**
- **migrator tests: 5/5 PASS**
- **newFeatures tests: PASS** (deviceInfo, auditLog)
- **Pre-existing failures**: sessionManager, challengeManager, notificationCenter tests fail with `ER_ACCESS_DENIED_ERROR` (no MySQL connection in worktree environment) — these are NOT caused by this refactor

### Security contract tests

Cannot run E2E tests without a running server (MySQL + Redis required). The security-contract.spec.js tests IP ban CRUD and redirect URI rejection — both code paths are preserved identically through the new modules.

## Self-review findings

1. **Redirect URI validation preserved exactly** — `isPrivateOrInternalHost` logic moved verbatim into clientRegistry. All private IP ranges (10.x, 172.16-31.x, 192.168.x, 169.254.x), localhost variants, and cloud metadata endpoints are still blocked.

2. **All audit logging preserved** — Every mutation that previously called `logAudit` now calls `auditWriter.writeAdminAudit`. The user unlock route still writes both admin and user audit records.

3. **Session invalidation preserved** — User ban/delete/reset-password still call `sessionManager.revokeAllUserSessions()` and `sessionManager.revokeAdminSessionsForUser()`.

4. **runtimeConfig invalidation preserved** — Settings routes still call `runtimeConfig.invalidate()` after email/SMS config updates.

5. **Backward compatibility** — `invalidateIpBanCache` is re-exported from middleware/ipBan.js for any external consumers.

6. **Read-only routes unchanged** — logs.js, auditLogs.js, smsAuditLogs.js kept as-is per task spec.

## Concerns

- E2E tests (security-contract, admin tests) cannot be run in this worktree without MySQL/Redis. The refactor preserves behavior but integration verification requires the full test environment.
- The `package-lock.json` was modified by `npm install` in the worktree — this is a side effect of dependency installation, not a code change.
