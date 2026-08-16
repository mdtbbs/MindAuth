# MindAuth Refactor — Reset & Release Guide

This document describes the one-time release process for the MindAuth full-stack refactor, including rollback procedures.

## Overview of Changes

The MindAuth refactor introduces:
- **React frontend** (Vite build) replacing legacy `public/app.js` and `public/js/*.js` SPAs
- **Deep backend modules** (`src/modules/*`) replacing flat route-level business logic
- **Express app factory** (`src/app.js`) separated from bootstrap (`src/bootstrap.js`)
- **Automatic DB migrations** (`src/db/migrator.js`) on startup
- **Token hashing** for sessions (SHA-256 in DB, raw only in cookies)
- **Removed**: `forumSync.js`, `requireServiceKey.js` middleware, legacy static frontend files
- **Removed env vars**: `MINDFORUM_API_URL`, `FORUM_API_URL`, `MINDAUTH_SERVICE_KEY` (no longer used)

---

## Prerequisites

- SSH/shell access to the MindAuth server
- MySQL client with admin privileges
- Redis CLI access
- Backup of current deployment (code + database)
- Node.js 18+ installed
- `.env` file prepared with correct values

---

## Release Procedure

### Step 1: Stop MindAuth Service

```bash
# If using PM2:
pm2 stop mindauth

# If using systemd:
sudo systemctl stop mindauth

# If running directly:
# Send SIGTERM or Ctrl+C
```

**Verify:** `curl http://localhost:4001/api/health` should fail (connection refused).

### Step 2: Backup Database (Recommended)

```bash
mysqldump -u root -p mindauth > mindauth_backup_$(date +%Y%m%d_%H%M%S).sql
```

Store the backup in a safe location. This enables rollback.

### Step 3: Backup Upload Directory (Recommended)

```bash
cp -r /path/to/mindauth/public/uploads /path/to/mindauth/uploads_backup_$(date +%Y%m%d)
```

> **Important:** The `public/uploads/` directory contains user avatars and banners. It MUST be preserved across deployments.

### Step 4: Drop and Recreate Database

This ensures a clean schema. The migrator will recreate all tables.

```bash
mysql -u root -p -e "DROP DATABASE mindauth; CREATE DATABASE mindauth CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

> **Warning:** This destroys all existing data. Only do this if you have a backup or are starting fresh. If you want to preserve data, skip this step — migrations will update the schema in-place.

### Step 5: Flush Redis (Recommended)

```bash
redis-cli FLUSHDB
```

This clears stale session caches, rate limit counters, and old auth codes. A clean Redis state avoids potential issues with changed session token formats.

> **Note:** This invalidates all active user sessions. Users will need to re-login.

### Step 6: Deploy New MindAuth Code

```bash
cd /path/to/mindauth

# If using git:
git pull origin feat/full-stack-refactor

# If deploying from archive:
# Extract new code to deployment directory
```

### Step 7: Install Dependencies

```bash
npm install --production=false
```

`devDependencies` are needed for the React build step.

### Step 8: Build React Frontend

```bash
npm run build
```

This runs `vite build` and outputs to `dist/client/`. Verify the output exists:

```bash
ls dist/client/
# Should contain: index.html, admin.html, assets/
```

### Step 9: Update `.env`

Ensure `.env` has the correct values. Key changes from the old version:

**Removed (no longer used):**
- `MINDFORUM_API_URL`
- `FORUM_API_URL`
- `MINDAUTH_SERVICE_KEY`

**Required (verify present):**
- `ADMIN_SECRET` — 32+ characters, strong random value
- `BASE_URL` — Must NOT be localhost in production
- `MYSQL_HOST`, `MYSQL_DATABASE`
- `REDIS_HOST`
- `ALLOWED_ORIGINS` — Set to actual domain(s), not `*`

**Optional (new):**
- _(Previously `TRUSTED_PROXY_*` / `ALIYUN_ESA_*` — removed; IP detection now reads CDN headers unconditionally.)_

### Step 10: Run Migrations (Automatic)

```bash
npm start
```

The startup sequence automatically runs `runMigrations()`, which creates all tables from `src/db/migrations/001_initial_schema.sql`. Watch the logs for:

```
Configuration validated
MySQL database migrated
Redis connected
Server running at http://localhost:4001
```

After confirming startup, stop the server (Ctrl+C).

### Step 11: Create Admin Account

The database is empty, so you need to create the first admin account:

```bash
curl -X POST http://localhost:4001/api/admin/create \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "YOUR_ADMIN_SECRET_FROM_ENV",
    "username": "admin",
    "email": "admin@example.com",
    "password": "StrongPassword123!"
  }'
```

**Verify response:**
```json
{ "success": true, "message": "管理员创建成功" }
```

### Step 12: Verify OAuth Client (MindFourm)

If MindFourm needs to connect, ensure the OAuth client exists. After creating the admin, log in to the admin panel:

1. Go to `http://your-auth-server/admin`
2. Log in with the admin account created in Step 11
3. Navigate to **OAuth 应用** (OAuth Clients)
4. Verify MindFourm client exists with:
   - `client_id`: `forum` (or your configured value)
   - `redirect_uri`: Must match MindFourm's `MINDAUTH_CALLBACK_URL` exactly
   - `client_secret`: Known to MindFourm's `.env` as `MINDAUTH_CLIENT_SECRET`

If the client doesn't exist, create it via the admin panel or API:

