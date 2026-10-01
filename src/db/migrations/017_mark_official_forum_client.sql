-- Official MindFourm web login is a first-party account flow. Older production
-- registrations use a generated client_id, so identify the server-side client
-- by its exact, registered forum callback as well as the legacy "forum" ID.
-- Keep third-party clients and public applications unchanged.
UPDATE clients AS c
LEFT JOIN oauth_client_redirect_uris AS r
  ON r.oauth_client_id = c.id
  AND r.redirect_uri = 'https://mdtbbs.cn/api/auth/callback'
SET c.party_type = 'first_party'
WHERE c.client_type = 'confidential'
  AND c.status = 'approved'
  AND (
    c.client_id = 'forum'
    OR c.redirect_uri = 'https://mdtbbs.cn/api/auth/callback'
    OR r.id IS NOT NULL
  );
