function maskPhone(phone) {
  if (!phone) return null;
  return String(phone).replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
}

module.exports = { maskPhone };
