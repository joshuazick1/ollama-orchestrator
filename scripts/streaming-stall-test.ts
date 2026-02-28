#!/usr/bin/env node
/**
 * Streaming Stall Detection and Failover Test Script
 *
 * This script tests the orchestrator's ability to detect stalled streaming requests
 * and failover to another server. It fully saturates the orchestrator based on:
 * - Number of servers available
 * - Each server's circuit breaker timeout
 * - Each server's max concurrency
 * - Model distribution across servers
 *
 * Usage:
 *   node scripts/streaming-stall-test.ts [--duration 120] [--concurrency auto]
 *   ORCHESTRATOR_STREAMING_STALL_THRESHOLD_MS=10000 node scripts/streaming-stall-test.ts
 *
 * Environment Variables:
 *   ORCHESTRATOR_URL - URL of the orchestrator (default: http://localhost:5100)
 *   ORCHESTRATOR_STREAMING_STALL_THRESHOLD_MS - Server stall detection threshold in ms (default: 60000)
 *   ORCHESTRATOR_STREAMING_STALL_CHECK_INTERVAL_MS - Server stall check interval in ms (default: 5000)
 *   STALL_THRESHOLD_MS - Client-side stall detection threshold in ms (default: 60000, should be > server threshold)
 *   STALL_CHECK_INTERVAL_MS - Client-side check interval in ms (default: 5000)
 *   POLL_INFLIGHT_INTERVAL_MS - How often to poll in-flight requests (default: 5000)
 */

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:5100';
const STALL_THRESHOLD_MS = parseInt(
  process.env.STALL_THRESHOLD_MS ||
    process.env.ORCHESTRATOR_STREAMING_STALL_THRESHOLD_MS ||
    '60000',
  10
);
const STALL_CHECK_INTERVAL_MS = parseInt(
  process.env.STALL_CHECK_INTERVAL_MS ||
    process.env.ORCHESTRATOR_STREAMING_STALL_CHECK_INTERVAL_MS ||
    '5000',
  10
);

// For testing with very short thresholds to trigger stall detection
const FORCE_SHORT_STALL = process.env.FORCE_SHORT_STALL === 'true';
const DEBUG_STALL_THRESHOLD = FORCE_SHORT_STALL ? 3000 : STALL_THRESHOLD_MS;
const DEBUG_STALL_INTERVAL = FORCE_SHORT_STALL ? 1000 : STALL_CHECK_INTERVAL_MS;
const POLL_INFLIGHT_INTERVAL_MS = parseInt(process.env.POLL_INFLIGHT_INTERVAL_MS || '5000', 10);

interface InFlightRequest {
  id: string;
  serverId: string;
  model: string;
  startTime: number;
  chunkCount: number;
  lastChunkTime: number;
  isStalled: boolean;
  accumulatedText: string;
  protocol: string;
  endpoint: string;
}

interface ErrorInfo {
  timestamp: string;
  serverId: string;
  model: string;
  errorType: string;
  message: string;
}

interface ServerInfo {
  id: string;
  url: string;
  maxConcurrency: number;
  healthy: boolean;
  models: string[];
}

interface CircuitBreakerInfo {
  serverId: string;
  model: string;
  state: 'closed' | 'open' | 'half-open';
  timeout: number;
  failureCount: number;
  successCount: number;
}

interface StallTestResult {
  requestId: string;
  model: string;
  endpoint: string;
  success: boolean;
  duration: number;
  chunksReceived: number;
  timeToFirstChunk: number;
  wasStalled: boolean;
  stallType?: 'pre-first-chunk' | 'post-first-chunk' | 'timeout';
  stallTimeMs?: number;
  failoverAttempted: boolean;
  failoverSucceeded?: boolean;
  serversTried: string[];
  finalServerId?: string;
  error?: string;
}

interface TestConfig {
  duration: number;
  concurrency: number;
  stallThreshold: number;
  stallCheckInterval: number;
  targetModel?: string;
}

