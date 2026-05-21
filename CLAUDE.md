# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MindAuth is an OAuth 2.0 authentication service providing centralized auth for Mindustry community applications. It handles user registration/login, email verification, password reset, and OAuth authorization code flow for third-party apps.

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
│  public/index.html, public/admin.html, public/docs.html         │
│  public/app.js - Vue-like SPA router + state management         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Express.js Server                              │
│  src/server.js - Helmet CSP, static files, routes mount          │
│  src/db/index.js - better-sqlite3, WAL mode, schema init         │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         /api/auth      /api/admin      /api (oauth)
    ┌────────────┐  ┌────────────┐  ┌────────────┐
    │ auth.js    │  │ admin.js   │  │ oauth.js   │
    │ register   │  │ CRUD users │  │ authorize  │
    │ login      │  │ CRUD clients│  │ token      │
    │ logout     │  │ stats      │  │ refresh    │
    │ me         │  │ email-config│  │ verify     │
    └────────────┘  └────────────┘  └────────────┘
```

## Key Patterns

### Session Management
- User session: cookie `session` → `users.session_token` (30 days)
- Admin session: cookie `admin_session` → `admin_sessions` table (24 hours)
- requireAuth middleware reads cookie, validates against DB, sets `req.user`

### OAuth 2.0 Authorization Code Flow
1. Third-party redirects to `/authorize?client_id=xxx&redirect_uri=xxx&state=xxx`
2. If not logged in → redirect to login page
3. If logged in → generate auth_code, record authorization, redirect back with code
4. Third-party POST `/token` with code + client_secret → returns access_token + refresh_token + user info
5. Refresh via POST `/refresh` with refresh_token

### Rate Limiting
- Login: 5 attempts per 5 minutes per IP
- Register: 5 attempts per hour per IP
- Admin login: 3 attempts per 15 minutes per IP
- Implemented in middleware/rateLimit.js using in-memory map keyed by IP

### Cleanup Scheduler
- Runs hourly on server start
- Deletes expired: auth_codes, admin_sessions, password_reset_tokens, email_verification_tokens, refresh_tokens

## Database Tables
- `users` - id, username, email, password_hash, session_token, email_verified, role
- `clients` - OAuth apps: name, client_id, client_secret, redirect_uri
- `auth_codes` - Temporary authorization codes (5 min expiry)
- `refresh_tokens` - Long-lived tokens (30 days), can be revoked
- `authorizations` - User-approved client connections (tracks last_used_at)
- `admin_sessions` - Admin login sessions (24 hours)
- `password_reset_tokens`, `email_verification_tokens` - One-time tokens
- `email_config` - SMTP settings (single row id=1)
- `login_logs` - Login history (user_id, ip, device, login_type: 'web'/'oauth')

## Frontend SPA
- Single-page app in `public/index.html` using hash routing (`#/login`, `#/register`, etc.)
- `public/app.js` handles routing, state, and API calls
- No build step - served directly as static files
- Admin panel at `/admin.html` (separate page)

## Environment Variables
- `PORT=4001`
- `ADMIN_SECRET` - Required for creating admin accounts (timing-safe comparison)
- `BASE_URL` - Used for email links
- `NODE_ENV=production` - Enables secure cookies
- `SMTP_*` - Email config (overridden by database email_config after admin setup)

## Security Notes
- Helmet CSP with `'unsafe-inline'` for scripts/styles (SPA requirement)
- bcrypt password hashing (rounds=10)
- Timing-safe ADMIN_SECRET comparison
- Foreign keys enabled in SQLite
- SameSite cookies: Lax for users, Strict for admin