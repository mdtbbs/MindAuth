# Task 15 Report — Documentation and Release/Reset Rehearsal

## What Was Updated

### 1. `README.md` — Full rewrite
- Added architecture diagram showing Express single-service shape (React SPA + API)
- Documented deep backend modules (`src/modules/*`) with module table
- Documented React frontend (Vite build → `dist/client/`)
- Updated commands: `npm run build`, `npm run verify`, `npm run test:unit`
- Updated admin URL from `/admin.html` to `/admin`
- Added OIDC Discovery section
- Added production build section (requires devDeps for React build)
- Added upload directory persistence documentation
- Added PKCE S256 mention in features
- Added complete API endpoint tables (previously incomplete)
- Added new tables: `email_config`, `system_config`, `user_field_values`, `sms_audit_logs`
- Updated tech stack to reflect React 18 + Vite + TypeScript

### 2. `CLAUDE.md` — Full rewrite
- Updated architecture diagram to show new startup sequence: `server.js → bootstrap.js → app.js`
- Replaced "Frontend SPA" section (legacy `public/app.js`) with React frontend + deep modules
- Documented all 10 deep module interfaces with key exports
- Updated middleware section: `requireAuth` now delegates to `sessionManager`, `requireAdmin` delegates to `sessionManager`, added `ipBan.js` middleware
- Added new test files (unit tests, contract tests)
- Added new env vars: `TRUSTED_PROXY_ENABLED`, `TRUSTED_PROXY_IPS`
- Added `MYSQL_POOL_SIZE` to env vars
- Updated session description: token hashing, SHA-256 in DB
- Removed references to legacy `public/js/*.js`, `public/style.css`, `public/app.js`
- Removed duplicate `aliyunSms.js` and `smsAudit.js` entries from utils table

### 3. `.env.example` — Updated
- Added trusted proxy section: `TRUSTED_PROXY_ENABLED`, `TRUSTED_PROXY_IPS`, `TRUST_CLOUDFLARE`
- Added production note: `BASE_URL` cannot be localhost in production
- All removed env vars (`MINDFORUM_API_URL`, `FORUM_API_URL`, `MINDAUTH_SERVICE_KEY`) were already absent — confirmed clean

### 4. `docs/third-party-integration.md` — Major update
- Added OIDC Discovery section (Section 1)
- Added note that MindFourm uses OAuth-only (no service-key paths)
- Updated admin URL from `/admin.html` to `/admin`
- Added PKCE S256 parameters to authorization endpoint
- Added Token Refresh section (3.3)
- Added UserInfo endpoint section (3.4)
- Added Token Introspection section (3.5, RFC 7662)
- Added Token Revocation section (3.6, RFC 7009)
- Updated examples with `state` parameter and PKCE
- Added SSRF protection note for redirect_uri
- Added refresh token rotation note
- Added FAQ: PKCE support, MindFourm service-key removal
- Updated code examples to use HTTPS URLs

### 5. `docs/release/mindauth-refactor-reset-release.md` — New file
- 18-step release procedure with verification at each step
- Rollback procedure (9 steps)
- Upload directory persistence rules
- Troubleshooting section
- Documents removed env vars
- Documents admin creation via API
- Documents MindFourm OAuth client setup
- Documents Redis flush and DB recreate steps

## Self-Review Findings

1. All API endpoints now use `/api/*` prefix consistently — verified against `src/app.js` route mounts
2. Admin URL updated from `/admin.html` to `/admin` — verified against `src/app.js` SPA routes
3. Module interfaces match actual `module.exports` — verified by grepping all module files
4. No references to legacy files (`public/app.js`, `public/js/*.js`, `public/style.css`) remain in updated docs
5. No references to removed env vars (`MINDFORUM_API_URL`, `FORUM_API_URL`, `MINDAUTH_SERVICE_KEY`) in `.env.example`
6. Startup sequence matches `src/bootstrap.js` code
7. Test file list matches actual files in `tests/`

## Concerns

- None. All documentation is consistent with the current codebase state.
