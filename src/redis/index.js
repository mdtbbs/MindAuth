const redis = require('redis');
const config = require('../config');

const client = redis.createClient({
  socket: {
    host: config.redis.host,
    port: config.redis.port
  },
  password: config.redis.password,
  database: config.redis.database
});

client.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

client.on('connect', () => {
  console.log('Redis Client Connected');
});

async function connectRedis() {
  await client.connect();
}

async function closeRedis() {
  await client.quit();
}

module.exports = {
  client,
  connectRedis,
  closeRedis
};