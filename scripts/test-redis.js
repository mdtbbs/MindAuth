const redis = require('redis');

require('dotenv').config();

async function testRedis() {
  console.log('Testing Redis connection...');
  console.log('Host:', process.env.REDIS_HOST);
  console.log('Port:', process.env.REDIS_PORT);
  console.log('Password:', process.env.REDIS_PASSWORD);

  // Test 1: Standard connection
  console.log('\n=== Test 1: Standard connection ===');
  try {
    const client1 = redis.createClient({
      socket: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT) || 6379,
        connectTimeout: 5000
      },
      password: process.env.REDIS_PASSWORD
    });

    client1.on('error', (err) => console.error('Test1 Error:', err.message));

    await client1.connect();
    console.log('Test1: Connected!');
    await client1.ping();
    console.log('Test1: PING OK');
    await client1.quit();
    return;
  } catch (err) {
    console.error('Test1 Failed:', err.message);
  }

  // Test 2: URL format
  console.log('\n=== Test 2: URL format ===');
  try {
    const password = encodeURIComponent(process.env.REDIS_PASSWORD);
    const url = `redis://:${password}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`;
    console.log('URL:', url);

    const client2 = redis.createClient({ url });

    client2.on('error', (err) => console.error('Test2 Error:', err.message));

    await client2.connect();
    console.log('Test2: Connected!');
    await client2.ping();
    console.log('Test2: PING OK');
    await client2.quit();
    return;
  } catch (err) {
    console.error('Test2 Failed:', err.message);
  }

  // Test 3: No password (to see if it's authentication issue)
  console.log('\n=== Test 3: No password ===');
  try {
    const client3 = redis.createClient({
      socket: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT) || 6379,
        connectTimeout: 5000
      }
    });

    client3.on('error', (err) => console.error('Test3 Error:', err.message));

    await client3.connect();
    console.log('Test3: Connected!');
    await client3.ping();
    console.log('Test3: PING OK');
    await client3.quit();
    console.log('\n>>> Redis does NOT require password, update .env to remove password');
    return;
  } catch (err) {
    console.error('Test3 Failed:', err.message);
    console.log('\n>>> Redis requires password or connection blocked');
  }
}

testRedis();