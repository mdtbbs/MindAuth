const mysql = require('mysql2/promise');
const config = require('../config');

const pool = mysql.createPool({
  ...(config.mysql.socketPath ? { socketPath: config.mysql.socketPath } : { host: config.mysql.host }),
  port: config.mysql.port,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
  waitForConnections: true,
  connectionLimit: config.mysql.poolSize,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
});

async function closePool() {
  await pool.end();
}

module.exports = { pool, closePool };
