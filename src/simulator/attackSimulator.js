const http = require('http');
const config = require('../config/config');

class AttackSimulator {
  constructor(port) {
    this.port = port || config.server.port;
  }

  setPort(port) {
    this.port = port;
  }

  async sendRequest(options) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const reqOptions = {
        hostname: '127.0.0.1',
        port: this.port,
        path: options.path || '/api/v1/products',
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
          'X-Simulated-IP': options.ip || '198.51.100.15',
          ...(options.headers || {}),
        },
      };

      const req = http.request(reqOptions, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            latencyMs: Date.now() - startTime,
            headers: res.headers,
            body: body ? (tryParse(body) || body) : null,
          });
        });
      });

      req.on('error', (err) => {
        resolve({
          statusCode: 500,
          latencyMs: Date.now() - startTime,
          error: err.message,
        });
      });

      if (options.body) {
        req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }

      req.end();
    });
  }

  async runScenario(type, customParams = {}) {
    switch (type) {
      case 'ddos':
        return await this.simulateDdosFlood(customParams);
      case 'honeypot':
        return await this.simulateScannerProbing(customParams);
      case 'credential_stuffing':
        return await this.simulateCredentialStuffing(customParams);
      case 'burst_spiker':
        return await this.simulateBurstSpike(customParams);
      case 'normal':
      default:
        return await this.simulateNormalTraffic(customParams);
    }
  }

  // 1. Legitimate user browsing session
  async simulateNormalTraffic(params = {}) {
    const total = params.count || 8;
    const ip = params.targetIp || `203.0.113.${Math.floor(Math.random() * 200) + 10}`;
    const paths = ['/api/v1/products', '/api/v1/products/prod_101', '/api/v1/profile', '/api/v1/search?q=router'];
    const results = [];

    for (let i = 0; i < total; i++) {
      const path = paths[i % paths.length];
      const res = await this.sendRequest({
        ip,
        path,
        method: 'GET',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      });
      results.push({ path, status: res.statusCode, latency: res.latencyMs });
      // Humane pause between clicks
      await delay(120);
    }

    return { type: 'normal', ip, requestsSent: total, results };
  }

  // 2. High-speed DDoS / Rate Limit Breaker
  async simulateDdosFlood(params = {}) {
    const total = params.count || 30;
    const ip = params.targetIp || `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
    const promises = [];

    // Send rapid burst concurrently
    for (let i = 0; i < total; i++) {
      promises.push(
        this.sendRequest({
          ip,
          path: '/api/v1/products',
          method: 'GET',
          userAgent: 'DDoS-Botnet/2.1 (Automated Flood Engine)',
        })
      );
    }

    const responses = await Promise.all(promises);
    const allowed = responses.filter((r) => r.statusCode === 200).length;
    const throttled = responses.filter((r) => r.statusCode === 429).length;
    const blocked = responses.filter((r) => r.statusCode === 403).length;

    return {
      type: 'ddos',
      ip,
      requestsSent: total,
      allowed,
      throttled,
      blocked,
    };
  }

  // 3. Vulnerability and Recon Scanner (Honeypot hit + Auto-Ban)
  async simulateScannerProbing(params = {}) {
    const ip = params.targetIp || `185.220.101.${Math.floor(Math.random() * 250) + 1}`;
    const scanPaths = ['/.env', '/wp-admin', '/phpmyadmin', '/actuator/env', '/.git'];
    const results = [];

    for (const path of scanPaths) {
      const res = await this.sendRequest({
        ip,
        path,
        method: 'GET',
        userAgent: 'nikto/2.1.6 (Security Scanner Recon)',
      });
      results.push({ path, status: res.statusCode, latency: res.latencyMs });
      await delay(80);
    }

    return {
      type: 'honeypot_scanner',
      ip,
      pathsTested: scanPaths,
      results,
    };
  }

  // 4. Credential Stuffing / Auth Brute Force
  async simulateCredentialStuffing(params = {}) {
    const total = params.count || 10;
    const ip = params.targetIp || `103.21.244.${Math.floor(Math.random() * 250) + 1}`;
    const results = [];

    for (let i = 0; i < total; i++) {
      const res = await this.sendRequest({
        ip,
        path: '/api/v1/login',
        method: 'POST',
        userAgent: 'Hydra/9.5 (Credential Attacker)',
        body: { username: `target_admin_${i}`, password: `password_${Math.random().toString(36).substring(2, 8)}` },
      });
      results.push({ attempt: i + 1, status: res.statusCode, latency: res.latencyMs });
      await delay(90);
    }

    return {
      type: 'credential_stuffing',
      ip,
      attempts: total,
      results,
    };
  }

  // 5. Burst Spiker
  async simulateBurstSpike(params = {}) {
    const ip = params.targetIp || `192.0.2.${Math.floor(Math.random() * 250) + 1}`;
    const total = params.count || 16;
    const promises = [];

    for (let i = 0; i < total; i++) {
      promises.push(
        this.sendRequest({
          ip,
          path: '/api/v1/search?q=edge',
          method: 'GET',
          userAgent: 'Python-urllib/3.10 (Batch Task)',
        })
      );
    }

    const responses = await Promise.all(promises);
    return {
      type: 'burst_spike',
      ip,
      total,
      successCount: responses.filter((r) => r.statusCode === 200).length,
      blockedCount: responses.filter((r) => r.statusCode >= 400).length,
    };
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryParse(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

module.exports = AttackSimulator;
