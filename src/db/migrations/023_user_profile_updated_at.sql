-- `userinfo` exposed `updated_at` sourced from `users.created_at` because the
-- table had no other timestamp. That made the claim actively misleading: a
-- client polling it for profile changes would never see one. Add a real
-- modification timestamp, backfilled so no row starts out NULL.
ALTER TABLE users
  ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

UPDATE users SET updated_at = created_at WHERE updated_at > created_at;
