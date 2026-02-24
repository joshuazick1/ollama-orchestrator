#!/usr/bin/env node
/**
 * Streaming Load Test Script
 *
 * This script tests the orchestrator with concurrent streaming requests to:
 * 1. Verify streaming responses work correctly under load
 * 2. Track chunk-level metrics (chunks received, timing, etc.)
 * 3. Test circuit breakers with streaming requests
 * 4. Analyze load balancer effectiveness with streaming
 * 5. Measure time to first token and total response time
 *
 * Usage: node scripts/streaming-load-test.ts [--duration 300] [--concurrency 50] [--mode mixed] [--models 30] [--chunks 10]
 */

import { promises as fs } from 'fs';
import path from 'path';

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:5100';

interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  successCount: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  openCount: number;
  totalTimeOpen: number;
  totalTimeHalfOpen: number;
  transitions: Array<{
    from: string;
    to: string;
    timestamp: number;
  }>;
}

interface StreamingTestResult {
  model: string;
  serverId: string;
  success: boolean;
  duration: number;
  error?: string;
  timestamp: number;
  circuitBreakerState?: string;
  serverCircuitState?: string;
  modelCircuitState?: string;
  wasRoutedToOpenCircuit?: boolean;
  availableServers?: number;
  selectedServerRank?: number;
  retryCount?: number;
  endpoint: string;
  chunksReceived: number;
  totalTokens: number;
  timeToFirstToken: number;
  avgChunkDelay: number;
  streamingDuration?: number;
  tokensPrompt?: number;
  maxChunkGapMs?: number;
  avgChunkSizeBytes?: number;
}

interface ModelInfo {
  name: string;
  serverCount: number;
  servers: string[];
}

interface TimeSeriesPoint {
  timestamp: number;
  openCircuits: number;
  halfOpenCircuits: number;
  closedCircuits: number;
  totalRequests: number;
  successRate: number;
  avgLatency: number;
  circuitBlockedRequests: number;
  avgChunksReceived: number;
  avgTimeToFirstToken: number;
}

type TestMode = 'uniform' | 'targeted' | 'spike' | 'mixed';

class StreamingLoadTest {
  private results: StreamingTestResult[] = [];
  private timeSeriesData: TimeSeriesPoint[] = [];
  private circuitBreakerStates: Map<string, CircuitBreakerState> = new Map();
  private startTime: number = 0;
  private modelsToTest: string[] = [];
  private modelServerMap: Map<string, string[]> = new Map();
  private allServers: Set<string> = new Set();
  private serversHit: Set<string> = new Set();
  private serversPendingCoverage: Set<string> = new Set();
  private activeRequests: number = 0;
  private maxConcurrency: number;
  private duration: number;
  private mode: TestMode;
  private modelCount: number;
  private expectedChunks: number;
  private requestCount: number = 0;
  private successCount: number = 0;
  private failureCount: number = 0;
  private circuitBlockedCount: number = 0;
  private lastCircuitStats: any = null;

  constructor(options: {
    duration?: number;
    concurrency?: number;
    mode?: TestMode;
    modelCount?: number;
    expectedChunks?: number;
  }) {
    this.duration = options.duration || 300;
    this.maxConcurrency = options.concurrency || 50;
    this.mode = options.mode || 'mixed';
    this.modelCount = options.modelCount || 30;
    this.expectedChunks = options.expectedChunks || 10;
  }

  async run(): Promise<void> {
    console.log('='.repeat(80));
    console.log('STREAMING LOAD TEST');
    console.log('='.repeat(80));
    console.log(`Orchestrator: ${ORCHESTRATOR_URL}`);
    console.log(`Duration: ${this.duration} seconds`);
    console.log(`Max Concurrency: ${this.maxConcurrency}`);
    console.log(`Test Mode: ${this.mode}`);
    console.log(`Models to Test: ${this.modelCount}`);
    console.log(`Expected Chunks per Request: ${this.expectedChunks}`);
    console.log('');

    console.log('Fetching available models and circuit breaker state...');
    const modelInfo = await this.fetchModelInfo();
    await this.fetchInitialCircuitBreakerState();

    this.selectModels(modelInfo);
    console.log(`Selected ${this.modelsToTest.length} models for testing:`);
    this.modelsToTest.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
    console.log('');

    console.log('Running warmup phase to exercise all servers...');
    await this.warmupServers();
    console.log('Warmup complete, starting main test...');
    console.log('');

    this.startTime = Date.now();
    const endTime = this.startTime + this.duration * 1000;

    console.log('Starting streaming load test...');
    console.log('');

    const progressInterval = setInterval(async () => {
      const elapsed = (Date.now() - this.startTime) / 1000;
      const remaining = Math.max(0, this.duration - elapsed);
      const rps = this.requestCount / Math.max(1, elapsed);

      await this.fetchCircuitBreakerStats();

      console.log(
        `[${elapsed.toFixed(1)}s/${this.duration}s] ` +
          `Active: ${this.activeRequests.toString().padStart(3)} | ` +
          `Total: ${this.requestCount.toString().padStart(5)} | ` +
          `Success: ${this.successCount.toString().padStart(5)} | ` +
          `Failed: ${this.failureCount.toString().padStart(5)} | ` +
          `CB-Blocked: ${this.circuitBlockedCount.toString().padStart(5)} | ` +
          `RPS: ${rps.toFixed(1)} | ` +
          `Remaining: ${remaining.toFixed(0)}s`
      );

      this.recordTimeSeriesPoint();
    }, 5000);

    const requestPromises: Promise<void>[] = [];

    if (this.mode === 'spike') {
      await this.runSpikePattern(requestPromises, endTime);
    } else if (this.mode === 'targeted') {
      await this.runTargetedPattern(requestPromises, endTime);
    } else {
      await this.runStandardPattern(requestPromises, endTime);
    }

    console.log('\nWaiting for active requests to complete...');
    await Promise.all(requestPromises);

    clearInterval(progressInterval);

    await this.generateReport();
  }

