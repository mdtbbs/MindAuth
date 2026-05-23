const { pool, closePool } = require('./pool');
const { initSchema } = require('./schema-mysql');
const { transaction } = require('./transactions');
const { isDuplicateError, getDuplicateField, isForeignKeyError } = require('./errors');

module.exports = {
  pool,
  closePool,
  initSchema,
  transaction,
  isDuplicateError,
  getDuplicateField,
  isForeignKeyError
};