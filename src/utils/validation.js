/**
 * Validation utilities
 */

/**
 * HTML escape function for preventing XSS in HTML content
 * @param {string} str - String to escape
 * @returns {string} Escaped string safe for HTML
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

/**
 * Username validation with character whitelist
 * Security: Only allows alphanumeric characters, underscores, and hyphens
 * This prevents injection issues in logs, emails, and database queries
 * @param {string} username - Username to validate
 * @returns {boolean} True if username meets requirements
 */
function isValidUsername(username) {
  if (!username || typeof username !== 'string') {
    return false;
  }
  // Length check
  if (username.length < 2 || username.length > 50) {
    return false;
  }
  // Character whitelist: alphanumeric, underscore, hyphen, and common CJK characters
  // This is more restrictive than before but prevents potential security issues
  const validPattern = /^[a-zA-Z0-9_\-一-龥぀-ヿ㐀-䶿]+$/;
  return validPattern.test(username.trim());
}

/**
 * Get username validation error message
 * @param {string} username - Username to check
 * @returns {string|null} Error message or null if valid
 */
function getUsernameValidationError(username) {
  if (!username) {
    return '用户名不能为空';
  }
  if (username.length < 2) {
    return '用户名至少需要2个字符';
  }
  if (username.length > 50) {
    return '用户名不能超过50个字符';
  }
  const validPattern = /^[a-zA-Z0-9_\-一-龥぀-ヿ㐀-䶿]+$/;
  if (!validPattern.test(username.trim())) {
    return '用户名只能包含字母、数字、下划线、连字符和中文';
  }
  return null;
}

module.exports = {
  isValidEmail,
  isValidPassword,
  getPasswordValidationError,
  isValidUsername,
  getUsernameValidationError,
  escapeHtml
};