```bash
# Login as admin first (get admin session cookie)
curl -X POST http://localhost:4001/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"StrongPassword123!"}' \
  -c admin_cookies.txt

# Create MindFourm OAuth client
curl -X POST http://localhost:4001/api/admin/clients \
  -H "Content-Type: application/json" \
  -b admin_cookies.txt \
  -H "X-CSRF-Token: $(grep csrf_token admin_cookies.txt | awk '{print $NF}')" \
  -d '{
    "name": "MindFourm",
    "redirect_uri": "https://forum.example.com/api/auth/callback"
  }'
```

> **Note:** The `client_secret` is returned only at creation time. Save it immediately.

### Step 13: Restore Upload Directory

If you backed up uploads in Step 3, ensure they are in place:

```bash
# Only if the uploads directory is empty or missing
cp -r /path/to/uploads_backup/* /path/to/mindauth/public/uploads/
```

### Step 14: Start MindAuth Service

```bash
# If using PM2:
NODE_ENV=production pm2 start mindauth

# If using systemd:
sudo systemctl start mindauth

# If running directly:
NODE_ENV=production nohup node src/server.js > mindauth.log 2>&1 &
```

### Step 15: Verify Health Check

```bash
curl http://localhost:4001/api/health
```

**Expected response (production):**
```json
{ "status": "ok" }
```

**Expected response (development):**
```json
{
  "status": "ok",
  "timestamp": "...",
  "uptime": 12.345,
  "version": "1.0.0",
  "services": {
    "database": "connected (MySQL)",
    "redis": "connected",
    "email": "configured"
  }
}
```

If status is `degraded`, check MySQL and Redis connectivity.

### Step 16: Test MindFourm OAuth Login

1. Go to MindFourm: `https://forum.example.com`
2. Click "Login" → should redirect to MindAuth React login page
3. Log in with a test account
4. Should redirect back to MindFourm with user session established
5. Verify user profile displays correctly

### Step 17: Verify Admin Panel

1. Go to `https://auth.example.com/admin`
2. Log in with admin account
3. Verify:
   - Dashboard loads with statistics
   - User list displays
   - OAuth clients list shows MindFourm client
   - Settings page works

### Step 18: Verify Static Assets

```bash
# User SPA
curl -I http://localhost:4001/
# Should return 200 with Content-Type: text/html

# Admin SPA
curl -I http://localhost:4001/admin
# Should return 200 with Content-Type: text/html

# Hashed assets
curl -I http://localhost:4001/assets/index-XXXXX.js
# Should return 200 with Cache-Control: public, max-age=31536000, immutable

# Uploads
curl -I http://localhost:4001/uploads/avatars/test.png
# Should return 200 or 404 (depending on file existence)
```

---

## Rollback Procedure

If the release fails and you need to revert:

### Step 1: Stop MindAuth Service

```bash
pm2 stop mindauth
# or
sudo systemctl stop mindauth
```

### Step 2: Restore Database from Backup

```bash
mysql -u root -p -e "DROP DATABASE mindauth; CREATE DATABASE mindauth CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p mindauth < mindauth_backup_YYYYMMDD_HHMMSS.sql
```

### Step 3: Restore Previous Code

```bash
# If using git:
git checkout main  # or the previous release tag/branch

# If deploying from archive:
# Extract previous code to deployment directory
```

### Step 4: Restore `.env`

Restore the previous `.env` file. The old version may reference `MINDFORUM_API_URL`, `FORUM_API_URL`, `MINDAUTH_SERVICE_KEY` which are no longer used by the new code but needed by the old code.

### Step 5: Flush Redis (Recommended)

```bash
redis-cli FLUSHDB
```

Session formats may have changed between versions.

### Step 6: Restore Upload Directory

If uploads were modified during the failed release:

```bash
cp -r /path/to/uploads_backup/* /path/to/mindauth/public/uploads/
```

### Step 7: Reinstall Dependencies (if needed)

```bash
npm install
```

The old code may have different dependency requirements.

### Step 8: Start MindAuth Service

```bash
# For old code, the start command may differ:
npm start
# or
pm2 start mindauth
```

### Step 9: Verify Rollback

```bash
curl http://localhost:4001/api/health
# Test MindFourm login flow
# Test admin panel
```

---

## Upload Directory Persistence

The `public/uploads/` directory stores user-generated content:

```
public/uploads/
├── avatars/    # User profile pictures (max 2MB each)
└── banners/    # User profile banners (max 5MB each)
```

**Rules:**
- NEVER delete `public/uploads/` during deployment
- When using `rsync`, exclude uploads: `rsync -av --exclude 'public/uploads/' ...`
- When using Docker, mount as volume: `-v /data/mindauth/uploads:/app/public/uploads`
- When using git, `public/uploads/` is already in `.gitignore`

---

## Troubleshooting

### `Configuration validation failed`
- Check `.env` has all required variables
- In production, `BASE_URL` must not be `localhost`
- `ADMIN_SECRET` must be 32+ characters in production

### `Upload directory is not writable`
- Check file permissions on `public/uploads/`
- Ensure the Node.js process user has write access

### Health check returns `degraded`
- Check MySQL connectivity: `mysql -u mindauth -p -e "SELECT 1"`
- Check Redis connectivity: `redis-cli ping`

### OAuth login fails from MindFourm
- Verify `redirect_uri` in MindAuth OAuth client exactly matches MindFourm's callback URL
- Verify `client_id` and `client_secret` match in both services
- Check `ALLOWED_ORIGINS` includes MindFourm's frontend URL

### React SPA shows blank page
- Ensure `npm run build` was run and `dist/client/` exists
- Check that Express is serving `dist/client/index.html` (not `public/index.html`)
- Look for errors in browser console
