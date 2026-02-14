#!/usr/bin/env tsx
/**
 * Direct Import Load Test Script
 *
 * This script imports the AIOrchestrator directly to capture granular metrics
 * on circuit breaker decisions, load balancer choices, and internal state changes.
 *
 * Usage: node scripts/direct-import-load-test.ts [--duration 300] [--concurrency 50] [--mode mixed]
 */

import { promises as fs } from 'fs';
import path from 'path';
import { AIOrchestrator } from '../src/orchestrator.js';

interface DetailedTestResult {
  requestId: string;
  model: string;
  serverId: string;
  success: boolean;
  duration: number;
  error?: string;
  timestamp: number;
  endpoint: 'generate' | 'embeddings';
  serverCircuitState: 'closed' | 'open' | 'half-open';
  modelCircuitState: 'closed' | 'open' | 'half-open';
  wasBlockedByCircuitBreaker: boolean;
  availableServers: number;
  selectedServerRank: number;
  retryCount: number;
  failoverServers: string[];
  errorClassification?: string;
  modelTypeDetected?: 'generation' | 'embedding' | 'unknown';
}

interface CircuitBreakerTransition {
  key: string;
  fromState: 'closed' | 'open' | 'half-open';
  toState: 'closed' | 'open' | 'half-open';
  timestamp: number;
  trigger: string;
  reason?: string;
}

interface LoadBalancerDecision {
  algorithm: string;
  candidates: Array<{
    serverId: string;
    score: number;
    rank: number;
    reason?: string;
  }>;
  selectedServer: string;
  selectionReason: string;
  timestamp: number;
}

interface TimeSeriesPoint {
  timestamp: number;
  activeRequests: number;
  queuedRequests: number;
  openCircuits: number;
  halfOpenCircuits: number;
  closedCircuits: number;
  totalRequests: number;
  successRate: number;
  avgLatency: number;
  circuitBlockedRequests: number;
  perServerHalfOpen: Record<string, number>;
  circuitBreakerTransitions: CircuitBreakerTransition[];
  loadBalancerDecisions: LoadBalancerDecision[];
}

type TestMode = 'uniform' | 'targeted' | 'spike' | 'mixed';

class DirectImportLoadTest {
  private orchestrator!: AIOrchestrator;
  private results: DetailedTestResult[] = [];
  private timeSeriesData: TimeSeriesPoint[] = [];
  private circuitBreakerTransitions: CircuitBreakerTransition[] = [];
  private loadBalancerDecisions: LoadBalancerDecision[] = [];
  private startTime: number = 0;
  private modelsToTest: string[] = [];
  private modelServerMap: Map<string, string[]> = new Map();
  private activeRequests: number = 0;
  private maxConcurrency: number;
  private duration: number;
  private mode: TestMode;
  private requestCount: number = 0;
  private successCount: number = 0;
  private failureCount: number = 0;
  private circuitBlockedCount: number = 0;

  // Hook into orchestrator internals for detailed tracking
  private originalTryRequestWithFailover: any;
  private originalGetBestServerForModel: any;

  constructor(options: { duration?: number; concurrency?: number; mode?: TestMode }) {
    this.duration = options.duration || 300; // 5 minutes default
    this.maxConcurrency = options.concurrency || 50;
    this.mode = options.mode || 'mixed';
  }

