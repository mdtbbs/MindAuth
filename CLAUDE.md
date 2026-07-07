# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in the MindAuth service.

## Project Overview

MindAuth is an OAuth 2.0 authentication service providing centralized SSO for Mindustry community applications. Features include:

- User registration/login with email verification
- Password reset flow
- OAuth 2.0 Authorization Code Flow for third-party apps
- Admin panel for user/client management
- Session management with Redis caching
- Forum-style account UX for Mindustry community services

## Commands

```bash
npm install          # Install dependencies
npm start            # Production mode (port 4001)
npm run dev          # Development with --watch auto-reload
npx playwright test  # Run E2E tests
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Browser (SPA)                               │
│  public/index.html - User SPA (hash routing)                    │
│  public/admin.html - Admin panel SPA                            │
│  public/app.js - 950 lines of routing/state/API logic            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Express.js Server                              │
│  src/server.js - Helmet CSP, static files, routes mount          │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         /api/auth      /api/admin      /api (oauth)
    ┌────────────┐  ┌────────────┐  ┌────────────┐
    │ auth.js    │  │ admin/*.js │  │ oauth.js   │
    │ register   │  │ users      │  │ authorize  │
    │ login      │  │ clients    │  │ token      │
    │ logout     │  │ settings   │  │ refresh    │
    │ me         │  │ logs       │  │ verify     │
    └────────────┘  └────────────┘  └────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         ┌─────────┐    ┌─────────┐    ┌─────────┐
         │  MySQL  │    │  Redis  │    │  Email  │
         │ Users   │    │ Session │    │ SMTP    │
         │ Tokens  │    │ Cache   │    │         │
         └─────────┘    └─────────┘    └─────────┘
```

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
| `/account/privacy` | GET/PUT | Privacy settings | Session |
| `/account/fields` | GET/PUT | Custom field values | Session |

## Database Tables

### MySQL Tables (`src/db/schema-mysql.js`)

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `users` | User accounts | id, username, email, password_hash, session_token, role, avatar_url, banner_url |
| `clients` | OAuth apps | id, name, client_id, client_secret, redirect_uri |
| `authorizations` | User-client auth records | user_id, client_id, scope, last_used_at |
| `refresh_tokens` | Long-lived tokens | user_id, client_id, token, expires_at, revoked |
| `login_logs` | Login history | user_id, ip, device, login_type (web/oauth) |
| `email_config` | SMTP settings | host, port, user, password, from (single row id=1) |
| `system_config` | Runtime config | key, value (session_lifetime, password_rules, etc.) |
| `user_sessions` | Active session tracking | user_id, session_token, ip_address, device_info, last_active_at |
| `challenge_questions` | Challenge Q&A bank | question, answer_hash (bcrypt), enabled |
| `ip_bans` | IP blacklist | ip_address, cidr_prefix, reason, expires_at |
| `user_notifications` | User notifications | user_id, type, title, content, is_read |
| `user_fields` | Custom field definitions | field_key, field_label, field_type, is_required, is_public, options |
| `user_field_values` | Custom field values | user_id, field_id, value |
| `admin_audit_logs` | Admin action audit trail | admin_id, action, target_type, target_id, details (JSON) |
| `sms_audit_logs` | SMS audit trail | user_id, action, phone_masked, success, code, ip_address |

### Redis Keys

| Key Pattern | TTL | Purpose |
|-------------|-----|---------|
| `session:${token}` | 24h | User session cache |
| `admin_session:${token}` | 24h | Admin session |
| `authcode:${code}` | 5min | OAuth authorization code |
| `accesstoken:${token}` | 1h | OAuth access token |
| `verify:${token}` | 1h | Email verification token |
| `reset:${token}` | 1h | Password reset token |
| `ratelimit:${ip}` | Variable | Rate limit counter |
| `sms:code:${phone}` | 5min | SMS verification code (dysmsapi) |
| `sms:send:ip:${ip}` | 1h | SMS send rate limit per IP |
| `sms:send:user:${id}` | 5min | SMS send rate limit per user |
| `sms:send:phone:${phone}` | 1min | SMS send rate limit per phone |
| `sms:verify:fail:*` | Variable | SMS verify failure rate limit |
| `phone_sync:${token}` | 5min | Phone verification sync token |
| `login_fail:${username}` | 5min | Login failure counter (lockout) |
| `session_active:${token}` | 5min | Session activity throttle |
| `challenge_session:${csrf}` | 30min | Challenge question session |
| `ip_bans_cache` | 5min | IP ban list cache |

## Middleware

### `requireAuth.js`
- Validates `session` cookie
- Redis cache → MySQL fallback
- Injects `req.user`

### `requireAdmin.js`
- Validates `admin_session` cookie
- Double verification: Redis + MySQL role check
- Provides session management functions

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

