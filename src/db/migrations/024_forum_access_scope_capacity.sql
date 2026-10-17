-- The single forum grant includes legacy aliases for existing resource servers.
-- Their complete set exceeds the original 255-character scope columns.
-- Widen storage without changing any existing grants or token contents.
ALTER TABLE authorizations
  MODIFY COLUMN scope VARCHAR(2048) DEFAULT '';

ALTER TABLE refresh_tokens
  MODIFY COLUMN scope VARCHAR(2048) DEFAULT 'openid profile email';
