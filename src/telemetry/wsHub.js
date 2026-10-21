const { WebSocketServer } = require('ws');
const metricsStore = require('./metricsStore');

class WsHub {
  constructor() {
    this.wss = null;
    this.clients = new Set();
    this.broadcastInterval = null;
  }

  init(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      this.clients.add(ws);

      // Send initial state snapshot on connect
      const initialSnapshot = metricsStore.getSnapshot();
      ws.send(JSON.stringify({
        type: 'INIT',
        data: initialSnapshot,
      }));

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', () => {
        this.clients.delete(ws);
      });
    });

    // Start periodic 1-second telemetry broadcast to keep dashboard alive
    this.broadcastInterval = setInterval(() => {
      if (this.clients.size > 0) {
        const snapshot = metricsStore.getSnapshot();
        this.broadcast({
          type: 'STATS_UPDATE',
          data: snapshot,
        });
      }
    }, 1000);
  }

  broadcast(message) {
    if (!this.clients || this.clients.size === 0) return;
    const payload = typeof message === 'string' ? message : JSON.stringify(message);

    for (const client of this.clients) {
      if (client.readyState === 1) { // OPEN
        try {
          client.send(payload);
        } catch (e) {
          this.clients.delete(client);
        }
      }
    }
  }

  broadcastRequest(requestEntry) {
    this.broadcast({
      type: 'NEW_REQUEST',
      data: requestEntry,
    });
  }

  broadcastAlert(alert) {
    this.broadcast({
      type: 'SECURITY_ALERT',
      data: alert,
    });
  }
}

const wsHub = new WsHub();
module.exports = wsHub;
