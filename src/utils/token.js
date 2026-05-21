const crypto = require('crypto');

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateShortToken() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = { generateToken, generateShortToken };