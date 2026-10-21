const { checkSlidingWindow } = require('./algorithms/slidingWindow');
const { checkTokenBucket } = require('./algorithms/tokenBucket');
const { checkFixedWindow } = require('./algorithms/fixedWindow');
const { checkLeakyBucket } = require('./algorithms/leakyBucket');
const config = require('../config/config');

class RateLimiter {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  setRedis(client) {
    this.redis = client;
  }

  async checkLimit(identifier, customOptions = {}) {
    const activeAlgorithm = customOptions.algorithm || config.rateLimit.algorithm;
    const windowMs = customOptions.windowMs || config.rateLimit.windowMs;
    const maxRequests = customOptions.maxRequests || config.rateLimit.maxRequests;

    switch (activeAlgorithm) {
      case 'token-bucket':
        return await checkTokenBucket(this.redis, identifier, {
          capacity: customOptions.capacity || config.rateLimit.tokenBucket.capacity,
          refillRate: customOptions.refillRate || config.rateLimit.tokenBucket.refillRate,
        });

      case 'fixed-window':
        return await checkFixedWindow(this.redis, identifier, {
          windowMs,
          maxRequests,
        });

      case 'leaky-bucket':
        return await checkLeakyBucket(this.redis, identifier, {
          capacity: customOptions.capacity || config.rateLimit.leakyBucket.capacity,
          leakRateMs: customOptions.leakRateMs || config.rateLimit.leakyBucket.leakRateMs,
        });

      case 'sliding-window':
      default:
        return await checkSlidingWindow(this.redis, identifier, {
          windowMs,
          maxRequests,
        });
    }
  }
}

module.exports = RateLimiter;
