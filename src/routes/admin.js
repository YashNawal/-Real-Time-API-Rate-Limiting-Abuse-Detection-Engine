const express = require('express');
const router = express.Router();
const config = require('../config/config');
const metricsStore = require('../telemetry/metricsStore');
const wsHub = require('../telemetry/wsHub');
const { getStatus: getRedisStatus } = require('../services/redisClient');

function createAdminRouter(blacklistManager, attackSimulator) {
  // 1. Get Telemetry Snapshot
  router.get('/metrics', async (req, res) => {
    const snapshot = metricsStore.getSnapshot();
    const redisStatus = await getRedisStatus();
    res.json({
      success: true,
      data: {
        ...snapshot,
        redis: redisStatus,
        activeAlgorithm: config.rateLimit.algorithm,
      },
    });
  });

  // 2. Reset Telemetry Metrics
  router.post('/metrics/reset', (req, res) => {
    metricsStore.reset();
    res.json({ success: true, message: 'Telemetry metrics cleared' });
  });

  // 3. Get All Banned IPs
  router.get('/blacklist', async (req, res) => {
    try {
      const banned = await blacklistManager.getAllBannedIPs();
      res.json({ success: true, count: banned.length, data: banned });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. Manually Ban IP
  router.post('/blacklist', async (req, res) => {
    const { ip, reason, durationSec } = req.body || {};
    if (!ip) {
      return res.status(400).json({ success: false, error: 'IP is required' });
    }

    await blacklistManager.banIP(ip, {
      reason: reason || 'Manual Admin Quarantine',
      score: 100,
      durationSec: durationSec !== undefined ? parseInt(durationSec, 10) : 300,
    });

    wsHub.broadcastAlert({
      level: 'MANUAL',
      title: 'IP Manually Quarantined',
      ip,
      reason: reason || 'Manual Admin Quarantine',
      timestamp: Date.now(),
    });

    res.json({ success: true, message: `IP ${ip} quarantined successfully` });
  });

  // 5. Unban IP
  router.delete('/blacklist/:ip', async (req, res) => {
    const ip = req.params.ip;
    await blacklistManager.unbanIP(ip);
    res.json({ success: true, message: `IP ${ip} removed from blacklist` });
  });

  // 6. Get Current Engine Config
  router.get('/config', (req, res) => {
    res.json({
      success: true,
      data: {
        rateLimit: config.rateLimit,
        abuseDetection: {
          enabled: config.abuseDetection.enabled,
          burstWindowMs: config.abuseDetection.burstWindowMs,
          burstThreshold: config.abuseDetection.burstThreshold,
          errorThreshold: config.abuseDetection.errorThreshold,
          tarpitDelayMs: config.abuseDetection.tarpitDelayMs,
          autoBlockDurationSec: config.abuseDetection.autoBlockDurationSec,
          riskThresholds: config.abuseDetection.riskThresholds,
        },
      },
    });
  });

  // 7. Update Dynamic Engine Config
  router.post('/config', (req, res) => {
    const {
      algorithm,
      windowMs,
      maxRequests,
      capacity,
      refillRate,
      burstThreshold,
      tarpitDelayMs,
      autoBlockDurationSec,
    } = req.body || {};

    if (algorithm && ['sliding-window', 'token-bucket', 'fixed-window', 'leaky-bucket'].includes(algorithm)) {
      config.rateLimit.algorithm = algorithm;
    }

    if (windowMs && !isNaN(windowMs)) {
      config.rateLimit.windowMs = parseInt(windowMs, 10);
    }

    if (maxRequests && !isNaN(maxRequests)) {
      config.rateLimit.maxRequests = parseInt(maxRequests, 10);
    }

    if (capacity && !isNaN(capacity)) {
      config.rateLimit.tokenBucket.capacity = parseInt(capacity, 10);
      config.rateLimit.leakyBucket.capacity = parseInt(capacity, 10);
    }

    if (refillRate && !isNaN(refillRate)) {
      config.rateLimit.tokenBucket.refillRate = parseFloat(refillRate);
    }

    if (burstThreshold && !isNaN(burstThreshold)) {
      config.abuseDetection.burstThreshold = parseInt(burstThreshold, 10);
    }

    if (tarpitDelayMs && !isNaN(tarpitDelayMs)) {
      config.abuseDetection.tarpitDelayMs = parseInt(tarpitDelayMs, 10);
    }

    if (autoBlockDurationSec && !isNaN(autoBlockDurationSec)) {
      config.abuseDetection.autoBlockDurationSec = parseInt(autoBlockDurationSec, 10);
    }

    wsHub.broadcast({
      type: 'CONFIG_CHANGED',
      data: {
        activeAlgorithm: config.rateLimit.algorithm,
        maxRequests: config.rateLimit.maxRequests,
        windowMs: config.rateLimit.windowMs,
      },
    });

    res.json({
      success: true,
      message: 'Configuration updated dynamically',
      currentConfig: {
        rateLimit: config.rateLimit,
        abuseDetection: config.abuseDetection,
      },
    });
  });

  // 8. Trigger Simulated Attack Scenario
  router.post('/simulate', async (req, res) => {
    const { scenario, count, targetIp } = req.body || {};
    if (!attackSimulator) {
      return res.status(500).json({ success: false, error: 'Simulator not initialized' });
    }

    try {
      const summary = await attackSimulator.runScenario(scenario || 'normal', {
        count: count ? parseInt(count, 10) : undefined,
        targetIp,
      });
      res.json({ success: true, scenario, summary });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = { createAdminRouter };
