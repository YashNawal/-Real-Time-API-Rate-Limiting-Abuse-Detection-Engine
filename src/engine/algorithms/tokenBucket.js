/**
 * Token Bucket Algorithm
 * Allows bursts of requests up to bucket capacity while enforcing a steady refill rate.
 * Widely used by AWS, Stripe, and Cloudflare.
 */
async function checkTokenBucket(redis, key, options = {}) {
  const capacity = options.capacity || 20;
  const refillRate = options.refillRate || 2; // tokens per second
  const now = Date.now();
  const redisKey = `ratelimit:tb:${key}`;

  // Read current bucket state: { tokens, lastRefill }
  const rawData = await redis.hgetall(redisKey);

  let tokens = capacity;
  let lastRefill = now;

  if (rawData && rawData.tokens !== undefined) {
    const prevTokens = parseFloat(rawData.tokens);
    const prevRefill = parseInt(rawData.lastRefill, 10);
    const elapsedSec = Math.max(0, (now - prevRefill) / 1000);
    const refilledTokens = elapsedSec * refillRate;
    tokens = Math.min(capacity, prevTokens + refilledTokens);
    lastRefill = now;
  }

  if (tokens >= 1) {
    tokens = tokens - 1;
    // Persist new state
    const pipeline = redis.pipeline();
    pipeline.hmset(redisKey, {
      tokens: tokens.toFixed(4),
      lastRefill: now.toString(),
    });
    // Expire if idle for 1 hour
    pipeline.expire(redisKey, 3600);
    await pipeline.exec();

    return {
      allowed: true,
      algorithm: 'Token Bucket',
      limit: capacity,
      remaining: Math.floor(tokens),
      current: capacity - Math.floor(tokens),
      capacity,
      tokensAvailable: tokens.toFixed(2),
      resetMs: Math.ceil(((capacity - tokens) / refillRate) * 1000),
      retryAfterSec: 0,
    };
  }

  // Not enough tokens
  const deficit = 1 - tokens;
  const retryAfterSec = Math.max(1, Math.ceil(deficit / refillRate));
  const resetMs = Math.ceil(retryAfterSec * 1000);

  return {
    allowed: false,
    algorithm: 'Token Bucket',
    limit: capacity,
    remaining: 0,
    current: capacity,
    capacity,
    tokensAvailable: tokens.toFixed(2),
    resetMs,
    retryAfterSec,
  };
}

module.exports = { checkTokenBucket };
