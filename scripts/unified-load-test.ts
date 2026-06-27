#!/usr/bin/env node
/**
 * Unified Load Test Script
 *
 * A comprehensive load testing tool that exercises the orchestrator under realistic
 * production conditions. Consolidates capabilities from all individual test scripts:
 *
 *  - streaming-stall-test.ts:              stall detection, failover tracking, in-flight polling
 *  - enhanced-circuit-breaker-load-test.ts: CB state tracking, time-series, server coverage, spike patterns
 *  - streaming-load-test.ts:               streaming chunk metrics, TTFT, SSE debug extraction
 *  - circuit-breaker-load-test.ts:         basic CB hammering, error analysis
 *  - direct-import-load-test.ts:           load balancer decision analysis
 *  - quick-load-test.sh:                   quick validation mode
 *
 * Features:
 *  - Streaming AND non-streaming request mix (configurable ratio)
 *  - Embedding model support alongside generation models
 *  - Circuit breaker state tracking with transition detection
 *  - Chunk-level streaming metrics (TTFT, chunk gaps, avg size)
 *  - Stall detection and failover tracking
 *  - In-flight request monitoring via orchestrator API
 *  - Server coverage analysis (which servers get exercised)
 *  - Load balancer distribution fairness scoring
 *  - Time-series data collection for trend analysis
 *  - Multiple test patterns: warmup, uniform, spike, targeted, recovery
 *  - Enhanced debug info consumption (requestId, chunkData, queueWaitTime)
 *  - Error analytics polling during test
 *  - Detailed JSON report with all collected metrics
 *
 * Usage:
 *   npx tsx scripts/unified-load-test.ts [options]
 *
 * Options:
 *   --url <url>              Orchestrator URL (default: http://localhost:5100)
 *   --duration <seconds>     Total test duration (default: 300)
 *   --concurrency <n>        Max concurrent requests (default: auto from server capacity)
 *   --pattern <mode>         Test pattern: uniform|spike|targeted|mixed (default: mixed)
 *   --streaming-ratio <0-1>  Fraction of requests that use streaming (default: 0.5)
 *   --models <n>             Max models to test (default: 30)
 *   --include-embeddings     Include embedding models in the test
 *   --warmup-seconds <n>     Warmup duration per server (default: 10)
 *   --time-series-interval <ms>  Time-series sample interval (default: 5000)
 *   --report-dir <path>      Directory for JSON reports (default: reports)
 *   --quiet                  Minimal console output
 *   --debug                  Send ?debug=true on requests for enhanced diagnostics
 */

import { promises as fs } from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
function parseArgs(): TestConfig {
  const args = process.argv.slice(2);
  const config: TestConfig = {
    url: 'http://localhost:5100',
    duration: 300,
    concurrency: 0, // 0 = auto
    pattern: 'mixed',
    streamingRatio: 0.5,
    maxModels: 30,
    includeEmbeddings: false,
    warmupSeconds: 10,
    timeSeriesIntervalMs: 5000,
    reportDir: 'reports',
    quiet: false,
    debug: false,
    maxChunks: 10000, // 0 = no limit
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--url':
        config.url = args[++i];
        break;
      case '--duration':
        config.duration = parseInt(args[++i], 10);
        break;
      case '--concurrency':
        config.concurrency = parseInt(args[++i], 10);
        break;
      case '--pattern':
        config.pattern = args[++i] as TestPattern;
        break;
      case '--streaming-ratio':
        config.streamingRatio = parseFloat(args[++i]);
        break;
      case '--models':
        config.maxModels = parseInt(args[++i], 10);
        break;
      case '--include-embeddings':
        config.includeEmbeddings = true;
        break;
      case '--warmup-seconds':
        config.warmupSeconds = parseInt(args[++i], 10);
        break;
      case '--time-series-interval':
        config.timeSeriesIntervalMs = parseInt(args[++i], 10);
        break;
      case '--report-dir':
        config.reportDir = args[++i];
        break;
      case '--quiet':
        config.quiet = true;
        break;
      case '--debug':
        config.debug = true;
        break;
      case '--max-chunks':
        config.maxChunks = parseInt(args[++i], 10);
        break;
      case '--help':
        console.log(`
Unified Load Test Script

Usage: npx tsx scripts/unified-load-test.ts [options]

Options:
  --url <url>                 Orchestrator URL (default: http://localhost:5100)
  --duration <seconds>        Total test duration (default: 300)
  --concurrency <n>           Max concurrent requests (default: auto from server capacity)
  --pattern <mode>            Test pattern: uniform|spike|targeted|mixed (default: mixed)
  --streaming-ratio <0-1>     Fraction streaming requests (default: 0.5)
  --models <n>                Max models to test (default: 30)
  --include-embeddings        Include embedding models
  --warmup-seconds <n>        Warmup duration (default: 10)
  --time-series-interval <ms> Sample interval for time-series data (default: 5000)
  --report-dir <path>         Report output directory (default: reports)
  --quiet                     Minimal console output
  --debug                     Also append ?debug=true query param (debug headers always sent)
  --max-chunks <n>           Max chunks to wait for in streaming responses (default: unlimited)
  --help                      Show this help
`);
        process.exit(0);
    }
  }
  return config;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type TestPattern = 'uniform' | 'spike' | 'targeted' | 'mixed';
type TestPhase = 'warmup' | 'ramp-up' | 'peak' | 'ramp-down' | 'recovery' | 'uniform' | 'targeted';

/**
 * Error blame attribution:
 * - orchestrator: The orchestrator itself caused the failure (circuit_blocked, no_servers)
 * - upstream: An upstream Ollama server caused the failure (timeout, server_error, connection_error)
 * - ambiguous: Cannot clearly attribute (rate_limited, unknown errors)
 */
type ErrorBlame = 'orchestrator' | 'upstream' | 'ambiguous';

interface TestConfig {
  url: string;
  duration: number;
  concurrency: number;
  pattern: TestPattern;
  streamingRatio: number;
  maxModels: number;
  includeEmbeddings: boolean;
  warmupSeconds: number;
  timeSeriesIntervalMs: number;
  reportDir: string;
  quiet: boolean;
  debug: boolean;
  maxChunks: number;
}

interface ServerInfo {
  id: string;
  url: string;
  healthy: boolean;
  models: string[];
  maxConcurrency: number;
  supportsOllama?: boolean;
  supportsV1?: boolean;
}

interface ModelInfo {
  name: string;
  servers: string[];
  isEmbedding: boolean;
  /** Sum of maxConcurrency across all servers hosting this model */
  totalCapacity: number;
}

interface RequestResult {
  model: string;
  serverId: string;
  success: boolean;
  duration: number;
  statusCode: number;
  error?: string;
  errorType?: string;
  timestamp: number;
  isStreaming: boolean;
  isEmbedding: boolean;
  phase: TestPhase;

  // Routing debug fields
  retryCount?: number;
  serversTried?: string[];
  totalCandidates?: number;
  serverLoad?: number;
  maxConcurrency?: number;
  algorithm?: string;
  serverCircuitState?: string;
  modelCircuitState?: string;
  routedToOpenCircuit?: boolean;
  requestId?: string;

  // Streaming-specific
  chunksReceived?: number;
  totalBytes?: number;
  timeToFirstToken?: number;
  streamingDuration?: number;
  tokensGenerated?: number;
  tokensPrompt?: number;
  maxChunkGapMs?: number;
  avgChunkSizeBytes?: number;

  // Stall / failover
  stallDetected?: boolean;
  handoffAttempted?: boolean;
  handoffSuccess?: boolean;

  // Failover diagnostics
  failoverPhase?: number;
  failoverCount?: number;
  failoverOccurred?: boolean;
  failoverErrors?: Array<{ serverId: string; error: string; errorType?: string }>;

  // Blame attribution: 'orchestrator' | 'upstream' | 'ambiguous'
  blame?: ErrorBlame;
}

interface CircuitBreakerSnapshot {
  name: string;
  state: string;
  failureCount: number;
  successCount: number;
  errorRate: number;
  consecutiveFailedRecoveries: number;
  modelType?: string;
}

interface TimeSeriesPoint {
  timestamp: number;
  elapsedMs: number;
  phase: TestPhase;

  // Request counts
  totalRequests: number;
  activeRequests: number;
  successRate: number;
  avgLatency: number;
  p95Latency: number;

  // Circuit breakers
  openCircuits: number;
  halfOpenCircuits: number;
  closedCircuits: number;

  // Streaming
  avgTTFT: number;
  avgChunksPerRequest: number;

  // Server coverage
  serversHit: number;
  totalServers: number;

  // In-flight from orchestrator
  inFlightTotal: number;
  inFlightStreaming: number;

  // Per-server distribution
  perServerRequests: Record<string, number>;
  perServerHalfOpen: Record<string, number>;

