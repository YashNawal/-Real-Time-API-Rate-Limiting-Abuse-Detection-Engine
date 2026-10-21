const Redis = require('ioredis');
const RedisMock = require('ioredis-mock');
const config = require('../config/config');

let redisClient = null;
let isMock = false;
let isConnected = false;

function initRedis() {
  return new Promise((resolve) => {
    try {
      const realClient = new Redis(config.redis.url, {
        connectTimeout: 1500,
        maxRetriesPerRequest: 0,
        enableOfflineQueue: false,
        retryStrategy: () => null,
      });

      let resolved = false;

      realClient.on('connect', () => {
        if (!resolved) {
          resolved = true;
          isConnected = true;
          isMock = false;
          redisClient = realClient;
          console.log(`[Redis] Connected to external Redis at ${config.redis.url}`);
          resolve(redisClient);
        }
      });

      realClient.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          console.warn(`[Redis] External Redis unavailable (${err.message}). Falling back to Embedded High-Speed In-Memory Redis.`);
          realClient.disconnect();
          useMockRedis();
          resolve(redisClient);
        }
      });

      // Safety timeout if neither connect nor error fires in 1800ms
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.warn('[Redis] Connection timed out. Falling back to Embedded In-Memory Redis.');
          try {
            realClient.disconnect();
          } catch (e) {}
          useMockRedis();
          resolve(redisClient);
        }
      }, 1800);
    } catch (err) {
      console.warn(`[Redis] Error initializing Redis client: ${err.message}. Using In-Memory Redis.`);
      useMockRedis();
      resolve(redisClient);
    }
  });
}

function useMockRedis() {
  redisClient = new RedisMock();
  isMock = true;
  isConnected = true;
  console.log('[Redis] Embedded High-Speed In-Memory Redis Engine active and ready.');
}

async function getStatus() {
  try {
    let keyCount = 0;
    if (redisClient) {
      const keys = await redisClient.keys('*');
      keyCount = keys.length;
    }
    return {
      connected: isConnected,
      isMock,
      mode: isMock ? 'Embedded High-Speed Redis (Mock)' : 'Standalone Production Redis',
      url: isMock ? 'memory://internal' : config.redis.url,
      keyCount,
    };
  } catch (err) {
    return {
      connected: false,
      isMock,
      mode: 'Error',
      url: config.redis.url,
      keyCount: 0,
      error: err.message,
    };
  }
}

module.exports = {
  initRedis,
  getClient: () => redisClient,
  getStatus,
  isUsingMock: () => isMock,
};
