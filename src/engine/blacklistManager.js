class BlacklistManager {
  constructor(redisClient) {
    this.redis = redisClient;
    this.whitelist = new Set(['127.0.0.1', '::1', 'localhost', 'trusted-admin']);
  }

  setRedis(client) {
    this.redis = client;
  }

  isWhitelisted(ip) {
    return this.whitelist.has(ip);
  }

  addToWhitelist(ip) {
    this.whitelist.add(ip);
  }

  removeFromWhitelist(ip) {
    this.whitelist.delete(ip);
  }

  async isBanned(ip) {
    if (this.isWhitelisted(ip)) return null;

    const banKey = `blacklist:${ip}`;
    const data = await this.redis.hgetall(banKey);

    if (data && data.bannedAt) {
      const ttl = await this.redis.ttl(banKey);
      return {
        banned: true,
        reason: data.reason || 'Abusive behavior detected',
        score: parseInt(data.score, 10) || 100,
        bannedAt: parseInt(data.bannedAt, 10),
        ttlSeconds: ttl > 0 ? ttl : null, // null if permanent
      };
    }

    return null;
  }

  async banIP(ip, options = {}) {
    if (this.isWhitelisted(ip)) return false;

    const banKey = `blacklist:${ip}`;
    const durationSec = options.durationSec || 180; // default 3 minutes
    const reason = options.reason || 'High abuse risk score';
    const score = options.score || 95;
    const now = Date.now();

    const pipeline = this.redis.pipeline();
    pipeline.hmset(banKey, {
      ip,
      reason,
      score: score.toString(),
      bannedAt: now.toString(),
      durationSec: durationSec.toString(),
    });

    if (durationSec > 0) {
      pipeline.expire(banKey, durationSec);
    }

    // Also add to a set of active banned IPs for fast listing
    pipeline.sadd('blacklist:all', ip);

    await pipeline.exec();
    return true;
  }

  async unbanIP(ip) {
    const banKey = `blacklist:${ip}`;
    const pipeline = this.redis.pipeline();
    pipeline.del(banKey);
    pipeline.srem('blacklist:all', ip);
    await pipeline.exec();
    return true;
  }

  async getAllBannedIPs() {
    const allIps = await this.redis.smembers('blacklist:all');
    const result = [];

    for (const ip of allIps) {
      const banInfo = await this.isBanned(ip);
      if (banInfo) {
        result.push({
          ip,
          reason: banInfo.reason,
          score: banInfo.score,
          bannedAt: banInfo.bannedAt,
          ttlSeconds: banInfo.ttlSeconds,
        });
      } else {
        // Expired from Redis, clean from set
        await this.redis.srem('blacklist:all', ip);
      }
    }

    // Sort by most recently banned
    return result.sort((a, b) => b.bannedAt - a.bannedAt);
  }
}

module.exports = BlacklistManager;