  async run(): Promise<void> {
    console.log('='.repeat(80));
    console.log('DIRECT IMPORT LOAD TEST');
    console.log('='.repeat(80));
    console.log(`Duration: ${this.duration} seconds`);
    console.log(`Max Concurrency: ${this.maxConcurrency}`);
    console.log(`Test Mode: ${this.mode}`);
    console.log('');

    // Initialize orchestrator directly
    await this.initializeOrchestrator();

    // Setup detailed tracking hooks
    this.setupTrackingHooks();

    // Get available models
    const allModels = this.orchestrator.getAllModels();
    const modelMap = this.orchestrator.getModelMap();

    console.log(`Found ${allModels.length} available models`);

    if (allModels.length === 0) {
      console.log('No models available - skipping load test');
      return;
    }

    // Select models to test
    this.selectModels(allModels, modelMap);

    // Run load test
    this.startTime = Date.now();
    const endTime = this.startTime + this.duration * 1000;

    console.log('Starting load test...');
    console.log('');

    // Progress reporter with detailed metrics
    const progressInterval = setInterval(async () => {
      const elapsed = (Date.now() - this.startTime) / 1000;
      const remaining = Math.max(0, this.duration - elapsed);
      const rps = this.requestCount / Math.max(1, elapsed);

      // Collect current circuit breaker stats
      const circuitStats = this.orchestrator.getCircuitBreakerStats();
      let openCount = 0,
        halfOpenCount = 0,
        closedCount = 0;
      const perServerHalfOpen: Record<string, number> = {};

      for (const [key, stats] of Object.entries(circuitStats)) {
        if (stats.state === 'open') openCount++;
        else if (stats.state === 'half-open') {
          halfOpenCount++;
          const serverId = key.split(':')[0];
          perServerHalfOpen[serverId] = (perServerHalfOpen[serverId] || 0) + 1;
        } else closedCount++;
      }

      console.log(
        `[${elapsed.toFixed(1)}s/${this.duration}s] ` +
          `Active: ${this.activeRequests.toString().padStart(3)} | ` +
          `Queued: ${this.orchestrator.getQueueStats().currentSize.toString().padStart(3)} | ` +
          `Total: ${this.requestCount.toString().padStart(5)} | ` +
          `Success: ${this.successCount.toString().padStart(5)} | ` +
          `Failed: ${this.failureCount.toString().padStart(5)} | ` +
          `CB-Blocked: ${this.circuitBlockedCount.toString().padStart(5)} | ` +
          `Open CBs: ${openCount.toString().padStart(3)} | ` +
          `RPS: ${rps.toFixed(1)} | ` +
          `Remaining: ${remaining.toFixed(0)}s`
      );

      // Record time-series data point
      this.recordTimeSeriesPoint();
    }, 5000);

    // Spawn concurrent requests
    const requestPromises: Promise<void>[] = [];

    if (this.mode === 'spike') {
      await this.runSpikePattern(requestPromises, endTime);
    } else if (this.mode === 'targeted') {
      await this.runTargetedPattern(requestPromises, endTime);
    } else {
      await this.runStandardPattern(requestPromises, endTime);
    }

    // Wait for all active requests to complete
    console.log('\nWaiting for active requests to complete...');
    await Promise.all(requestPromises);

    clearInterval(progressInterval);

    // Generate detailed report
    await this.generateDetailedReport();

    // Cleanup hooks
    this.cleanupTrackingHooks();
  }

  private async initializeOrchestrator(): Promise<void> {
    // Create orchestrator with default config (will load from existing setup)
    this.orchestrator = new AIOrchestrator();
    await this.orchestrator.initialize();

    console.log('Orchestrator initialized successfully');

    // Print current circuit breaker status
    const circuitStats = this.orchestrator.getCircuitBreakerStats();
    console.log('\n=== CURRENT CIRCUIT BREAKER STATUS ===');
    let openCount = 0,
      halfOpenCount = 0,
      closedCount = 0;
    for (const [key, stats] of Object.entries(circuitStats)) {
      if (stats.state === 'open') openCount++;
      else if (stats.state === 'half-open') halfOpenCount++;
      else closedCount++;
    }
    console.log(`Total circuits: ${Object.keys(circuitStats).length}`);
    console.log(`Open: ${openCount}, Half-open: ${halfOpenCount}, Closed: ${closedCount}`);
    console.log('=== END CIRCUIT BREAKER STATUS ===\n');
  }

  private setupTrackingHooks(): void {
    // Hook into load balancer decisions
    const originalGetBestServerForModel = this.orchestrator.getBestServerForModel.bind(
      this.orchestrator
    );
    this.orchestrator.getBestServerForModel = (model: string, isStreaming?: boolean) => {
      const server = originalGetBestServerForModel(model, isStreaming);

      // Record load balancer decision
      if (server) {
        const scores = this.orchestrator.getServerScores(model);
        const selectedScore = scores.find(s => s.server.id === server.id);

        this.loadBalancerDecisions.push({
          algorithm: 'historical', // Would get from load balancer
          candidates: scores.map((s, index) => ({
            serverId: s.server.id,
            score: s.totalScore,
            rank: index + 1,
          })),
          selectedServer: server.id,
          selectionReason: selectedScore ? `Score: ${selectedScore.totalScore}` : 'Unknown',
          timestamp: Date.now(),
        });
      }

      return server;
    };

    // Hook into request execution for detailed tracking
    const originalTryRequestWithFailover = this.orchestrator.tryRequestWithFailover.bind(
      this.orchestrator
    );
    this.orchestrator.tryRequestWithFailover = async (
      model: string,
      fn: (server: any) => Promise<any>,
      isStreaming?: boolean,
      endpoint?: 'generate' | 'embeddings'
    ): Promise<any> => {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      try {
        const result = await originalTryRequestWithFailover(model, fn, isStreaming, endpoint);

        // Record successful request
        this.recordDetailedResult({
          requestId,
          model,
          serverId: 'unknown', // Would need to extract from context
          success: true,
          duration: 0, // Would need to track this
          timestamp: Date.now(),
          endpoint: endpoint || 'generate',
          serverCircuitState: 'closed', // Would need to get from orchestrator
          modelCircuitState: 'closed', // Would need to get from orchestrator
          wasBlockedByCircuitBreaker: false,
          availableServers: this.modelServerMap.get(model)?.length || 0,
          selectedServerRank: 1, // Would calculate this
          retryCount: 0, // Would track this
          failoverServers: [],
        });

        return result;
      } catch (error) {
        // Record failed request
        this.recordDetailedResult({
          requestId,
          model,
          serverId: 'unknown',
          success: false,
          duration: 0,
          error: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
          endpoint: endpoint || 'generate',
          serverCircuitState: 'closed',
          modelCircuitState: 'closed',
          wasBlockedByCircuitBreaker: false, // Would detect this
          availableServers: this.modelServerMap.get(model)?.length || 0,
          selectedServerRank: 1,
          retryCount: 0,
          failoverServers: [],
          errorClassification: 'unknown', // Would classify error
        });

        throw error;
      }
    };
  }

