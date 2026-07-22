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

## Commands

```bash
npm install          # Install dependencies (includes devDeps for React build)
npm run build        # Build React frontend (vite build → dist/client/)
npm run verify       # TypeCheck + Build
npm start            # Production mode (port 4001)
npm run dev          # Development with --watch auto-reload
npm run test:unit    # Unit tests (node --test tests/unit/*.test.js)
npm run test:e2e     # E2E tests (Playwright)
npm run typecheck    # TypeScript type checking (frontend only)
```

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
| `sessionManager` | `sessions/sessionManager.js` | `createUserSession`, `authenticateUserSession`, `touchUserSession`, `revokeUserSession`, `revokeAllUserSessions`, `listUserSessions`, `createAdminSession`, `authenticateAdminSession`, `revokeAdminSessionsForUser` |
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

### Account Management (`/api/account`)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/change-password` | POST | Change password |
| `/change-email` | POST | Change email |
| `/avatar` | POST/DELETE | Upload/delete avatar |
| `/banner` | POST/DELETE | Upload/delete banner |
| `/` | DELETE | Delete account |
| `/privacy` | GET/PUT | Privacy settings |
| `/fields` | GET/PUT | Custom field values |

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

### User Endpoints (`/api`)
| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/sms/send` | POST | Send SMS verification code | Session |
| `/sms/verify` | POST | Verify SMS code and bind phone | Session |
| `/sms/sync-status` | POST | Sync phone status to external service | Token |
| `/challenge/random` | GET | Get random challenge question | None |
| `/challenge/verify` | POST | Verify challenge answer | None |
| `/sessions` | GET | List active sessions | Session |
| `/notifications` | GET | List user notifications | Session |
| `/notifications/unread-count` | GET | Get unread notification count | Session |
| `/notifications/:id/read` | PATCH | Mark notification as read | Session |
| `/notifications/read-all` | PATCH | Mark all notifications as read | Session |
| `/health` | GET | Health check (MySQL + Redis) | None |
| `/csrf-token` | GET | Get CSRF token | None |

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
| `system_config` | Runtime config | key, value (session_lifetime, password_rules, etc.) |
| `user_sessions` | Active session tracking | user_id, token_hash, ip_address, device_info, last_active_at |
| `challenge_questions` | Challenge Q&A bank | question, answer_hash (bcrypt), enabled |
| `ip_bans` | IP blacklist | ip_address, cidr_prefix, reason, expires_at |
| `user_notifications` | User notifications | user_id, type, title, content, is_read |
| `user_fields` | Custom field definitions | field_key, field_label, field_type, is_required, is_public, options |
| `user_field_values` | Custom field values | user_id, field_id, value |
| `admin_audit_logs` | Admin action audit trail | admin_id, action, target_type, target_id, details (JSON) |
| `sms_audit_logs` | SMS audit trail | user_id, action, phone_masked, success, code, ip_address |

Schema migrations live in `src/db/migrations/` and run automatically on startup via `src/db/migrator.js`.

### Redis Keys

| Key Pattern | TTL | Purpose |
|-------------|-----|---------|
| `session:{hash}` | 24h | User session cache |
| `admin_session:{hash}` | 24h | Admin session |
| `authcode:{code}` | 5min | OAuth authorization code |
| `accesstoken:{token}` | 1h | OAuth access token |
| `verify:{token}` | 1h | Email verification token |
| `reset:{token}` | 1h | Password reset token |
| `ratelimit:{ip}` | Variable | Rate limit counter |
| `sms:code:{phone}` | 5min | SMS verification code (dysmsapi) |
| `sms:send:ip:{ip}` | 1h | SMS send rate limit per IP |
| `sms:send:user:{id}` | 5min | SMS send rate limit per user |
| `sms:send:phone:{phone}` | 1min | SMS send rate limit per phone |
| `sms:verify:fail:*` | Variable | SMS verify failure rate limit |
| `phone_sync:{token}` | 5min | Phone verification sync token |
| `login_fail:{username}` | 5min | Login failure counter (lockout) |
| `session_active:{hash}` | 5min | Session activity throttle |
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
- Double-submit cookie pattern
- `csrf_token` cookie (httpOnly=false)
- Validates `X-CSRF-Token` header
- Whitelist: `/token`, `/refresh`, `/login`, `/register`

### `rateLimit.js`
- Redis sliding window + memory fallback
- Configurable limits:
  - Login: 5/5min
  - Register: 5/hour
  - Admin login: 3/15min

### `ipBan.js`
- Uses `ipBanMatcher.isBanned()` to check incoming requests
- Blocks banned IPs before they reach API routes

### `upload.js`
- Multer file upload
- Avatars: 2MB (JPEG/PNG/GIF/WebP)
- Banners: 5MB
- Path: `public/uploads/{avatars,banners}/`

## Utilities (`src/utils/`)

| File | Functions |
|------|-----------|
| `token.js` | `generateToken()` (32 bytes), `generateShortToken()` (16 bytes) |
| `validation.js` | `isValidEmail`, `isValidPassword` (8 chars + complexity), `isValidUsername`, `escapeHtml` |
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
| `unit/sessionManager.test.js` | Session lifecycle (create, auth, revoke, touch) |
| `unit/challengeManager.test.js` | Challenge question CRUD and verification |
| `unit/notificationCenter.test.js` | Notification CRUD and read/unread |
| `unit/runtimeConfig.test.js` | Runtime config get/set/cache |
| `unit/migrator.test.js` | SQL migration runner |
| `specs/auth/session-contract.spec.js` | Session contract E2E |
| `specs/oauth/oauth-contract.spec.js` | OAuth contract E2E |
| `specs/oauth/oauth-flow.spec.js` | Full OAuth flow E2E |
| `specs/security/security-contract.spec.js` | Security contract E2E |
| `specs/build/no-legacy-deps.spec.js` | Build dependency checks |

## Security Features

- bcrypt password hashing (cost=10)
- Session tokens: SHA-256 hashed in DB, raw only in cookies
- CSRF double-submit cookie
- Rate limiting (Redis + memory fallback)
- Timing-safe secret comparison
- Trusted proxy IP validation
- PKCE S256 support (OAuth)
- Replay attack detection (OAuth)
- SSRF protection (private IP redirect_uri blocked in clientRegistry)
- IP ban matching with CIDR support
- Helmet CSP headers
- Config validation on startup (strict in production)

---
*Last updated: 2026-07-23*
