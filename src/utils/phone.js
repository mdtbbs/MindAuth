const MAINLAND_CHINA_PHONE_RE = /^1[3-9]\d{9}$/;

function normalizePhone(phone) {
  return String(phone || '').trim();
}

function isValidMainlandChinaPhone(phone) {
  return MAINLAND_CHINA_PHONE_RE.test(normalizePhone(phone));
}

function maskPhone(phone) {
  if (!phone) return null;
  return String(phone).replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
}

module.exports = { normalizePhone, isValidMainlandChinaPhone, maskPhone };
