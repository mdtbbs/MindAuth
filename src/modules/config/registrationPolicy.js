/**
 * registrationPolicy — runtime switching for the system_config keys that the
 * admin settings page exposes but nothing consumed.
 *
 * `registration_enabled` was editable in the admin UI and documented as a
 * working switch, yet no source file read it: turning registration "off" left
 * /api/register wide open. This module is the single consumer so the switch,
 * the password rules, and the session lifetime have exactly one reading path.
 *
 * All lookups are cached by runtimeConfig (5 min) and fail open on DB errors —
 * an unreadable settings table must not take registration down. The password
 * policy is the one exception: it can only tighten the hardcoded floor.
 */

const runtimeConfig = require('./runtimeConfig');

const SESSION_LIFETIME_DAYS = 30;
const PASSWORD_MIN_LENGTH = 8;

/**
 * @returns {Promise<boolean>} whether new registrations are accepted
 */
async function isRegistrationEnabled() {
  try {
    return (await runtimeConfig.get('registration_enabled')) !== '0';
  } catch {
    return true;
  }
}

/**
 * @returns {Promise<number>} session lifetime in days
 */
async function getSessionLifetimeDays() {
  try {
    const raw = Number(await runtimeConfig.get('session_lifetime_days'));
    return Number.isFinite(raw) && raw > 0 ? raw : SESSION_LIFETIME_DAYS;
  } catch {
    return SESSION_LIFETIME_DAYS;
  }
}

/**
 * @returns {Promise<{ minLength: number, requireComplexity: boolean }>}
 */
async function getPasswordPolicy() {
  try {
    const values = await runtimeConfig.getMany(['password_min_length', 'password_require_complexity']);
    const minLength = Number(values.password_min_length);
    return {
      // Admin input below the floor is ignored (not clamped silently upward):
      // the floor is the contract existing clients validate against.
      minLength: Number.isFinite(minLength) && minLength >= PASSWORD_MIN_LENGTH ? minLength : PASSWORD_MIN_LENGTH,
      requireComplexity: values.password_require_complexity === '1',
    };
  } catch {
    return { minLength: PASSWORD_MIN_LENGTH, requireComplexity: false };
  }
}

/**
 * Validate a password against the runtime policy.
 *
 * Hard floor (always enforced, independent of config): 8+ characters and at
 * least one letter and one digit. The admin settings can only tighten this —
 * `password_min_length` raises the length, `password_require_complexity`
 * additionally demands an uppercase letter and a special character. A config
 * value below the floor is ignored so a settings change can never weaken
 * passwords that existing clients already rely on.
 *
 * @param {string} password
 * @returns {Promise<string|null>} error message, or null when accepted
 */
async function validatePassword(password) {
  if (!password) return '密码不能为空';
  const { minLength, requireComplexity } = await getPasswordPolicy();
  if (password.length < minLength) return `密码至少需要${minLength}个字符`;
  if (!/[A-Za-z]/.test(password)) return '密码需要包含字母';
  if (!/[0-9]/.test(password)) return '密码需要包含数字';
  if (requireComplexity) {
    if (!/[A-Z]/.test(password)) return '密码需要包含大写字母';
    if (!/[^A-Za-z0-9]/.test(password)) return '密码需要包含特殊字符';
  }
  return null;
}

module.exports = {
  // Test seam: drop runtimeConfig's cache so the next read hits the store.
  _invalidate: () => runtimeConfig.invalidate(),
  isRegistrationEnabled,
  getSessionLifetimeDays,
  getPasswordPolicy,
  validatePassword,
  SESSION_LIFETIME_DAYS,
  PASSWORD_MIN_LENGTH,
};
