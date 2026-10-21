/**
 * Fixed Window Counter Algorithm
 * Partitions time into fixed discrete slots (e.g., 10 seconds).
 * Ultra-fast with Redis INCR.
 */
async function checkFixedWindow(redis, key, options = {}) {
  const windowMs = options.windowMs || 10000;
  const maxRequests = options.maxRequests || 20;
  const now = Date.now();
  const currentWindowIndex = Math.floor(now / windowMs);
  const redisKey = `ratelimit:fw:${key}:${currentWindowIndex}`;

  const pipeline = redis.pipeline();
  pipeline.incr(redisKey);
  pipeline.pexpire(redisKey, windowMs * 2);

  const results = await pipeline.exec();
  const currentCount = results[0][1];

  const windowEnd = (currentWindowIndex + 1) * windowMs;
  const resetMs = Math.max(0, windowEnd - now);

  if (currentCount <= maxRequests) {
    return {
      allowed: true,
      algorithm: 'Fixed Window Counter',
      limit: maxRequests,
      remaining: Math.max(0, maxRequests - currentCount),
      current: currentCount,
      resetMs,
      retryAfterSec: 0,
    };
  }

  return {
    allowed: false,
    algorithm: 'Fixed Window Counter',
    limit: maxRequests,
    remaining: 0,
    current: currentCount,
    resetMs,
    retryAfterSec: Math.max(1, Math.ceil(resetMs / 1000)),
  };
}

module.exports = { checkFixedWindow };
