#!/usr/bin/env node
/**
 * Enhanced Circuit Breaker Load Test Script
 *
 * This script hammers the orchestrator with concurrent requests to:
 * 1. Trigger circuit breakers to open and track state transitions
 * 2. Test the recovery mechanisms and measure recovery times
 * 3. Verify adaptive timeouts and backoff strategies
 * 4. Analyze load balancer effectiveness at avoiding open circuits
 * 5. Gather time-series data on circuit breaker behavior under pressure
 * 6. Ensure all servers get exercised during testing
 *
 * Usage: node scripts/enhanced-circuit-breaker-load-test.ts [--duration 300] [--concurrency 50] [--mode mixed] [--models 30]
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

interface EnhancedTestResult {
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
  embeddingRequests: number;
  embeddingSuccessRate: number;
  perServerHalfOpen: Record<string, number>; // server -> half-open count
  modelTypeDistribution: { generation: number; embedding: number; unknown: number };
}

type TestMode = 'uniform' | 'targeted' | 'spike' | 'mixed';

class EnhancedCircuitBreakerLoadTest {
  private results: EnhancedTestResult[] = [];
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
  }) {
    this.duration = options.duration || 300; // 5 minutes default
    this.maxConcurrency = options.concurrency || 50;
    this.mode = options.mode || 'mixed';
    this.modelCount = options.modelCount || 30; // Default to 30 models
  }

  async run(): Promise<void> {
    console.log('='.repeat(80));
    console.log('ENHANCED CIRCUIT BREAKER LOAD TEST');
    console.log('='.repeat(80));
    console.log(`Orchestrator: ${ORCHESTRATOR_URL}`);
    console.log(`Duration: ${this.duration} seconds`);
    console.log(`Max Concurrency: ${this.maxConcurrency}`);
    console.log(`Test Mode: ${this.mode}`);
    console.log(`Models to Test: ${this.modelCount}`);
    console.log('');

    // Fetch available models and circuit breaker info
    console.log('Fetching available models and circuit breaker state...');
    const modelInfo = await this.fetchModelInfo();
    await this.fetchInitialCircuitBreakerState();

    // Select models to test
    this.selectModels(modelInfo);
    console.log(`Selected ${this.modelsToTest.length} models for testing:`);
    this.modelsToTest.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
    console.log('');

    // Warmup phase: Ensure every server with tested models gets at least one request
    // This builds their metrics so the load balancer will consider them
    console.log('Running warmup phase to exercise all servers...');
    await this.warmupServers();
    console.log('Warmup complete, starting main test...');
    console.log('');

    // Run load test
    this.startTime = Date.now();
    const endTime = this.startTime + this.duration * 1000;

    console.log('Starting load test...');
    console.log('');

    // Progress reporter with circuit breaker stats
    const progressInterval = setInterval(async () => {
      const elapsed = (Date.now() - this.startTime) / 1000;
      const remaining = Math.max(0, this.duration - elapsed);
      const rps = this.requestCount / Math.max(1, elapsed);

      // Fetch current circuit breaker stats
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

      // Record time-series data point
      this.recordTimeSeriesPoint();
    }, 5000);

    // Spawn concurrent requests based on test mode
    const requestPromises: Promise<void>[] = [];

    if (this.mode === 'spike') {
      // Spike mode: gradually increase load then drop
      await this.runSpikePattern(requestPromises, endTime);
    } else if (this.mode === 'targeted') {
      // Targeted mode: focus on specific models to trigger circuit breakers
      await this.runTargetedPattern(requestPromises, endTime);
    } else {
      // Uniform or mixed mode
      await this.runStandardPattern(requestPromises, endTime);
    }

    // Wait for all active requests to complete
    console.log('\nWaiting for active requests to complete...');
    await Promise.all(requestPromises);

    clearInterval(progressInterval);

    // Generate enhanced report
    await this.generateEnhancedReport();
  }

  private async runStandardPattern(
    requestPromises: Promise<void>[],
    endTime: number
  ): Promise<void> {
    while (Date.now() < endTime) {
      if (this.activeRequests < this.maxConcurrency) {
        const model = this.getRandomModel();
        requestPromises.push(this.sendRequest(model));
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

      // Determine concurrency based on phase
      let targetConcurrency = this.maxConcurrency;
      if (phase === 0) {
        // Ramp up: 25% -> 100%
        targetConcurrency = Math.floor(
          this.maxConcurrency * (0.25 + (elapsed / phaseDuration) * 0.75)
        );
      } else if (phase === 1) {
        // Peak: 100%
        targetConcurrency = this.maxConcurrency;
      } else if (phase === 2) {
        // Ramp down: 100% -> 25%
        targetConcurrency = Math.floor(
          this.maxConcurrency * (1.0 - (elapsed / phaseDuration) * 0.75)
        );
      } else {
        // Recovery: 25%
        targetConcurrency = Math.floor(this.maxConcurrency * 0.25);
      }

      if (this.activeRequests < targetConcurrency) {
        const model = this.getRandomModel();
        requestPromises.push(this.sendRequest(model));
      }

      // Phase transition
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
    // Focus on models with fewer servers to more easily trigger circuit breakers
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
        // 70% of requests to targeted models, 30% random
        const model =
          Math.random() < 0.7
            ? targetModels[Math.floor(Math.random() * targetModels.length)]
            : this.getRandomModel();
        requestPromises.push(this.sendRequest(model));
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

      // Track all available servers
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
    // Handle both array format (from API) and object format
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

    // Handle both array format (from API) and object format
    const breakers = Array.isArray(circuitBreakers)
      ? circuitBreakers
      : Object.entries(circuitBreakers);

    for (const item of breakers) {
      const key = Array.isArray(item) ? item[0] : item.serverId;
      const breaker = Array.isArray(item) ? item[1] : item;
      const normalizedState = this.normalizeState(breaker.state);

      const existing = this.circuitBreakerStates.get(key);

      if (existing) {
        // Check for state transition
        if (existing.state !== normalizedState) {
          existing.transitions.push({
            from: existing.state,
            to: normalizedState,
            timestamp: now,
          });

          // Track open count
          if (normalizedState === 'open') {
            existing.openCount++;
          }
        }

        // Update timing
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
        // New circuit breaker discovered during test
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
    const perServerHalfOpen: Record<string, number> = {};

    for (const [key, state] of this.circuitBreakerStates.entries()) {
      if (state.state === 'open') openCount++;
      else if (state.state === 'half-open') {
        halfOpenCount++;
        // Track per-server half-open counts
        const serverId = key.split(':')[0];
        perServerHalfOpen[serverId] = (perServerHalfOpen[serverId] || 0) + 1;
      } else closedCount++;
    }

    // Calculate recent metrics (last 10 seconds)
    const recentResults = this.results.filter(r => r.timestamp > now - 10000);
    const recentSuccesses = recentResults.filter(r => r.success).length;
    const recentAvgLatency =
      recentResults.length > 0
        ? recentResults.reduce((sum, r) => sum + r.duration, 0) / recentResults.length
        : 0;

    // Calculate embedding-specific metrics
    const recentEmbeddingResults = recentResults.filter(r => r.endpoint === '/api/embeddings');
    const embeddingRequests = recentEmbeddingResults.length;
    const embeddingSuccesses = recentEmbeddingResults.filter(r => r.success).length;
    const embeddingSuccessRate = embeddingRequests > 0 ? embeddingSuccesses / embeddingRequests : 0;

    // Model type distribution (approximate based on endpoint)
    const generationRequests = recentResults.filter(r => r.endpoint === '/api/generate').length;
    const embeddingCount = embeddingRequests;
    const unknownRequests = recentResults.filter(r => !r.endpoint).length;

    this.timeSeriesData.push({
      timestamp: now,
      openCircuits: openCount,
      halfOpenCircuits: halfOpenCount,
      closedCircuits: closedCount,
      totalRequests: this.requestCount,
      successRate: recentResults.length > 0 ? recentSuccesses / recentResults.length : 1,
      avgLatency: recentAvgLatency,
      circuitBlockedRequests: this.circuitBlockedCount,
      embeddingRequests,
      embeddingSuccessRate,
      perServerHalfOpen,
      modelTypeDistribution: {
        generation: generationRequests,
        embedding: embeddingCount,
        unknown: unknownRequests,
      },
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
    // Filter out embedding models and models with only 1 node
    const eligibleModels = Array.from(modelInfo.values()).filter(m => {
      if (m.serverCount < 2) return false;
      if (this.isEmbeddingModel(m.name)) return false;
      return true;
    });

    // Sort by server count descending
    const sortedModels = eligibleModels.sort((a, b) => b.serverCount - a.serverCount);

    console.log(`Total eligible models (non-embedding, >=2 nodes): ${sortedModels.length}`);
    console.log('Top models by server count:');
    sortedModels.slice(0, 30).forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.name} (${m.serverCount} servers)`);
    });
    console.log('');

    // Calculate how many models to pick from top vs random
    const halfCount = Math.floor(this.modelCount / 2);

    // Pick top models by server count
    const topModels = sortedModels.slice(0, halfCount).map(m => m.name);

    // Pick remaining from random eligible models
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
    // Get all servers that have any of our test models
    const serversToWarmup = new Set<string>();
    for (const model of this.modelsToTest) {
      const servers = this.modelServerMap.get(model) || [];
      for (const server of servers) {
        serversToWarmup.add(server);
      }
    }

    console.log(`  Warming up ${serversToWarmup.size} servers with test models...`);

    // Send one request per server to build metrics
    let warmedUp = 0;
    const warmupPromises: Promise<void>[] = [];

    for (const serverId of serversToWarmup) {
      // Find a model this server has
      let targetModel: string | undefined;
      for (const model of this.modelsToTest) {
        const servers = this.modelServerMap.get(model) || [];
        if (servers.includes(serverId)) {
          targetModel = model;
          break;
        }
      }

      if (!targetModel) continue;

      // Send a single warmup request
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

    // Wait for all warmup requests to complete
    await Promise.all(warmupPromises);
    console.log(`  Successfully warmed up ${warmedUp}/${serversToWarmup.size} servers`);
  }

  private getRandomModel(): string {
    // If there are still servers that haven't been hit, prioritize models that include those servers
    if (this.serversPendingCoverage.size > 0) {
      // Find models that have servers not yet covered
      const modelsWithUncoveredServers = this.modelsToTest.filter(model => {
        const servers = this.modelServerMap.get(model) || [];
        return servers.some(s => this.serversPendingCoverage.has(s));
      });

      // If we have models with uncovered servers, pick one with higher weight
      if (modelsWithUncoveredServers.length > 0) {
        // Bias towards models with more uncovered servers
        const weightedModels = modelsWithUncoveredServers.map(model => {
          const servers = this.modelServerMap.get(model) || [];
          const uncoveredCount = servers.filter(s => this.serversPendingCoverage.has(s)).length;
          return { model, weight: uncoveredCount };
        });

        // Weighted random selection
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

    // Fall back to uniform random
    return this.modelsToTest[Math.floor(Math.random() * this.modelsToTest.length)];
  }

  private async sendRequest(model: string, retryCount: number = 0): Promise<void> {
    this.activeRequests++;
    this.requestCount++;

    const startTime = Date.now();
    const requestId = `${startTime}-${Math.random().toString(36).substr(2, 9)}`;

    const isEmbeddingModel =
      model.toLowerCase().includes('embed') || model.toLowerCase().includes('nomic');

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
          prompt: 'Say hello',
          stream: false,
          options: { num_predict: 5 },
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

      if (success) {
        this.successCount++;
      } else {
        this.failureCount++;
        if (response.status === 503) {
          this.circuitBlockedCount++;
        }
      }

      // Extract circuit breaker information from headers
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
      });

      // Track server coverage
      if (selectedServer && selectedServer !== 'unknown') {
        this.serversHit.add(selectedServer);
        this.serversPendingCoverage.delete(selectedServer);
      }

      // Log interesting events
      if (!success && response.status === 503) {
        console.log(`  [503] Circuit breaker blocked ${model} (${duration}ms)`);
      } else if (wasRoutedToOpen === 'true') {
        console.log(`  [WARN] Request routed to OPEN circuit: ${model} -> ${selectedServer}`);
      } else if (duration > 30000) {
        console.log(`  [SLOW] Request took ${duration}ms for ${model}`);
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
      });

      if (errorMessage.includes('circuit breaker')) {
        this.circuitBlockedCount++;
        console.log(`  [CB] Circuit breaker blocked request for ${model}`);
      }
    } finally {
      this.activeRequests--;
    }
  }

  private async generateEnhancedReport(): Promise<void> {
    const endTime = Date.now();
    const totalDuration = (endTime - this.startTime) / 1000;
    const rps = this.requestCount / totalDuration;

    console.log('\n' + '='.repeat(80));
    console.log('ENHANCED LOAD TEST COMPLETE');
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

    // Server Coverage Analysis
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

    // Circuit Breaker Summary
    console.log('CIRCUIT BREAKER ANALYSIS');
    console.log('-'.repeat(80));

    let totalOpenCount = 0;
    let totalTransitions = 0;
    const modelCircuitStats = new Map<
      string,
      { openCount: number; transitions: number; servers: Set<string> }
    >();

    for (const [key, state] of this.circuitBreakerStates.entries()) {
      totalOpenCount += state.openCount;
      totalTransitions += state.transitions.length;

      // Parse model name from key (format: "serverId:model" or "serverId")
      const parts = key.split(':');
      const modelName = parts.length > 1 ? parts.slice(1).join(':') : 'server-level';
      const serverId = parts[0];

      const existing = modelCircuitStats.get(modelName) || {
        openCount: 0,
        transitions: 0,
        servers: new Set(),
      };
      existing.openCount += state.openCount;
      existing.transitions += state.transitions.length;
      existing.servers.add(serverId);
      modelCircuitStats.set(modelName, existing);
    }

    console.log(`Total Circuit Open Events: ${totalOpenCount}`);
    console.log(`Total State Transitions: ${totalTransitions}`);
    console.log(`Unique Circuit Breakers Tracked: ${this.circuitBreakerStates.size}`);
    console.log('');

    // Circuit breaker stats by model
    console.log('Circuit Breaker Activity by Model:');
    console.log('-'.repeat(80));
    console.log(
      `${'Model'.padEnd(40)} ${'Open Events'.padStart(12)} ${'Transitions'.padStart(12)} ${'Servers'.padStart(8)}`
    );
    console.log('-'.repeat(80));

    const sortedModelStats = Array.from(modelCircuitStats.entries())
      .sort((a, b) => b[1].openCount - a[1].openCount)
      .slice(0, 20);

    for (const [model, stats] of sortedModelStats) {
      console.log(
        `${model.slice(0, 40).padEnd(40)} ` +
          `${stats.openCount.toString().padStart(12)} ` +
          `${stats.transitions.toString().padStart(12)} ` +
          `${stats.servers.size.toString().padStart(8)}`
      );
    }
    console.log('');

    // Load balancer effectiveness analysis
    this.analyzeLoadBalancerEffectiveness();

    // Time series summary
    this.analyzeTimeSeries();

    // Save detailed results
    const reportPath = path.join(process.cwd(), 'reports', `enhanced-load-test-${Date.now()}.json`);
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
            models: this.modelsToTest,
            serverCoverage: {
              totalServers: this.allServers.size,
              serversHit: this.serversHit.size,
              coveragePercent: (this.serversHit.size / this.allServers.size) * 100,
              serversNotHit: Array.from(this.serversPendingCoverage),
            },
          },
          circuitBreakerSummary: {
            totalOpenEvents: totalOpenCount,
            totalTransitions,
            uniqueBreakers: this.circuitBreakerStates.size,
            modelStats: Array.from(modelCircuitStats.entries()).map(([model, stats]) => ({
              model,
              openCount: stats.openCount,
              transitions: stats.transitions,
              serverCount: stats.servers.size,
            })),
            detailedStates: Array.from(this.circuitBreakerStates.entries()).map(([key, state]) => ({
              key,
              ...state,
              transitions: state.transitions,
            })),
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
        errors: new Set<string>(),
        serverDistribution: new Map<string, number>(),
      };

      stats.requests++;
      if (result.success) {
        stats.successes++;
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
      successRate: stats.successes / stats.requests,
      avgDuration: stats.avgDuration,
      errors: Array.from(stats.errors),
      serverDistribution: Array.from(stats.serverDistribution.entries()),
    }));
  }

  private analyzeLoadBalancerEffectiveness(): void {
    console.log('LOAD BALANCER EFFECTIVENESS');
    console.log('-'.repeat(80));

    // Count requests that were routed to open circuits
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

    // Failure breakdown analysis
    console.log('');
    console.log('FAILURE BREAKDOWN:');
    console.log('-'.repeat(80));

    const failuresByType = {
      circuitBlocked: 0,
      serverError: 0,
      timeout: 0,
      other: 0,
    };

    const serverErrorPatterns = [
      '500',
      '502',
      '503',
      '504', // HTTP errors
      'connection refused',
      'ECONNREFUSED',
      'timeout',
      'ETIMEDOUT',
      'unavailable',
      'unhealthy',
    ];

    for (const result of this.results) {
      if (!result.success) {
        const error = result.error?.toLowerCase() || '';

        if (error.includes('503') || result.wasRoutedToOpenCircuit) {
          failuresByType.circuitBlocked++;
        } else if (serverErrorPatterns.some(p => error.includes(p.toLowerCase()))) {
          failuresByType.serverError++;
        } else if (error.includes('timeout') || error.includes('timed out')) {
          failuresByType.timeout++;
        } else {
          failuresByType.other++;
        }
      }
    }

    console.log(
      `  Circuit Breaker Blocked: ${failuresByType.circuitBlocked} (${((failuresByType.circuitBlocked / this.failureCount) * 100).toFixed(1)}%)`
    );
    console.log(
      `  Server Errors (5xx):     ${failuresByType.serverError} (${((failuresByType.serverError / this.failureCount) * 100).toFixed(1)}%)`
    );
    console.log(
      `  Timeouts:                ${failuresByType.timeout} (${((failuresByType.timeout / this.failureCount) * 100).toFixed(1)}%)`
    );
    console.log(
      `  Other Errors:            ${failuresByType.other} (${((failuresByType.other / this.failureCount) * 100).toFixed(1)}%)`
    );

    // Per-server analysis
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

    // Analyze server distribution for models with multiple servers
    const multiServerModels = this.results.filter(r => {
      const servers = this.modelServerMap.get(r.model) || [];
      return servers.length > 1;
    });

    if (multiServerModels.length > 0) {
      console.log('');
      console.log('Server Distribution by Model (multi-server models):');
      console.log('-'.repeat(80));

      const modelServerUsage = new Map<string, Map<string, number>>();
      for (const result of multiServerModels) {
        if (result.serverId && result.serverId !== 'unknown') {
          const serverMap = modelServerUsage.get(result.model) || new Map<string, number>();
          serverMap.set(result.serverId, (serverMap.get(result.serverId) || 0) + 1);
          modelServerUsage.set(result.model, serverMap);
        }
      }

      for (const [model, serverMap] of modelServerUsage.entries()) {
        const total = Array.from(serverMap.values()).reduce((a, b) => a + b, 0);
        const entries = Array.from(serverMap.entries());
        if (entries.length > 1) {
          // Calculate distribution statistics
          const counts = entries.map(([, count]) => count);
          const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
          const max = Math.max(...counts);
          const min = Math.min(...counts);
          const spread = max - min;

          const distribution = entries
            .map(
              ([server, count]) => `${server.slice(0, 8)}:${((count / total) * 100).toFixed(0)}%`
            )
            .join(', ');

          console.log(
            `  ${model.slice(0, 25).padEnd(25)} spread:${spread.toString().padStart(3)} ${distribution}`
          );
        }
      }

      // Calculate load balancing quality score
      console.log('');
      console.log('LOAD BALANCING QUALITY:');
      let totalVariance = 0;
      let modelCount = 0;

      for (const [model, serverMap] of modelServerUsage.entries()) {
        const counts = Array.from(serverMap.values());
        if (counts.length > 1) {
          const total = counts.reduce((a, b) => a + b, 0);
          const ideal = total / counts.length;
          const variance =
            counts.reduce((sum, c) => sum + Math.pow(c - ideal, 2), 0) / counts.length;
          const stdDev = Math.sqrt(variance);
          const coefficientOfVariation = ideal > 0 ? stdDev / ideal : 0;
          totalVariance += coefficientOfVariation;
          modelCount++;
        }
      }

      const avgCoefficientOfVariation = modelCount > 0 ? totalVariance / modelCount : 0;
      // CV of 0 = perfect balance, CV > 1 = high imbalance
      const balanceScore = Math.max(0, Math.min(100, (1 - avgCoefficientOfVariation) * 100));
      console.log(`  Balance Score: ${balanceScore.toFixed(1)}% (0%=worst, 100%=perfect)`);
      console.log(`  Coefficient of Variation: ${avgCoefficientOfVariation.toFixed(2)}`);
    }

    console.log('');
  }

  private analyzeTimeSeries(): void {
    console.log('TIME SERIES ANALYSIS');
    console.log('-'.repeat(80));

    if (this.timeSeriesData.length < 2) {
      console.log('Insufficient time series data for analysis');
      return;
    }

    // Find peak open circuit count
    const peakOpen = Math.max(...this.timeSeriesData.map(d => d.openCircuits));
    const avgOpen =
      this.timeSeriesData.reduce((sum, d) => sum + d.openCircuits, 0) / this.timeSeriesData.length;

    // Find worst success rate period
    const worstPeriod = this.timeSeriesData.reduce((worst, current) =>
      current.successRate < worst.successRate ? current : worst
    );

    console.log(`Peak Open Circuits: ${peakOpen}`);
    console.log(`Average Open Circuits: ${avgOpen.toFixed(1)}`);
    console.log(
      `Worst Success Rate: ${(worstPeriod.successRate * 100).toFixed(1)}% at ${new Date(worstPeriod.timestamp).toISOString()}`
    );
    console.log(`Open Circuits at Worst Period: ${worstPeriod.openCircuits}`);

    // Calculate correlation between open circuits and success rate
    const correlation = this.calculateCorrelation(
      this.timeSeriesData.map(d => d.openCircuits),
      this.timeSeriesData.map(d => d.successRate)
    );
    console.log(`Correlation (Open Circuits vs Success Rate): ${correlation.toFixed(3)}`);

    console.log('');
  }

  private calculateCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    return denominator === 0 ? 0 : numerator / denominator;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: { duration?: number; concurrency?: number; mode?: TestMode; modelCount?: number } =
  {};

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
  }
}

// Run the test
const test = new EnhancedCircuitBreakerLoadTest(options);
test.run().catch(error => {
  console.error('Load test failed:', error);
  process.exit(1);
});