  private async runStandardPattern(
    requestPromises: Promise<void>[],
    endTime: number
  ): Promise<void> {
    while (Date.now() < endTime) {
      if (this.activeRequests < this.maxConcurrency) {
        const model = this.getRandomModel();
        requestPromises.push(this.sendStreamingRequest(model));
      }
      await this.sleep(10);
    }
  }

  private async runSpikePattern(requestPromises: Promise<void>[], endTime: number): Promise<void> {
    const phaseDuration = this.duration / 4;
    let phase = 0;
    const phaseStartTime = Date.now();

    while (Date.now() < endTime) {
      const elapsed = (Date.now() - phaseStartTime) / 1000;

      let targetConcurrency = this.maxConcurrency;
      if (phase === 0) {
        targetConcurrency = Math.floor(
          this.maxConcurrency * (0.25 + (elapsed / phaseDuration) * 0.75)
        );
      } else if (phase === 1) {
        targetConcurrency = this.maxConcurrency;
      } else if (phase === 2) {
        targetConcurrency = Math.floor(
          this.maxConcurrency * (1.0 - (elapsed / phaseDuration) * 0.75)
        );
      } else {
        targetConcurrency = Math.floor(this.maxConcurrency * 0.25);
      }

      if (this.activeRequests < targetConcurrency) {
        const model = this.getRandomModel();
        requestPromises.push(this.sendStreamingRequest(model));
      }

      if (elapsed > phaseDuration) {
        phase++;
        console.log(`\n[Phase ${phase}] Concurrency target: ${targetConcurrency}`);
      }

      await this.sleep(10);
    }
  }

  private async runTargetedPattern(
    requestPromises: Promise<void>[],
    endTime: number
  ): Promise<void> {
    const vulnerableModels = this.modelsToTest.filter(model => {
      const servers = this.modelServerMap.get(model) || [];
      return servers.length <= 2;
    });

    const targetModels =
      vulnerableModels.length > 0 ? vulnerableModels : this.modelsToTest.slice(0, 5);
    console.log(
      `\nTargeting ${targetModels.length} vulnerable models for circuit breaker testing:`
    );
    targetModels.forEach(m => console.log(`  - ${m}`));

    while (Date.now() < endTime) {
      if (this.activeRequests < this.maxConcurrency) {
        const model =
          Math.random() < 0.7
            ? targetModels[Math.floor(Math.random() * targetModels.length)]
            : this.getRandomModel();
        requestPromises.push(this.sendStreamingRequest(model));
      }
      await this.sleep(10);
    }
  }

  private async fetchModelInfo(): Promise<Map<string, ModelInfo>> {
    try {
      const [modelMapResponse, serversResponse] = await Promise.all([
        fetch(`${ORCHESTRATOR_URL}/api/orchestrator/model-map`),
        fetch(`${ORCHESTRATOR_URL}/api/orchestrator/servers`),
      ]);

      if (!modelMapResponse.ok) {
        throw new Error(`Failed to fetch model-map: ${modelMapResponse.status}`);
      }
      if (!serversResponse.ok) {
        throw new Error(`Failed to fetch servers: ${serversResponse.status}`);
      }

      const serversData = await serversResponse.json();
      if (serversData.servers) {
        for (const server of serversData.servers) {
          this.allServers.add(server.id);
          this.serversPendingCoverage.add(server.id);
        }
      }

      const modelMapData = await modelMapResponse.json();
      const modelToServers: Record<string, string[]> = modelMapData.modelToServers || {};

      const modelMap = new Map<string, ModelInfo>();

      for (const [modelName, serverIds] of Object.entries(modelToServers)) {
        modelMap.set(modelName, {
          name: modelName,
          serverCount: serverIds.length,
          servers: serverIds,
        });
        this.modelServerMap.set(modelName, serverIds);
      }

      return modelMap;
    } catch (error) {
      console.error('Failed to fetch model info:', error);
      throw error;
    }
  }

