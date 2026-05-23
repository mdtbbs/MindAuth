/**
 * Validation utilities
 */

function isValidEmail(email) {
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Password validation (enhanced)
 * Requirements:
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one digit
 * @param {string} password - Password to validate
 * @returns {boolean} True if password meets requirements
 */
function isValidPassword(password) {
  if (!password || password.length < 8) {
    return false;
  }

  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);

  return hasUppercase && hasLowercase && hasDigit;
}

/**
 * Get password validation error message
 * @param {string} password - Password to check
 * @returns {string|null} Error message or null if valid
 */
function getPasswordValidationError(password) {
  if (!password) {
    return '密码不能为空';
  }
  if (password.length < 8) {
    return '密码至少需要8个字符';
  }
  if (!/[A-Z]/.test(password)) {
    return '密码需要包含大写字母';
  }
  if (!/[a-z]/.test(password)) {
    return '密码需要包含小写字母';
  }
  if (!/[0-9]/.test(password)) {
    return '密码需要包含数字';
  }
  return null;
}

function isValidUsername(username) {
  return username && username.length >= 2 && username.length <= 50;
}

module.exports = { isValidEmail, isValidPassword, getPasswordValidationError, isValidUsername };