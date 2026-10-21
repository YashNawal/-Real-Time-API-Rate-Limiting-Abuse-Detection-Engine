const config = require('../config/config');
const metricsStore = require('../telemetry/metricsStore');
const wsHub = require('../telemetry/wsHub');

function createTrafficGuard(rateLimiter, abuseDetector, blacklistManager) {
  return async function trafficGuard(req, res, next) {
    const startTime = Date.now();

    // Support X-Simulated-IP header for the Attack Simulator so developers can simulate multiple clients
    const rawIp = req.headers['x-simulated-ip'] ||
                  req.headers['x-forwarded-for']?.split(',')[0].trim() ||
                  req.socket?.remoteAddress ||
                  '127.0.0.1';

    // Normalize IPv6 localhost
    const ip = rawIp === '::1' || rawIp === '::ffff:127.0.0.1' ? '127.0.0.1' : rawIp;
    const url = req.originalUrl || req.url;
    const method = req.method;
    const userAgent = req.headers['user-agent'] || 'Unknown';

    // Skip rate limiting for static dashboard assets and admin API
    if (
      url.startsWith('/css/') ||
      url.startsWith('/js/') ||
      url.startsWith('/favicon.ico') ||
      url.startsWith('/api/admin/') ||
      url === '/' ||
      url === '/index.html'
    ) {
      return next();
    }

    // Step 1: Check Blacklist (Quarantine)
    const banInfo = await blacklistManager.isBanned(ip);
    if (banInfo) {
      res.setHeader('X-IP-Status', 'Banned');
      res.setHeader('X-Abuse-Risk-Score', '100');
      res.setHeader('X-Abuse-Risk-Tier', 'banned');

      const entry = metricsStore.recordRequest({
        ip,
        method,
        url,
        status: 403,
        verdict: 'BLOCK',
        reason: `IP Quarantined: ${banInfo.reason} (TTL: ${banInfo.ttlSeconds || 'Permanent'}s)`,
        abuseScore: 100,
        riskTier: 'banned',
        algorithm: 'Blacklist Enforcement',
        remaining: 0,
        limit: 0,
        latencyMs: Date.now() - startTime,
        userAgent,
      });

      wsHub.broadcastRequest(entry);

      return res.status(403).json({
        error: 'Forbidden: IP address is quarantined due to malicious activity',
        ip,
        reason: banInfo.reason,
        ttlSecondsRemaining: banInfo.ttlSeconds,
        timestamp: new Date().toISOString(),
      });
    }

    // Step 2: Run Real-Time Abuse Detection
    const abuseResult = await abuseDetector.evaluateRequest(req, ip);

    // If abuse score triggered an automatic block
    if (abuseResult.action === 'block') {
      res.setHeader('X-Abuse-Risk-Score', abuseResult.score.toString());
      res.setHeader('X-Abuse-Risk-Tier', abuseResult.tier);

      const entry = metricsStore.recordRequest({
        ip,
        method,
        url,
        status: 403,
        verdict: 'BLOCK',
        reason: `Auto-Banned: ${abuseResult.reason}`,
        abuseScore: abuseResult.score,
        riskTier: abuseResult.tier,
        algorithm: 'Abuse Detector Auto-Ban',
        remaining: 0,
        limit: 0,
        latencyMs: Date.now() - startTime,
        userAgent,
        isHoneypot: abuseResult.flags.some((f) => f.type === 'HONEYPOT_HIT'),
      });

      wsHub.broadcastRequest(entry);
      wsHub.broadcastAlert({
        level: 'CRITICAL',
        title: 'IP Auto-Banned by Abuse Engine',
        ip,
        score: abuseResult.score,
        reason: abuseResult.reason,
        timestamp: Date.now(),
      });

      return res.status(403).json({
        error: 'Forbidden: Abusive activity detected and IP automatically blacklisted',
        reason: abuseResult.reason,
        riskScore: abuseResult.score,
        riskTier: abuseResult.tier,
        quarantineDurationSec: config.abuseDetection.autoBlockDurationSec,
      });
    }

    // Step 3: Rate Limiting with Adaptive Thresholds
    // If client is marked "suspicious", halve their rate limit budget
    const isSuspicious = abuseResult.tier === 'suspicious';
    const rateLimitOptions = {
      maxRequests: isSuspicious
        ? Math.max(3, Math.floor(config.rateLimit.maxRequests / 2))
        : config.rateLimit.maxRequests,
      capacity: isSuspicious
        ? Math.max(3, Math.floor(config.rateLimit.tokenBucket.capacity / 2))
        : config.rateLimit.tokenBucket.capacity,
    };

    const rlResult = await rateLimiter.checkLimit(ip, rateLimitOptions);

    // Attach standard rate limit headers
    res.setHeader('X-RateLimit-Limit', rlResult.limit);
    res.setHeader('X-RateLimit-Remaining', rlResult.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(Date.now() / 1000 + rlResult.resetMs / 1000));
    res.setHeader('X-RateLimit-Algorithm', rlResult.algorithm);
    res.setHeader('X-Abuse-Risk-Score', abuseResult.score.toString());
    res.setHeader('X-Abuse-Risk-Tier', abuseResult.tier);

    // Step 4: Handle Rate Limit Exceeded (429)
    if (!rlResult.allowed) {
      res.setHeader('Retry-After', rlResult.retryAfterSec);

      const entry = metricsStore.recordRequest({
        ip,
        method,
        url,
        status: 429,
        verdict: 'BLOCK',
        reason: `Rate Limit Exceeded (${rlResult.algorithm}): limit of ${rlResult.limit} requests hit`,
        abuseScore: abuseResult.score,
        riskTier: abuseResult.tier,
        algorithm: rlResult.algorithm,
        remaining: 0,
        limit: rlResult.limit,
        latencyMs: Date.now() - startTime,
        userAgent,
      });

      wsHub.broadcastRequest(entry);
      abuseDetector.recordResponseStatus(ip, 429);

      return res.status(429).json({
        error: 'Too Many Requests: Rate limit exceeded',
        algorithm: rlResult.algorithm,
        limit: rlResult.limit,
        retryAfterSeconds: rlResult.retryAfterSec,
        resetInMs: rlResult.resetMs,
      });
    }

    // Step 5: Tarpitting / Throttling for Abusive Clients
    let verdict = 'ALLOW';
    let verdictReason = 'Request allowed within acceptable parameters';

    if (abuseResult.action === 'throttle') {
      verdict = 'THROTTLE';
      verdictReason = `Throttled (Tarpitted ${config.abuseDetection.tarpitDelayMs}ms): ${abuseResult.reason}`;
      res.setHeader('X-Traffic-Throttled', 'true');
      res.setHeader('X-Tarpit-Delay-Ms', config.abuseDetection.tarpitDelayMs.toString());

      // Artificially delay response to deplete attacker resource and slow down automated attacks
      await new Promise((resolve) => setTimeout(resolve, config.abuseDetection.tarpitDelayMs));
    }

    // Step 6: Telemetry Recording on Finish
    res.on('finish', () => {
      const latencyMs = Date.now() - startTime;
      abuseDetector.recordResponseStatus(ip, res.statusCode);

      const entry = metricsStore.recordRequest({
        ip,
        method,
        url,
        status: res.statusCode,
        verdict,
        reason: verdictReason,
        abuseScore: abuseResult.score,
        riskTier: abuseResult.tier,
        algorithm: rlResult.algorithm,
        remaining: rlResult.remaining,
        limit: rlResult.limit,
        latencyMs,
        userAgent,
        isHoneypot: abuseResult.flags.some((f) => f.type === 'HONEYPOT_HIT'),
      });

      wsHub.broadcastRequest(entry);
    });

    next();
  };
}

module.exports = { createTrafficGuard };
