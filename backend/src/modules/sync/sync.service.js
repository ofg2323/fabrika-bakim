class SyncService {
  constructor() {
    this.version = 1;
    this.lastChangeTimestamp = Date.now();
    this.clients = new Set();
  }

  notifyChange(details = {}) {
    this.version += 1;
    this.lastChangeTimestamp = Date.now();
    const data = JSON.stringify({
      type: 'change',
      version: this.version,
      timestamp: this.lastChangeTimestamp,
      details,
    });
    const message = `event: change\ndata: ${data}\n\n`;

    for (const client of this.clients) {
      try {
        client.write(message);
      } catch (err) {
        this.clients.delete(client);
      }
    }
  }

  addClient(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const initialData = JSON.stringify({
      type: 'init',
      version: this.version,
      timestamp: this.lastChangeTimestamp,
    });
    res.write(`event: init\ndata: ${initialData}\n\n`);

    this.clients.add(res);

    // Heartbeat: Bağlantının canlı kalmasını sağlamak ve proxy zaman aşımlarını önlemek için
    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch (err) {
        clearInterval(heartbeat);
        this.clients.delete(res);
      }
    }, 20000);

    req.on('close', () => {
      clearInterval(heartbeat);
      this.clients.delete(res);
    });
  }

  getStatus() {
    return {
      version: this.version,
      timestamp: this.lastChangeTimestamp,
      activeClients: this.clients.size,
    };
  }
}

const syncService = new SyncService();
module.exports = syncService;