class StreamingStallTest {
  private results: StallTestResult[] = [];
  private startTime: number = 0;
  private activeRequests: number = 0;
  private config: TestConfig;
  private servers: ServerInfo[] = [];
  private circuitBreakers: Map<string, CircuitBreakerInfo> = new Map();
  private modelsToTest: string[] = [];
  private modelServerMap: Map<string, string[]> = new Map();
  private totalCapacity: number = 0;
  private requestStartTime: number = 0;

  // New: Track in-flight requests over time
  private inFlightSnapshots: Array<{
    timestamp: number;
    count: number;
    byModel: Record<string, number>;
    stalled: number;
  }> = [];

  // New: Track errors
  private recentErrors: ErrorInfo[] = [];

  // New: Final debug data
  private finalInFlight: InFlightRequest[] = [];
  private finalErrors: ErrorInfo[] = [];

  constructor(config: Partial<TestConfig> = {}) {
    this.config = {
      duration: config.duration ?? 120,
      concurrency: config.concurrency ?? 0, // 0 = auto
      stallThreshold: config.stallThreshold ?? STALL_THRESHOLD_MS,
      stallCheckInterval: config.stallCheckInterval ?? STALL_CHECK_INTERVAL_MS,
    };
  }

  async run(): Promise<void> {
    console.log('='.repeat(80));
    console.log('STREAMING STALL DETECTION AND FAILOVER TEST');
    console.log('='.repeat(80));
    console.log(`Orchestrator: ${ORCHESTRATOR_URL}`);
    console.log(
      `Stall Threshold: ${this.config.stallThreshold}ms${FORCE_SHORT_STALL ? ' (FORCED SHORT)' : ''}`
    );
    console.log(`Stall Check Interval: ${this.config.stallCheckInterval}ms`);
    console.log('');

    await this.fetchServerInfo();
    await this.fetchCircuitBreakers();

    if (this.servers.length === 0) {
      console.error('No servers available');
      process.exit(1);
    }

    this.calculateCapacity();
    await this.fetchModelInfo();

    if (this.modelsToTest.length === 0) {
      console.error('No models available for testing');
      process.exit(1);
    }

    // Auto-calculate concurrency if not set
    if (this.config.concurrency === 0) {
      this.config.concurrency = Math.min(this.totalCapacity, 100);
      console.log(
        `Auto-detected concurrency: ${this.config.concurrency} (based on total capacity: ${this.totalCapacity})`
      );
    }

    console.log(`\nTest Configuration:`);
    console.log(`  Duration: ${this.config.duration}s`);
    console.log(`  Concurrency: ${this.config.concurrency}`);
    console.log(`  Total Servers: ${this.servers.length}`);
    console.log(`  Total Capacity: ${this.totalCapacity}`);
    console.log(`  Models: ${this.modelsToTest.length}`);
    console.log('');

    this.displayServerStatus();
    this.displayCircuitBreakers();

    this.startTime = Date.now();
    const endTime = this.startTime + this.config.duration * 1000;

    console.log('\nStarting saturation test...');

    const progressInterval = setInterval(() => {
      this.printProgress();
      this.fetchCircuitBreakers(); // Keep updating circuit breaker state
      this.pollInFlightRequests(); // Poll in-flight requests
    }, POLL_INFLIGHT_INTERVAL_MS);

    const requestPromises: Promise<void>[] = [];

    while (Date.now() < endTime) {
      if (this.activeRequests < this.config.concurrency) {
        const model = this.selectModelByLoad();
        requestPromises.push(this.sendStreamingRequest(model));
      }
      await this.sleep(10);
    }

    console.log('\nWaiting for active requests to complete...');
    await Promise.all(requestPromises);

    clearInterval(progressInterval);

    // Fetch final state for debugging
    console.log('\nFetching final debug info...');
    this.finalInFlight = await this.fetchInFlightRequests();
    this.finalErrors = await this.fetchRecentErrors();
    await this.fetchCircuitBreakers();

    await this.generateReport();
  }

  private async fetchServerInfo(): Promise<void> {
    try {
      const response = await fetch(`${ORCHESTRATOR_URL}/api/orchestrator/servers`);
      if (!response.ok) throw new Error(`Failed: ${response.status}`);

      const data = await response.json();
      this.servers = (data.servers || []).filter((s: ServerInfo) => s.healthy);

      console.log(`Discovered ${this.servers.length} healthy servers`);
    } catch (error) {
      console.error('Failed to fetch servers:', error);
      throw error;
    }
  }

