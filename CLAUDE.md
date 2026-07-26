# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in the MindAuth service.

## Project Overview

MindAuth is an OAuth 2.0 authentication service providing centralized SSO for Mindustry community applications. Features include:

- User registration/login with email verification
- Password reset flow
- OAuth 2.0 Authorization Code Flow for third-party apps (PKCE S256 supported)
- OIDC Discovery endpoint (`/.well-known/openid-configuration`)
- Admin panel for user/client management (React SPA)
- Session management with Redis caching and token hashing
- Forum-style account UX for Mindustry community services

## Documentation Map

Detailed Chinese developer docs live in `docs/`. This file stays the compact authoritative index; read the mapped doc before working in its area:

| Doc | Read it when |
|-----|--------------|
| `docs/getting-started.md` | Setting up a dev environment, running tests, first-time onboarding |
| `docs/architecture/overview.md` | Changing startup sequence, middleware order, or `src/app.js` wiring |
| `docs/architecture/backend.md` | Working in `src/modules/**`, `src/middleware/*`, or `src/utils/*` |
| `docs/architecture/frontend.md` | Working in `frontend/src/**` or touching the legacy `public/js/` SPA boundary |
| `docs/architecture/database.md` | Changing schema/migrations, Redis key usage, or `system_config` keys |
| `docs/architecture/security.md` | Touching auth, tokens, CSRF, rate limiting, IP handling, or RBAC |
| `docs/api/README.md` | Adding/changing any endpoint (full ~93-endpoint index + shared conventions) |
| `docs/api/{auth,oauth,account,admin}.md` | Endpoint-level reference per domain (params, responses, errors) |
| `docs/operations/{deployment,configuration,runbook}.md` | Deploying, changing env vars/config keys, or handling incidents |
| `docs/third-party-integration.md` | Changing anything third-party clients depend on (public OAuth contract) |

## Commands

```bash
npm install          # Install dependencies (includes devDeps for React build)
npm run build        # Build React frontend (vite build → dist/client/)
npm run lint         # ESLint (backend Node + frontend TS/React)
npm run verify       # Lint + TypeCheck + Build
npm start            # Production mode (port 4001)
npm run dev          # Development with --watch auto-reload
npm run test         # Unit tests (alias of test:unit)
npm run test:unit    # Pure unit tests, no external services (node --test tests/unit/*.test.js)
npm run test:integration # DB-backed tests; requires MySQL + RUN_INTEGRATION=1 (else skipped)
npm run test:e2e     # E2E tests (Playwright; USE_MEMORY_REDIS=1 to skip real Redis)
npm run typecheck    # TypeScript type checking (frontend only)
```

CI (`.github/workflows/ci.yml`) runs lint + typecheck + build + unit + integration + e2e against MySQL 8 / Redis 7 service containers on every push and PR to `main`.

## Architecture

```
Browser
  │
  ├── /admin, /admin/*  →  Admin React SPA (dist/client/admin.html)
  ├── /*                →  User React SPA  (dist/client/index.html)
  ├── /assets/*         →  Vite hashed assets (1y immutable cache)
  ├── /uploads/*        →  User uploads (avatars, banners)
  ├── /api/*            →  Express API routes
  └── /api/health       →  Health check

┌─────────────────────────────────────────────────────────────────┐
│                   Express.js Server                              │
│  src/server.js → src/bootstrap.js → src/app.js                  │
│  (entry)         (db connect, migrate)   (middleware, routes)    │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         /api (auth)    /api/admin      /api (oauth)
    ┌────────────┐  ┌────────────┐  ┌────────────┐
    │ auth.js    │  │ admin/*.js │  │ oauth.js   │
    │ register   │  │ users      │  │ → oauth-   │
    │ login      │  │ clients    │  │   Issuer   │
    │ logout     │  │ settings   │  │ → token-   │
    │ me         │  │ logs       │  │   Store    │
    └────────────┘  └────────────┘  └────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
    ┌──────────────┐  ┌─────────┐    ┌─────────┐
    │ src/modules/ │  │  MySQL  │    │  Redis  │
    │ (deep mods)  │  │  Users  │    │ Session │
    │ sessionMgr   │  │  Tokens │    │ Cache   │
    │ oauthIssuer  │  └─────────┘    └─────────┘
    │ clientReg    │
    └──────────────┘
```

