-- Track when username was last changed (for rate limiting self-service changes)
ALTER TABLE users ADD COLUMN username_changed_at DATETIME NULL DEFAULT NULL;