  private async fetchCircuitBreakers(): Promise<void> {
    try {
      const response = await fetch(`${ORCHESTRATOR_URL}/api/orchestrator/circuit-breakers`);
      if (!response.ok) return;

      const data = await response.json();
      const breakers = data.circuitBreakers || [];

      for (const cb of breakers) {
        const key = `${cb.serverId}:${cb.model}`;
        this.circuitBreakers.set(key, {
          serverId: cb.serverId,
          model: cb.model,
          state: cb.state,
          timeout: cb.timeout || 60000,
          failureCount: cb.failureCount || 0,
          successCount: cb.successCount || 0,
        });
      }
    } catch (error) {
      // Silent fail
    }
  }

  private async fetchInFlightRequests(): Promise<InFlightRequest[]> {
    try {
      const response = await fetch(`${ORCHESTRATOR_URL}/api/orchestrator/in-flight`);
      if (!response.ok) return [];

      const data = await response.json();
      const requests: InFlightRequest[] = [];

      if (data.inFlight) {
        for (const serverData of data.inFlight) {
          if (serverData.streamingRequests) {
            for (const req of serverData.streamingRequests) {
              requests.push({
                id: req.id,
                serverId: req.serverId,
                model: req.model,
                startTime: req.startTime,
                chunkCount: req.chunkCount,
                lastChunkTime: req.lastChunkTime,
                isStalled: req.isStalled,
                accumulatedText: req.accumulatedText,
                protocol: req.protocol,
                endpoint: req.endpoint,
              });
            }
          }
        }
      }
      return requests;
    } catch {
      return [];
    }
  }

  private async fetchRecentErrors(): Promise<ErrorInfo[]> {
    try {
      const response = await fetch(
        `${ORCHESTRATOR_URL}/api/orchestrator/analytics/errors?includeRecent=true&timeRange=1m`
      );
      if (!response.ok) return [];

      const data = await response.json();
      return data.recentErrors || [];
    } catch {
      return [];
    }
  }

  private async pollInFlightRequests(): Promise<void> {
    const requests = await this.fetchInFlightRequests();

    const byModel: Record<string, number> = {};
    let stalled = 0;

    for (const req of requests) {
      byModel[req.model] = (byModel[req.model] || 0) + 1;
      if (req.isStalled || req.chunkCount === 0) {
        stalled++;
      }
    }

    this.inFlightSnapshots.push({
      timestamp: Date.now(),
      count: requests.length,
      byModel,
      stalled,
    });

    if (requests.length > 0) {
      console.log(`  [INFLIGHT] ${requests.length} requests, ${stalled} stalled`);
    }
  }

  private calculateCapacity(): void {
    this.totalCapacity = this.servers.reduce((sum, s) => sum + (s.maxConcurrency || 4), 0);
  }

  private async fetchModelInfo(): Promise<void> {
    try {
      const response = await fetch(`${ORCHESTRATOR_URL}/api/orchestrator/model-map`);
      if (!response.ok) throw new Error(`Failed: ${response.status}`);

      const data = await response.json();
      const modelToServers: Record<string, string[]> = data.modelToServers || {};

      for (const [modelName, serverIds] of Object.entries(modelToServers)) {
        const healthyServers = (serverIds as string[]).filter(id =>
          this.servers.some(s => s.id === id && s.healthy)
        );
        if (healthyServers.length >= 1) {
          this.modelsToTest.push(modelName);
          this.modelServerMap.set(modelName, healthyServers);
        }
      }
    } catch (error) {
      console.error('Failed to fetch models:', error);
      throw error;
    }
  }

  private displayServerStatus(): void {
    console.log('\nSERVER STATUS:');
    console.log('-'.repeat(80));
    console.log(
      `${'Server ID'.padEnd(30)} ${'URL'.padEnd(35)} ${'Capacity'.padStart(10)} ${'Models'.padStart(8)}`
    );
    console.log('-'.repeat(80));

    for (const server of this.servers) {
      const modelCount = server.models?.length || 0;
      console.log(
        `${server.id.slice(0, 30).padEnd(30)} ` +
          `${server.url.slice(0, 35).padEnd(35)} ` +
          `${(server.maxConcurrency || 4).toString().padStart(10)} ` +
          `${modelCount.toString().padStart(8)}`
      );
    }
    console.log('');
  }