### Startup Sequence (`src/bootstrap.js`)

1. Validate configuration (`src/config/validate.js`)
2. Connect MySQL + run migrations (`src/db/migrator.js`)
3. Seed test fixtures (dev/test only)
4. Connect Redis
5. Create Express app (`src/app.js`)
6. Listen on port
7. Start cleanup scheduler
8. Register graceful shutdown handlers

### Frontend (`frontend/`)

React 18 + Vite + TypeScript. Two entry points:
- `frontend/index.html` → User SPA (login, register, dashboard, account settings, OAuth authorize)
- `frontend/admin.html` → Admin SPA (dashboard, users, clients, security, settings, logs)

Build output: `dist/client/` (served by Express in production).
Dev server: Vite dev server on port 5173 with `/api` proxy to Express.

### Deep Modules (`src/modules/`)

Each module is the **single seam** for its domain. Routes call modules; modules call DB/Redis directly. No other code should bypass module interfaces.

| Module | File | Key Exports |
|--------|------|-------------|
| `sessionManager` | `sessions/sessionManager.js` | `hashToken`, `createUserSession`, `authenticateUserSession`, `touchUserSession`, `revokeUserSession`, `revokeAllUserSessions`, `invalidateUserSessionCache`, `listUserSessions`, `createAdminSession`, `authenticateAdminSession`, `revokeAdminSessionsForUser` |
| `oauthIssuer` | `oauth/oauthIssuer.js` | `authorize`, `exchangeCode`, `refresh`, `introspect`, `revoke`, `userinfo`, `userByAccessToken`, `listAuthorizations`, `revokeAuthorization`, `verify` |
| `tokenStore` | `oauth/tokenStore.js` | `storeAuthCode`, `consumeAuthCode`, `storeAccessToken`, `getAccessToken`, `getAccessTokenTtl`, `revokeAccessToken`, `revokeAccessTokensForUserClient` |
| `clientRegistry` | `admin/clientRegistry.js` | `createClient`, `updateClient`, `rotateSecret`, `deleteClient`, `listClients`, `getClient`, `validateRedirectUri` |
| `challengeManager` | `challenges/challengeManager.js` | `getRandomChallenge`, `verifyChallengeAnswer`, `verifyForRegistration`, `isChallengeRequired`, `listChallenges`, `createChallenge`, `updateChallenge`, `deleteChallenge` |
| `notificationCenter` | `notifications/notificationCenter.js` | `create`, `list`, `getUnreadCount`, `markRead`, `markAllRead`, `remove` |
| `smsBinding` | `sms/smsBinding.js` | `sendCode`, `verifyCode`, `getStatus` |
| `ipBanMatcher` | `security/ipBanMatcher.js` | `isBanned`, `refreshCache`, `clearCache` |
| `auditWriter` | `audit/auditWriter.js` | `writeAdminAudit`, `writeUserAudit` |
| `runtimeConfig` | `config/runtimeConfig.js` | `get`, `getMany`, `set`, `invalidate`, `preload` |

## API Endpoints

