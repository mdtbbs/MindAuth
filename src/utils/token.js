const crypto = require('crypto');

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateShortToken() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * SHA-256 hash (hex) of a raw token. Store this — never the raw value — for
 * bearer tokens kept server-side (password reset, email verification), so a
 * Redis/DB dump never exposes usable tokens. The raw token is only ever put
 * in the emailed link.
 */
function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

module.exports = { generateToken, generateShortToken, hashToken };