  private async fetchInitialCircuitBreakerState(): Promise<void> {
    try {
      const response = await fetch(`${ORCHESTRATOR_URL}/api/orchestrator/circuit-breakers`);
      if (response.ok) {
        const data = await response.json();
        if (data.circuitBreakers) {
          this.initializeCircuitBreakerTracking(data.circuitBreakers);
        }
      }
    } catch (error) {
      console.warn('Could not fetch initial circuit breaker state:', error);
    }
  }

  private async fetchCircuitBreakerStats(): Promise<void> {
    try {
      const response = await fetch(`${ORCHESTRATOR_URL}/api/orchestrator/circuit-breakers`);
      if (response.ok) {
        const data = await response.json();
        this.lastCircuitStats = data;
        this.updateCircuitBreakerTracking(data.circuitBreakers || {});
      }
    } catch (error) {
      // Silent fail - stats are best effort
    }
  }

  private initializeCircuitBreakerTracking(circuitBreakers: any): void {
    const breakers = Array.isArray(circuitBreakers)
      ? circuitBreakers
      : Object.entries(circuitBreakers);

    for (const item of breakers) {
      const key = Array.isArray(item) ? item[0] : item.serverId;
      const breaker = Array.isArray(item) ? item[1] : item;

      this.circuitBreakerStates.set(key, {
        state: this.normalizeState(breaker.state),
        failureCount: breaker.failureCount || 0,
        successCount: breaker.successCount || 0,
        lastFailureTime: breaker.lastFailure,
        lastSuccessTime: breaker.lastSuccess,
        openCount: this.normalizeState(breaker.state) === 'open' ? 1 : 0,
        totalTimeOpen: 0,
        totalTimeHalfOpen: 0,
        transitions: [],
      });
    }
  }

  private normalizeState(state: string): 'closed' | 'open' | 'half-open' {
    const normalized = state?.toLowerCase();
    if (normalized === 'open') return 'open';
    if (normalized === 'half-open' || normalized === 'half_open') return 'half-open';
    return 'closed';
  }

  private updateCircuitBreakerTracking(circuitBreakers: any): void {
    const now = Date.now();

    const breakers = Array.isArray(circuitBreakers)
      ? circuitBreakers
      : Object.entries(circuitBreakers);

    for (const item of breakers) {
      const key = Array.isArray(item) ? item[0] : item.serverId;
      const breaker = Array.isArray(item) ? item[1] : item;
      const normalizedState = this.normalizeState(breaker.state);

      const existing = this.circuitBreakerStates.get(key);

      if (existing) {
        if (existing.state !== normalizedState) {
          existing.transitions.push({
            from: existing.state,
            to: normalizedState,
            timestamp: now,
          });

          if (normalizedState === 'open') {
            existing.openCount++;
          }
        }

        const timeSinceLastUpdate = now - (existing.lastSuccessTime || this.startTime);
        if (existing.state === 'open') {
          existing.totalTimeOpen += timeSinceLastUpdate;
        } else if (existing.state === 'half-open') {
          existing.totalTimeHalfOpen += timeSinceLastUpdate;
        }

        existing.state = normalizedState;
        existing.failureCount = breaker.failureCount || 0;
        existing.successCount = breaker.successCount || 0;
      } else {
        this.circuitBreakerStates.set(key, {
          state: normalizedState,
          failureCount: breaker.failureCount || 0,
          successCount: breaker.successCount || 0,
          lastFailureTime: breaker.lastFailure,
          lastSuccessTime: breaker.lastSuccess,
          openCount: normalizedState === 'open' ? 1 : 0,
          totalTimeOpen: 0,
          totalTimeHalfOpen: 0,
          transitions: [],
        });
      }
    }
  }

  private recordTimeSeriesPoint(): void {
    const now = Date.now();
    let openCount = 0;
    let halfOpenCount = 0;
    let closedCount = 0;

    for (const [key, state] of this.circuitBreakerStates.entries()) {
      if (state.state === 'open') openCount++;
      else if (state.state === 'half-open') halfOpenCount++;
      else closedCount++;
    }

    const recentResults = this.results.filter(r => r.timestamp > now - 10000);
    const recentSuccesses = recentResults.filter(r => r.success).length;
    const recentAvgLatency =
      recentResults.length > 0
        ? recentResults.reduce((sum, r) => sum + r.duration, 0) / recentResults.length
        : 0;

    const avgChunksReceived =
      recentResults.length > 0
        ? recentResults.reduce((sum, r) => sum + r.chunksReceived, 0) / recentResults.length
        : 0;

    const avgTimeToFirstToken =
      recentResults.length > 0
        ? recentResults.reduce((sum, r) => sum + r.timeToFirstToken, 0) / recentResults.length
        : 0;

    this.timeSeriesData.push({
      timestamp: now,
      openCircuits: openCount,
      halfOpenCircuits: halfOpenCount,
      closedCircuits: closedCount,
      totalRequests: this.requestCount,
      successRate: recentResults.length > 0 ? recentSuccesses / recentResults.length : 1,
      avgLatency: recentAvgLatency,
      circuitBlockedRequests: this.circuitBlockedCount,
      avgChunksReceived,
      avgTimeToFirstToken,
    });
  }