### User Authentication (`/api`)
| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/register` | POST | User registration | None |
| `/login` | POST | User login | None |
| `/logout` | POST | User logout | Session |
| `/me` | GET | Current user info | Session |
| `/login-logs` | GET | Login history | Session |

### OAuth 2.0 (`/api`)
| Endpoint | Method | Description | Standard |
|----------|--------|-------------|----------|
| `/authorize` | GET | Authorization endpoint | RFC 6749 |
| `/token` | POST | Token exchange | RFC 6749 |
| `/refresh` | POST | Token refresh | RFC 6749 |
| `/introspect` | POST | Token validation | RFC 7662 |
| `/userinfo` | GET | User info | OIDC Core |
| `/revoke` | POST | Token revocation | RFC 7009 |
| `/verify` | POST | Session verification | Custom |
| `/user` | GET | User info (legacy MindFourm compat, Bearer) | Custom |
| `/authorizations` | GET | List current user's authorized apps | Custom |
| `/authorizations/:client_id` | DELETE | Revoke authorization for a client | Custom |

### Account Management (`/api/account`)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/change-password` | POST | Change password |
| `/change-email` | POST | Change email |
| `/avatar` | POST/DELETE | Upload/delete avatar |
| `/banner` | POST/DELETE | Upload/delete banner |
| `/` | DELETE | Delete account |
| `/fields` | GET/PUT | Custom field values |
| `/audit-logs` | GET | Current user's security audit log |

### Password Reset (`/api/password`)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/reset-request` | POST | Request reset link |
| `/reset` | POST | Execute password reset |

### Email Verification (`/api/email-verification`)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/send` | POST | Send verification email |
| `/verify` | POST | Verify email token |
| `/status` | GET | Check verification status |

### Admin Panel (`/api/admin`)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/create` | POST | Create admin (ADMIN_SECRET) |
| `/login` | POST | Admin login |
| `/users` | GET/PUT/DELETE | User management |
| `/clients` | GET/POST/PUT/DELETE | OAuth client management |
| `/stats` | GET | System statistics |
| `/email-config` | GET/PUT | SMTP configuration |
| `/login-logs` | GET | Login logs |
| `/ip-bans` | GET/POST/PUT/DELETE | IP ban management (supports CIDR) |
| `/challenges` | GET/POST/PUT/DELETE | Challenge question bank management |
| `/user-fields` | GET/POST/PUT/DELETE/PATCH | Custom user field definitions |
| `/audit-logs` | GET | Admin audit log viewer (filterable) |
| `/users/:id/ban` | POST/DELETE | Ban/unban user |
| `/users/:id/mute` | POST | Mute user |
| `/users/:id/unlock` | POST | Unlock locked account |
| `/auth-background` | POST/DELETE | Upload/reset auth page background image (config.write) |

