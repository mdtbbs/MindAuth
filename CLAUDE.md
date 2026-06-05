# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in the MindAuth service.

## Project Overview

MindAuth is an OAuth 2.0 authentication service providing centralized SSO for Mindustry community applications. Features include:

- User registration/login with email verification
- Password reset flow
- OAuth 2.0 Authorization Code Flow for third-party apps
- Admin panel for user/client management
- Session management with Redis caching
- **XenForo 2 forum account linking** with avatar and user group sync

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
| `/userinfo` | GET | User info + linked_accounts | OIDC Core |
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

### XenForo Account Linking (`/api`)
| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/xenforo/config/status` | GET | Check if linking is enabled | Public |
| `/xenforo/link` | GET | Start OAuth flow, redirect to XenForo | Session |
| `/xenforo/callback` | GET | Handle XenForo OAuth callback | State token |
| `/xenforo/status` | GET | Get linking status | Session |
| `/xenforo/link` | DELETE | Unlink XenForo account | Session |
| `/xenforo/sync` | POST | Manually sync avatar/user group | Session |
| `/account/linked-accounts` | GET | Get all linked external accounts | Session |

### Admin Panel (`/api/admin`)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/create` | POST | Create admin (ADMIN_SECRET) |
| `/login` | POST | Admin login |
| `/users` | GET/PUT/DELETE | User management |
| `/clients` | GET/POST/PUT/DELETE | OAuth client management |
| `/stats` | GET | System statistics |
| `/email-config` | GET/PUT | SMTP configuration |
| `/xenforo-config` | GET/PUT | XenForo OAuth configuration |
| `/login-logs` | GET | Login logs |

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
| `external_identities` | External account links | user_id, provider, external_user_id, external_username, external_avatar_url, external_user_group_id, external_is_admin, external_is_moderator, provider_data (JSON) |
| `xenforo_config` | XenForo OAuth config | base_url, client_id, client_secret, enabled, sync_avatar, sync_user_group (single row id=1) |

### Redis Keys

| Key Pattern | TTL | Purpose |
|-------------|-----|---------|
| `session:${token}` | 24h | User session cache |
| `admin_session:${token}` | 24h | Admin session |
| `authcode:${code}` | 5min | OAuth authorization code |
| `accesstoken:${token}` | 1h | OAuth access token |
| `verify:${token}` | 1h | Email verification token |
| `reset:${token}` | 1h | Password reset token |
| `xf_state:${state}` | 5min | XenForo OAuth state token |
| `ratelimit:${ip}` | Variable | Rate limit counter |

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
| `xenforo-client.js` | `buildAuthorizationUrl`, `exchangeCodeForToken`, `fetchUserInfo`, `downloadAvatar` |

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

## XenForo Account Linking Flow

```
1. User clicks "Link XenForo" on dashboard
2. MindAuth → Generate state token → Store in Redis (xf_state:${state}, 5min TTL)
3. Redirect to XenForo: /oauth2/authorize?client_id=X&state=S
4. User authorizes on XenForo
5. XenForo → Redirect to /api/xenforo/callback?code=C&state=S
6. MindAuth → Validate state → Exchange code for token → Fetch userinfo
7. Store external_identities record + sync avatar/user group (if enabled)
8. Redirect to dashboard with success message
```

**UserInfo Endpoint Enhancement:**
- `/api/userinfo` returns `linked_accounts` array in `profile` scope
- Each linked account includes: provider, external_user_id, external_username, external_avatar_url, external_user_group_id, external_is_admin, external_is_moderator, linked_at

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
*Last updated: 2026-06-06*