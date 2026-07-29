-- 004_registration_email_codes.sql
-- MySQL fallback table for registration email verification codes.
-- Codes are short-lived (5 minutes). Redis holds them primarily; this table
-- survives Redis restarts and lets registration succeed when the code was
-- issued before a Redis flush.
--
-- Keyed by SHA-256(lowercase-trimmed-email) so only one pending code can
-- exist per email at a time, matching the Redis key design. The stored
-- code_hash is SHA-256(code), never the plaintext 6-digit value.

CREATE TABLE IF NOT EXISTS registration_email_codes (
  email_hash VARCHAR(64) PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  code_hash VARCHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_reg_codes_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
