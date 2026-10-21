class MetricsStore {
  constructor() {
    this.totalRequests = 0;
    this.totalAllowed = 0;
    this.totalThrottled = 0;
    this.totalBlocked = 0;
    this.totalHoneypotHits = 0;
    this.startTime = Date.now();
    this.recentRequests = []; // Circular buffer of last 150 requests
    this.maxRecent = 150;

    // Per-second rolling RPS calculation
    this.currentSecondCount = 0;
    this.currentRps = 0;
    this.peakRps = 0;
    this.rpsHistory = []; // Last 30 seconds of RPS points
    this.maxRpsHistory = 30;

    // IP statistics map: ip -> { count, allowed, blocked, score, lastSeen }
    this.ipStats = new Map();

    // Start 1-second interval to compute RPS and slide time series
    this.tickInterval = setInterval(() => this.tick(), 1000);
  }

  tick() {
    this.currentRps = this.currentSecondCount;
    if (this.currentRps > this.peakRps) {
      this.peakRps = this.currentRps;
    }

    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    this.rpsHistory.push({
      time: timestamp,
      rps: this.currentRps,
    });

    if (this.rpsHistory.length > this.maxRpsHistory) {
      this.rpsHistory.shift();
    }

    this.currentSecondCount = 0;
  }

  recordRequest(data) {
    this.totalRequests++;
    this.currentSecondCount++;

    if (data.verdict === 'ALLOW') {
      this.totalAllowed++;
    } else if (data.verdict === 'THROTTLE') {
      this.totalThrottled++;
    } else if (data.verdict === 'BLOCK') {
      this.totalBlocked++;
    }

    if (data.isHoneypot) {
      this.totalHoneypotHits++;
    }

    // Add to circular recent requests buffer
    const entry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
      timeFormatted: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      ip: data.ip,
      method: data.method,
      url: data.url,
      status: data.status,
      verdict: data.verdict,
      reason: data.reason,
      abuseScore: data.abuseScore,
      riskTier: data.riskTier,
      algorithm: data.algorithm,
      remaining: data.remaining,
      limit: data.limit,
      latencyMs: data.latencyMs,
      userAgent: data.userAgent,
    };

    this.recentRequests.unshift(entry);
    if (this.recentRequests.length > this.maxRecent) {
      this.recentRequests.pop();
    }

    // Update IP stats
    const ipStat = this.ipStats.get(data.ip) || {
      ip: data.ip,
      count: 0,
      allowed: 0,
      blocked: 0,
      throttled: 0,
      lastScore: data.abuseScore,
      lastTier: data.riskTier,
      lastSeen: Date.now(),
    };

    ipStat.count++;
    if (data.verdict === 'ALLOW') ipStat.allowed++;
    if (data.verdict === 'BLOCK') ipStat.blocked++;
    if (data.verdict === 'THROTTLE') ipStat.throttled++;
    ipStat.lastScore = data.abuseScore;
    ipStat.lastTier = data.riskTier;
    ipStat.lastSeen = Date.now();

    this.ipStats.set(data.ip, ipStat);

    return entry;
  }

  getSnapshot() {
    const uptimeSec = Math.floor((Date.now() - this.startTime) / 1000);
    const topIPs = Array.from(this.ipStats.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    return {
      totalRequests: this.totalRequests,
      totalAllowed: this.totalAllowed,
      totalThrottled: this.totalThrottled,
      totalBlocked: this.totalBlocked,
      totalHoneypotHits: this.totalHoneypotHits,
      currentRps: this.currentRps,
      peakRps: this.peakRps,
      uptimeSec,
      recentRequests: this.recentRequests.slice(0, 50),
      rpsHistory: this.rpsHistory,
      topIPs,
    };
  }

  reset() {
    this.totalRequests = 0;
    this.totalAllowed = 0;
    this.totalThrottled = 0;
    this.totalBlocked = 0;
    this.totalHoneypotHits = 0;
    this.recentRequests = [];
    this.ipStats.clear();
    this.rpsHistory = [];
    this.peakRps = 0;
    this.currentRps = 0;
    this.currentSecondCount = 0;
  }
}

const metricsStore = new MetricsStore();
module.exports = metricsStore;
