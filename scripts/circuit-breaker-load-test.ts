#!/usr/bin/env node
/**
 * Circuit Breaker Load Test Script
 *
 * This script hammers the orchestrator with concurrent requests to:
 * 1. Trigger circuit breakers to open
 * 2. Test the recovery mechanisms
 * 3. Verify adaptive timeouts and backoff strategies
 * 4. Analyze concurrency handling
 *
 * Usage: node scripts/circuit-breaker-load-test.ts [--duration 300] [--concurrency 50]
 */

import { promises as fs } from 'fs';
import path from 'path';

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:5100';

interface TestResult {
  model: string;
  serverId: string;
  success: boolean;
  duration: number;
  error?: string;
  timestamp: number;
  circuitBreakerState?: string;
}

interface ModelInfo {
  name: string;
  serverCount: number;
  servers: string[];
}

class CircuitBreakerLoadTest {
  private results: TestResult[] = [];
  private startTime: number = 0;
  private modelsToTest: string[] = [];
  private activeRequests: number = 0;
  private maxConcurrency: number;
  private duration: number;
  private requestCount: number = 0;
  private successCount: number = 0;
  private failureCount: number = 0;

  constructor(options: { duration?: number; concurrency?: number }) {
    this.duration = options.duration || 300; // 5 minutes default
    this.maxConcurrency = options.concurrency || 50;
  }

  async run(): Promise<void> {
    console.log('='.repeat(80));
    console.log('CIRCUIT BREAKER LOAD TEST');
    console.log('='.repeat(80));
    console.log(`Orchestrator: ${ORCHESTRATOR_URL}`);
    console.log(`Duration: ${this.duration} seconds`);
    console.log(`Max Concurrency: ${this.maxConcurrency}`);
    console.log('');

    // Fetch available models
    console.log('Fetching available models...');
    const modelInfo = await this.fetchModelInfo();

    // Select models to test
    this.selectModels(modelInfo);
    console.log(`Selected ${this.modelsToTest.length} models for testing:`);
    this.modelsToTest.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
    console.log('');

    // Run load test
    this.startTime = Date.now();
    const endTime = this.startTime + this.duration * 1000;

    console.log('Starting load test...');
    console.log('');

    // Progress reporter
    const progressInterval = setInterval(() => {
      const elapsed = (Date.now() - this.startTime) / 1000;
      const remaining = Math.max(0, this.duration - elapsed);
      const rps = this.requestCount / Math.max(1, elapsed);

      console.log(
        `[${elapsed.toFixed(1)}s/${this.duration}s] ` +
          `Active: ${this.activeRequests.toString().padStart(3)} | ` +
          `Total: ${this.requestCount.toString().padStart(5)} | ` +
          `Success: ${this.successCount.toString().padStart(5)} | ` +
          `Failed: ${this.failureCount.toString().padStart(5)} | ` +
          `RPS: ${rps.toFixed(1)} | ` +
          `Remaining: ${remaining.toFixed(0)}s`
      );
    }, 5000);

    // Spawn concurrent requests
    const requestPromises: Promise<void>[] = [];

    while (Date.now() < endTime) {
      if (this.activeRequests < this.maxConcurrency) {
        const model = this.getRandomModel();
        requestPromises.push(this.sendRequest(model));
      }

      // Small delay to prevent tight spinning
      await this.sleep(10);
    }

    // Wait for all active requests to complete
    console.log('\nWaiting for active requests to complete...');
    await Promise.all(requestPromises);

    clearInterval(progressInterval);

    // Generate report
    await this.generateReport();
  }

  private async fetchModelInfo(): Promise<Map<string, ModelInfo>> {
    try {
      // Fetch both model-map and servers endpoints (like the frontend does)
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

      // modelMap is: { success: true, modelToServers: { [modelName: string]: string[] }, ... }
      const modelMapData = await modelMapResponse.json();
      const modelToServers: Record<string, string[]> = modelMapData.modelToServers || {};

      // Build the model info map
      const modelMap = new Map<string, ModelInfo>();

      for (const [modelName, serverIds] of Object.entries(modelToServers)) {
        modelMap.set(modelName, {
          name: modelName,
          serverCount: serverIds.length,
          servers: serverIds,
        });
      }

      return modelMap;
    } catch (error) {
      console.error('Failed to fetch model info:', error);
      throw error;
    }
  }

  private selectModels(modelInfo: Map<string, ModelInfo>): void {
    // Convert to array and sort by server count
    const sortedModels = Array.from(modelInfo.values()).sort(
      (a, b) => b.serverCount - a.serverCount
    );

    console.log('Top models by server count:');
    sortedModels.slice(0, 30).forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.name} (${m.serverCount} servers)`);
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

  private getRandomModel(): string {
    return this.modelsToTest[Math.floor(Math.random() * this.modelsToTest.length)];
  }

  private async sendRequest(model: string): Promise<void> {
    this.activeRequests++;
    this.requestCount++;

    const startTime = Date.now();
    const requestId = `${startTime}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Determine if this is an embedding model
      const isEmbeddingModel =
        model.toLowerCase().includes('embed') || model.toLowerCase().includes('nomic');