  private displayCircuitBreakers(): void {
    console.log('CIRCUIT BREAKERS:');
    console.log('-'.repeat(80));

    const breakersByServer = new Map<string, CircuitBreakerInfo[]>();
    for (const cb of Array.from(this.circuitBreakers.values())) {
      const key = `${cb.serverId}:${cb.model}`;
      const list = breakersByServer.get(key) || [];
      list.push(cb);
      breakersByServer.set(key, list);
    }

    for (const [serverId, breakers] of Array.from(breakersByServer.entries())) {
      console.log(`\n${serverId}:`);
      for (const cb of breakers.slice(0, 3)) {
        const timeout = cb.timeout || 60000;
        console.log(
          `  ${cb.model.slice(0, 25).padEnd(25)} ${cb.state.padEnd(10)} timeout: ${(timeout / 1000).toFixed(0)}s fail: ${cb.failureCount}`
        );
      }
    }
    console.log('');
  }

  private selectModelByLoad(): string {
    // Weight by number of available servers (prefer models with more servers = more failover options)
    const weightedModels: Array<{ model: string; weight: number }> = [];

    for (const model of this.modelsToTest) {
      const servers = this.modelServerMap.get(model) || [];
      // Skip servers with open circuit breakers
      const healthyForModel = servers.filter(serverId => {
        const key = `${serverId}:${model}`;
        const cb = this.circuitBreakers.get(key);
        return !cb || cb.state === 'closed';
      });

      if (healthyForModel.length > 0) {
        weightedModels.push({ model, weight: healthyForModel.length * 10 });
      }
    }

    if (weightedModels.length === 0) {
      return this.modelsToTest[Math.floor(Math.random() * this.modelsToTest.length)];
    }

    const totalWeight = weightedModels.reduce((sum, m) => sum + m.weight, 0);
    let random = Math.random() * totalWeight;

    for (const { model, weight } of weightedModels) {
      random -= weight;
      if (random <= 0) return model;
    }

    return weightedModels[0].model;
  }

  private getServerTimeout(serverId: string, model: string): number {
    const key = `${serverId}:${model}`;
    const cb = this.circuitBreakers.get(key);
    return cb?.timeout || 60000;
  }