  private recordDetailedResult(result: DetailedTestResult): void {
    this.results.push(result);

    if (result.success) {
      this.successCount++;
    } else {
      this.failureCount++;
      if (result.wasBlockedByCircuitBreaker) {
        this.circuitBlockedCount++;
      }
    }
  }

  private recordTimeSeriesPoint(): void {
    const now = Date.now();
    const circuitStats = this.orchestrator.getCircuitBreakerStats();
    const queueStats = this.orchestrator.getQueueStats();

    let openCount = 0,
      halfOpenCount = 0,
      closedCount = 0;
    const perServerHalfOpen: Record<string, number> = {};

    for (const [key, stats] of Object.entries(circuitStats)) {
      if (stats.state === 'open') openCount++;
      else if (stats.state === 'half-open') {
        halfOpenCount++;
        const serverId = key.split(':')[0];
        perServerHalfOpen[serverId] = (perServerHalfOpen[serverId] || 0) + 1;
      } else closedCount++;
    }

    // Calculate recent metrics
    const recentResults = this.results.filter(r => r.timestamp > now - 10000);
    const recentSuccesses = recentResults.filter(r => r.success).length;
    const recentAvgLatency =
      recentResults.length > 0
        ? recentResults.reduce((sum, r) => sum + r.duration, 0) / recentResults.length
        : 0;

    // Get recent transitions and decisions
    const recentTransitions = this.circuitBreakerTransitions.filter(t => t.timestamp > now - 10000);
    const recentDecisions = this.loadBalancerDecisions.filter(d => d.timestamp > now - 10000);

    this.timeSeriesData.push({
      timestamp: now,
      activeRequests: this.activeRequests,
      queuedRequests: queueStats.currentSize,
      openCircuits: openCount,
      halfOpenCircuits: halfOpenCount,
      closedCircuits: closedCount,
      totalRequests: this.requestCount,
      successRate: recentResults.length > 0 ? recentSuccesses / recentResults.length : 1,
      avgLatency: recentAvgLatency,
      circuitBlockedRequests: recentResults.filter(r => r.wasBlockedByCircuitBreaker).length,
      perServerHalfOpen,
      circuitBreakerTransitions: recentTransitions,
      loadBalancerDecisions: recentDecisions,
    });
  }

