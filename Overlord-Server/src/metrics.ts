import os from "node:os";

export interface MetricsSnapshot {
  timestamp: number;
  clients: {
    total: number;
    online: number;
    offline: number;
    byOS: Record<string, number>;
    byCountry: Record<string, number>;
  };
  connections: {
    totalConnections: number;
    totalDisconnections: number;
    activeConnections: number;
  };
  commands: {
    total: number;
    lastMinute: number;
    lastHour: number;
    byType: Record<string, number>;
  };
  sessions: {
    console: number;
    remoteDesktop: number;
    fileBrowser: number;
    process: number;
  };
  bandwidth: {
    sent: number;
    received: number;
    sentPerSecond: number;
    receivedPerSecond: number;
  };
  server: {
    uptime: number;
    startTime: number;
    memoryUsage: NodeJS.MemoryUsage;
    systemMemory: {
      total: number;
      free: number;
      used: number;
      usedPercent: number;
    };
    cpu: {
      cores: number;
      loadAvg: [number, number, number];
    };
  };
  ping: {
    min: number | null;
    max: number | null;
    avg: number | null;
    count: number;
  };
  http: {
    total: number;
    lastMinute: number;
    lastMinuteErrors: number;
    latencyAvg: number;
    latencyP95: number;
  };
  eventLoop: {
    avg: number;
    max: number;
    p95: number;
  };
}

export interface MetricsHistory {
  timestamp: number;
  clientsOnline: number;
  commandsPerMinute: number;
  bandwidthSent: number;
  bandwidthReceived: number;
}

class MetricsCollector {
  private startTime: number = Date.now();

  private totalConnections: number = 0;
  private totalDisconnections: number = 0;

  private commandCount: number = 0;
  private commandTypeCount: Map<string, number> = new Map();
  private commandTimestamps: number[] = [];

  private bytesSent: number = 0;
  private bytesReceived: number = 0;
  private lastBandwidthCheck: number = Date.now();
  private lastBytesSent: number = 0;
  private lastBytesReceived: number = 0;
  private sentPerSecond: number = 0;
  private receivedPerSecond: number = 0;

  private history: MetricsHistory[] = [];
  private maxHistoryPoints: number = 60;

  private pingValues: number[] = [];
  private maxPingHistory: number = 1000;

  private httpTotal: number = 0;
  private httpTimestamps: number[] = [];
  private httpErrorTimestamps: number[] = [];
  private httpLatencies: number[] = [];
  private maxHttpLatencyHistory: number = 1000;

  private eventLoopDelays: number[] = [];
  private maxEventLoopHistory: number = 300;

  constructor() {
    setInterval(() => this.updateBandwidthRates(), 1000);

    setInterval(() => this.recordHistory(), 5000);

    this.trackEventLoopDelay();
  }

  recordConnection() {
    this.totalConnections++;
  }

  recordDisconnection() {
    this.totalDisconnections++;
  }

  recordCommand(type: string) {
    this.commandCount++;
    this.commandTimestamps.push(Date.now());

    const count = this.commandTypeCount.get(type) || 0;
    this.commandTypeCount.set(type, count + 1);

    const oneHourAgo = Date.now() - 3600000;
    this.commandTimestamps = this.commandTimestamps.filter(
      (ts) => ts > oneHourAgo,
    );
  }

  recordBytesSent(bytes: number) {
    this.bytesSent += bytes;
  }

  recordBytesReceived(bytes: number) {
    this.bytesReceived += bytes;
  }

  private updateBandwidthRates() {
    const now = Date.now();
    const elapsed = (now - this.lastBandwidthCheck) / 1000;

    if (elapsed > 0) {
      this.sentPerSecond = (this.bytesSent - this.lastBytesSent) / elapsed;
      this.receivedPerSecond =
        (this.bytesReceived - this.lastBytesReceived) / elapsed;

      this.lastBytesSent = this.bytesSent;
      this.lastBytesReceived = this.bytesReceived;
      this.lastBandwidthCheck = now;
    }
  }

  recordPing(pingMs: number) {
    this.pingValues.push(pingMs);

    if (this.pingValues.length > this.maxPingHistory) {
      this.pingValues.shift();
    }
  }

  private getPingStats() {
    if (this.pingValues.length === 0) {
      return { min: null, max: null, avg: null, count: 0 };
    }

    const min = Math.min(...this.pingValues);
    const max = Math.max(...this.pingValues);
    const sum = this.pingValues.reduce((a, b) => a + b, 0);
    const avg = sum / this.pingValues.length;

    return { min, max, avg, count: this.pingValues.length };
  }

  private recordHistory() {}

  private trackEventLoopDelay() {
    const intervalMs = 1000;
    let last = Date.now();
    setInterval(() => {
      const now = Date.now();
      const delay = Math.max(0, now - last - intervalMs);
      this.eventLoopDelays.push(delay);
      if (this.eventLoopDelays.length > this.maxEventLoopHistory) {
        this.eventLoopDelays.shift();
      }
      last = now;
    }, intervalMs);
  }

  recordHttpRequest(durationMs: number, statusCode: number) {
    this.httpTotal++;
    const now = Date.now();
    this.httpTimestamps.push(now);
    if (statusCode >= 400) {
      this.httpErrorTimestamps.push(now);
    }
    if (Number.isFinite(durationMs)) {
      this.httpLatencies.push(durationMs);
      if (this.httpLatencies.length > this.maxHttpLatencyHistory) {
        this.httpLatencies.shift();
      }
    }
  }

