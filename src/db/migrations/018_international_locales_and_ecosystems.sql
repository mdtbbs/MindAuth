-- Persist account language preference and the ecosystem whose developer policy
-- applies to each OAuth client. Existing clients remain on the MDTBBS policy.
ALTER TABLE users
  ADD COLUMN preferred_locale VARCHAR(16) DEFAULT NULL AFTER email_verified;

ALTER TABLE clients
  ADD COLUMN ecosystem VARCHAR(32) NOT NULL DEFAULT 'mdtbbs' AFTER party_type,
  ADD INDEX idx_clients_ecosystem (ecosystem, status);

UPDATE clients SET ecosystem = 'mdtbbs' WHERE ecosystem IS NULL OR ecosystem = '';
