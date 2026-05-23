const redis = require('redis');

require('dotenv').config();

async function checkRateLimits() {
  const client = redis.createClient({
    socket: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379
    },
    password: process.env.REDIS_PASSWORD || undefined,
    database: parseInt(process.env.REDIS_DB) || 0
  });

  await client.connect();

  // Get all rate limit keys
  const keys = await client.keys('ratelimit:*');
  console.log('Rate limit keys:', keys);

  for (const key of keys) {
    const value = await client.get(key);
    const ttl = await client.ttl(key);
    console.log(`${key}: value=${value}, ttl=${ttl}s`);
  }

  await client.quit();
}

checkRateLimits();