# 🛡️ Real-Time API Rate Limiting & Abuse Detection Engine (RateGuard PRO)

A high-throughput, production-grade security engine that inspects incoming API traffic, enforces rate limiting across 4 algorithms (Sliding Window Log, Token Bucket, Leaky Bucket, and Fixed Window), computes real-time behavioral abuse scores (0–100), and automatically throttles or quarantines abusive IP addresses.

Includes an interactive **Real-Time Visual Command Center Dashboard** with live telemetry, velocity sparklines, an **Attack Launchpad / Traffic Simulator**, and a Redis-backed quarantine table.

---

## 🎯 What This Project Means & Why It's Built

In modern production systems, deploying an API without rate limiting and abuse detection leaves your service vulnerable to:
1. **DDoS and Resource Exhaustion**: Millions of rapid requests taking down databases or microservices.
2. **Credential Stuffing & Brute Force Attacks**: Automated bots attempting thousands of login requests per second.
3. **Vulnerability Reconnaissance Scanners**: Automated scripts scanning for sensitive files (`/.env`, `/wp-admin`, `/.git`, `/phpmyadmin`).
4. **Data Scraping & Cost Bleed**: Aggressive scrapers consuming expensive CPU and cloud egress bandwidth.

Most developers only use simple fixed counters (e.g. "100 requests per 15 minutes"), which suffer from **boundary burst attacks** (200 requests within 2 seconds across a window border).

**RateGuard PRO solves this by providing:**
- **Mathematical Rate Limiting Accuracy**: True Redis Sorted Set (ZSET) Sliding Window and Token Bucket models.
- **Behavioral Multi-Signal Abuse Detection**: Evaluates micro-window velocity bursts, honeypot traps, repeated 4xx failure ratios, and scanner signatures.
- **Graduated Enforcement Action**:
  - `0 - 39 (Normal)`: Allowed.
  - `40 - 74 (Suspicious)`: Allowed, but rate limit quota is dynamically cut in half.
  - `75 - 89 (Abusive)`: **Tarpitted** (artificially delayed by 1200ms) to starve bot compute and exhaust attacker sockets.
  - `90 - 100 (Critical)`: **Auto-Quarantine** (IP blacklisted in Redis with automated expiration countdown).
- **Dual-Mode Storage**: Runs with real production Redis when available, or automatically falls back with zero configuration to an embedded high-speed in-memory engine.

---

## 🏗️ Architecture & Component Flow

```
Incoming Request
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│                   TrafficGuard Middleware                   │
│                                                             │
│  1. Check Blacklist/Quarantine ───► [Banned?] ──► 403 Ban   │
│  2. Abuse Scoring Engine                                    │
│     ├─ Honeypot Detection (/.env, /wp-admin)                │
│     ├─ Micro-burst Velocity (>8 reqs / 2s)                  │
│     ├─ 4xx Error Ratio Accumulation                         │
│     └─ Scanner User-Agent Signatures                        │
│  3. Adaptive Rate Limiter                                   │
│     ├─ Sliding Window Log (Redis ZSET)                      │
│     ├─ Token Bucket (Capacity + Refill)                     │
│     ├─ Fixed Window Counter                                 │
│     └─ Leaky Bucket                                         │
│  4. Action Dispatch:                                        │
│     ├─ ALLOW (Standard headers injected)                    │
│     ├─ THROTTLE (Tarpit delay added to penalize bots)       │
│     └─ BLOCK (429 Rate Limit or 403 Auto-Quarantine)        │
└──────────────────────────────┬──────────────────────────────┘
                               │
                WebSocket Live Stream & Telemetry
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             RateGuard PRO Visual Dashboard (Port 4000)      │
│  - Live Real-Time Request Stream Terminal                   │
│  - Rolling 30-Second RPS Velocity Sparkline                 │
│  - 1-Click Interactive Attack Simulator                     │
│  - Live Quarantine Table with Instant Unban                 │
│  - Dynamic Algorithm & Sensitivity Policy Tuner             │
└─────────────────────────────────────────────────────────────┘
```

---

## ⚡ Algorithms Compared

| Algorithm | Redis Data Structure | Boundary Burst Resistant? | Burst Allowance? | Best For |
|---|---|---|---|---|
| **Sliding Window Log** | Sorted Set (`ZSET`) |  Yes (100% accurate) | Exact limit | Mission-critical security, financial APIs |
| **Token Bucket** | Hash (`HMSET`) |  Yes |  Configurable capacity | Stripe, AWS, bursty APIs |
| **Leaky Bucket** | Hash (`HMSET`) |  Yes | Constant outflow | Protecting fragile downstream databases |
| **Fixed Window** | String Counter (`INCR`) |  No (Vulnerable at window edge) | No | High-throughput, low-memory caches |

---

## 🚀 Getting Started

### 1. Start the Server
```bash
npm start
```
Or with auto-restart on changes:
```bash
npm run dev
```

### 2. Open the Live Dashboard
Navigate to:
```
http://localhost:4000
```

### 3. Test Attack Scenarios in 1 Click
On the dashboard launchpad:
- 🟢 **Legitimate User Flow**: Simulates 8 standard human requests.
- 💥 **DDoS Rate Limit Breaker**: Fires 30 concurrent requests to test the 429 barrier.
- 🕵️ **Vulnerability Scanner**: Probes `/.env` and `/wp-admin` to trigger instant honeypot detection and auto-quarantine.
- 🔐 **Credential Brute-Forcer**: Fires failed login attempts to trigger 401 failure ratio penalties and tarpitting.
- ⚡ **Token Bucket Burst Spiker**: Tests bucket depletion and continuous token refill.

---

## 📦 How to Use in Your Own Express Apps

```javascript
const express = require('express');
const { createTrafficGuard } = require('./src/middleware/trafficGuard');
const RateLimiter = require('./src/engine/rateLimiter');
const AbuseDetector = require('./src/engine/abuseDetector');
const BlacklistManager = require('./src/engine/blacklistManager');
const { initRedis } = require('./src/services/redisClient');

async function start() {
  const app = express();
  const redis = await initRedis();

  const rateLimiter = new RateLimiter(redis);
  const blacklist = new BlacklistManager(redis);
  const abuseDetector = new AbuseDetector(redis, blacklist);

  // Mount protection middleware across all routes
  app.use(createTrafficGuard(rateLimiter, abuseDetector, blacklist));

  app.get('/api/users', (req, res) => {
    res.json({ message: 'Protected resource' });
  });

  app.listen(3000);
}
start();
```

---

## 🛡️ Response Headers Injected
Standard RFC 6585 / IETF Headers:
- `X-RateLimit-Limit`: Maximum requests permitted in window.
- `X-RateLimit-Remaining`: Remaining request quota.
- `X-RateLimit-Reset`: Unix timestamp when quota resets.
- `X-RateLimit-Algorithm`: Active enforcement algorithm (`Sliding Window Log`, `Token Bucket`, etc.).
- `X-Abuse-Risk-Score`: Real-time computed risk score (0 to 100).
- `X-Abuse-Risk-Tier`: `normal` | `suspicious` | `throttled` | `banned`.
- `Retry-After`: Seconds to wait before retrying (when 429).