  private isEmbeddingModel(modelName: string): boolean {
    const lower = modelName.toLowerCase();
    return (
      lower.includes('embed') ||
      lower.includes('nomic') ||
      lower.includes('text-embedding') ||
      lower.includes('e5-') ||
      lower.includes('bge-') ||
      lower.includes('sentence-transformer')
    );
  }

  private selectModels(modelInfo: Map<string, ModelInfo>): void {
    const eligibleModels = Array.from(modelInfo.values()).filter(m => {
      if (m.serverCount < 2) return false;
      if (this.isEmbeddingModel(m.name)) return false;
      return true;
    });

    const sortedModels = eligibleModels.sort((a, b) => b.serverCount - a.serverCount);

    console.log(`Total eligible models (non-embedding, >=2 nodes): ${sortedModels.length}`);
    console.log('Top models by server count:');
    sortedModels.slice(0, 30).forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.name} (${m.serverCount} servers)`);
    });
    console.log('');

    const halfCount = Math.floor(this.modelCount / 2);

    const topModels = sortedModels.slice(0, halfCount).map(m => m.name);

    const remainingModels = sortedModels.slice(halfCount);
    const randomModels: string[] = [];

    while (randomModels.length < this.modelCount - halfCount && remainingModels.length > 0) {
      const index = Math.floor(Math.random() * remainingModels.length);
      const model = remainingModels.splice(index, 1)[0];
      randomModels.push(model.name);
    }

    this.modelsToTest = [...topModels, ...randomModels].slice(0, this.modelCount);
  }

  private async warmupServers(): Promise<void> {
    const serversToWarmup = new Set<string>();
    for (const model of this.modelsToTest) {
      const servers = this.modelServerMap.get(model) || [];
      for (const server of servers) {
        serversToWarmup.add(server);
      }
    }

    console.log(`  Warming up ${serversToWarmup.size} servers with test models...`);

    let warmedUp = 0;
    const warmupPromises: Promise<void>[] = [];

    for (const serverId of serversToWarmup) {
      let targetModel: string | undefined;
      for (const model of this.modelsToTest) {
        const servers = this.modelServerMap.get(model) || [];
        if (servers.includes(serverId)) {
          targetModel = model;
          break;
        }
      }

      if (!targetModel) continue;

      warmupPromises.push(
        (async () => {
          const isEmbedding = this.isEmbeddingModel(targetModel!);
          const endpoint = isEmbedding ? '/api/embeddings' : '/api/generate';
          const body = isEmbedding
            ? JSON.stringify({ model: targetModel, prompt: 'test' })
            : JSON.stringify({
                model: targetModel,
                prompt: 'hi',
                stream: false,
                options: { num_predict: 5 },
              });

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);

          try {
            const response = await fetch(`${ORCHESTRATOR_URL}${endpoint}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Include-Debug-Info': 'true' },
              body,
              signal: controller.signal,
            });
            clearTimeout(timeout);

            if (response.ok) {
              warmedUp++;
            }
          } catch (error) {
            clearTimeout(timeout);
          }
        })()
      );
    }

    await Promise.all(warmupPromises);
    console.log(`  Successfully warmed up ${warmedUp}/${serversToWarmup.size} servers`);
  }

  private getRandomModel(): string {
    if (this.serversPendingCoverage.size > 0) {
      const modelsWithUncoveredServers = this.modelsToTest.filter(model => {
        const servers = this.modelServerMap.get(model) || [];
        return servers.some(s => this.serversPendingCoverage.has(s));
      });

      if (modelsWithUncoveredServers.length > 0) {
        const weightedModels = modelsWithUncoveredServers.map(model => {
          const servers = this.modelServerMap.get(model) || [];
          const uncoveredCount = servers.filter(s => this.serversPendingCoverage.has(s)).length;
          return { model, weight: uncoveredCount };
        });

        const totalWeight = weightedModels.reduce((sum, m) => sum + m.weight, 0);
        let random = Math.random() * totalWeight;

        for (const { model, weight } of weightedModels) {
          random -= weight;
          if (random <= 0) {
            return model;
          }
        }
      }
    }

    return this.modelsToTest[Math.floor(Math.random() * this.modelsToTest.length)];
  }

  private async sendStreamingRequest(model: string, retryCount: number = 0): Promise<void> {
    this.activeRequests++;
    this.requestCount++;

    const startTime = Date.now();
    const requestId = `${startTime}-${Math.random().toString(36).substr(2, 9)}`;

    const isEmbeddingModel =
      model.toLowerCase().includes('embed') || model.toLowerCase().includes('nomic');

    let chunksReceived = 0;
    let totalTokens = 0;
    let timeToFirstToken = 0;
    let avgChunkDelay = 0;
    let lastChunkTime = startTime;
    // Captured from SSE payload metrics (fallback when headers absent)
    let streamingDurationFromStream: number | undefined;
    let ttftFromStream: number | undefined;
    let tokensPromptFromStream: number | undefined;
    let maxChunkGapMsFromStream: number | undefined;
    let avgChunkSizeBytesFromStream: number | undefined;

    try {
      let endpoint: string;
      let body: string;

      if (isEmbeddingModel) {
        endpoint = '/api/embeddings';
        body = JSON.stringify({ model: model, prompt: 'test' });
      } else {
        endpoint = '/api/generate';
        body = JSON.stringify({
          model: model,
          prompt: 'Write a detailed story about a robot',
          stream: true,
          options: { num_predict: this.expectedChunks * 20 },
        });
      }

      const response = await fetch(`${ORCHESTRATOR_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': requestId,
          'X-Include-Debug-Info': 'true',
        },
        body,
      });

      const duration = Date.now() - startTime;
      const success = response.ok;

      if (success && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let done = false;

        while (!done) {
          const { value, done: doneReading } = await reader.read();
          done = doneReading;

          if (value) {
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(line => line.trim() !== '');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') {
                  done = true;
                  break;
                }

                try {
                  const parsed = JSON.parse(data);
                  chunksReceived++;

                  // Mark time-to-first-token if not already set
                  if (timeToFirstToken === 0) {
                    timeToFirstToken = Date.now() - startTime;
                  } else {
                    const chunkDelay = Date.now() - lastChunkTime;
                    avgChunkDelay =
                      (avgChunkDelay * (chunksReceived - 2) + chunkDelay) / (chunksReceived - 1);
                  }
                  lastChunkTime = Date.now();

                  // Heuristic token counts from response/text fields
                  if (parsed.response) {
                    totalTokens += parsed.response.length;
                  }
                  if (parsed.token) {
                    totalTokens++;
                  }

                  // Capture streaming metrics emitted by orchestrator in SSE payload
                  if (parsed._streamingMetrics && typeof parsed._streamingMetrics === 'object') {
                    const sm = parsed._streamingMetrics as any;
                    if (typeof sm.ttft === 'number') {
                      ttftFromStream = Math.floor(sm.ttft);
                      if (timeToFirstToken === 0) timeToFirstToken = ttftFromStream;
                    }
                    if (typeof sm.streamingDuration === 'number') {
                      streamingDurationFromStream = Math.floor(sm.streamingDuration);
                    }
                  }

                  if (parsed._tokenMetrics && typeof parsed._tokenMetrics === 'object') {
                    const tm = parsed._tokenMetrics as any;
                    if (typeof tm.tokensGenerated === 'number') {
                      totalTokens = Math.max(totalTokens, Math.floor(tm.tokensGenerated));
                    }
                    if (typeof tm.tokensPrompt === 'number') {
                      tokensPromptFromStream = Math.floor(tm.tokensPrompt);
                    }
                  }

                  if (parsed._chunkData && typeof parsed._chunkData === 'object') {
                    const cd = parsed._chunkData as any;
                    if (typeof cd.chunkCount === 'number') {
                      chunksReceived = Math.max(chunksReceived, Math.floor(cd.chunkCount));
                    }
                    if (typeof cd.maxChunkGapMs === 'number') {
                      maxChunkGapMsFromStream = Math.floor(cd.maxChunkGapMs);
                    }
                    if (typeof cd.avgChunkSizeBytes === 'number') {
                      avgChunkSizeBytesFromStream = Math.floor(cd.avgChunkSizeBytes);
                    }
                  }
                } catch (e) {
                  // Skip invalid JSON
                }
              }
            }
          }
        }

        reader.releaseLock();
      }

      if (success) {
        this.successCount++;
      } else {
        this.failureCount++;
        if (response.status === 503) {
          this.circuitBlockedCount++;
        }
      }

      const serverCbState = response.headers.get('X-Server-Circuit-State');
      const modelCbState = response.headers.get('X-Model-Circuit-State');
      const selectedServer = response.headers.get('X-Selected-Server');
      const availableServers = response.headers.get('X-Available-Servers');
      const wasRoutedToOpen = response.headers.get('X-Routed-To-Open-Circuit');

      this.results.push({
        model,
        serverId: selectedServer || 'unknown',
        success,
        duration,
        error: success ? undefined : `HTTP ${response.status}`,
        timestamp: startTime,
        circuitBreakerState: response.headers.get('X-Circuit-Breaker-State') || undefined,
        serverCircuitState: serverCbState || undefined,
        modelCircuitState: modelCbState || undefined,
        wasRoutedToOpenCircuit: wasRoutedToOpen === 'true',
        availableServers: availableServers ? parseInt(availableServers, 10) : undefined,
        retryCount,
        endpoint,
        chunksReceived,
        totalTokens,
        timeToFirstToken,
        avgChunkDelay,
        // prefer metrics from headers, fallback to values captured in SSE payload
        streamingDuration: (() => {
          const headerVal = response.headers.get('X-Streaming-Duration');
          if (headerVal) return parseInt(headerVal, 10);
          return streamingDurationFromStream;
        })(),
        tokensPrompt: (() => {
          const headerVal = response.headers.get('X-Tokens-Prompt');
          if (headerVal) return parseInt(headerVal, 10);
          return tokensPromptFromStream;
        })(),
        maxChunkGapMs: (() => {
          const headerVal = response.headers.get('X-Max-Chunk-Gap-Ms');
          if (headerVal) return parseInt(headerVal, 10);
          return maxChunkGapMsFromStream;
        })(),
        avgChunkSizeBytes: (() => {
          const headerVal = response.headers.get('X-Avg-Chunk-Size-Bytes');
          if (headerVal) return parseInt(headerVal, 10);
          return avgChunkSizeBytesFromStream;
        })(),
      });

      if (selectedServer && selectedServer !== 'unknown') {
        this.serversHit.add(selectedServer);
        this.serversPendingCoverage.delete(selectedServer);
      }

      if (!success && response.status === 503) {
        console.log(`  [503] Circuit breaker blocked ${model} (${duration}ms)`);
      } else if (wasRoutedToOpen === 'true') {
        console.log(`  [WARN] Request routed to OPEN circuit: ${model} -> ${selectedServer}`);
      } else if (duration > 60000) {
        console.log(`  [SLOW] Request took ${duration}ms for ${model} (${chunksReceived} chunks)`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.failureCount++;

      const errorMessage = error instanceof Error ? error.message : String(error);

      this.results.push({
        model,
        serverId: 'unknown',
        success: false,
        duration,
        error: errorMessage,
        timestamp: startTime,
        retryCount,
        endpoint: isEmbeddingModel ? '/api/embeddings' : '/api/generate',
        chunksReceived: 0,
        totalTokens: 0,
        timeToFirstToken: 0,
        avgChunkDelay: 0,
      });

      if (errorMessage.includes('circuit breaker')) {
        this.circuitBlockedCount++;
        console.log(`  [CB] Circuit breaker blocked request for ${model}`);
      }
    } finally {
      this.activeRequests--;
    }
  }

  private async generateReport(): Promise<void> {
    const endTime = Date.now();
    const totalDuration = (endTime - this.startTime) / 1000;
    const rps = this.requestCount / totalDuration;

    console.log('\n' + '='.repeat(80));
    console.log('STREAMING LOAD TEST COMPLETE');
    console.log('='.repeat(80));
    console.log(`Total Duration: ${totalDuration.toFixed(1)} seconds`);
    console.log(`Total Requests: ${this.requestCount}`);
    console.log(
      `Successful: ${this.successCount} (${((this.successCount / this.requestCount) * 100).toFixed(1)}%)`
    );
    console.log(
      `Failed: ${this.failureCount} (${((this.failureCount / this.requestCount) * 100).toFixed(1)}%)`
    );
    console.log(
      `Circuit Blocked: ${this.circuitBlockedCount} (${((this.circuitBlockedCount / this.requestCount) * 100).toFixed(1)}%)`
    );
    console.log(`Average RPS: ${rps.toFixed(1)}`);
    console.log('');

    const successfulResults = this.results.filter(r => r.success);
    if (successfulResults.length > 0) {
      const totalChunks = successfulResults.reduce((sum, r) => sum + r.chunksReceived, 0);
      const avgChunks = totalChunks / successfulResults.length;
      const totalTokens = successfulResults.reduce((sum, r) => sum + r.totalTokens, 0);
      const avgTokens = totalTokens / successfulResults.length;
      const avgTimeToFirstToken =
        successfulResults.reduce((sum, r) => sum + r.timeToFirstToken, 0) /
        successfulResults.length;
      const avgDuration =
        successfulResults.reduce((sum, r) => sum + r.duration, 0) / successfulResults.length;

      console.log('STREAMING METRICS');
      console.log('-'.repeat(80));
      console.log(`Average Chunks per Request: ${avgChunks.toFixed(1)}`);
      console.log(`Average Tokens per Request: ${avgTokens.toFixed(1)}`);
      console.log(`Average Time to First Token: ${avgTimeToFirstToken.toFixed(0)}ms`);
      console.log(`Average Total Duration: ${avgDuration.toFixed(0)}ms`);
      console.log(
        `Average Chunk Delay: ${
          successfulResults.reduce((sum, r) => sum + r.avgChunkDelay, 0) / successfulResults.length
        }ms`
      );
      console.log('');
    }

    console.log('SERVER COVERAGE ANALYSIS');
    console.log('-'.repeat(80));
    console.log(`Total Available Servers: ${this.allServers.size}`);
    console.log(`Servers Hit During Test: ${this.serversHit.size}`);
    console.log(
      `Server Coverage: ${((this.serversHit.size / this.allServers.size) * 100).toFixed(1)}%`
    );
    if (this.serversPendingCoverage.size > 0) {
      console.log(`Servers NOT hit (${this.serversPendingCoverage.size}):`);
      for (const server of this.serversPendingCoverage) {
        console.log(`  - ${server}`);
      }
    }
    console.log('');

    console.log('CIRCUIT BREAKER ANALYSIS');
    console.log('-'.repeat(80));

    let totalOpenCount = 0;
    let totalTransitions = 0;

    for (const [key, state] of this.circuitBreakerStates.entries()) {
      totalOpenCount += state.openCount;
      totalTransitions += state.transitions.length;
    }

    console.log(`Total Circuit Open Events: ${totalOpenCount}`);
    console.log(`Total State Transitions: ${totalTransitions}`);
    console.log(`Unique Circuit Breakers Tracked: ${this.circuitBreakerStates.size}`);
    console.log('');

    this.analyzeLoadBalancerEffectiveness();

    const reportPath = path.join(
      process.cwd(),
      'reports',
      `streaming-load-test-${Date.now()}.json`
    );
    await fs.mkdir(path.dirname(reportPath), { recursive: true });

    const modelStats = this.calculateModelStats();

    await fs.writeFile(
      reportPath,
      JSON.stringify(
        {
          metadata: {
            startTime: new Date(this.startTime).toISOString(),
            endTime: new Date(endTime).toISOString(),
            duration: totalDuration,
            totalRequests: this.requestCount,
            successful: this.successCount,
            failed: this.failureCount,
            circuitBlocked: this.circuitBlockedCount,
            rps,
            mode: this.mode,
            modelCount: this.modelCount,
            expectedChunks: this.expectedChunks,
            models: this.modelsToTest,
            serverCoverage: {
              totalServers: this.allServers.size,
              serversHit: this.serversHit.size,
              coveragePercent: (this.serversHit.size / this.allServers.size) * 100,
              serversNotHit: Array.from(this.serversPendingCoverage),
            },
          },
          streamingMetrics: {
            avgChunksPerRequest:
              successfulResults.length > 0
                ? successfulResults.reduce((sum, r) => sum + r.chunksReceived, 0) /
                  successfulResults.length
                : 0,
            avgTokensPerRequest:
              successfulResults.length > 0
                ? successfulResults.reduce((sum, r) => sum + r.totalTokens, 0) /
                  successfulResults.length
                : 0,
            avgTimeToFirstToken:
              successfulResults.length > 0
                ? successfulResults.reduce((sum, r) => sum + r.timeToFirstToken, 0) /
                  successfulResults.length
                : 0,
            avgTotalDuration:
              successfulResults.length > 0
                ? successfulResults.reduce((sum, r) => sum + r.duration, 0) /
                  successfulResults.length
                : 0,
          },
          circuitBreakerSummary: {
            totalOpenEvents: totalOpenCount,
            totalTransitions,
            uniqueBreakers: this.circuitBreakerStates.size,
          },
          timeSeriesData: this.timeSeriesData,
          modelStats,
          results: this.results,
        },
        null,
        2
      )
    );

    console.log('');
    console.log(`Detailed report saved to: ${reportPath}`);
    console.log('='.repeat(80));
  }

  private calculateModelStats() {
    const modelStats = new Map<
      string,
      {
        requests: number;
        successes: number;
        failures: number;
        circuitBlocked: number;
        avgDuration: number;
        avgChunks: number;
        avgTimeToFirstToken: number;
        errors: Set<string>;
        serverDistribution: Map<string, number>;
      }
    >();

    for (const result of this.results) {
      const stats = modelStats.get(result.model) || {
        requests: 0,
        successes: 0,
        failures: 0,
        circuitBlocked: 0,
        avgDuration: 0,
        avgChunks: 0,
        avgTimeToFirstToken: 0,
        errors: new Set<string>(),
        serverDistribution: new Map<string, number>(),
      };

      stats.requests++;
      if (result.success) {
        stats.successes++;
        stats.avgChunks =
          (stats.avgChunks * (stats.successes - 1) + result.chunksReceived) / stats.successes;
        stats.avgTimeToFirstToken =
          (stats.avgTimeToFirstToken * (stats.successes - 1) + result.timeToFirstToken) /
          stats.successes;
      } else {
        stats.failures++;
        if (result.error?.includes('503') || result.wasRoutedToOpenCircuit) {
          stats.circuitBlocked++;
        }
        if (result.error) stats.errors.add(result.error);
      }
      stats.avgDuration =
        (stats.avgDuration * (stats.requests - 1) + result.duration) / stats.requests;

      if (result.serverId && result.serverId !== 'unknown') {
        stats.serverDistribution.set(
          result.serverId,
          (stats.serverDistribution.get(result.serverId) || 0) + 1
        );
      }

      modelStats.set(result.model, stats);
    }

    return Array.from(modelStats.entries()).map(([model, stats]) => ({
      model,
      requests: stats.requests,
      successes: stats.successes,
      failures: stats.failures,
      circuitBlocked: stats.circuitBlocked,
      successRate: stats.requests > 0 ? stats.successes / stats.requests : 0,
      avgDuration: stats.avgDuration,
      avgChunks: stats.avgChunks,
      avgTimeToFirstToken: stats.avgTimeToFirstToken,
      errors: Array.from(stats.errors),
      serverDistribution: Array.from(stats.serverDistribution.entries()),
    }));
  }

  private analyzeLoadBalancerEffectiveness(): void {
    console.log('LOAD BALANCER EFFECTIVENESS');
    console.log('-'.repeat(80));

    const routedToOpen = this.results.filter(r => r.wasRoutedToOpenCircuit).length;
    const totalWithCircuitInfo = this.results.filter(
      r => r.circuitBreakerState !== undefined
    ).length;

    if (totalWithCircuitInfo > 0) {
      const avoidanceRate = 1 - routedToOpen / totalWithCircuitInfo;
      console.log(`Circuit Avoidance Rate: ${(avoidanceRate * 100).toFixed(1)}%`);
      console.log(`  - Total requests with circuit info: ${totalWithCircuitInfo}`);
      console.log(`  - Routed to open circuits: ${routedToOpen}`);
      console.log(`  - Successfully avoided: ${totalWithCircuitInfo - routedToOpen}`);
    }

    console.log('');
    console.log('PER-SERVER ANALYSIS:');
    console.log('-'.repeat(80));
    console.log(
      `${'Server ID'.padEnd(35)} ${'Requests'.padStart(10)} ${'Success'.padStart(10)} ${'Fail'.padStart(10)} ${'Success%'.padStart(10)}`
    );
    console.log('-'.repeat(80));

    const serverStats = new Map<
      string,
      { requests: number; successes: number; failures: number }
    >();

    for (const result of this.results) {
      if (result.serverId && result.serverId !== 'unknown') {
        const stats = serverStats.get(result.serverId) || {
          requests: 0,
          successes: 0,
          failures: 0,
        };
        stats.requests++;
        if (result.success) {
          stats.successes++;
        } else {
          stats.failures++;
        }
        serverStats.set(result.serverId, stats);
      }
    }

    const sortedServerStats = Array.from(serverStats.entries()).sort(
      (a, b) => b[1].requests - a[1].requests
    );

    for (const [serverId, stats] of sortedServerStats) {
      const successRate = stats.requests > 0 ? (stats.successes / stats.requests) * 100 : 0;
      console.log(
        `${serverId.slice(0, 35).padEnd(35)} ` +
          `${stats.requests.toString().padStart(10)} ` +
          `${stats.successes.toString().padStart(10)} ` +
          `${stats.failures.toString().padStart(10)} ` +
          `${successRate.toFixed(1).padStart(10)}%`
      );
    }

    console.log('');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

const args = process.argv.slice(2);
const options: {
  duration?: number;
  concurrency?: number;
  mode?: TestMode;
  modelCount?: number;
  expectedChunks?: number;
} = {};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--duration' && args[i + 1]) {
    options.duration = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--concurrency' && args[i + 1]) {
    options.concurrency = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--mode' && args[i + 1]) {
    const mode = args[i + 1] as TestMode;
    if (['uniform', 'targeted', 'spike', 'mixed'].includes(mode)) {
      options.mode = mode;
    }
    i++;
  } else if (args[i] === '--models' && args[i + 1]) {
    options.modelCount = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--chunks' && args[i + 1]) {
    options.expectedChunks = parseInt(args[i + 1], 10);
    i++;
  }
}

const test = new StreamingLoadTest(options);
test.run().catch(error => {
  console.error('Streaming load test failed:', error);
  process.exit(1);
});