### `upload.js`
- Multer file upload
- Avatars: 2MB (JPEG/PNG/GIF/WebP)
- Banners: 5MB
- Path: `public/uploads/{avatars,banners}/`

## Frontend SPA (`public/`)

### Hash Routes (`app.js`)
| Route | View |
|-------|------|
| `#/login` | Login form |
| `#/register` | Registration form |
| `#/dashboard` | User dashboard (profile, authorizations, logs) |
| `#/account-settings` | Password/email/avatar management |
| `#/reset-request` | Request password reset |
| `#/reset-password?token=` | Set new password |
| `#/verify-email?token=` | Email verification |

### JS Modules
| File | Size | Purpose |
|------|------|---------|
| `app.js` | 950 lines | SPA router, state, API calls |
| `js/admin.js` | 512 lines | Admin panel logic |
| `js/common.js` | 306 lines | API request, Toast, Modal, validation |
| `js/shared-loader.js` | 146 lines | Load HTML templates |

### Styling (`style.css` - 2100 lines)
- Responsive: mobile (<480px), tablet (481-768px), desktop (>769px)
- Light/dark theme support
- MagicUI animations: shimmer, card glow, entrance effects
- Components: login cards, dashboard, modals, tables, charts

## Utilities (`src/utils/`)

| File | Functions |
|------|-----------|
| `token.js` | `generateToken()` (32 bytes), `generateShortToken()` (16 bytes) |
| `validation.js` | `isValidEmail`, `isValidPassword` (8 chars + complexity), `isValidUsername`, `escapeHtml` |
| `email.js` | `sendEmail`, `sendVerificationEmail`, `sendPasswordResetEmail` |
| `crypto.js` | `timingSafeCompare` |
| `request.js` | `getClientIp` (Cloudflare/proxy support) |
| `datetime.js` | `formatMySQLDateTime` |
| `cleanup.js` | Scheduled cleanup of expired tokens |
| `aliyunSms.js` | `sendSmsCode(phone)` (dysmsapi SendSms + Redis), `checkSmsCode(phone, code)` (Redis timing-safe lookup) |
| `smsAudit.js` | `logSmsAudit(data)` — SMS audit logging with masked phone |
| `aliyunSms.js` | `sendSmsCode(phone)` (dysmsapi V3 SendSms + Redis), `checkSmsCode(phone, code)` (Redis timing-safe lookup) |
| `smsAudit.js` | `logSmsAudit(data)` — SMS audit logging with masked phone |
| `auditLog.js` | `logAudit({admin_id, action, target_type, target_id, details, ip_address})` |
| `notify.js` | `createNotification({user_id, type, title, content, sendEmail})` — 站内+邮件通知 |
| `deviceInfo.js` | `parseDeviceInfo(ua)` — User-Agent 解析为浏览器+操作系统 |
| `phone.js` | `maskPhone(phone)` — 手机号脱敏 `138****1234` |

## Configuration (`src/config/index.js`)

### Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 4001 | Server port |
| `BASE_URL` | - | Service URL for email links |
| `ADMIN_SECRET` | - | Admin creation key (32+ chars required) |
| `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE` | localhost | MySQL config |
| `REDIS_HOST/PORT/PASSWORD/DB` | localhost | Redis config |
| `SMTP_*` | - | Email configuration |
| `TRUST_CLOUDFLARE` | false | Cloudflare IP extraction |
| `CDN_URL` | - | CDN base URL |

### Runtime Constants
| Setting | Value |
|---------|-------|
| Session lifetime | 30 days |
| Access token | 1 hour |
| Refresh token | 30 days |
| Auth code | 5 minutes |
| Email verification | 1 hour |
| Password reset | 1 hour |

## OAuth 2.0 Flow

```
1. Third-party → GET /authorize?client_id=X&redirect_uri=Y&state=Z
2. If not logged in → Redirect to #/login with redirect
3. User logs in → Generate auth_code → Redirect to redirect_uri?code=ABC
4. Third-party → POST /token with code + client_secret
5. Returns: { access_token, refresh_token, user info }
6. Refresh: POST /refresh with refresh_token
```

## Tests (`tests/`)

| File | Coverage |
|------|----------|
| `specs/auth/auth.spec.js` | Register/login/logout flow |
| `specs/auth/redirect.spec.js` | Login redirects |
| `specs/oauth/oauth-flow.spec.js` | Full OAuth flow |
| `specs/account/avatar-banner.spec.js` | Avatar/banner upload |

## Security Features

- bcrypt password hashing (cost=10)
- CSRF double-submit cookie
- Rate limiting (Redis + memory fallback)
- Timing-safe secret comparison
- Trusted proxy IP validation
- Replay attack detection (OAuth)
- SSRF protection (private IP redirect_uri blocked)

---
*Last updated: 2026-07-05*