  private async sendStreamingRequest(model: string): Promise<void> {
    this.activeRequests++;
    this.requestStartTime = Date.now();
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    const serversForModel = this.modelServerMap.get(model) || [];
    const result: StallTestResult = {
      requestId,
      model,
      endpoint: '/api/generate',
      success: false,
      duration: 0,
      chunksReceived: 0,
      timeToFirstChunk: 0,
      wasStalled: false,
      failoverAttempted: false,
      serversTried: [],
    };

    try {
      // Calculate timeout based on circuit breakers
      const timeouts = serversForModel.map(s => this.getServerTimeout(s, model));
      const maxTimeout = Math.max(...timeouts, 60000);
      const requestTimeout = Math.min(maxTimeout + 5000, 120000);

      console.log(
        `[${requestId}] Starting request for ${model} (timeout: ${requestTimeout}ms, servers: ${serversForModel.length})`
      );

      const response = await fetch(`${ORCHESTRATOR_URL}/api/generate?debug=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': requestId,
        },
        body: JSON.stringify({
          model,
          prompt: 'Write a detailed story about a robot discovering emotions and becoming human',
          stream: true,
          options: { num_predict: 150 },
        }),
        signal: AbortSignal.timeout(requestTimeout),
      });

      const duration = Date.now() - this.requestStartTime;
      result.duration = duration;
      result.finalServerId = response.headers.get('X-Selected-Server') || undefined;

      // Check for failover in headers
      const serversTried = response.headers.get('X-Servers-Tried');
      if (serversTried) {
        result.serversTried = serversTried.split(',');
        result.failoverAttempted = result.serversTried.length > 1;
        console.log(`[${requestId}] Servers tried: ${result.serversTried.join(' -> ')}`);
      }

      if (response.ok && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let done = false;
        let lastChunkTime = Date.now();
        let chunkCount = 0;
        let firstChunkTime: number | undefined;

        while (!done) {
          const { value, done: doneReading } = await reader.read();
          done = doneReading;

          if (value) {
            const now = Date.now();
            chunkCount++;

            if (!firstChunkTime) {
              firstChunkTime = now - this.requestStartTime;
              result.timeToFirstChunk = firstChunkTime;
              console.log(`[${requestId}] First chunk after ${firstChunkTime}ms`);
            }

            // Check for post-first-chunk stall
            const timeSinceLastChunk = now - lastChunkTime;
            if (timeSinceLastChunk > this.config.stallThreshold) {
              result.wasStalled = true;
              result.stallType = 'post-first-chunk';
              result.stallTimeMs = timeSinceLastChunk;
              result.chunksReceived = chunkCount;
              console.log(
                `[${requestId}] POST-FIRST-CHUNK STALL: ${timeSinceLastChunk}ms gap after ${chunkCount} chunks`
              );

              // Abort the reader
              reader.cancel();
              break;
            }

            lastChunkTime = now;

            // Check for completion
            const chunkText = decoder.decode(value, { stream: true });
            if (chunkText.includes('"done":true') || chunkText.includes('[DONE]')) {
              done = true;
            }
          }
        }

        result.chunksReceived = chunkCount;

        if (!result.wasStalled) {
          result.success = true;
          console.log(`[${requestId}] Completed: ${chunkCount} chunks in ${duration}ms`);
        }

        reader.releaseLock();
      } else {
        result.error = `HTTP ${response.status}`;
        if (response.status === 503) {
          result.failoverAttempted = true;
        }
      }
    } catch (error) {
      result.duration = Date.now() - this.requestStartTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('timeout') || errorMessage.includes('abort')) {
        if (result.chunksReceived === 0) {
          result.wasStalled = true;
          result.stallType = 'pre-first-chunk';
          result.stallTimeMs = result.duration;
          console.log(
            `[${requestId}] PRE-FIRST-CHUNK TIMEOUT: ${result.duration}ms (no chunks received)`
          );
        } else if (!result.wasStalled) {
          result.wasStalled = true;
          result.stallType = 'timeout';
          result.stallTimeMs = result.duration;
          console.log(
            `[${requestId}] TIMEOUT: ${result.duration}ms after ${result.chunksReceived} chunks`
          );
        }
      } else {
        result.error = errorMessage;
        console.log(`[${requestId}] ERROR: ${errorMessage}`);
      }
    }

    this.results.push(result);
    this.activeRequests--;
  }

  private printProgress(): void {
    const elapsed = (Date.now() - this.startTime) / 1000;
    const remaining = Math.max(0, this.config.duration - elapsed);

    const stalledCount = this.results.filter(r => r.wasStalled).length;
    const failoverCount = this.results.filter(r => r.failoverAttempted).length;
    const successCount = this.results.filter(r => r.success).length;
    const totalCount = this.results.length;

    const successRate = totalCount > 0 ? ((successCount / totalCount) * 100).toFixed(1) : '0.0';
    const stallRate = totalCount > 0 ? ((stalledCount / totalCount) * 100).toFixed(1) : '0.0';

    // Count open circuits
    let openCircuits = 0;
    let halfOpenCircuits = 0;
    for (const cb of Array.from(this.circuitBreakers.values())) {
      if (cb.state === 'open') openCircuits++;
      else if (cb.state === 'half-open') halfOpenCircuits++;
    }

    console.log(
      `[${elapsed.toFixed(0)}s/${this.config.duration}s] ` +
        `Active: ${this.activeRequests.toString().padStart(3)} | ` +
        `Total: ${totalCount.toString().padStart(4)} | ` +
        `Success: ${successCount.toString().padStart(3)} (${successRate}%) | ` +
        `Stalled: ${stalledCount.toString().padStart(3)} (${stallRate}%) | ` +
        `Failover: ${failoverCount.toString().padStart(3)} | ` +
        `Circuits: O:${openCircuits} HO:${halfOpenCircuits}`
    );
  }

  private async generateReport(): Promise<void> {
    const endTime = Date.now();
    const totalDuration = (endTime - this.startTime) / 1000;

    console.log('\n' + '='.repeat(80));
    console.log('STALL DETECTION TEST RESULTS');
    console.log('='.repeat(80));
    console.log(`Test Duration: ${totalDuration.toFixed(1)} seconds`);
    console.log(`Total Requests: ${this.results.length}`);
    console.log('');

    const stalledResults = this.results.filter(r => r.wasStalled);
    const preFirstChunkStalls = stalledResults.filter(r => r.stallType === 'pre-first-chunk');
    const postFirstChunkStalls = stalledResults.filter(r => r.stallType === 'post-first-chunk');
    const timeoutStalls = stalledResults.filter(r => r.stallType === 'timeout');
    const failoverAttempts = this.results.filter(r => r.failoverAttempted);
    const successfulRequests = this.results.filter(r => r.success);

    console.log('SUMMARY:');
    console.log('-'.repeat(80));
    console.log(
      `Successful: ${successfulRequests.length} (${((successfulRequests.length / this.results.length) * 100).toFixed(1)}%)`
    );
    console.log(
      `Failed: ${this.results.length - successfulRequests.length - stalledResults.length} (${(((this.results.length - successfulRequests.length - stalledResults.length) / this.results.length) * 100).toFixed(1)}%)`
    );
    console.log(
      `Stalled: ${stalledResults.length} (${((stalledResults.length / this.results.length) * 100).toFixed(1)}%)`
    );
    console.log(`  - Pre-First-Chunk: ${preFirstChunkStalls.length}`);
    console.log(`  - Post-First-Chunk: ${postFirstChunkStalls.length}`);
    console.log(`  - Timeout: ${timeoutStalls.length}`);
    console.log(`Failover Attempts: ${failoverAttempts.length}`);
    console.log('');

    if (failoverAttempts.length > 0) {
      console.log('FAILOVER ANALYSIS:');
      console.log('-'.repeat(80));

      const failoverSuccesses = failoverAttempts.filter(r => r.success).length;
      console.log(
        `Failover Success Rate: ${((failoverSuccesses / failoverAttempts.length) * 100).toFixed(1)}%`
      );
      console.log('');

      // Show sample failover events
      console.log('SAMPLE FAILOVER EVENTS:');
      failoverAttempts.slice(0, 10).forEach(r => {
        console.log(
          `  ${r.requestId}: ${r.serversTried.join(' -> ')} ` +
            `(${r.success ? 'SUCCESS' : 'FAILED'})`
        );
      });
      console.log('');
    }

    if (stalledResults.length > 0) {
      console.log('STALL METRICS:');
      console.log('-'.repeat(80));

      if (preFirstChunkStalls.length > 0) {
        const avgTime =
          preFirstChunkStalls.reduce((sum, r) => sum + r.duration, 0) / preFirstChunkStalls.length;
        console.log(
          `Pre-First-Chunk: ${preFirstChunkStalls.length} stalls, avg duration: ${avgTime.toFixed(0)}ms`
        );
      }

      if (postFirstChunkStalls.length > 0) {
        const avgChunks =
          postFirstChunkStalls.reduce((sum, r) => sum + r.chunksReceived, 0) /
          postFirstChunkStalls.length;
        const avgStallTime =
          postFirstChunkStalls.reduce((sum, r) => sum + (r.stallTimeMs || 0), 0) /
          postFirstChunkStalls.length;
        console.log(
          `Post-First-Chunk: ${postFirstChunkStalls.length} stalls, avg chunks before stall: ${avgChunks.toFixed(1)}, avg stall time: ${avgStallTime.toFixed(0)}ms`
        );
      }
      console.log('');
    }

    console.log('CIRCUIT BREAKER STATE:');
    console.log('-'.repeat(80));

    const stateCounts = { closed: 0, open: 0, 'half-open': 0 };
    for (const cb of Array.from(this.circuitBreakers.values())) {
      stateCounts[cb.state]++;
    }

    console.log(
      `Closed: ${stateCounts.closed}, Open: ${stateCounts.open}, Half-Open: ${stateCounts['half-open']}`
    );
    console.log('');

    // Show in-flight snapshot summary
    if (this.inFlightSnapshots.length > 0) {
      console.log('IN-FLIGHT REQUEST SNAPSHOTS:');
      console.log('-'.repeat(80));
      const maxCount = Math.max(...this.inFlightSnapshots.map(s => s.count));
      const maxStalled = Math.max(...this.inFlightSnapshots.map(s => s.stalled));
      console.log(`  Max concurrent in-flight: ${maxCount}`);
      console.log(`  Max stalled at any point: ${maxStalled}`);
      console.log(`  Snapshots taken: ${this.inFlightSnapshots.length}`);
      console.log('');
    }

    // Show final in-flight requests
    if (this.finalInFlight.length > 0) {
      console.log('FINAL IN-FLIGHT REQUESTS (after test):');
      console.log('-'.repeat(80));
      console.log(`  Total: ${this.finalInFlight.length}`);

      const byModel: Record<string, number> = {};
      const zeroChunks = this.finalInFlight.filter(r => r.chunkCount === 0);
      const stalled = this.finalInFlight.filter(r => r.isStalled);

      for (const req of this.finalInFlight) {
        byModel[req.model] = (byModel[req.model] || 0) + 1;
      }

      console.log(`  With 0 chunks: ${zeroChunks.length}`);
      console.log(`  Marked as stalled: ${stalled.length}`);
      console.log(`  By model:`, byModel);

      // Show requests stuck for > 30 seconds
      const now = Date.now();
      const stuckLong = this.finalInFlight.filter(r => now - r.lastChunkTime > 30000);
      if (stuckLong.length > 0) {
        console.log(`  Stuck > 30s without chunks:`);
        stuckLong.slice(0, 5).forEach(r => {
          console.log(
            `    ${r.id}: ${r.model} on ${r.serverId.slice(0, 20)}... (chunks: ${r.chunkCount})`
          );
        });
      }
      console.log('');
    }

    // Show recent errors
    if (this.finalErrors.length > 0) {
      console.log('RECENT ERRORS:');
      console.log('-'.repeat(80));
      console.log(`  Total: ${this.finalErrors.length}`);

      const errorTypes: Record<string, number> = {};
      for (const err of this.finalErrors) {
        errorTypes[err.errorType] = (errorTypes[err.errorType] || 0) + 1;
      }
      console.log(`  By type:`, errorTypes);
      console.log('');
    }

    const reportPath = `reports/streaming-stall-test-${Date.now()}.json`;
    await import('fs').then(fs => fs.mkdirSync('reports', { recursive: true }));

    const report = {
      metadata: {
        startTime: new Date(this.startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        duration: totalDuration,
        config: this.config,
        servers: this.servers.map(s => ({ id: s.id, maxConcurrency: s.maxConcurrency })),
        totalCapacity: this.totalCapacity,
      },
      summary: {
        totalRequests: this.results.length,
        successful: successfulRequests.length,
        stalled: stalledResults.length,
        preFirstChunkStalls: preFirstChunkStalls.length,
        postFirstChunkStalls: postFirstChunkStalls.length,
        timeoutStalls: timeoutStalls.length,
        failoverAttempts: failoverAttempts.length,
      },
      circuitBreakerState: Object.fromEntries(this.circuitBreakers),
      inFlightSnapshots: this.inFlightSnapshots,
      finalInFlight: this.finalInFlight,
      finalErrors: this.finalErrors,
      results: this.results,
    };

    await import('fs').then(fs => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)));
    console.log(`Detailed report saved to: ${reportPath}`);
    console.log('='.repeat(80));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

const args = process.argv.slice(2);
const options: Partial<TestConfig> = {};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--duration' && args[i + 1]) {
    options.duration = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--concurrency' && args[i + 1]) {
    options.concurrency = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--model' && args[i + 1]) {
    options.targetModel = args[i + 1];
    i++;
  }
}

const test = new StreamingStallTest(options);
test.run().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
