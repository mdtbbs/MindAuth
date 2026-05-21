function isValidEmail(email) {
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPassword(password) {
  return password && password.length >= 6;
}

function isValidUsername(username) {
  return username && username.length >= 2 && username.length <= 50;
}

module.exports = { isValidEmail, isValidPassword, isValidUsername };