### User Endpoints (`/api`)
| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/sms/send` | POST | Send SMS verification code | Session |
| `/sms/verify` | POST | Verify SMS code and bind phone | Session |
| `/challenge/random` | GET | Get random challenge question | None |
| `/challenge/verify` | POST | Verify challenge answer | None |
| `/sessions` | GET | List active sessions | Session |
| `/sessions/:id` | DELETE | Revoke a session (remote logout) | Session |
| `/notifications` | GET | List user notifications | Session |
| `/notifications/:id` | DELETE | Delete a notification | Session |
| `/notifications/unread-count` | GET | Get unread notification count | Session |
| `/notifications/:id/read` | PATCH | Mark notification as read | Session |
| `/notifications/read-all` | PATCH | Mark all notifications as read | Session |
| `/health` | GET | Health check (MySQL + Redis) | None |
| `/csrf-token` | GET | Get CSRF token | None |
| `/public/auth-page-config` | GET | Auth page config (custom background URL) | None |

## Database Tables

### MySQL Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `users` | User accounts | id, username, email, password_hash, role, avatar_url, banner_url |
| `clients` | OAuth apps | id, name, client_id, client_secret, redirect_uri |
| `authorizations` | User-client auth records | user_id, client_id, scope, last_used_at |
| `refresh_tokens` | Long-lived tokens | user_id, client_id, token, expires_at, revoked |
| `login_logs` | Login history | user_id, ip, device, login_type (web/oauth) |
| `email_config` | SMTP settings | host, port, user, password, from (single row id=1) |
| `system_config` | Runtime config | key, value (session_lifetime, password_rules, auth_background_url, etc.) |
| `user_sessions` | Active session tracking | user_id, session_token (SHA-256 hash), ip_address, device_info, expires_at, last_active_at |
| `challenge_questions` | Challenge Q&A bank | question, answer_hash (bcrypt), enabled |
| `ip_bans` | IP blacklist | ip_address, cidr_prefix, reason, expires_at |
| `user_notifications` | User notifications | user_id, type, title, content, is_read |
| `user_fields` | Custom field definitions | field_key, field_label, field_type, is_required, is_public, options |
| `user_field_values` | Custom field values | user_id, field_id, value |
| `admin_audit_logs` | Admin action audit trail | admin_id, action, target_type, target_id, details (JSON) |
| `user_audit_logs` | User security audit trail (written by `src/utils/userAudit.js`) | user_id, action, ip_address, details |
| `sms_audit_logs` | SMS audit trail | user_id, action, phone_masked, success, code, ip_address |
| `sms_config` | Aliyun SMS settings (single row id=1) | access_key_id, access_key_secret, sign_name, template_code |
| `email_verification_tokens` | Email verification tokens (MySQL fallback beside Redis) | user_id, token_hash, expires_at |

Schema migrations live in `src/db/migrations/` and run automatically on startup via `src/db/migrator.js`. Migration `002_security_hardening.sql` adds `user_sessions.expires_at` + UNIQUE token index, hashes existing `refresh_tokens.token` values (SHA-256), drops the `clients` credential index and the deprecated `users.session_token` column, and indexes `ip_bans.ip_address`. Migration `003_auth_background_config.sql` seeds the `auth_background_url` key (`runtimeConfig.set` is UPDATE-only, so config keys must be seeded by migration).

### Redis Keys

| Key Pattern | TTL | Purpose |
|-------------|-----|---------|
| `session:{hash}` | 24h | User session cache |
| `admin_session:{hash}` | 24h | Admin session |
| `authcode:{code}` | 5min | OAuth authorization code |
| `accesstoken:{token}` | 1h | OAuth access token |
| `verify:{sha256(token)}` | 1h | Email verification token (hashed at rest) |
| `reset:{sha256(token)}` | 1h | Password reset token (hashed at rest) |
| `ratelimit:{ip}` | Variable | Rate limit counter |
| `sms:code:{phone}` | 5min | SMS verification code (dysmsapi) |
| `sms:send:ip:{ip}` | 1h | SMS send rate limit per IP |
| `sms:send:user:{id}` | 5min | SMS send rate limit per user |
| `sms:send:phone:{phone}` | 1min | SMS send rate limit per phone |
| `sms:verify:fail:*` | Variable | SMS verify failure rate limit |
| `login_fail:{username}:{ip}` | 5min | Login failure counter (lockout), keyed by username + IP |
| `session_active:{sessionId}` | 5min | Session activity throttle (keyed by session id, not token hash) |
| `sessions_by_user:{userId}` | none | Index SET of a user's session hashes |
| `admin_sessions_by_user:{userId}` | none | Index SET of a user's admin session hashes |
| `accesstokens_by_userclient:{userId}:{clientId}` | none | Index SET for bulk access-token revocation |
| `challenge_session:{csrf}` | 30min | Challenge question session |
| `ip_bans_cache` | 5min | IP ban list cache |

## Middleware

### `requireAuth.js`
- Validates `session` cookie via `sessionManager.authenticateUserSession()`
- Injects `req.user`

### `requireAdmin.js`
- Validates `admin_session` cookie via `sessionManager.authenticateAdminSession()`
- Role-based permission checks

### `csrf.js`
- Signed double-submit cookie pattern (`csrf_token` = `random.HMAC(random)`, so only server-minted tokens validate)
- `csrf_token` cookie (httpOnly=false)
- Validates `X-CSRF-Token` header (timing-safe compare + signature check)
- Exempt paths (15): OAuth `/token` `/refresh` `/introspect` `/revoke` `/verify`, `/login`, `/register`, `/admin/login`, `/challenge/random` `/challenge/verify`, `/email-verification/verify`, and the non-production `/admin/test/*` endpoints

### `rateLimit.js`
- Redis fixed-window counter + memory fallback (memory Map pruned; counter always gets a TTL)
- **Every limiter requires a unique `keyPrefix`** so endpoints cannot consume or reset each other's budget
- Configurable limits:
  - Login: 5/5min (`ratelimit:login`)
  - Register: 5/hour (`ratelimit:register`)
  - Admin login: 3/15min (`ratelimit:admin_login`)
  - Challenge, password-reset, and admin test-send endpoints each have their own prefix

### `ipBan.js`
- Uses `ipBanMatcher.isBanned()` to check incoming requests
- Blocks banned IPs before they reach API routes

### `upload.js`
- Multer file upload
- Avatars: 2MB (JPEG/PNG/GIF/WebP)
- Banners: 5MB
- Auth page backgrounds: 5MB (JPEG/PNG/WebP, no GIF; admin-uploaded)
- Path: `public/uploads/{avatars,banners,backgrounds}/`

## Utilities (`src/utils/`)

| File | Functions |
|------|-----------|
| `token.js` | `generateToken()` (32 bytes), `generateShortToken()` (16 bytes), `hashToken()` (SHA-256) |
| `validation.js` | `isValidEmail`, `isValidPassword` (rules from `system_config`: `password_min_length` default 6, `password_require_complexity` default off), `getPasswordValidationError`, `isValidUsername`, `getUsernameValidationError`, `escapeHtml` |
| `email.js` | `sendEmail`, `sendVerificationEmail`, `sendPasswordResetEmail` |
| `crypto.js` | `timingSafeCompare` |
| `request.js` | `getClientIp` (trusted proxy support) |
| `datetime.js` | `formatMySQLDateTime` |
| `cleanup.js` | Scheduled cleanup of expired tokens |
| `aliyunSms.js` | `sendSmsCode(phone)`, `checkSmsCode(phone, code)` |
| `smsAudit.js` | `logSmsAudit(data)` |
| `auditLog.js` | `logAudit({admin_id, action, target_type, target_id, details, ip_address})` |
| `notify.js` | `createNotification({user_id, type, title, content, sendEmail})` |
| `deviceInfo.js` | `parseDeviceInfo(ua)` |
| `phone.js` | `maskPhone(phone)` |

## Configuration (`src/config/index.js`)

### Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 4001 | Server port |
| `NODE_ENV` | development | Environment (production enables strict checks) |
| `BASE_URL` | http://localhost:4001 | Service URL for email links |
| `ADMIN_SECRET` | - | Admin creation key (32+ chars required in production) |
| `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE` | localhost | MySQL config |
| `MYSQL_POOL_SIZE` | 10 | Connection pool size |
| `REDIS_HOST/PORT/PASSWORD/DB` | localhost | Redis config |
| `SMTP_HOST/PORT/USER/PASS/FROM/SECURE` | - | Email configuration |
| `CDN_URL` | - | CDN base URL (auto-added to CSP) |
| `ALLOWED_ORIGINS` | localhost:3000,4000,4001 | CORS allowed origins |
| `TRUST_CLOUDFLARE` | false | Trust Cloudflare IP headers |
| `TRUSTED_PROXY_ENABLED` | false | Enable trusted proxy IP extraction |
| `TRUSTED_PROXY_IPS` | - | Comma-separated trusted proxy IPs |
| `ALIYUN_ACCESS_KEY_ID/SECRET` | - | Aliyun SMS credentials |
| `ALIYUN_SMS_SIGN_NAME/TEMPLATE_CODE` | - | Aliyun SMS sign and template |

### Runtime Constants
| Setting | Value |
|---------|-------|
| Session lifetime | 30 days |
| Admin session lifetime | 1 day |
| Access token | 1 hour |
| Refresh token | 30 days |
| Auth code | 5 minutes |
| Email verification | 1 hour |
| Password reset | 1 hour |

## OAuth 2.0 Flow

```
1. Third-party → GET /api/authorize?client_id=X&redirect_uri=Y&state=Z
2. Express serves React SPA → user logs in via React frontend
3. oauthIssuer.authorize() generates auth_code → Redirect to redirect_uri?code=ABC
4. Third-party backend → POST /api/token with code + client_secret
5. oauthIssuer.exchangeCode() returns: { access_token, refresh_token, user info }
6. Refresh: POST /api/refresh with refresh_token
```

## Tests (`tests/`)

| File | Coverage |
|------|----------|
| `unit/migrator.test.js` | SQL migration runner (pure) |
| `unit/tokenStore.test.js` | OAuth token hashing-at-rest + single-use codes (mock Redis) |
| `unit/clientRegistry.test.js` | redirect_uri SSRF validation (pure) |
| `unit/aliyunSms.test.js`, `unit/newFeatures.test.js` | SMS + misc (mock Redis) |
| `integration/sessionManager.test.js` | Session lifecycle — requires MySQL |
| `integration/challengeManager.test.js` | Challenge CRUD/verification — requires MySQL |
| `integration/notificationCenter.test.js` | Notification CRUD — requires MySQL |
| `integration/runtimeConfig.test.js` | Runtime config get/set/cache — requires MySQL |
| `specs/auth/session-contract.spec.js` | Session contract E2E |
| `specs/oauth/oauth-contract.spec.js` | OAuth contract E2E |
| `specs/oauth/oauth-flow.spec.js` | Full OAuth flow E2E |
| `specs/security/security-contract.spec.js` | Security contract E2E |
| `specs/build/no-legacy-deps.spec.js` | Build dependency checks |

## Security Features

- bcrypt password hashing (cost=12; login still verifies older cost-10 hashes)
- Session tokens: SHA-256 hashed in DB, raw only in cookies
- OAuth access/refresh tokens: SHA-256 hashed at rest (Redis/MySQL)
- Password-reset & email-verification tokens: SHA-256 hashed at rest; raw value only in the emailed link
- Failed-login lockout is **always temporary** (15min → 1h → 2h cap, auto-expires); a hard indefinite block is only ever applied by an admin via `ban_status` — a single IP cannot permanently lock an account
- CSRF signed double-submit cookie (HMAC of a random nonce)
- Rate limiting (Redis + memory fallback); every limiter has a unique keyPrefix; OAuth `/token` `/refresh` `/authorize` `/introspect` `/revoke` are rate-limited
- Timing-safe secret comparison (incl. client_secret)
- Trusted proxy IP validation (proxy headers untrusted by default)
- PKCE S256 support (OAuth)
- Replay attack detection (OAuth); `/introspect` and `/revoke` are bound to the requesting client (a client cannot probe/revoke another client's tokens)
- SSRF protection (private IP redirect_uri blocked in clientRegistry)
- IP ban matching with CIDR support for **IPv4 and IPv6** (128-bit via BigInt)
- Admin RBAC with last-super-admin / self-demotion protection on delete, ban, and role change
- Helmet CSP headers (note: `script-src` still allows `'unsafe-inline'` — legacy static error/docs pages use inline scripts; tightening requires externalizing them first)
- Config validation on startup (strict in production; blocks memory Redis, wildcard CORS, short ADMIN_SECRET)

### Known deferred (need migration / external coordination)
- `client_secret` stored plaintext at rest (compared timing-safe; the credential index was dropped in migration 002). Full hashing requires re-issuing third-party client secrets.
- SMTP password / Aliyun SMS access-key-secret stored plaintext at rest (回显已脱敏). Encrypting at rest needs app-level key management.

---
*Last updated: 2026-07-26*
