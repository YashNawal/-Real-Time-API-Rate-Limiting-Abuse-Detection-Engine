/**
 * Leaky Bucket Algorithm
 * Smooths traffic out at a constant outflow rate.
 * Good for preventing bursts from overwhelming downstream services.
 */
async function checkLeakyBucket(redis, key, options = {}) {
  const capacity = options.capacity || 20;
  const leakRateMs = options.leakRateMs || 500; // 1 unit leaks every 500ms (2 units / sec)
  const now = Date.now();
  const redisKey = `ratelimit:lb:${key}`;

  const rawData = await redis.hgetall(redisKey);

  let waterLevel = 0;
  let lastLeakTime = now;

  if (rawData && rawData.waterLevel !== undefined) {
    const prevWater = parseFloat(rawData.waterLevel);
    const prevTime = parseInt(rawData.lastLeakTime, 10);
    const elapsedMs = Math.max(0, now - prevTime);
    const leakedUnits = elapsedMs / leakRateMs;
    waterLevel = Math.max(0, prevWater - leakedUnits);
    lastLeakTime = now;
  }

  // Check if adding 1 unit exceeds capacity
  if (waterLevel + 1 <= capacity) {
    const newWater = waterLevel + 1;
    const pipeline = redis.pipeline();
    pipeline.hmset(redisKey, {
      waterLevel: newWater.toFixed(4),
      lastLeakTime: now.toString(),
    });
    pipeline.expire(redisKey, 3600);
    await pipeline.exec();

    const emptyTimeMs = Math.ceil(newWater * leakRateMs);

    return {
      allowed: true,
      algorithm: 'Leaky Bucket',
      limit: capacity,
      remaining: Math.max(0, Math.floor(capacity - newWater)),
      current: Math.ceil(newWater),
      resetMs: emptyTimeMs,
      retryAfterSec: 0,
    };
  }

  // Overflow!
  const overflow = waterLevel + 1 - capacity;
  const retryAfterSec = Math.max(1, Math.ceil((overflow * leakRateMs) / 1000));

  return {
    allowed: false,
    algorithm: 'Leaky Bucket',
    limit: capacity,
    remaining: 0,
    current: capacity,
    resetMs: retryAfterSec * 1000,
    retryAfterSec,
  };
}

module.exports = { checkLeakyBucket };
