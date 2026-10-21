require('dotenv').config();

const config = {
  server: {
    port: parseInt(process.env.PORT, 10) || 4000,
    host: process.env.HOST || '0.0.0.0',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
    connectTimeout: 2000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null, // don't hang endlessly if Redis is offline
  },
  rateLimit: {
    algorithm: process.env.DEFAULT_ALGORITHM || 'sliding-window', // 'sliding-window' | 'token-bucket' | 'fixed-window' | 'leaky-bucket'
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 10000, // 10s default
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 20, // 20 requests per window
    tokenBucket: {
      capacity: parseInt(process.env.TOKEN_BUCKET_CAPACITY, 10) || 20,
      refillRate: parseFloat(process.env.TOKEN_BUCKET_REFILL_RATE) || 2, // tokens per second
    },
    leakyBucket: {
      capacity: 20,
      leakRateMs: 500, // leaks 1 request every 500ms
    },
  },
  abuseDetection: {
    enabled: true,
    burstWindowMs: parseInt(process.env.ABUSE_BURST_WINDOW_MS, 10) || 2000, // 2s
    burstThreshold: parseInt(process.env.ABUSE_BURST_THRESHOLD, 10) || 8, // >8 reqs in 2s
    errorThreshold: parseInt(process.env.ABUSE_ERROR_THRESHOLD, 10) || 5, // >5 4xx errors
    tarpitDelayMs: parseInt(process.env.TARPIT_DELAY_MS, 10) || 1200, // slow down response
    autoBlockDurationSec: parseInt(process.env.ABUSE_BLOCK_DURATION_SEC, 10) || 180, // 3 mins
    // Risk score thresholds (0-100)
    riskThresholds: {
      normal: 39,     // 0-39: Allow
      suspicious: 74, // 40-74: Stricter rate limiting (halved)
      throttled: 89,  // 75-89: Tarpit + Throttle
      banned: 90,     // 90-100: Auto-ban IP
    },
    // Honeypot endpoints frequently probed by automated vulnerability scanners
    honeypotPaths: [
      '/.env',
      '/.git',
      '/wp-admin',
      '/wp-login.php',
      '/phpmyadmin',
      '/actuator/env',
      '/actuator/health',
      '/server-status',
      '/shell',
      '/admin.php',
      '/.aws/credentials',
      '/config.json',
      '/id_rsa',
    ],
    // Known scanner / crawler / scraper user agents
    suspiciousUserAgents: [
      'sqlmap',
      'nikto',
      'masscan',
      'nmap',
      'zgrab',
      'dirbuster',
      'wpscan',
      'gobuster',
    ],
  },
};

module.exports = config;
