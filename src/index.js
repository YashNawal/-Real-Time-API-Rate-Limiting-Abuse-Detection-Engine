const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');

const config = require('./config/config');
const { initRedis, getStatus: getRedisStatus } = require('./services/redisClient');
const RateLimiter = require('./engine/rateLimiter');
const BlacklistManager = require('./engine/blacklistManager');
const AbuseDetector = require('./engine/abuseDetector');
const { createTrafficGuard } = require('./middleware/trafficGuard');
const wsHub = require('./telemetry/wsHub');
const apiRouter = require('./routes/api');
const { createAdminRouter } = require('./routes/admin');
const AttackSimulator = require('./simulator/attackSimulator');

async function bootstrap() {
  const app = express();
  const server = http.createServer(app);

  // Initialize Dual-Mode Storage (Redis with In-Memory fallback)
  const redis = await initRedis();

  // Initialize Core Engines
  const rateLimiter = new RateLimiter(redis);
  const blacklistManager = new BlacklistManager(redis);
  const abuseDetector = new AbuseDetector(redis, blacklistManager);
  const attackSimulator = new AttackSimulator(config.server.port);

  // Initialize Real-Time WebSocket Hub
  wsHub.init(server);

  // Standard middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Serve static dashboard UI
  app.use(express.static(path.join(__dirname, '../public')));

  // Attach Traffic Guard Middleware (Rate Limiter + Abuse Detection)
  const trafficGuardMiddleware = createTrafficGuard(rateLimiter, abuseDetector, blacklistManager);
  app.use(trafficGuardMiddleware);

  // Mount API Endpoints
  app.use('/api/v1', apiRouter);
  app.use('/api/admin', createAdminRouter(blacklistManager, attackSimulator));

  // Catch-all for Root-level Honeypot Scans (e.g., /.env, /.git at root)
  app.all(['/.env', '/.git', '/wp-admin', '/wp-login.php', '/phpmyadmin', '/actuator', '/shell'], (req, res) => {
    res.status(404).json({
      error: 'Not Found',
      warning: 'Access logged and flagged by Real-Time Abuse Detection Engine',
    });
  });

  // Health check
  app.get('/health', async (req, res) => {
    const redisStatus = await getRedisStatus();
    res.json({
      status: 'healthy',
      uptimeSec: Math.floor(process.uptime()),
      redis: redisStatus,
      algorithm: config.rateLimit.algorithm,
    });
  });

  // Start Server
  const PORT = config.server.port;
  server.listen(PORT, config.server.host, () => {
    console.log(`
====================================================================
  🛡️ REAL-TIME API RATE LIMITING & ABUSE DETECTION ENGINE
====================================================================
  🚀 Server Running:    http://localhost:${PORT}
  📊 Live Dashboard:    http://localhost:${PORT}
  ⚡ Active Algorithm:  ${config.rateLimit.algorithm.toUpperCase()}
  📡 WebSocket Stream:  ws://localhost:${PORT}/ws
  🔒 Storage Engine:    ${redis.isMock ? 'High-Speed In-Memory Redis' : 'Production Redis'}
====================================================================
`);
  });

  return { server, app, rateLimiter, abuseDetector, blacklistManager, attackSimulator };
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error('Fatal bootstrap error:', err);
    process.exit(1);
  });
}

module.exports = { bootstrap };