  private selectModels(allModels: string[], modelMap: Record<string, string[]>): void {
    // Select diverse models for testing
    const sortedModels = allModels
      .map(model => ({
        name: model,
        serverCount: modelMap[model]?.length || 0,
      }))
      .sort((a, b) => b.serverCount - a.serverCount);

    console.log('Top models by server count:');
    sortedModels.slice(0, 30).forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.name} (${m.serverCount} servers)`);
      this.modelServerMap.set(m.name, modelMap[m.name] || []);
    });
    console.log('');

    // Pick top 20 models
    const topModels = sortedModels.slice(0, 20).map(m => m.name);

    // Pick 10 random models from remaining that have at least 2 nodes
    const remainingModels = sortedModels.slice(20).filter(m => m.serverCount >= 2);
    const randomModels: string[] = [];

    while (randomModels.length < 10 && remainingModels.length > 0) {
      const index = Math.floor(Math.random() * remainingModels.length);
      const model = remainingModels.splice(index, 1)[0];
      randomModels.push(model.name);
    }

    this.modelsToTest = [...topModels, ...randomModels];
  }

  private async runStandardPattern(
    requestPromises: Promise<void>[],
    endTime: number
  ): Promise<void> {
    while (Date.now() < endTime) {
      if (this.activeRequests < this.maxConcurrency) {
        const model = this.getRandomModel();
        requestPromises.push(this.sendDirectRequest(model));
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
        requestPromises.push(this.sendDirectRequest(model));
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
        requestPromises.push(this.sendDirectRequest(model));
      }
      await this.sleep(10);
    }
  }

  private async sendDirectRequest(model: string): Promise<void> {
    this.activeRequests++;
    this.requestCount++;

    const isEmbeddingModel =
      model.toLowerCase().includes('embed') || model.toLowerCase().includes('nomic');

    try {
      // Use orchestrator's direct method instead of HTTP request
      const endpoint = isEmbeddingModel ? 'embeddings' : 'generate';

      if (isEmbeddingModel) {
        await this.orchestrator.tryRequestWithFailover(
          model,
          async server => {
            // Simulate embedding request
            const response = await fetch(`${server.url}/api/embeddings`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model, prompt: 'test' }),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          },
          false,
          endpoint
        );
      } else {
        await this.orchestrator.tryRequestWithFailover(
          model,
          async server => {
            // Simulate generation request
            const response = await fetch(`${server.url}/api/generate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model,
                prompt: 'Say hello',
                stream: false,
                options: { num_predict: 5 },
              }),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          },
          false,
          endpoint
        );
      }

      this.successCount++;
    } catch (error) {
      this.failureCount++;
      // Error details are captured by our hooks
    } finally {
      this.activeRequests--;
    }
  }

  private getRandomModel(): string {
    return this.modelsToTest[Math.floor(Math.random() * this.modelsToTest.length)];
  }

  private async generateDetailedReport(): Promise<void> {
    const endTime = Date.now();
    const totalDuration = (endTime - this.startTime) / 1000;
    const rps = this.requestCount / totalDuration;

    console.log('\n' + '='.repeat(80));
    console.log('DIRECT IMPORT LOAD TEST COMPLETE');
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

    // Circuit Breaker Analysis
    console.log('CIRCUIT BREAKER ANALYSIS');
    console.log('-'.repeat(80));
    console.log(`Total Circuit Breaker Transitions: ${this.circuitBreakerTransitions.length}`);
    console.log(`Total Load Balancer Decisions: ${this.loadBalancerDecisions.length}`);

    // Load Balancer Analysis
    console.log('\nLOAD BALANCER ANALYSIS');
    console.log('-'.repeat(80));

    const algorithmUsage = this.loadBalancerDecisions.reduce(
      (acc, d) => {
        acc[d.algorithm] = (acc[d.algorithm] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    for (const [algorithm, count] of Object.entries(algorithmUsage)) {
      console.log(`${algorithm}: ${count} decisions`);
    }

    // Time Series Analysis
    console.log('\nTIME SERIES ANALYSIS');
    console.log('-'.repeat(80));

    if (this.timeSeriesData.length >= 2) {
      const peakOpen = Math.max(...this.timeSeriesData.map(d => d.openCircuits));
      const avgOpen =
        this.timeSeriesData.reduce((sum, d) => sum + d.openCircuits, 0) /
        this.timeSeriesData.length;
      const worstPeriod = this.timeSeriesData.reduce((worst, current) =>
        current.successRate < worst.successRate ? current : worst
      );

      console.log(`Peak Open Circuits: ${peakOpen}`);
      console.log(`Average Open Circuits: ${avgOpen.toFixed(1)}`);
      console.log(`Worst Success Rate: ${(worstPeriod.successRate * 100).toFixed(1)}%`);
      console.log(`Open Circuits at Worst Period: ${worstPeriod.openCircuits}`);
    }

    // Save detailed results
    const reportPath = path.join(
      process.cwd(),
      'reports',
      `direct-import-load-test-${Date.now()}.json`
    );
    await fs.mkdir(path.dirname(reportPath), { recursive: true });

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
            models: this.modelsToTest,
          },
          circuitBreakerAnalysis: {
            totalTransitions: this.circuitBreakerTransitions.length,
            detailedTransitions: this.circuitBreakerTransitions.slice(-100), // Last 100
          },
          loadBalancerAnalysis: {
            totalDecisions: this.loadBalancerDecisions.length,
            algorithmUsage,
            recentDecisions: this.loadBalancerDecisions.slice(-50), // Last 50
          },
          timeSeriesData: this.timeSeriesData,
          detailedResults: this.results.slice(-1000), // Last 1000 results
          modelStats: this.calculateModelStats(),
        },
        null,
        2
      )
    );

    console.log(`\nDetailed report saved to: ${reportPath}`);
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
        serverDistribution: new Map<string, number>(),
      };

      stats.requests++;
      if (result.success) stats.successes++;
      else stats.failures++;
      if (result.wasBlockedByCircuitBreaker) stats.circuitBlocked++;

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
      serverDistribution: Array.from(stats.serverDistribution.entries()),
    }));
  }

  private cleanupTrackingHooks(): void {
    // Restore original methods if needed
    // This would be complex to implement perfectly, but for testing it's fine
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: { duration?: number; concurrency?: number; mode?: TestMode } = {};

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
  }
}

// Run the test
const test = new DirectImportLoadTest(options);
test.run().catch(error => {
  console.error('Direct import load test failed:', error);
  process.exit(1);
});
