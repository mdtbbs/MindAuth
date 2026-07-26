-- 002_security_hardening.sql
-- Security hardening (2026-07):
--   * user_sessions: absolute expiry column + UNIQUE token hash index
--   * refresh_tokens: store SHA-256 hashes instead of plaintext tokens
--   * clients: drop the composite index that embedded client_secret
--   * users: drop deprecated session_token column + redundant indexes
--   * ip_bans: add lookup index on ip_address

-- ─────────────────────────────────────────────────────────────
-- user_sessions: absolute session lifetime
-- ─────────────────────────────────────────────────────────────
ALTER TABLE user_sessions ADD COLUMN expires_at DATETIME DEFAULT NULL AFTER device_info;

-- Backfill existing sessions with a 30-day lifetime from creation
UPDATE user_sessions SET expires_at = DATE_ADD(created_at, INTERVAL 30 DAY) WHERE expires_at IS NULL;

-- Token hashes must be unique; replaces the plain index from 001
ALTER TABLE user_sessions DROP INDEX idx_sessions_token;
ALTER TABLE user_sessions ADD UNIQUE INDEX uniq_sessions_token (session_token);
ALTER TABLE user_sessions ADD INDEX idx_sessions_expires (expires_at);

-- ─────────────────────────────────────────────────────────────
-- refresh_tokens: hash existing plaintext tokens (SHA-256 hex).
-- Migrations run exactly once per database, so this cannot double-hash.
-- ─────────────────────────────────────────────────────────────
UPDATE refresh_tokens SET token = SHA2(token, 256);

-- ─────────────────────────────────────────────────────────────
-- clients: secrets must never appear in an index
-- ─────────────────────────────────────────────────────────────
ALTER TABLE clients DROP INDEX idx_clients_credentials;

-- ─────────────────────────────────────────────────────────────
-- users: drop deprecated session storage + redundant indexes
-- (username/email already have UNIQUE constraints from 001)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE users DROP INDEX idx_users_session;
ALTER TABLE users DROP COLUMN session_token;
ALTER TABLE users DROP INDEX idx_users_username;
ALTER TABLE users DROP INDEX idx_users_email;

-- ─────────────────────────────────────────────────────────────
-- ip_bans: direct lookup index for admin queries and cache reloads
-- ─────────────────────────────────────────────────────────────
ALTER TABLE ip_bans ADD INDEX idx_ip_bans_ip (ip_address);
