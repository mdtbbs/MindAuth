-- Store short-lived, encrypted responses for recoverable OAuth refresh retries.
-- Values are populated only on the old, rotated refresh-token row.
ALTER TABLE refresh_tokens
  ADD COLUMN refresh_idempotency_key_hash CHAR(64) NULL,
  ADD COLUMN refresh_idempotency_response MEDIUMTEXT NULL,
  ADD COLUMN refresh_idempotency_expires_at_ms BIGINT UNSIGNED NULL,
  ADD COLUMN refresh_idempotency_access_token_hash CHAR(64) NULL,
  ADD INDEX idx_refresh_tokens_idempotency_expiry (refresh_idempotency_expires_at_ms);
