-- Protect provider credentials at rest and migrate OAuth client secrets to hashes.
ALTER TABLE email_config MODIFY password VARCHAR(1024) NOT NULL DEFAULT '';
ALTER TABLE sms_config MODIFY access_key_secret VARCHAR(1024) NOT NULL DEFAULT '';

UPDATE clients
SET client_secret = CONCAT('sha256:', SHA2(client_secret, 256))
WHERE client_secret <> '' AND client_secret NOT LIKE 'sha256:%';
