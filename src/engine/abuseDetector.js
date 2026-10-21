const config = require('../config/config');

class AbuseDetector {
  constructor(redisClient, blacklistManager) {
    this.redis = redisClient;
    this.blacklist = blacklistManager;
  }

  setRedis(client) {
    this.redis = client;
  }

  /**
   * Evaluates incoming request signals and calculates an Abuse Risk Score (0 - 100).
   * Returns: { score, tier, flags: [], action: 'allow' | 'throttle' | 'block', reason }
   */
  async evaluateRequest(req, ip) {
    if (!config.abuseDetection.enabled) {
      return { score: 0, tier: 'normal', flags: [], action: 'allow', reason: 'Abuse detection disabled' };
    }

    const flags = [];
    let score = 0;
    const now = Date.now();
    const redisKey = `abuse:profile:${ip}`;

    // Read previous historical profile if present
    const rawProfile = await this.redis.hgetall(redisKey);
    let baseScore = 0;
    if (rawProfile && rawProfile.score) {
      const prevScore = parseFloat(rawProfile.score);
      const lastSeen = parseInt(rawProfile.lastSeen, 10);
      const elapsedSec = (now - lastSeen) / 1000;
      // Natural decay: decays 1 point every 4 seconds of idle/clean time
      baseScore = Math.max(0, prevScore - Math.floor(elapsedSec / 4));
    }

    score = baseScore;

    // --- Signal 1: Honeypot / Scanner Path Detection ---
    const rawPath = (req.originalUrl || req.url || '').toLowerCase().split('?')[0];
    const isHoneypot = config.abuseDetection.honeypotPaths.some((hp) => rawPath.startsWith(hp.toLowerCase()));
    if (isHoneypot) {
      score += 55;
      flags.push({
        type: 'HONEYPOT_HIT',
        detail: `Attempted access to sensitive scanner honeypot: ${rawPath}`,
        weight: 55,
      });
    }

    // --- Signal 2: Suspicious User-Agent / Scanner Tool ---
    const userAgent = (req.headers['user-agent'] || '').toLowerCase();
    if (!userAgent) {
      score += 20;
      flags.push({
        type: 'MISSING_USER_AGENT',
        detail: 'Request sent with blank or missing User-Agent header',
        weight: 20,
      });
    } else {
      const matchedScanner = config.abuseDetection.suspiciousUserAgents.find((bot) =>
        userAgent.includes(bot.toLowerCase())
      );
      if (matchedScanner) {
        score += 45;
        flags.push({
          type: 'SUSPICIOUS_USER_AGENT',
          detail: `Known automated scanner detected: ${matchedScanner}`,
          weight: 45,
        });
      }
    }

    // --- Signal 3: Micro-window Burst Velocity ---
    const burstKey = `abuse:burst:${ip}`;
    const burstWindowMs = config.abuseDetection.burstWindowMs;
    const burstStart = now - burstWindowMs;

    const burstPipeline = this.redis.pipeline();
    burstPipeline.zremrangebyscore(burstKey, 0, burstStart);
    burstPipeline.zcard(burstKey);
    const burstResults = await burstPipeline.exec();
    const recentBurstCount = burstResults[1][1] || 0;

    if (recentBurstCount >= config.abuseDetection.burstThreshold) {
      const burstSeverity = Math.min(45, (recentBurstCount - config.abuseDetection.burstThreshold + 1) * 8);
      score += burstSeverity;
      flags.push({
        type: 'BURST_VELOCITY_SPIKE',
        detail: `Abnormal rapid burst: ${recentBurstCount + 1} requests in ${burstWindowMs / 1000}s`,
        weight: burstSeverity,
      });
    }

    // Record this hit in the burst window
    const addBurstPipeline = this.redis.pipeline();
    addBurstPipeline.zadd(burstKey, now, `${now}:${Math.random().toString(36).substring(2, 6)}`);
    addBurstPipeline.pexpire(burstKey, burstWindowMs * 3);
    await addBurstPipeline.exec();

    // --- Signal 4: Failure/Error History Check ---
    const errorKey = `abuse:errors:${ip}`;
    const errorCount = parseInt((await this.redis.get(errorKey)) || '0', 10);
    if (errorCount >= config.abuseDetection.errorThreshold) {
      const errPoints = Math.min(30, errorCount * 5);
      score += errPoints;
      flags.push({
        type: 'HIGH_ERROR_RATIO',
        detail: `Accumulated ${errorCount} recent 4xx/5xx security/auth failures`,
        weight: errPoints,
      });
    }

    // Cap score at 100
    score = Math.min(100, Math.max(0, score));

    // Determine Risk Tier
    let tier = 'normal';
    let action = 'allow';
    let primaryReason = 'Traffic within normal behavioral parameters';

    if (score >= config.abuseDetection.riskThresholds.banned) {
      tier = 'banned';
      action = 'block';
      primaryReason = flags.map((f) => f.type).join(' + ') || 'Severe abuse detected';
      // Automatically quarantine IP in Redis Blacklist
      await this.blacklist.banIP(ip, {
        reason: primaryReason,
        score,
        durationSec: config.abuseDetection.autoBlockDurationSec,
      });
    } else if (score >= config.abuseDetection.riskThresholds.throttled) {
      tier = 'throttled';
      action = 'throttle';
      primaryReason = flags.map((f) => f.type).join(' + ') || 'Throttled due to repeated abuse signals';
    } else if (score >= config.abuseDetection.riskThresholds.suspicious) {
      tier = 'suspicious';
      action = 'allow'; // Allowed but with stricter rate limit multiplier applied
      primaryReason = 'Flagged as suspicious; restrictive limits applied';
    }

    // Persist updated profile
    const savePipeline = this.redis.pipeline();
    savePipeline.hmset(redisKey, {
      score: score.toString(),
      tier,
      lastSeen: now.toString(),
      flagsCount: flags.length.toString(),
    });
    savePipeline.expire(redisKey, 3600); // 1h profile retention
    await savePipeline.exec();

    return {
      score: Math.round(score),
      tier,
      action,
      reason: primaryReason,
      flags,
    };
  }

  /**
   * Called by middleware after request finishes to record 4xx/5xx failure patterns
   */
  async recordResponseStatus(ip, statusCode) {
    if (statusCode >= 400) {
      const errorKey = `abuse:errors:${ip}`;
      const pipeline = this.redis.pipeline();
      pipeline.incr(errorKey);
      pipeline.expire(errorKey, 60); // 1 minute rolling error window
      await pipeline.exec();
    }
  }
}

module.exports = AbuseDetector;
