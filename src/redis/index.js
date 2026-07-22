const redis = require('redis');
const config = require('../config');

function createMemoryRedisClient() {
  const store = new Map();
  const expires = new Map();
  const sets = new Map(); // Redis SET support

  function now() {
    return Date.now();
  }

  function isExpired(key) {
    const expiresAt = expires.get(key);
    if (!expiresAt || expiresAt > now()) {
      return false;
    }
    store.delete(key);
    expires.delete(key);
    return true;
  }

  function getMatchingKeys(pattern) {
    const regex = new RegExp(`^${String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    return Array.from(store.keys()).filter((key) => !isExpired(key) && regex.test(key));
  }

  return {
    async connect() {},
    async quit() {},
    async ping() {
      return 'PONG';
    },
    async get(key) {
      return isExpired(key) ? null : store.get(key) || null;
    },
    async setEx(key, ttlSeconds, value) {
      store.set(key, String(value));
      expires.set(key, now() + Number(ttlSeconds) * 1000);
      return 'OK';
    },
    async del(keys) {
      const list = Array.isArray(keys) ? keys : [keys, ...Array.prototype.slice.call(arguments, 1)];
      let count = 0;
      for (const key of list.flat()) {
        if (store.delete(key)) count += 1;
        if (sets.delete(key)) count += 1;
        expires.delete(key);
      }
      return count;
    },
    async incr(key) {
      const current = Number((await this.get(key)) || 0) + 1;
      store.set(key, String(current));
      return current;
    },
    async expire(key, ttlSeconds) {
      if (!store.has(key) || isExpired(key)) return 0;
      expires.set(key, now() + Number(ttlSeconds) * 1000);
      return 1;
    },
    async pExpire(key, ttlMs) {
      if (!store.has(key) || isExpired(key)) return 0;
      expires.set(key, now() + Number(ttlMs));
      return 1;
    },
    async ttl(key) {
      if (!store.has(key) || isExpired(key)) return -2;
      const expiresAt = expires.get(key);
      if (!expiresAt) return -1;
      return Math.max(Math.ceil((expiresAt - now()) / 1000), 0);
    },
    async scan(cursor, ...args) {
      let pattern = '*';
      for (let i = 0; i < args.length; i += 2) {
        if (String(args[i]).toUpperCase() === 'MATCH') {
          pattern = args[i + 1];
        }
      }
      return { cursor: '0', keys: getMatchingKeys(pattern) };
    },
    async sAdd(key, members) {
      const list = Array.isArray(members) ? members : [String(members)];
      if (!sets.has(key)) sets.set(key, new Set());
      const s = sets.get(key);
      let added = 0;
      for (const m of list) { if (!s.has(String(m))) { s.add(String(m)); added++; } }
      return added;
    },
    async sRem(key, members) {
      const list = Array.isArray(members) ? members : [String(members)];
      const s = sets.get(key);
      if (!s) return 0;
      let removed = 0;
      for (const m of list) { if (s.delete(String(m))) removed++; }
      if (s.size === 0) sets.delete(key);
      return removed;
    },
    async sMembers(key) {
      const s = sets.get(key);
      if (!s) return [];
      return Array.from(s);
    },
    async eval(script, options) {
      const key = options?.keys?.[0];
      const max = Number(options?.arguments?.[0]);
      const ttlSeconds = Number(options?.arguments?.[1]);
      if (!key) return 0;
      const count = await this.incr(key);
      if (count === 1) await this.expire(key, ttlSeconds);
      if (count > max) {
        const ttl = await this.ttl(key);
        return ttl < 1 ? ttlSeconds : ttl;
      }
      return 0;
    },
    on() {},
  };
}

if (process.env.USE_MEMORY_REDIS === '1') {
  const client = createMemoryRedisClient();
  module.exports = {
    client,
    connectRedis: () => client.connect(),
    closeRedis: () => client.quit(),
  };
  return;
}

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