      let response;
      let endpoint;
      let body;

      if (isEmbeddingModel) {
        // Test embedding endpoint
        endpoint = '/api/embeddings';
        body = JSON.stringify({
          model: model,
          prompt: 'test',
        });
      } else {
        // Test generation endpoint
        endpoint = '/api/generate';
        body = JSON.stringify({
          model: model,
          prompt: 'Say hello',
          stream: false,
          options: {
            num_predict: 5,
          },
        });
      }

      response = await fetch(`${ORCHESTRATOR_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': requestId,
        },
        body,
      });

      const duration = Date.now() - startTime;
      const success = response.ok;

      if (success) {
        this.successCount++;
      } else {
        this.failureCount++;
      }

      // Try to get circuit breaker state from response headers
      const cbState = response.headers.get('X-Circuit-Breaker-State');

      this.results.push({
        model,
        serverId: 'unknown',
        success,
        duration,
        error: success ? undefined : `HTTP ${response.status}`,
        timestamp: startTime,
        circuitBreakerState: cbState || undefined,
      });

      // Log interesting events
      if (!success && response.status === 503) {
        console.log(`  [503] Circuit breaker OPEN for ${model} (${duration}ms)`);
      } else if (!success && response.status === 504) {
        console.log(`  [504] Gateway timeout for ${model} (${duration}ms)`);
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
      });

      if (errorMessage.includes('circuit breaker')) {
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
    console.log('LOAD TEST COMPLETE');
    console.log('='.repeat(80));
    console.log(`Total Duration: ${totalDuration.toFixed(1)} seconds`);
    console.log(`Total Requests: ${this.requestCount}`);
    console.log(
      `Successful: ${this.successCount} (${((this.successCount / this.requestCount) * 100).toFixed(1)}%)`
    );
    console.log(
      `Failed: ${this.failureCount} (${((this.failureCount / this.requestCount) * 100).toFixed(1)}%)`
    );
    console.log(`Average RPS: ${rps.toFixed(1)}`);
    console.log('');

    // Analyze by model
    const modelStats = new Map<
      string,
      {
        requests: number;
        successes: number;
        failures: number;
        avgDuration: number;
        errors: Set<string>;
      }
    >();

    for (const result of this.results) {
      const stats = modelStats.get(result.model) || {
        requests: 0,
        successes: 0,
        failures: 0,
        avgDuration: 0,
        errors: new Set<string>(),
      };

      stats.requests++;
      if (result.success) {
        stats.successes++;
      } else {
        stats.failures++;
        if (result.error) stats.errors.add(result.error);
      }
      stats.avgDuration =
        (stats.avgDuration * (stats.requests - 1) + result.duration) / stats.requests;

      modelStats.set(result.model, stats);
    }

    console.log('Results by Model:');
    console.log('-'.repeat(80));
    console.log(
      `${'Model'.padEnd(40)} ${'Reqs'.padStart(6)} ${'Succ%'.padStart(6)} ${'AvgMs'.padStart(8)} ${'Errors'.padStart(15)}`
    );
    console.log('-'.repeat(80));

    const sortedModels = Array.from(modelStats.entries()).sort(
      (a, b) => b[1].requests - a[1].requests
    );

    for (const [model, stats] of sortedModels) {
      const successRate = ((stats.successes / stats.requests) * 100).toFixed(0);
      const errorSummary = Array.from(stats.errors).slice(0, 2).join(', ') || 'None';
      console.log(
        `${model.slice(0, 40).padEnd(40)} ` +
          `${stats.requests.toString().padStart(6)} ` +
          `${successRate.padStart(6)}% ` +
          `${stats.avgDuration.toFixed(0).padStart(8)} ` +
          `${errorSummary.slice(0, 15).padStart(15)}`
      );
    }

    console.log('');
    console.log('Error Analysis:');
    console.log('-'.repeat(80));

    const errorCounts = new Map<string, number>();
    for (const result of this.results) {
      if (result.error) {
        const errorKey = result.error.substring(0, 50);
        errorCounts.set(errorKey, (errorCounts.get(errorKey) || 0) + 1);
      }
    }

    const sortedErrors = Array.from(errorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    for (const [error, count] of sortedErrors) {
      console.log(`  ${count.toString().padStart(5)}x: ${error}`);
    }

    // Save detailed results
    const reportPath = path.join(process.cwd(), 'reports', `load-test-${Date.now()}.json`);
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
            rps,
            models: this.modelsToTest,
          },
          modelStats: Array.from(modelStats.entries()).map(([model, stats]) => ({
            model,
            requests: stats.requests,
            successes: stats.successes,
            failures: stats.failures,
            successRate: stats.successes / stats.requests,
            avgDuration: stats.avgDuration,
            errors: Array.from(stats.errors),
          })),
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

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: { duration?: number; concurrency?: number } = {};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--duration' && args[i + 1]) {
    options.duration = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--concurrency' && args[i + 1]) {
    options.concurrency = parseInt(args[i + 1], 10);
    i++;
  }
}

// Run the test
const test = new CircuitBreakerLoadTest(options);
test.run().catch(error => {
  console.error('Load test failed:', error);
  process.exit(1);
});