  async withHttpMetrics<T extends Response>(handler: () => Promise<T>): Promise<T> {
    const start = typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
    try {
      const response = await handler();
      const end = typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();
      this.recordHttpRequest(end - start, response?.status ?? 0);
      return response;
    } catch (err) {
      const end = typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();
      this.recordHttpRequest(end - start, 500);
      throw err;
    }
  }

  recordHistoryEntry(snapshot: MetricsSnapshot) {
    const historyEntry: MetricsHistory = {
      timestamp: snapshot.timestamp,
      clientsOnline: snapshot.clients.online,
      commandsPerMinute: snapshot.commands.lastMinute,
      bandwidthSent: this.sentPerSecond,
      bandwidthReceived: this.receivedPerSecond,
    };

    this.history.push(historyEntry);

    if (this.history.length > this.maxHistoryPoints) {
      this.history.shift();
    }
  }

  getSnapshot(): MetricsSnapshot {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const oneHourAgo = now - 3600000;

    const commandsLastMinute = this.commandTimestamps.filter(
      (ts) => ts > oneMinuteAgo,
    ).length;
    const commandsLastHour = this.commandTimestamps.filter(
      (ts) => ts > oneHourAgo,
    ).length;

    const commandsByType: Record<string, number> = {};
    for (const [type, count] of this.commandTypeCount.entries()) {
      commandsByType[type] = count;
    }

    const oneMinuteAgoForHttp = now - 60000;
    const httpLastMinute = this.httpTimestamps.filter(
      (ts) => ts > oneMinuteAgoForHttp,
    ).length;
    const httpErrorsLastMinute = this.httpErrorTimestamps.filter(
      (ts) => ts > oneMinuteAgoForHttp,
    ).length;

    const httpLatencySamples = [...this.httpLatencies].sort((a, b) => a - b);
    const httpLatencyAvg = httpLatencySamples.length
      ? httpLatencySamples.reduce((a, b) => a + b, 0) / httpLatencySamples.length
      : 0;
    const httpP95Index = httpLatencySamples.length
      ? Math.max(0, Math.floor(httpLatencySamples.length * 0.95) - 1)
      : 0;
    const httpLatencyP95 = httpLatencySamples.length
      ? httpLatencySamples[httpP95Index] ?? 0
      : 0;

    const eventLoopSamples = [...this.eventLoopDelays].sort((a, b) => a - b);
    const eventLoopAvg = eventLoopSamples.length
      ? eventLoopSamples.reduce((a, b) => a + b, 0) / eventLoopSamples.length
      : 0;
    const eventLoopMax = eventLoopSamples.length
      ? eventLoopSamples[eventLoopSamples.length - 1]
      : 0;
    const eventLoopP95Index = eventLoopSamples.length
      ? Math.max(0, Math.floor(eventLoopSamples.length * 0.95) - 1)
      : 0;
    const eventLoopP95 = eventLoopSamples.length
      ? eventLoopSamples[eventLoopP95Index] ?? 0
      : 0;

    const memoryUsage = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = Math.max(0, totalMem - freeMem);
    const usedPercent = totalMem > 0 ? (usedMem / totalMem) * 100 : 0;
    const loadAvg = os.loadavg();
    const loadTuple: [number, number, number] = [
      loadAvg[0] ?? 0,
      loadAvg[1] ?? 0,
      loadAvg[2] ?? 0,
    ];

    return {
      timestamp: now,
      clients: {
        total: 0,
        online: 0,
        offline: 0,
        byOS: {},
        byCountry: {},
      },
      connections: {
        totalConnections: this.totalConnections,
        totalDisconnections: this.totalDisconnections,
        activeConnections: this.totalConnections - this.totalDisconnections,
      },
      commands: {
        total: this.commandCount,
        lastMinute: commandsLastMinute,
        lastHour: commandsLastHour,
        byType: commandsByType,
      },
      sessions: {
        console: 0,
        remoteDesktop: 0,
        fileBrowser: 0,
        process: 0,
      },
      bandwidth: {
        sent: this.bytesSent,
        received: this.bytesReceived,
        sentPerSecond: this.sentPerSecond,
        receivedPerSecond: this.receivedPerSecond,
      },
      server: {
        uptime: now - this.startTime,
        startTime: this.startTime,
        memoryUsage,
        systemMemory: {
          total: totalMem,
          free: freeMem,
          used: usedMem,
          usedPercent,
        },
        cpu: {
          cores: os.cpus().length || 0,
          loadAvg: loadTuple,
        },
      },
      ping: this.getPingStats(),
      http: {
        total: this.httpTotal,
        lastMinute: httpLastMinute,
        lastMinuteErrors: httpErrorsLastMinute,
        latencyAvg: httpLatencyAvg,
        latencyP95: httpLatencyP95,
      },
      eventLoop: {
        avg: eventLoopAvg,
        max: eventLoopMax,
        p95: eventLoopP95,
      },
    };
  }

  getHistory(): MetricsHistory[] {
    return [...this.history];
  }

  reset() {
    this.commandCount = 0;
    this.commandTypeCount.clear();
    this.commandTimestamps = [];
    this.bytesSent = 0;
    this.bytesReceived = 0;
    this.lastBytesSent = 0;
    this.lastBytesReceived = 0;
    this.sentPerSecond = 0;
    this.receivedPerSecond = 0;
    this.pingValues = [];
    this.history = [];
    this.httpTotal = 0;
    this.httpTimestamps = [];
    this.httpErrorTimestamps = [];
    this.httpLatencies = [];
    this.eventLoopDelays = [];
  }
}

export const metrics = new MetricsCollector();
