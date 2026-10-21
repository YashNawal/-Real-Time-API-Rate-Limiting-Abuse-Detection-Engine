// RateGuard PRO Dashboard Application
(function () {
  let ws = null;
  let autoScroll = true;
  let activeFilter = 'all';
  let sparkline = null;
  const maxRows = 200;

  // DOM Elements
  const elStreamContainer = document.getElementById('stream-container');
  const elStreamPlaceholder = document.getElementById('stream-placeholder');
  const elValTotal = document.getElementById('val-total');
  const elValAllowed = document.getElementById('val-allowed');
  const elValAllowedPct = document.getElementById('val-allowed-pct');
  const elValThrottled = document.getElementById('val-throttled');
  const elValBlocked = document.getElementById('val-blocked');
  const elValHoneypots = document.getElementById('val-honeypots');
  const elValRps = document.getElementById('val-rps');
  const elValPeakRps = document.getElementById('val-peak-rps');
  const elValBannedIps = document.getElementById('val-banned-ips');
  const elStorageStatus = document.getElementById('storage-status');
  const elActiveAlgoBadge = document.getElementById('active-algo-badge');
  const elBannedCountBadge = document.getElementById('banned-count-badge');
  const elBlacklistTbody = document.getElementById('blacklist-tbody');
  const elToastContainer = document.getElementById('toast-container');

  // Initialize Canvas Chart
  window.addEventListener('DOMContentLoaded', () => {
    sparkline = new window.RpsSparkline('rps-canvas');
    connectWebSocket();
    loadBlacklist();
    loadConfig();
    setupEventListeners();
  });

  // 1. WebSocket Connection with Auto-Reconnect
  function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[WS] Connected to telemetry bus');
      document.getElementById('engine-status').textContent = 'ONLINE';
      document.getElementById('engine-status').style.color = '#10b981';
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleWsMessage(msg);
      } catch (err) {
        console.error('[WS] Parse error:', err);
      }
    };

    ws.onclose = () => {
      document.getElementById('engine-status').textContent = 'OFFLINE';
      document.getElementById('engine-status').style.color = '#ef4444';
      setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = (err) => {
      console.warn('[WS] Error:', err);
    };
  }

  function handleWsMessage(msg) {
    switch (msg.type) {
      case 'INIT':
        updateStats(msg.data);
        if (msg.data.recentRequests && msg.data.recentRequests.length > 0) {
          msg.data.recentRequests.reverse().forEach(renderRequestRow);
        }
        break;

      case 'STATS_UPDATE':
        updateStats(msg.data);
        break;

      case 'NEW_REQUEST':
        renderRequestRow(msg.data);
        break;

      case 'SECURITY_ALERT':
        showToast(msg.data.title, `${msg.data.reason} (${msg.data.ip})`, msg.data.level || 'CRITICAL');
        loadBlacklist();
        break;

      case 'CONFIG_CHANGED':
        if (msg.data.activeAlgorithm) {
          elActiveAlgoBadge.textContent = msg.data.activeAlgorithm.toUpperCase();
        }
        break;
    }
  }

  // 2. Render Live Stream Row
  function renderRequestRow(req) {
    if (elStreamPlaceholder) {
      elStreamPlaceholder.style.display = 'none';
    }

    const row = document.createElement('div');
    row.className = `stream-row verdict-${req.verdict}`;
    row.dataset.verdict = req.verdict;

    if (activeFilter !== 'all' && req.verdict !== activeFilter) {
      row.style.display = 'none';
    }

    let scoreClass = 'score-low';
    if (req.abuseScore >= 75) scoreClass = 'score-high';
    else if (req.abuseScore >= 40) scoreClass = 'score-mid';

    let verdictClass = 'verdict-badge-allow';
    if (req.verdict === 'THROTTLE') verdictClass = 'verdict-badge-throttle';
    else if (req.verdict === 'BLOCK') verdictClass = 'verdict-badge-block';

    row.innerHTML = `
      <span class="row-time">${req.timeFormatted || formatTime(req.timestamp)}</span>
      <span class="row-ip" title="User-Agent: ${escapeHtml(req.userAgent || '')}">${req.ip}</span>
      <span class="row-method method-${req.method}">${req.method}</span>
      <span class="row-url" title="${escapeHtml(req.url)}">${escapeHtml(req.url)}</span>
      <span class="row-status status-${req.status}">${req.status}</span>
      <span class="row-score ${scoreClass}" title="${escapeHtml(req.reason || '')}">Risk: ${req.abuseScore}</span>
      <span class="row-verdict ${verdictClass}" title="${escapeHtml(req.reason || '')}">${req.verdict}</span>
    `;

    elStreamContainer.appendChild(row);

    // Limit DOM rows
    const rows = elStreamContainer.querySelectorAll('.stream-row');
    if (rows.length > maxRows) {
      rows[0].remove();
    }

    if (autoScroll) {
      elStreamContainer.scrollTop = elStreamContainer.scrollHeight;
    }
  }

  // 3. Update KPI Counters
  function updateStats(stats) {
    if (!stats) return;

    elValTotal.textContent = Number(stats.totalRequests || 0).toLocaleString();
    elValAllowed.textContent = Number(stats.totalAllowed || 0).toLocaleString();
    elValThrottled.textContent = Number(stats.totalThrottled || 0).toLocaleString();
    elValBlocked.textContent = Number(stats.totalBlocked || 0).toLocaleString();
    elValHoneypots.textContent = Number(stats.totalHoneypotHits || 0).toLocaleString();

    const allowedPct = stats.totalRequests > 0
      ? Math.round((stats.totalAllowed / stats.totalRequests) * 100)
      : 100;
    elValAllowedPct.textContent = `${allowedPct}%`;

    elValRps.textContent = `${stats.currentRps || 0} RPS`;
    elValPeakRps.textContent = stats.peakRps || 0;

    if (stats.rpsHistory && sparkline) {
      sparkline.update(stats.rpsHistory);
    }

    if (stats.redis) {
      elStorageStatus.textContent = stats.redis.isMock
        ? 'Engine: Embedded In-Memory'
        : 'Engine: Standalone Redis';
    }

    if (stats.activeAlgorithm) {
      elActiveAlgoBadge.textContent = stats.activeAlgorithm.toUpperCase();
    }
  }

  // 4. Load Blacklist Table
  async function loadBlacklist() {
    try {
      const res = await fetch('/api/admin/blacklist');
      const data = await res.json();
      if (!data.success) return;

      const banned = data.data || [];
      elValBannedIps.textContent = `${banned.length} Quarantined`;
      elBannedCountBadge.textContent = `${banned.length} Active`;

      if (banned.length === 0) {
        elBlacklistTbody.innerHTML = `
          <tr>
            <td colspan="5" class="empty-table-msg">No IPs currently quarantined. Normal operation.</td>
          </tr>
        `;
        return;
      }

      elBlacklistTbody.innerHTML = banned.map((item) => `
        <tr>
          <td><strong style="color: #ef4444; font-family: var(--font-mono);">${item.ip}</strong></td>
          <td style="color: #94a3b8;">${escapeHtml(item.reason)}</td>
          <td><span class="row-score score-high">Score ${item.score}</span></td>
          <td style="font-family: var(--font-mono); color: #f59e0b;">${item.ttlSeconds ? item.ttlSeconds + 's' : 'Permanent'}</td>
          <td>
            <button class="btn-unban" data-ip="${item.ip}">Unban</button>
          </td>
        </tr>
      `).join('');

      // Attach unban handlers
      document.querySelectorAll('.btn-unban').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const ip = btn.getAttribute('data-ip');
          await unbanIP(ip);
        });
      });
    } catch (err) {
      console.warn('Failed to load blacklist:', err);
    }
  }

  async function unbanIP(ip) {
    try {
      const res = await fetch(`/api/admin/blacklist/${encodeURIComponent(ip)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast('IP Released', `IP ${ip} was removed from the quarantine blacklist`, 'SUCCESS');
        loadBlacklist();
      }
    } catch (err) {
      showToast('Error', err.message, 'CRITICAL');
    }
  }

  // 5. Load and Apply Dynamic Config
  async function loadConfig() {
    try {
      const res = await fetch('/api/admin/config');
      const data = await res.json();
      if (data.success) {
        const rl = data.data.rateLimit;
        const abuse = data.data.abuseDetection;

        const algoRadio = document.querySelector(`input[name="algorithm"][value="${rl.algorithm}"]`);
        if (algoRadio) algoRadio.checked = true;

        document.getElementById('cfg-max-requests').value = rl.maxRequests || 20;
        document.getElementById('cfg-window-ms').value = rl.windowMs || 10000;
        document.getElementById('cfg-burst-threshold').value = abuse.burstThreshold || 8;
        document.getElementById('cfg-tarpit-delay').value = abuse.tarpitDelayMs || 1200;

        elActiveAlgoBadge.textContent = rl.algorithm.toUpperCase();
      }
    } catch (err) {
      console.warn('Config load error:', err);
    }
  }

  // 6. Setup UI Event Listeners
  function setupEventListeners() {
    // Attack Simulation Buttons
    document.getElementById('btn-sim-normal').addEventListener('click', () => triggerSimulation('normal'));
    document.getElementById('btn-sim-ddos').addEventListener('click', () => triggerSimulation('ddos'));
    document.getElementById('btn-sim-honeypot').addEventListener('click', () => triggerSimulation('honeypot'));
    document.getElementById('btn-sim-auth').addEventListener('click', () => triggerSimulation('credential_stuffing'));
    document.getElementById('btn-sim-burst').addEventListener('click', () => triggerSimulation('burst_spiker'));

    // Custom Request Fire
    document.getElementById('btn-fire-custom').addEventListener('click', async () => {
      const ip = document.getElementById('custom-ip').value.trim() || '198.51.100.99';
      const endpoint = document.getElementById('custom-endpoint').value;
      const method = endpoint === '/api/v1/login' ? 'POST' : 'GET';
      const body = method === 'POST' ? JSON.stringify({ username: 'hacker', password: 'bad' }) : undefined;

      try {
        await fetch(endpoint, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'X-Simulated-IP': ip,
          },
          body,
        });
      } catch (e) {
        console.error(e);
      }
    });

    // Reset Metrics
    document.getElementById('btn-reset-metrics').addEventListener('click', async () => {
      await fetch('/api/admin/metrics/reset', { method: 'POST' });
      elStreamContainer.innerHTML = '';
      if (elStreamPlaceholder) {
        elStreamPlaceholder.style.display = 'flex';
        elStreamContainer.appendChild(elStreamPlaceholder);
      }
      showToast('Telemetry Cleared', 'All throughput and abuse counters have been reset', 'SUCCESS');
      loadBlacklist();
    });

    // Stream Controls
    document.getElementById('btn-toggle-scroll').addEventListener('click', (e) => {
      autoScroll = !autoScroll;
      e.currentTarget.classList.toggle('active', autoScroll);
    });

    document.getElementById('btn-clear-stream').addEventListener('click', () => {
      elStreamContainer.innerHTML = '';
      if (elStreamPlaceholder) {
        elStreamPlaceholder.style.display = 'flex';
        elStreamContainer.appendChild(elStreamPlaceholder);
      }
    });

    // Stream Filter Buttons
    document.querySelectorAll('.filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilter = btn.getAttribute('data-filter');

        const rows = elStreamContainer.querySelectorAll('.stream-row');
        rows.forEach((row) => {
          if (activeFilter === 'all' || row.dataset.verdict === activeFilter) {
            row.style.display = 'grid';
          } else {
            row.style.display = 'none';
          }
        });
      });
    });

    // Config Form Submit
    document.getElementById('config-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const selectedAlgo = document.querySelector('input[name="algorithm"]:checked')?.value || 'sliding-window';
      const maxRequests = document.getElementById('cfg-max-requests').value;
      const windowMs = document.getElementById('cfg-window-ms').value;
      const burstThreshold = document.getElementById('cfg-burst-threshold').value;
      const tarpitDelayMs = document.getElementById('cfg-tarpit-delay').value;

      try {
        const res = await fetch('/api/admin/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            algorithm: selectedAlgo,
            maxRequests,
            windowMs,
            burstThreshold,
            tarpitDelayMs,
          }),
        });
        const data = await res.json();
        if (data.success) {
          showToast('Engine Policy Updated', `Active Algorithm: ${selectedAlgo.toUpperCase()}`, 'SUCCESS');
          elActiveAlgoBadge.textContent = selectedAlgo.toUpperCase();
        }
      } catch (err) {
        showToast('Update Failed', err.message, 'CRITICAL');
      }
    });

    // Copy Code Snippet
    document.getElementById('btn-copy-code').addEventListener('click', () => {
      const code = document.querySelector('.code-block code').innerText;
      navigator.clipboard.writeText(code).then(() => {
        showToast('Copied', 'Integration middleware snippet copied to clipboard', 'SUCCESS');
      });
    });
  }

  // 7. Trigger Simulation on Backend
  async function triggerSimulation(scenario) {
    try {
      showToast('Launching Simulator', `Running scenario: ${scenario}...`, 'SUCCESS');
      const res = await fetch('/api/admin/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario }),
      });
      const data = await res.json();
      if (data.success) {
        loadBlacklist();
      }
    } catch (err) {
      showToast('Simulation Failed', err.message, 'CRITICAL');
    }
  }

  // 8. Toast Helper
  function showToast(title, message, level = 'SUCCESS') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${level}`;
    toast.innerHTML = `
      <div>
        <strong>${escapeHtml(title)}</strong>
        <div style="font-size: 0.72rem; color: #94a3b8;">${escapeHtml(message)}</div>
      </div>
    `;
    elToastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3800);
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
