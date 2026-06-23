function isDuplicateError(err) {
  return err.code === 'ER_DUP_ENTRY';
}

function getDuplicateField(err) {
  if (!isDuplicateError(err)) return null;

  const message = err.sqlMessage || '';
  if (message.includes('phone')) return 'phone';
  if (message.includes('username')) return 'username';
  if (message.includes('email')) return 'email';

  const match = message.match(/Duplicate entry '.*' for key '.*\.(.+)'/);
  if (match && match[1]) {
    return match[1];
  }

  return null;
}

function isForeignKeyError(err) {
  return err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_ROW_IS_REFERENCED_2';
}

module.exports = {
  isDuplicateError,
  getDuplicateField,
  isForeignKeyError
};