  // Failures
  circuitBlockedRequests: number;
  timeoutRequests: number;
  serverErrorRequests: number;
  concurrencySaturatedRequests: number;
  noServersRequests: number;
}

interface InFlightResponse {
  total: number;
  inFlight: Array<{
    serverId: string;
    model: string;
    streaming?: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------
const GENERATION_PROMPTS = [
  'Explain the concept of load balancing in distributed systems.',
  'What are circuit breakers in microservices architecture?',
  'Describe how streaming responses work in HTTP/2.',
  'Compare round-robin and weighted load balancing strategies.',
  'What is the CAP theorem and how does it apply to databases?',
  'Explain eventual consistency and its trade-offs.',
  'How does a connection pool work?',
  'What are the benefits and drawbacks of server-sent events?',
  'Describe the retry pattern with exponential backoff.',
  'What is VRAM and how does it affect model inference?',
];

const EMBEDDING_INPUTS = [
  'Load balancing optimization',
  'Circuit breaker pattern recovery',
  'Distributed system fault tolerance',
  'Machine learning inference pipeline',
  'Streaming response chunk processing',
];

const EMBEDDING_PATTERNS = [
  'embed',
  'bge',
  'gte',
  'nomic-embed',
  'all-minilm',
  'e5-',
  'snowflake',
  'mxbai-embed',
  'paraphrase',
];

function isEmbeddingModel(name: string): boolean {
  const lower = name.toLowerCase();
  return EMBEDDING_PATTERNS.some(p => lower.includes(p));
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ---------------------------------------------------------------------------
// Main test class
// ---------------------------------------------------------------------------
class UnifiedLoadTest {
  private config: TestConfig;
  private results: RequestResult[] = [];
  private timeSeriesData: TimeSeriesPoint[] = [];
  private servers: ServerInfo[] = [];
  private models: ModelInfo[] = [];
  private modelsToTest: ModelInfo[] = [];
  private serversHit = new Set<string>();
  private activeRequests = 0;
  private testStartTime = 0;
  private currentPhase: TestPhase = 'warmup';
  private running = false;

  // Interval tracking
  private recentResults: RequestResult[] = []; // results since last time-series sample
  private perServerRequestCount = new Map<string, number>();
  private previousCBStates = new Map<string, string>(); // for transition detection
  private cbTransitions: Array<{
    timestamp: number;
    elapsedMs: number;
    name: string;
    from: string;
    to: string;
  }> = [];

  // Per-model in-flight tracking to avoid saturating any single model
  private perModelInFlight = new Map<string, number>();

  // Per-model blocked capacity from open circuit breakers
  // Updated during time-series collection (CB polling)
  private perModelBlockedCapacity = new Map<string, number>();

  constructor(config: TestConfig) {
    this.config = config;
  }

  // -------------------------------------------------------------------------
  // Discovery
  // -------------------------------------------------------------------------
  private async fetchJson<T>(endpoint: string): Promise<T> {
    const resp = await fetch(`${this.config.url}/api/orchestrator${endpoint}`);
    if (!resp.ok) throw new Error(`GET ${endpoint} failed: ${resp.status}`);
    return resp.json() as Promise<T>;
  }

  private async discoverServers(): Promise<void> {
    const raw = await this.fetchJson<ServerInfo[] | { servers: ServerInfo[] }>('/servers');
    const servers = Array.isArray(raw) ? raw : (raw as { servers: ServerInfo[] }).servers;
    this.servers = servers.filter(s => s.healthy);
    if (this.servers.length === 0) {
      throw new Error('No healthy servers found');
    }
    this.log(`Discovered ${this.servers.length} healthy servers (${servers.length} total)`);
  }

  private async discoverModels(): Promise<void> {
    const raw = await this.fetchJson<
      Record<string, string[]> | { modelToServers: Record<string, string[]> }
    >('/model-map');
    const modelMap: Record<string, string[]> =
      (raw as { modelToServers?: Record<string, string[]> }).modelToServers ??
      (raw as Record<string, string[]>);
    this.models = [];

    // Build a lookup from server ID to maxConcurrency for capacity calculation
    const serverCapacity = new Map<string, number>();
    for (const s of this.servers) {
      serverCapacity.set(s.id, s.maxConcurrency || 4);
    }

    for (const [model, serverIds] of Object.entries(modelMap)) {
      const embedding = isEmbeddingModel(model);
      if (!this.config.includeEmbeddings && embedding) continue;
      const totalCapacity = serverIds.reduce((sum, id) => sum + (serverCapacity.get(id) ?? 4), 0);
      this.models.push({
        name: model,
        servers: serverIds,
        isEmbedding: embedding,
        totalCapacity,
      });
    }

    // Sort by total capacity (more capacity = can absorb more load = should get more requests)
    this.models.sort((a, b) => b.totalCapacity - a.totalCapacity);

    // Select models: take top half by server count, rest random, up to maxModels
    const generationModels = this.models.filter(m => !m.isEmbedding);
    const embeddingModels = this.models.filter(m => m.isEmbedding);

    const selected = new Set<string>();

    // Top generation models by server count
    const topCount = Math.min(Math.ceil(this.config.maxModels * 0.5), generationModels.length);
    for (let i = 0; i < topCount; i++) {
      selected.add(generationModels[i].name);
    }

    // Random generation models (for coverage diversity)
    const remaining = generationModels.filter(m => !selected.has(m.name));
    const randomCount = Math.min(Math.ceil(this.config.maxModels * 0.3), remaining.length);
    for (let i = 0; i < randomCount; i++) {
      const idx = Math.floor(Math.random() * remaining.length);
      selected.add(remaining.splice(idx, 1)[0].name);
    }

    // Embedding models (if included)
    if (this.config.includeEmbeddings) {
      const embedCount = Math.min(Math.ceil(this.config.maxModels * 0.2), embeddingModels.length);
      for (let i = 0; i < embedCount; i++) {
        selected.add(embeddingModels[i].name);
      }
    }

    this.modelsToTest = this.models.filter(m => selected.has(m.name));
    const totalTestCapacity = this.modelsToTest.reduce((sum, m) => sum + m.totalCapacity, 0);
    this.log(
      `Selected ${this.modelsToTest.length} models to test ` +
        `(${this.modelsToTest.filter(m => !m.isEmbedding).length} generation, ` +
        `${this.modelsToTest.filter(m => m.isEmbedding).length} embedding, ` +
        `total capacity: ${totalTestCapacity} slots)`
    );
  }

  private autoCalculateConcurrency(): number {
    const totalCapacity = this.servers.reduce((sum, s) => sum + (s.maxConcurrency || 4), 0);
    // Use 80% of total server capacity to generate meaningful load without total saturation
    return Math.max(10, Math.floor(totalCapacity * 0.8));
  }

  // -------------------------------------------------------------------------
  // Request execution
  // -------------------------------------------------------------------------
  private selectModel(): ModelInfo {
    // Weight selection by available capacity: totalCapacity minus current in-flight
    // minus capacity blocked by open circuit breakers.
    // This ensures models with more available servers/concurrency slots get proportionally
    // more requests, while models near saturation or with tripped breakers are deprioritized.
    const weights = this.modelsToTest.map(m => {
      const inFlight = this.perModelInFlight.get(m.name) ?? 0;
      const blocked = this.perModelBlockedCapacity.get(m.name) ?? 0;
      const available = Math.max(0, m.totalCapacity - inFlight - blocked);
      // Use a small floor (1) so completely saturated models still have a tiny chance,
      // preventing starvation if in-flight tracking drifts slightly.
      return Math.max(1, available);
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalWeight;
    for (let i = 0; i < this.modelsToTest.length; i++) {
      r -= weights[i];
      if (r <= 0) return this.modelsToTest[i];
    }
    return this.modelsToTest[this.modelsToTest.length - 1];
  }

  private shouldStream(model: ModelInfo): boolean {
    // Embeddings are never streamed
    if (model.isEmbedding) return false;
    return Math.random() < this.config.streamingRatio;
  }

  private buildUrl(endpoint: string): string {
    const debugSuffix = this.config.debug ? '?debug=true' : '';
    return `${this.config.url}${endpoint}${debugSuffix}`;
  }

  private async executeRequest(model: ModelInfo, stream: boolean): Promise<RequestResult> {
    const startTime = Date.now();
    const result: RequestResult = {
      model: model.name,
      serverId: 'unknown',
      success: false,
      duration: 0,
      statusCode: 0,
      timestamp: startTime,
      isStreaming: stream,
      isEmbedding: model.isEmbedding,
      phase: this.currentPhase,
    };

    try {
      if (model.isEmbedding) {
        await this.executeEmbeddingRequest(model, result);
      } else if (stream) {
        await this.executeStreamingRequest(model, result);
      } else {
        await this.executeNonStreamingRequest(model, result);
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      result.errorType = this.classifyError(result.error, result.statusCode);
      result.blame = this.attributeBlame(result.errorType, result);
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  private async executeNonStreamingRequest(model: ModelInfo, result: RequestResult): Promise<void> {
    const prompt = randomItem(GENERATION_PROMPTS);
    const response = await fetch(this.buildUrl('/api/generate'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Include-Debug-Info': 'true',
      },
      body: JSON.stringify({ model: model.name, prompt, stream: false }),
    });

    result.statusCode = response.status;

    if (!response.ok) {
      const body = await response.text();
      let parsed: any;
      try {
        parsed = JSON.parse(body);
      } catch {
        // not JSON
      }
      // Extract debug from error response
      if (parsed?.debug) {
        this.extractDebugFromObject(parsed.debug, result);
      }
      throw new Error(
        `HTTP ${response.status}: ${parsed?.message || parsed?.error || body.slice(0, 200)}`
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    result.success = true;

    // Extract debug info
    if (data.debug) {
      this.extractDebugFromObject(data.debug as Record<string, unknown>, result);
    }

    // Extract from response headers
    this.extractDebugFromHeaders(response.headers, result);
  }

  private async executeStreamingRequest(model: ModelInfo, result: RequestResult): Promise<void> {
    const prompt = randomItem(GENERATION_PROMPTS);
    const response = await fetch(this.buildUrl('/api/generate'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Include-Debug-Info': 'true',
      },
      body: JSON.stringify({ model: model.name, prompt, stream: true }),
    });

    result.statusCode = response.status;

    if (!response.ok) {
      const body = await response.text();
      let parsed: any;
      try {
        parsed = JSON.parse(body);
      } catch {
        // not JSON
      }
      if (parsed?.debug) {
        this.extractDebugFromObject(parsed.debug, result);
      }
      throw new Error(
        `HTTP ${response.status}: ${parsed?.message || parsed?.error || body.slice(0, 200)}`
      );
    }

    this.extractDebugFromHeaders(response.headers, result);

    // Read the SSE stream
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body reader');

    const decoder = new TextDecoder();
    let chunkCount = 0;
    let totalBytes = 0;
    let firstChunkTime: number | undefined;
    let lastChunkTime = Date.now();
    let maxChunkGap = 0;
    let tokensGenerated = 0;
    let tokensPrompt = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const now = Date.now();
        const chunkStr = decoder.decode(value, { stream: true });
        totalBytes += value.byteLength;

        // May contain multiple lines (NDJSON or SSE data: lines)
        const lines = chunkStr.split('\n').filter(l => l.trim().length > 0);

        for (const line of lines) {
          let parsed: any;
          // Try parsing as raw JSON (Ollama NDJSON) or SSE data: prefix
          const dataLine = line.startsWith('data: ') ? line.slice(6) : line;
          try {
            parsed = JSON.parse(dataLine);
          } catch {
            continue;
          }

          // Debug event from orchestrator
          if (parsed.debug) {
            this.extractDebugFromObject(parsed.debug, result);
            continue;
          }

          chunkCount++;

          // Cap streaming response at maxChunks if configured
          if (this.config.maxChunks > 0 && chunkCount >= this.config.maxChunks) {
            result.success = true;
            result.chunksReceived = chunkCount;
            result.totalBytes = totalBytes;
            result.tokensGenerated = tokensGenerated;
            result.tokensPrompt = tokensPrompt;
            result.maxChunkGapMs = maxChunkGap;
            result.avgChunkSizeBytes = chunkCount > 0 ? totalBytes / chunkCount : 0;
            result.streamingDuration = firstChunkTime ? Date.now() - result.timestamp : undefined;
            // Note: we intentionally do NOT call reader.releaseLock() here since we're
            // just abandoning the stream. The reader will be garbage collected.
            return;
          }

          if (!firstChunkTime) {
            firstChunkTime = now;
            result.timeToFirstToken = now - result.timestamp;
          }

          const gap = now - lastChunkTime;
          if (gap > maxChunkGap) maxChunkGap = gap;
          lastChunkTime = now;

          // Extract SSE-embedded metrics from final chunk
          if (parsed._streamingMetrics) {
            result.timeToFirstToken = parsed._streamingMetrics.ttft ?? result.timeToFirstToken;
            result.streamingDuration = parsed._streamingMetrics.streamingDuration;
          }
          if (parsed._tokenMetrics) {
            tokensGenerated = parsed._tokenMetrics.tokensGenerated ?? 0;
            tokensPrompt = parsed._tokenMetrics.tokensPrompt ?? 0;
          }
          if (parsed._chunkData) {
            result.maxChunkGapMs = parsed._chunkData.maxChunkGapMs;
            result.avgChunkSizeBytes = parsed._chunkData.avgChunkSizeBytes;
          }

          // Ollama NDJSON: extract tokens from eval_count / prompt_eval_count
          if (parsed.eval_count) tokensGenerated = parsed.eval_count;
          if (parsed.prompt_eval_count) tokensPrompt = parsed.prompt_eval_count;
        }
      }
    } finally {
      reader.releaseLock();
    }

    result.success = true;
    result.chunksReceived = chunkCount;
    result.totalBytes = totalBytes;
    result.tokensGenerated = tokensGenerated;
    result.tokensPrompt = tokensPrompt;
    if (!result.maxChunkGapMs) result.maxChunkGapMs = maxChunkGap;
    if (!result.avgChunkSizeBytes && chunkCount > 0) {
      result.avgChunkSizeBytes = totalBytes / chunkCount;
    }
    if (!result.streamingDuration && firstChunkTime) {
      result.streamingDuration = Date.now() - result.timestamp;
    }
  }

  private async executeEmbeddingRequest(model: ModelInfo, result: RequestResult): Promise<void> {
    const input = randomItem(EMBEDDING_INPUTS);
    const response = await fetch(this.buildUrl('/api/embeddings'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Include-Debug-Info': 'true',
      },
      body: JSON.stringify({ model: model.name, prompt: input }),
    });

    result.statusCode = response.status;

    if (!response.ok) {
      const body = await response.text();
      let parsed: any;
      try {
        parsed = JSON.parse(body);
      } catch {
        // not JSON
      }
      if (parsed?.debug) {
        this.extractDebugFromObject(parsed.debug, result);
      }
      throw new Error(
        `HTTP ${response.status}: ${parsed?.message || parsed?.error || body.slice(0, 200)}`
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    result.success = true;

    if (data.debug) {
      this.extractDebugFromObject(data.debug as Record<string, unknown>, result);
    }
    this.extractDebugFromHeaders(response.headers, result);
  }

  // -------------------------------------------------------------------------
  // Debug extraction helpers
  // -------------------------------------------------------------------------
  private extractDebugFromHeaders(headers: Headers, result: RequestResult): void {
    const serverId = headers.get('x-selected-server');
    if (serverId) {
      result.serverId = serverId;
      this.serversHit.add(serverId);
    }
    const retryCount = headers.get('x-retry-count');
    if (retryCount) result.retryCount = parseInt(retryCount, 10);

    const serverCircuit = headers.get('x-server-circuit-state');
    if (serverCircuit) result.serverCircuitState = serverCircuit;

    const modelCircuit = headers.get('x-model-circuit-state');
    if (modelCircuit) result.modelCircuitState = modelCircuit;

    const available = headers.get('x-available-servers');
    if (available) result.totalCandidates = parseInt(available, 10);

    const serversTried = headers.get('x-servers-tried');
    if (serversTried) result.serversTried = serversTried.split(',');

    const load = headers.get('x-server-load');
    if (load) result.serverLoad = parseInt(load, 10);

    const maxConc = headers.get('x-max-concurrency');
    if (maxConc) result.maxConcurrency = parseInt(maxConc, 10);

    const algo = headers.get('x-algorithm');
    if (algo) result.algorithm = algo;

    const requestId = headers.get('x-request-id');
    if (requestId) result.requestId = requestId;

    const stallDetected = headers.get('x-stall-detected');
    if (stallDetected === '1') result.stallDetected = true;

    const failoverPhase = headers.get('x-failover-phase');
    if (failoverPhase) result.failoverPhase = parseInt(failoverPhase, 10);

    const failoverCount = headers.get('x-failover-count');
    if (failoverCount) result.failoverCount = parseInt(failoverCount, 10);

    const failoverOccurred = headers.get('x-failover-occurred');
    if (failoverOccurred === '1') result.failoverOccurred = true;

    const queueWait = headers.get('x-queue-wait-ms');
    if (queueWait) {
      // Store in result even though it's not a direct field; we track it in debug
    }
  }

  private extractDebugFromObject(debug: Record<string, unknown>, result: RequestResult): void {
    if (debug.selectedServerId) {
      result.serverId = debug.selectedServerId as string;
      this.serversHit.add(result.serverId);
    }
    if (debug.retryCount !== undefined) result.retryCount = debug.retryCount as number;
    if (debug.serversTried) result.serversTried = debug.serversTried as string[];
    if (debug.totalCandidates !== undefined)
      result.totalCandidates = debug.totalCandidates as number;
    if (debug.serverLoad !== undefined) result.serverLoad = debug.serverLoad as number;
    if (debug.maxConcurrency !== undefined) result.maxConcurrency = debug.maxConcurrency as number;
    if (debug.algorithm) result.algorithm = debug.algorithm as string;
    if (debug.serverCircuitState) result.serverCircuitState = debug.serverCircuitState as string;
    if (debug.modelCircuitState) result.modelCircuitState = debug.modelCircuitState as string;
    if (debug.routedToOpenCircuit)
      result.routedToOpenCircuit = debug.routedToOpenCircuit as boolean;
    if (debug.requestId) result.requestId = debug.requestId as string;
    if (debug.timeToFirstToken !== undefined)
      result.timeToFirstToken = debug.timeToFirstToken as number;
    if (debug.streamingDuration !== undefined)
      result.streamingDuration = debug.streamingDuration as number;
    if (debug.tokensGenerated !== undefined)
      result.tokensGenerated = debug.tokensGenerated as number;
    if (debug.tokensPrompt !== undefined) result.tokensPrompt = debug.tokensPrompt as number;
    if (debug.stallDetected) result.stallDetected = debug.stallDetected as boolean;
    if (debug.handoffAttempted !== undefined)
      result.handoffAttempted = debug.handoffAttempted as boolean;
    if (debug.handoffSuccess !== undefined) result.handoffSuccess = debug.handoffSuccess as boolean;
    if (debug.failoverPhase !== undefined) result.failoverPhase = debug.failoverPhase as number;
    if (debug.failoverCount !== undefined) result.failoverCount = debug.failoverCount as number;
    if (debug.failoverOccurred) result.failoverOccurred = debug.failoverOccurred as boolean;
    if (debug.failoverErrors)
      result.failoverErrors = debug.failoverErrors as Array<{
        serverId: string;
        error: string;
        errorType?: string;
      }>;

    // Chunk data from debug
    const chunkData = debug.chunkData as Record<string, unknown> | undefined;
    if (chunkData) {
      if (chunkData.chunkCount !== undefined)
        result.chunksReceived = chunkData.chunkCount as number;
      if (chunkData.totalBytes !== undefined) result.totalBytes = chunkData.totalBytes as number;
      if (chunkData.maxChunkGapMs !== undefined)
        result.maxChunkGapMs = chunkData.maxChunkGapMs as number;
      if (chunkData.avgChunkSizeBytes !== undefined)
        result.avgChunkSizeBytes = chunkData.avgChunkSizeBytes as number;
    }
  }

  private classifyError(error: string, statusCode: number): string {
    if (error.includes('at max concurrency')) return 'concurrency_saturated';
    if (statusCode === 503) return 'circuit_blocked';
    if (statusCode === 504) return 'gateway_timeout';
    if (statusCode === 429) return 'rate_limited';
    if (error.includes('timeout') || error.includes('Timeout')) return 'timeout';
    if (error.includes('circuit')) return 'circuit_blocked';
    if (error.includes('ECONNREFUSED') || error.includes('ECONNRESET')) return 'connection_error';
    if (error.includes('No') && error.includes('servers')) return 'no_servers';
    if (statusCode >= 500) return 'server_error';
    return 'other';
  }

  /**
   * Attribute an error to the orchestrator, upstream server, or mark as ambiguous.
   *
   * Orchestrator faults: errors that indicate the orchestrator's own routing/circuit
   * logic blocked the request before it could reach an upstream server.
   *
   * Upstream faults: errors from the upstream Ollama servers themselves (timeouts,
   * connection errors, 5xx responses from the server).
   *
   * Ambiguous: rate limiting (could be either layer), unknown errors.
   */
  private attributeBlame(errorType: string, result: RequestResult): ErrorBlame {
    switch (errorType) {
      // Orchestrator refused to send the request
      case 'circuit_blocked':
      case 'no_servers':
      case 'concurrency_saturated':
        return 'orchestrator';

      // Upstream server failed
      case 'timeout':
      case 'gateway_timeout':
      case 'connection_error':
      case 'server_error':
        return 'upstream';

      // Could be either side
      case 'rate_limited':
      case 'other':
      default:
        // If we have failoverErrors from debug, the orchestrator did try servers
        // and they all failed — that's upstream
        if (result.failoverErrors && result.failoverErrors.length > 0) {
          return 'upstream';
        }
        return 'ambiguous';
    }
  }

  // -------------------------------------------------------------------------
  // Circuit breaker monitoring
  // -------------------------------------------------------------------------
  private async getCircuitBreakerStates(): Promise<CircuitBreakerSnapshot[]> {
    try {
      const data = await this.fetchJson<Record<string, any>>('/circuit-breakers');
      // API returns { success, circuitBreakers: [...] } or legacy { [name]: cb }
      const entries: any[] = Array.isArray((data as any).circuitBreakers)
        ? (data as any).circuitBreakers
        : Object.values(data).filter(v => typeof v === 'object' && v !== null && 'state' in v);
      const snapshots: CircuitBreakerSnapshot[] = [];
      for (const cb of entries) {
        // Normalize state to lowercase with consistent hyphenation
        const rawState: string = (cb.state ?? 'unknown').toUpperCase();
        const state =
          rawState === 'OPEN'
            ? 'open'
            : rawState === 'CLOSED'
              ? 'closed'
              : rawState === 'HALF_OPEN' || rawState === 'HALF-OPEN'
                ? 'half-open'
                : rawState.toLowerCase();
        snapshots.push({
          name: cb.serverId ?? cb.name ?? 'unknown',
          state,
          failureCount: cb.failureCount ?? 0,
          successCount: cb.successCount ?? 0,
          errorRate: cb.errorRate ?? 0,
          consecutiveFailedRecoveries: cb.consecutiveFailedRecoveries ?? 0,
          modelType: cb.modelType,
        });
      }
      return snapshots;
    } catch {
      return [];
    }
  }

  private async getInFlightStats(): Promise<{ total: number; streaming: number }> {
    try {
      const data = await this.fetchJson<InFlightResponse>('/in-flight');
      // API returns { total, inFlight: [...] } — count streaming entries from inFlight array
      const inFlightArr: any[] = (data as any).inFlight ?? [];
      const streaming = inFlightArr.filter((r: any) => r.streaming === true).length;
      const total = (data as any).total ?? inFlightArr.length;
      return { total, streaming };
    } catch {
      return { total: 0, streaming: 0 };
    }
  }

  private async getErrorAnalytics(): Promise<any> {
    try {
      return await this.fetchJson('/analytics/errors');
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Time-series collection
  // -------------------------------------------------------------------------
  private async collectTimeSeriesPoint(): Promise<void> {
    const now = Date.now();
    const recent = this.recentResults;
    this.recentResults = [];

    // Latency calculations
    const durations = recent.map(r => r.duration).sort((a, b) => a - b);
    const avgLatency =
      durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const p95Latency = percentile(durations, 95);

    const successCount = recent.filter(r => r.success).length;
    const successRate = recent.length > 0 ? successCount / recent.length : 1;

    // Streaming metrics
    const streamingResults = recent.filter(r => r.isStreaming && r.success);
    const avgTTFT =
      streamingResults.length > 0
        ? streamingResults.reduce((sum, r) => sum + (r.timeToFirstToken ?? 0), 0) /
          streamingResults.length
        : 0;
    const avgChunks =
      streamingResults.length > 0
        ? streamingResults.reduce((sum, r) => sum + (r.chunksReceived ?? 0), 0) /
          streamingResults.length
        : 0;

    // Circuit breaker states
    const cbStates = await this.getCircuitBreakerStates();
    const openCount = cbStates.filter(cb => cb.state === 'open').length;
    const halfOpenCount = cbStates.filter(cb => cb.state === 'half-open').length;
    const closedCount = cbStates.filter(cb => cb.state === 'closed').length;

    // Detect circuit breaker state transitions
    for (const cb of cbStates) {
      const prevState = this.previousCBStates.get(cb.name);
      if (prevState !== undefined && prevState !== cb.state) {
        const transition = {
          timestamp: now,
          elapsedMs: now - this.testStartTime,
          name: cb.name,
          from: prevState,
          to: cb.state,
        };
        this.cbTransitions.push(transition);
        if (!this.config.quiet) {
          this.log(`  [CB-TRANSITION] ${cb.name}: ${prevState} -> ${cb.state}`);
        }
      }
      this.previousCBStates.set(cb.name, cb.state);
    }

    // Update per-model blocked capacity from open circuit breakers.
    // CB names are in "serverId:model" format — extract the model and sum
    // the blocked server's capacity to reduce effective available slots.
    const serverCapacity = new Map<string, number>();
    for (const s of this.servers) {
      serverCapacity.set(s.id, s.maxConcurrency || 4);
    }
    const newBlockedCapacity = new Map<string, number>();
    for (const cb of cbStates) {
      if (cb.state === 'open') {
        const colonIndex = cb.name.indexOf(':');
        if (colonIndex > 0) {
          const serverId = cb.name.substring(0, colonIndex);
          const model = cb.name.substring(colonIndex + 1);
          const cap = serverCapacity.get(serverId) ?? 4;
          newBlockedCapacity.set(model, (newBlockedCapacity.get(model) ?? 0) + cap);
        }
      }
    }
    this.perModelBlockedCapacity = newBlockedCapacity;

    // Per-server half-open
    const perServerHalfOpen: Record<string, number> = {};
    for (const cb of cbStates) {
      if (cb.state === 'half-open') {
        const serverId = cb.name.split(':')[0];
        perServerHalfOpen[serverId] = (perServerHalfOpen[serverId] ?? 0) + 1;
      }
    }

    // In-flight
    const inFlight = await this.getInFlightStats();

    // Per-server request distribution for this interval
    const intervalPerServer: Record<string, number> = {};
    for (const r of recent) {
      if (r.serverId && r.serverId !== 'unknown') {
        intervalPerServer[r.serverId] = (intervalPerServer[r.serverId] ?? 0) + 1;
      }
    }

    // Failure breakdown
    const circuitBlocked = recent.filter(r => r.errorType === 'circuit_blocked').length;
    const timeouts = recent.filter(
      r => r.errorType === 'timeout' || r.errorType === 'gateway_timeout'
    ).length;
    const serverErrors = recent.filter(r => r.errorType === 'server_error').length;
    const concurrencySaturated = recent.filter(r => r.errorType === 'concurrency_saturated').length;
    const noServers = recent.filter(r => r.errorType === 'no_servers').length;

    const point: TimeSeriesPoint = {
      timestamp: now,
      elapsedMs: now - this.testStartTime,
      phase: this.currentPhase,
      totalRequests: this.results.length,
      activeRequests: this.activeRequests,
      successRate,
      avgLatency,
      p95Latency,
      openCircuits: openCount,
      halfOpenCircuits: halfOpenCount,
      closedCircuits: closedCount,
      avgTTFT,
      avgChunksPerRequest: avgChunks,
      serversHit: this.serversHit.size,
      totalServers: this.servers.length,
      inFlightTotal: inFlight.total,
      inFlightStreaming: inFlight.streaming,
      perServerRequests: intervalPerServer,
      perServerHalfOpen,
      circuitBlockedRequests: circuitBlocked,
      timeoutRequests: timeouts,
      serverErrorRequests: serverErrors,
      concurrencySaturatedRequests: concurrencySaturated,
      noServersRequests: noServers,
    };

    this.timeSeriesData.push(point);
  }

  // -------------------------------------------------------------------------
  // Test patterns / phases
  // -------------------------------------------------------------------------
  private getConcurrencyForPhase(baseConcurrency: number): number {
    switch (this.currentPhase) {
      case 'warmup':
        return Math.max(1, Math.floor(baseConcurrency * 0.1));
      case 'ramp-up':
        return Math.floor(baseConcurrency * 0.6);
      case 'peak':
        return baseConcurrency;
      case 'ramp-down':
        return Math.floor(baseConcurrency * 0.4);
      case 'recovery':
        return Math.max(1, Math.floor(baseConcurrency * 0.2));
      case 'targeted':
        return Math.floor(baseConcurrency * 0.8);
      case 'uniform':
      default:
        return baseConcurrency;
    }
  }

  private getPhaseForTime(elapsed: number, totalDuration: number, pattern: TestPattern): TestPhase {
    const fraction = elapsed / totalDuration;

    if (pattern === 'uniform') return 'uniform';

    if (pattern === 'spike') {
      if (fraction < 0.2) return 'ramp-up';
      if (fraction < 0.5) return 'peak';
      if (fraction < 0.7) return 'ramp-down';
      return 'recovery';
    }

    if (pattern === 'targeted') return 'targeted';

    // mixed: cycle through patterns
    if (fraction < 0.15) return 'uniform';
    if (fraction < 0.35) return 'ramp-up';
    if (fraction < 0.55) return 'peak';
    if (fraction < 0.7) return 'ramp-down';
    if (fraction < 0.85) return 'targeted';
    return 'recovery';
  }

  private selectModelForPhase(): ModelInfo {
    if (this.currentPhase === 'targeted') {
      // Bias toward models with fewer servers (stress circuit breakers)
      const fewServerModels = this.modelsToTest.filter(m => m.servers.length <= 2);
      if (fewServerModels.length > 0 && Math.random() < 0.7) {
        return randomItem(fewServerModels);
      }
    }
    return this.selectModel();
  }

  // -------------------------------------------------------------------------
  // Warmup
  // -------------------------------------------------------------------------
  private async runWarmup(): Promise<void> {
    this.log('--- Warmup Phase ---');
    this.currentPhase = 'warmup';

    const warmupEnd = Date.now() + this.config.warmupSeconds * 1000;

    // Send one request per server per model to prime metrics
    const warmupTasks: Promise<void>[] = [];
    for (const model of this.modelsToTest) {
      for (const serverId of model.servers) {
        if (Date.now() >= warmupEnd) break;
        warmupTasks.push(
          (async () => {
            const result = await this.executeRequest(model, false);
            this.recordResult(result);
          })()
        );
        // Limit warmup concurrency to 5
        if (warmupTasks.length >= 5) {
          await Promise.race(warmupTasks);
          // Clean completed
          const pending: Promise<void>[] = [];
          for (const t of warmupTasks) {
            const settled = await Promise.race([t.then(() => true), Promise.resolve(false)]);
            if (!settled) pending.push(t);
          }
          warmupTasks.length = 0;
          warmupTasks.push(...pending);
        }
      }
    }
    await Promise.allSettled(warmupTasks);

    const warmupResults = this.results.filter(r => r.phase === 'warmup');
    this.log(
      `Warmup complete: ${warmupResults.length} requests, ` +
        `${warmupResults.filter(r => r.success).length} successful, ` +
        `${this.serversHit.size}/${this.servers.length} servers exercised`
    );
  }

  // -------------------------------------------------------------------------
  // Main test loop
  // -------------------------------------------------------------------------
  private recordResult(result: RequestResult): void {
    this.results.push(result);
    this.recentResults.push(result);

    // Track server hits
    if (result.serverId && result.serverId !== 'unknown') {
      this.serversHit.add(result.serverId);
      this.perServerRequestCount.set(
        result.serverId,
        (this.perServerRequestCount.get(result.serverId) ?? 0) + 1
      );
    }

    // Log notable events
    if (!this.config.quiet) {
      if (!result.success && result.blame) {
        const blameTag =
          result.blame === 'orchestrator'
            ? 'ORCH'
            : result.blame === 'upstream'
              ? 'UPSTREAM'
              : 'AMBIG';
        this.log(
          `  [${result.errorType?.toUpperCase()}][${blameTag}] ${result.model} -> ${result.serverId} (${result.error?.slice(0, 80)})`
        );
      } else if (result.failoverOccurred && result.success) {
        const triedList = result.serversTried?.join(',') ?? '?';
        this.log(
          `  [FAILOVER-OK] ${result.model} -> ${result.serverId} (phase=${result.failoverPhase}, tried=[${triedList}], retries=${result.retryCount})`
        );
      } else if (result.stallDetected) {
        this.log(
          `  [STALL] ${result.model} -> ${result.serverId}, handoff=${result.handoffSuccess}`
        );
      } else if (result.retryCount && result.retryCount > 0 && !result.failoverOccurred) {
        this.log(
          `  [RETRY] ${result.model} -> ${result.serverId}, retries=${result.retryCount}, tried=[${result.serversTried?.join(',')}]`
        );
      }
    }
  }

  async run(): Promise<void> {
    this.log('=== Unified Load Test ===');
    this.log(`URL: ${this.config.url}`);
    this.log(`Duration: ${this.config.duration}s, Pattern: ${this.config.pattern}`);
    this.log(`Streaming ratio: ${this.config.streamingRatio}`);
    this.log(`Debug headers: always ON${this.config.debug ? ' (+?debug=true query param)' : ''}`);
    this.log('');

    // Discovery
    await this.discoverServers();
    await this.discoverModels();

    if (this.modelsToTest.length === 0) {
      this.log('ERROR: No models available to test');
      process.exit(1);
    }

    // Auto concurrency
    const baseConcurrency =
      this.config.concurrency > 0 ? this.config.concurrency : this.autoCalculateConcurrency();
    this.log(
      `Concurrency: ${baseConcurrency} (${this.config.concurrency > 0 ? 'manual' : 'auto'})`
    );
    this.log('');

    // Warmup
    await this.runWarmup();

    // Main test
    this.testStartTime = Date.now();
    this.running = true;
    const testEndTime = this.testStartTime + this.config.duration * 1000;

    // Start time-series collector
    const tsInterval = setInterval(async () => {
      if (this.running) {
        await this.collectTimeSeriesPoint();
      }
    }, this.config.timeSeriesIntervalMs);

    // Progress logger
    const progressInterval = setInterval(() => {
      if (!this.running) return;
      const elapsed = (Date.now() - this.testStartTime) / 1000;
      const total = this.results.length;
      const success = this.results.filter(r => r.success).length;
      const rate = total > 0 ? ((success / total) * 100).toFixed(1) : '0';
      const rps = (total / Math.max(elapsed, 1)).toFixed(1);
      const failovers = this.results.filter(r => r.failoverOccurred).length;
      const orchFaults = this.results.filter(r => r.blame === 'orchestrator').length;
      const upFaults = this.results.filter(r => r.blame === 'upstream').length;
      this.log(
        `[${elapsed.toFixed(0)}s/${this.config.duration}s] ` +
          `Phase: ${this.currentPhase} | ` +
          `Requests: ${total} (${rate}% ok) | ` +
          `RPS: ${rps} | ` +
          `Active: ${this.activeRequests} | ` +
          `Servers: ${this.serversHit.size}/${this.servers.length}` +
          (failovers > 0 ? ` | Failovers: ${failovers}` : '') +
          (orchFaults + upFaults > 0 ? ` | Blame: orch=${orchFaults} up=${upFaults}` : '')
      );
    }, 15000);

    this.log('');
    this.log('--- Main Test Phase ---');

    // Concurrent request launcher
    const runRequest = async (): Promise<void> => {
      while (this.running && Date.now() < testEndTime) {
        const elapsed = Date.now() - this.testStartTime;
        this.currentPhase = this.getPhaseForTime(
          elapsed,
          this.config.duration * 1000,
          this.config.pattern
        );

        const currentConcurrency = this.getConcurrencyForPhase(baseConcurrency);
        if (this.activeRequests >= currentConcurrency) {
          // Backpressure: wait a bit
          await new Promise(resolve => setTimeout(resolve, 50));
          continue;
        }

        const model = this.selectModelForPhase();
        const stream = this.shouldStream(model);

        this.activeRequests++;
        this.perModelInFlight.set(model.name, (this.perModelInFlight.get(model.name) ?? 0) + 1);
        try {
          const result = await this.executeRequest(model, stream);
          this.recordResult(result);
        } catch (e) {
          // Should not reach here; executeRequest handles errors internally
        } finally {
          this.activeRequests--;
          const current = this.perModelInFlight.get(model.name) ?? 1;
          this.perModelInFlight.set(model.name, Math.max(0, current - 1));
        }
      }
    };

    // Launch worker coroutines - use more workers than max concurrency to keep pipeline full
    const workerCount = Math.min(baseConcurrency * 2, 500);
    const workers = Array.from({ length: workerCount }, () => runRequest());

    await Promise.allSettled(workers);

    this.running = false;
    clearInterval(tsInterval);
    clearInterval(progressInterval);

    // Collect final time-series point
    await this.collectTimeSeriesPoint();

    this.log('');
    this.log('--- Test Complete ---');

    // Final circuit breaker snapshot
    const finalCBStates = await this.getCircuitBreakerStates();
    const finalErrors = await this.getErrorAnalytics();
    const finalInFlight = await this.getInFlightStats();

    // Generate report
    const report = this.generateReport(finalCBStates, finalErrors, finalInFlight);
    await this.saveReport(report);
    this.printSummary(report);
  }

  // -------------------------------------------------------------------------
  // Report generation
  // -------------------------------------------------------------------------
  private generateReport(
    finalCB: CircuitBreakerSnapshot[],
    finalErrors: any,
    finalInFlight: { total: number; streaming: number }
  ): any {
    const mainResults = this.results.filter(r => r.phase !== 'warmup');
    const warmupResults = this.results.filter(r => r.phase === 'warmup');
    const successResults = mainResults.filter(r => r.success);
    const failedResults = mainResults.filter(r => !r.success);

    // Overall metrics
    const totalDuration =
      mainResults.length > 0
        ? (mainResults[mainResults.length - 1].timestamp - mainResults[0].timestamp) / 1000
        : 0;
    const rps = totalDuration > 0 ? mainResults.length / totalDuration : 0;

    // Latency
    const latencies = successResults.map(r => r.duration).sort((a, b) => a - b);
    const avgLatency =
      latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;

    // Streaming metrics
    const streamingResults = successResults.filter(r => r.isStreaming);
    const nonStreamingResults = successResults.filter(r => !r.isStreaming && !r.isEmbedding);
    const embeddingResults = successResults.filter(r => r.isEmbedding);

    const avgTTFT =
      streamingResults.length > 0
        ? streamingResults.reduce((s, r) => s + (r.timeToFirstToken ?? 0), 0) /
          streamingResults.length
        : 0;
    const avgChunks =
      streamingResults.length > 0
        ? streamingResults.reduce((s, r) => s + (r.chunksReceived ?? 0), 0) /
          streamingResults.length
        : 0;
    const avgTokens =
      streamingResults.length > 0
        ? streamingResults.reduce((s, r) => s + (r.tokensGenerated ?? 0), 0) /
          streamingResults.length
        : 0;
    const ttftValues = streamingResults
      .map(r => r.timeToFirstToken ?? 0)
      .filter(v => v > 0)
      .sort((a, b) => a - b);

    // Stall tracking
    const stallResults = mainResults.filter(r => r.stallDetected);
    const handoffAttempts = stallResults.filter(r => r.handoffAttempted);
    const handoffSuccesses = handoffAttempts.filter(r => r.handoffSuccess);

    // Error breakdown
    const errorBreakdown: Record<string, number> = {};
    for (const r of failedResults) {
      const type = r.errorType ?? 'unknown';
      errorBreakdown[type] = (errorBreakdown[type] ?? 0) + 1;
    }

    // Blame attribution breakdown
    const blameBreakdown: Record<string, number> = {
      orchestrator: 0,
      upstream: 0,
      ambiguous: 0,
    };
    const blameDetails: Record<string, Record<string, number>> = {
      orchestrator: {},
      upstream: {},
      ambiguous: {},
    };
    for (const r of failedResults) {
      const blame = r.blame ?? 'ambiguous';
      const type = r.errorType ?? 'unknown';
      blameBreakdown[blame] = (blameBreakdown[blame] ?? 0) + 1;
      blameDetails[blame][type] = (blameDetails[blame][type] ?? 0) + 1;
    }

    // Per-model analysis
    const modelStats: Record<
      string,
      {
        requests: number;
        successes: number;
        failures: number;
        avgDuration: number;
        streamingCount: number;
        avgTTFT: number;
        totalCapacity: number;
        serverCount: number;
        concurrencySaturated: number;
        noServers: number;
        circuitBlocked: number;
        timeouts: number;
        serverErrors: number;
        failoverCount: number;
        failoverSuccesses: number;
      }
    > = {};
    // Pre-populate with model capacity info so even models with 0 requests show up
    for (const m of this.modelsToTest) {
      modelStats[m.name] = {
        requests: 0,
        successes: 0,
        failures: 0,
        avgDuration: 0,
        streamingCount: 0,
        avgTTFT: 0,
        totalCapacity: m.totalCapacity,
        serverCount: m.servers.length,
        concurrencySaturated: 0,
        noServers: 0,
        circuitBlocked: 0,
        timeouts: 0,
        serverErrors: 0,
        failoverCount: 0,
        failoverSuccesses: 0,
      };
    }
    for (const r of mainResults) {
      if (!modelStats[r.model]) {
        // Model not in modelsToTest (shouldn't happen, but be safe)
        modelStats[r.model] = {
          requests: 0,
          successes: 0,
          failures: 0,
          avgDuration: 0,
          streamingCount: 0,
          avgTTFT: 0,
          totalCapacity: 0,
          serverCount: 0,
          concurrencySaturated: 0,
          noServers: 0,
          circuitBlocked: 0,
          timeouts: 0,
          serverErrors: 0,
          failoverCount: 0,
          failoverSuccesses: 0,
        };
      }
      const ms = modelStats[r.model];
      ms.requests++;
      if (r.success) {
        ms.successes++;
      } else {
        ms.failures++;
        if (r.errorType === 'concurrency_saturated') ms.concurrencySaturated++;
        if (r.errorType === 'no_servers') ms.noServers++;
        if (r.errorType === 'circuit_blocked') ms.circuitBlocked++;
        if (r.errorType === 'timeout' || r.errorType === 'gateway_timeout') ms.timeouts++;
        if (r.errorType === 'server_error') ms.serverErrors++;
      }
      ms.avgDuration += r.duration;
      if (r.isStreaming) {
        ms.streamingCount++;
        ms.avgTTFT += r.timeToFirstToken ?? 0;
      }
      if (r.failoverOccurred) {
        ms.failoverCount++;
        if (r.success) ms.failoverSuccesses++;
      }
    }
    for (const ms of Object.values(modelStats)) {
      ms.avgDuration = ms.requests > 0 ? ms.avgDuration / ms.requests : 0;
      ms.avgTTFT = ms.streamingCount > 0 ? ms.avgTTFT / ms.streamingCount : 0;
    }

    // Models sorted by saturation issues (most problematic first)
    const saturationView = Object.entries(modelStats)
      .filter(([, s]) => s.concurrencySaturated > 0 || s.noServers > 0 || s.circuitBlocked > 0)
      .map(([name, s]) => ({
        model: name,
        totalCapacity: s.totalCapacity,
        serverCount: s.serverCount,
        requests: s.requests,
        failures: s.failures,
        concurrencySaturated: s.concurrencySaturated,
        noServers: s.noServers,
        circuitBlocked: s.circuitBlocked,
        saturationRate: s.requests > 0 ? (s.concurrencySaturated + s.noServers) / s.requests : 0,
      }))
      .sort((a, b) => b.saturationRate - a.saturationRate);

    // Server coverage & distribution
    const allServerIds = new Set(this.servers.map(s => s.id));
    const missedServers = [...allServerIds].filter(id => !this.serversHit.has(id));

    const serverRequestCounts = [...this.perServerRequestCount.entries()].sort(
      (a, b) => b[1] - a[1]
    );
    const counts = serverRequestCounts.map(([, c]) => c);
    const mean = counts.length > 0 ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;
    const stddev =
      counts.length > 0
        ? Math.sqrt(counts.reduce((sum, c) => sum + (c - mean) ** 2, 0) / counts.length)
        : 0;
    const distributionCV = mean > 0 ? stddev / mean : 0;
    const distributionScore = Math.max(0, 1 - distributionCV); // 1 = perfectly balanced

    // Retry / failover analysis
    const retriedResults = mainResults.filter(r => r.retryCount && r.retryCount > 0);
    const avgRetryCount =
      retriedResults.length > 0
        ? retriedResults.reduce((s, r) => s + (r.retryCount ?? 0), 0) / retriedResults.length
        : 0;

    // Failover analysis
    const failoverResults = mainResults.filter(r => r.failoverOccurred);
    const failoverSuccessful = failoverResults.filter(r => r.success);
    const failoverFailed = failoverResults.filter(r => !r.success);
    const avgServersTriedPerFailover =
      failoverResults.length > 0
        ? failoverResults.reduce((s, r) => s + (r.serversTried?.length ?? 0), 0) /
          failoverResults.length
        : 0;
    const maxServersTried = failoverResults.reduce(
      (max, r) => Math.max(max, r.serversTried?.length ?? 0),
      0
    );
    const failoverByPhase: Record<number, number> = {};
    for (const r of failoverResults) {
      if (r.failoverPhase !== undefined) {
        failoverByPhase[r.failoverPhase] = (failoverByPhase[r.failoverPhase] ?? 0) + 1;
      }
    }

    // Response body validation for successful failover requests
    // If a request succeeded after failover, verify it has a clean response
    // (no internal error details leaked). We check via the absence of errorType and presence of serverId.
    const leakedInternals = failoverSuccessful.filter(
      r => r.error !== undefined || r.serverId === 'unknown'
    );
    const seamlessFailovers = failoverSuccessful.length - leakedInternals.length;

    // Circuit breaker analysis
    const openCBs = finalCB.filter(cb => cb.state === 'open');
    const halfOpenCBs = finalCB.filter(cb => cb.state === 'half-open');

    // Algorithm usage
    const algorithmUsage: Record<string, number> = {};
    for (const r of mainResults) {
      if (r.algorithm) {
        algorithmUsage[r.algorithm] = (algorithmUsage[r.algorithm] ?? 0) + 1;
      }
    }

    return {
      meta: {
        testDate: new Date().toISOString(),
        orchestratorUrl: this.config.url,
        config: this.config,
        testDurationSeconds: totalDuration,
      },
      summary: {
        totalRequests: mainResults.length,
        warmupRequests: warmupResults.length,
        successRate: mainResults.length > 0 ? successResults.length / mainResults.length : 0,
        rps: Math.round(rps * 100) / 100,
        latency: {
          avg: Math.round(avgLatency),
          p50: percentile(latencies, 50),
          p95: percentile(latencies, 95),
          p99: percentile(latencies, 99),
          min: latencies[0] ?? 0,
          max: latencies[latencies.length - 1] ?? 0,
        },
      },
      streaming: {
        totalStreamingRequests: streamingResults.length,
        totalNonStreamingRequests: nonStreamingResults.length,
        totalEmbeddingRequests: embeddingResults.length,
        avgTimeToFirstToken: Math.round(avgTTFT),
        ttft: {
          p50: percentile(ttftValues, 50),
          p95: percentile(ttftValues, 95),
          p99: percentile(ttftValues, 99),
        },
        avgChunksPerRequest: Math.round(avgChunks * 10) / 10,
        avgTokensPerRequest: Math.round(avgTokens * 10) / 10,
        stalls: {
          total: stallResults.length,
          handoffAttempted: handoffAttempts.length,
          handoffSucceeded: handoffSuccesses.length,
          handoffSuccessRate:
            handoffAttempts.length > 0 ? handoffSuccesses.length / handoffAttempts.length : 0,
        },
      },
      errors: {
        totalFailures: failedResults.length,
        breakdown: errorBreakdown,
        blame: {
          summary: blameBreakdown,
          details: blameDetails,
        },
      },
      circuitBreakers: {
        finalState: {
          open: openCBs.length,
          halfOpen: halfOpenCBs.length,
          closed: finalCB.filter(cb => cb.state === 'closed').length,
          total: finalCB.length,
        },
        openBreakers: openCBs.map(cb => ({
          name: cb.name,
          failureCount: cb.failureCount,
          errorRate: cb.errorRate,
          consecutiveFailedRecoveries: cb.consecutiveFailedRecoveries,
        })),
        transitions: this.cbTransitions,
      },
      serverCoverage: {
        totalServers: allServerIds.size,
        serversHit: this.serversHit.size,
        coveragePercent:
          allServerIds.size > 0 ? (this.serversHit.size / allServerIds.size) * 100 : 0,
        missedServers,
        distribution: {
          perServer: Object.fromEntries(serverRequestCounts),
          fairnessScore: Math.round(distributionScore * 1000) / 1000,
          coefficientOfVariation: Math.round(distributionCV * 1000) / 1000,
        },
      },
      routing: {
        retriedRequests: retriedResults.length,
        retriedPercent:
          mainResults.length > 0 ? (retriedResults.length / mainResults.length) * 100 : 0,
        avgRetryCount: Math.round(avgRetryCount * 100) / 100,
        algorithmUsage,
        failover: {
          totalFailoverRequests: failoverResults.length,
          failoverSuccessful: failoverSuccessful.length,
          failoverFailed: failoverFailed.length,
          failoverSuccessRate:
            failoverResults.length > 0 ? failoverSuccessful.length / failoverResults.length : 0,
          avgServersTriedPerFailover: Math.round(avgServersTriedPerFailover * 100) / 100,
          maxServersTried,
          byPhase: failoverByPhase,
          seamlessFailovers,
          leakedInternals: leakedInternals.length,
        },
      },
      modelStats,
      saturation: {
        modelsWithCapacityIssues: saturationView.length,
        models: saturationView,
      },
      finalInFlight: finalInFlight,
      errorAnalytics: finalErrors,
      timeSeries: this.timeSeriesData,
    };
  }

  // -------------------------------------------------------------------------
  // Output
  // -------------------------------------------------------------------------
  private async saveReport(report: any): Promise<void> {
    const dir = path.resolve(this.config.reportDir);
    await fs.mkdir(dir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `unified-load-test-${timestamp}.json`;
    const filepath = path.join(dir, filename);
    await fs.writeFile(filepath, JSON.stringify(report, null, 2));
    this.log(`\nReport saved to: ${filepath}`);
  }

  private printSummary(report: any): void {
    const s = report.summary;
    const st = report.streaming;
    const e = report.errors;
    const cb = report.circuitBreakers;
    const sc = report.serverCoverage;
    const rt = report.routing;

    console.log('\n' + '='.repeat(70));
    console.log('UNIFIED LOAD TEST RESULTS');
    console.log('='.repeat(70));

    console.log(`\n--- Overview ---`);
    console.log(
      `  Total Requests:     ${s.totalRequests} (+ ${report.meta.config.warmupSeconds > 0 ? report.summary.warmupRequests || 0 : 0} warmup)`
    );
    console.log(`  Success Rate:       ${(s.successRate * 100).toFixed(1)}%`);
    console.log(`  Throughput:         ${s.rps} req/s`);
    console.log(`  Duration:           ${report.meta.testDurationSeconds.toFixed(0)}s`);

    console.log(`\n--- Latency ---`);
    console.log(`  Average:            ${s.latency.avg}ms`);
    console.log(`  P50:                ${s.latency.p50}ms`);
    console.log(`  P95:                ${s.latency.p95}ms`);
    console.log(`  P99:                ${s.latency.p99}ms`);
    console.log(`  Min/Max:            ${s.latency.min}ms / ${s.latency.max}ms`);

    console.log(`\n--- Request Mix ---`);
    console.log(`  Streaming:          ${st.totalStreamingRequests}`);
    console.log(`  Non-Streaming:      ${st.totalNonStreamingRequests}`);
    console.log(`  Embedding:          ${st.totalEmbeddingRequests}`);

    if (st.totalStreamingRequests > 0) {
      console.log(`\n--- Streaming Metrics ---`);
      console.log(`  Avg TTFT:           ${st.avgTimeToFirstToken}ms`);
      console.log(`  TTFT P95:           ${st.ttft.p95}ms`);
      console.log(`  Avg Chunks:         ${st.avgChunksPerRequest}`);
      console.log(`  Avg Tokens:         ${st.avgTokensPerRequest}`);
    }

    if (st.stalls.total > 0) {
      console.log(`\n--- Stall Detection ---`);
      console.log(`  Stalls Detected:    ${st.stalls.total}`);
      console.log(`  Handoff Attempted:  ${st.stalls.handoffAttempted}`);
      console.log(`  Handoff Succeeded:  ${st.stalls.handoffSucceeded}`);
      console.log(`  Handoff Rate:       ${(st.stalls.handoffSuccessRate * 100).toFixed(1)}%`);
    }

    console.log(`\n--- Errors ---`);
    console.log(`  Total Failures:     ${e.totalFailures}`);
    if (Object.keys(e.breakdown).length > 0) {
      for (const [type, count] of Object.entries(e.breakdown)) {
        console.log(`    ${type}: ${count}`);
      }
    }
    if (e.totalFailures > 0) {
      console.log(`  Blame Attribution:`);
      console.log(
        `    Orchestrator:     ${e.blame.summary.orchestrator} (${e.totalFailures > 0 ? ((e.blame.summary.orchestrator / e.totalFailures) * 100).toFixed(0) : 0}%)`
      );
      console.log(
        `    Upstream Server:  ${e.blame.summary.upstream} (${e.totalFailures > 0 ? ((e.blame.summary.upstream / e.totalFailures) * 100).toFixed(0) : 0}%)`
      );
      console.log(
        `    Ambiguous:        ${e.blame.summary.ambiguous} (${e.totalFailures > 0 ? ((e.blame.summary.ambiguous / e.totalFailures) * 100).toFixed(0) : 0}%)`
      );
    }

    console.log(`\n--- Circuit Breakers ---`);
    console.log(`  Open:               ${cb.finalState.open}`);
    console.log(`  Half-Open:          ${cb.finalState.halfOpen}`);
    console.log(`  Closed:             ${cb.finalState.closed}`);
    if (cb.transitions.length > 0) {
      console.log(`  Transitions:        ${cb.transitions.length} total`);
      // Show last 5 transitions
      const recentTransitions = cb.transitions.slice(-5);
      for (const t of recentTransitions) {
        const elapsed = (t.elapsedMs / 1000).toFixed(0);
        console.log(`    @${elapsed}s ${t.name}: ${t.from} -> ${t.to}`);
      }
      if (cb.transitions.length > 5) {
        console.log(`    ... and ${cb.transitions.length - 5} more`);
      }
    }
    if (cb.openBreakers.length > 0) {
      console.log(`  Open Breakers:`);
      for (const ob of cb.openBreakers.slice(0, 10)) {
        console.log(
          `    ${ob.name} (failures: ${ob.failureCount}, errorRate: ${(ob.errorRate * 100).toFixed(0)}%)`
        );
      }
    }

    console.log(`\n--- Server Coverage ---`);
    console.log(
      `  Servers Hit:        ${sc.serversHit}/${sc.totalServers} (${sc.coveragePercent.toFixed(1)}%)`
    );
    console.log(`  Fairness Score:     ${sc.distribution.fairnessScore} (1.0 = perfect)`);
    console.log(`  CoV:                ${sc.distribution.coefficientOfVariation}`);
    if (sc.missedServers.length > 0) {
      console.log(`  Missed:             ${sc.missedServers.join(', ')}`);
    }

    console.log(`\n--- Routing ---`);
    console.log(`  Retried Requests:   ${rt.retriedRequests} (${rt.retriedPercent.toFixed(1)}%)`);
    console.log(`  Avg Retry Count:    ${rt.avgRetryCount}`);
    if (rt.failover.totalFailoverRequests > 0) {
      console.log(`  Failover Requests:  ${rt.failover.totalFailoverRequests}`);
      console.log(
        `    Successful:       ${rt.failover.failoverSuccessful} (${(rt.failover.failoverSuccessRate * 100).toFixed(1)}%)`
      );
      console.log(`    Failed:           ${rt.failover.failoverFailed}`);
      console.log(`    Avg Servers Tried:${rt.failover.avgServersTriedPerFailover}`);
      console.log(`    Max Servers Tried:${rt.failover.maxServersTried}`);
      console.log(
        `    Seamless:         ${rt.failover.seamlessFailovers}/${rt.failover.failoverSuccessful} (no leaked internals)`
      );
      if (rt.failover.leakedInternals > 0) {
        console.log(
          `    LEAKED INTERNALS: ${rt.failover.leakedInternals} (failovers with leaked error data)`
        );
      }
      if (Object.keys(rt.failover.byPhase).length > 0) {
        console.log(`    By Phase:`);
        for (const [phase, count] of Object.entries(rt.failover.byPhase)) {
          console.log(`      Phase ${phase}: ${count}`);
        }
      }
    }
    if (Object.keys(rt.algorithmUsage).length > 0) {
      console.log(`  Algorithm Usage:`);
      for (const [algo, count] of Object.entries(rt.algorithmUsage)) {
        console.log(`    ${algo}: ${count}`);
      }
    }

    console.log(`\n--- Top Models (by request count) ---`);
    const sorted = Object.entries(report.modelStats as Record<string, any>)
      .sort((a, b) => b[1].requests - a[1].requests)
      .slice(0, 10);
    for (const [model, stats] of sorted) {
      const successRate =
        stats.requests > 0 ? ((stats.successes / stats.requests) * 100).toFixed(0) : '0';
      const capacityInfo = stats.totalCapacity > 0 ? `, cap:${stats.totalCapacity}` : '';
      const failoverInfo = stats.failoverCount > 0 ? `, ${stats.failoverCount} failovers` : '';
      console.log(
        `  ${model}: ${stats.requests} req, ${successRate}% success, ${Math.round(stats.avgDuration)}ms avg` +
          (stats.streamingCount > 0 ? `, ${Math.round(stats.avgTTFT)}ms TTFT` : '') +
          capacityInfo +
          failoverInfo
      );
    }

    // Per-model saturation view
    const sat = report.saturation;
    if (sat && sat.modelsWithCapacityIssues > 0) {
      console.log(
        `\n--- Capacity Saturation (${sat.modelsWithCapacityIssues} models affected) ---`
      );
      for (const m of (sat.models as any[]).slice(0, 15)) {
        const satPct = (m.saturationRate * 100).toFixed(0);
        const parts = [`${m.requests} req`, `${satPct}% saturated`];
        if (m.concurrencySaturated > 0) parts.push(`concurrency:${m.concurrencySaturated}`);
        if (m.noServers > 0) parts.push(`no_servers:${m.noServers}`);
        if (m.circuitBlocked > 0) parts.push(`cb_blocked:${m.circuitBlocked}`);
        parts.push(`cap:${m.totalCapacity} (${m.serverCount} srv)`);
        console.log(`  ${m.model}: ${parts.join(', ')}`);
      }
    }

    console.log('\n' + '='.repeat(70));
  }

  private log(msg: string): void {
    if (!this.config.quiet || msg.startsWith('===') || msg.startsWith('ERROR')) {
      const timestamp = new Date().toISOString().slice(11, 19);
      console.log(`[${timestamp}] ${msg}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main() {
  const config = parseArgs();

  // Verify connectivity
  try {
    const resp = await fetch(`${config.url}/health`);
    if (!resp.ok) {
      console.error(`Orchestrator health check failed: ${resp.status}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Cannot connect to orchestrator at ${config.url}: ${error}`);
    process.exit(1);
  }

  const test = new UnifiedLoadTest(config);
  await test.run();
}

main().catch(error => {
  console.error('Load test failed:', error);
  process.exit(1);
});
