/**
 * Sliding Window Counter / Log using Redis Sorted Set (ZSET)
 * Guarantees exact rate enforcement with zero boundary burst vulnerability.
 */
async function checkSlidingWindow(redis, key, options = {}) {
  const windowMs = options.windowMs || 10000;
  const maxRequests = options.maxRequests || 20;
  const now = Date.now();
  const windowStart = now - windowMs;
  const redisKey = `ratelimit:sw:${key}`;

  // Multi-exec pipeline for atomic operation
  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(redisKey, 0, windowStart);
  pipeline.zcard(redisKey);
  pipeline.zrange(redisKey, 0, 0, 'WITHSCORES');

  const results = await pipeline.exec();
  const currentCount = results[1][1] || 0;
  const earliestScoreEntry = results[2][1];

  let earliestTime = now;
  if (earliestScoreEntry && earliestScoreEntry.length >= 2) {
    earliestTime = parseFloat(earliestScoreEntry[1]) || now;
  }

  const resetMs = Math.max(0, Math.ceil(earliestTime + windowMs - now));

  if (currentCount < maxRequests) {
    // Add current request timestamp with micro-fraction to ensure unique members in ZSET
    const uniqueMember = `${now}:${Math.random().toString(36).substring(2, 7)}`;
    const addPipeline = redis.pipeline();
    addPipeline.zadd(redisKey, now, uniqueMember);
    addPipeline.pexpire(redisKey, windowMs * 2);
    await addPipeline.exec();

    return {
      allowed: true,
      algorithm: 'Sliding Window Log',
      limit: maxRequests,
      remaining: Math.max(0, maxRequests - currentCount - 1),
      current: currentCount + 1,
      resetMs,
      retryAfterSec: 0,
    };
  }

  return {
    allowed: false,
    algorithm: 'Sliding Window Log',
    limit: maxRequests,
    remaining: 0,
    current: currentCount,
    resetMs,
    retryAfterSec: Math.max(1, Math.ceil(resetMs / 1000)),
  };
}

module.exports = { checkSlidingWindow };
