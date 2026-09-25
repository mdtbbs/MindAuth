-- Public PKCE client used by the Mindustry v8 Game Content Mod.
-- The exchange secret remains server-side in MindFourm and is never shipped
-- to the client. Existing Android and legacy native clients remain unchanged.
INSERT INTO native_auth_clients (client_id, enabled, allowed_methods, pkce_required, token_audience_client_id)
VALUES ('mdtbbs_mindustry', 1, JSON_ARRAY('password'), 1, 'forum')
ON DUPLICATE KEY UPDATE
  enabled = VALUES(enabled),
  allowed_methods = VALUES(allowed_methods),
  pkce_required = VALUES(pkce_required),
  token_audience_client_id = VALUES(token_audience_client_id);
