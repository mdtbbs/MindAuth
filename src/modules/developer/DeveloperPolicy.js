const { pool } = require('../../db');

const DEVELOPER_ECOSYSTEMS = Object.freeze(['mdtbbs', 'mindustry-club', 'global']);

function normalizeEcosystem(value, fallback = 'mdtbbs') {
  const ecosystem = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return DEVELOPER_ECOSYSTEMS.includes(ecosystem) ? ecosystem : fallback;
}

function isSupportedEcosystem(value) {
  return typeof value === 'string' && DEVELOPER_ECOSYSTEMS.includes(value.trim().toLowerCase());
}

async function assertDeveloperEligibility(userId, ecosystem = 'mdtbbs', executor = pool) {
  const policyEcosystem = normalizeEcosystem(ecosystem);
  const [users] = await executor.execute(
    'SELECT email_verified, phone_verified FROM users WHERE id = ? LIMIT 1',
    [userId],
  );
  const user = users[0];
  if (!user || !(user.email_verified === 1 || user.email_verified === true)) {
    const error = new Error('Verify your email before creating a developer application.');
    error.code = 'EMAIL_VERIFICATION_REQUIRED';
    error.statusCode = 403;
    throw error;
  }
  if (policyEcosystem === 'mdtbbs' && !(user.phone_verified === 1 || user.phone_verified === true)) {
    const error = new Error('Verify your phone before creating an MDTBBS developer application.');
    error.code = 'PHONE_VERIFICATION_REQUIRED';
    error.statusCode = 403;
    throw error;
  }
}

module.exports = { DEVELOPER_ECOSYSTEMS, normalizeEcosystem, isSupportedEcosystem, assertDeveloperEligibility };
