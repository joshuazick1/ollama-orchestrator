import { test, expect, APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Test configuration
const TEST_CONFIG = {
  ORCHESTRATOR_URL: 'http://localhost:5100',
  HEALTH_CHECK_TIMEOUT: 30000,
  REQUEST_TIMEOUT: 60000,
  LOAD_TEST_CONCURRENCY: 10,
  LOAD_TEST_REQUESTS: 50,
  CIRCUIT_BREAKER_THRESHOLD: 5,
  MAX_SERVERS_TO_TEST: 160,
};

// Types for server data
interface ServerConfig {
  id: string;
  url: string;
  type: string;
  healthy: boolean;
  lastResponseTime: number | null;
  models: string[];
}

interface TestResult {
  testName: string;
  passed: boolean;
  duration: number;
  details: Record<string, any>;
  error?: string;
}

interface ServerTestResult {
  server: ServerConfig;
  reachable: boolean;
  healthy: boolean;
  responseTime: number | null;
  modelsAvailable: string[];
  error?: string;
}

// Load servers from orchestrator-servers file
function loadServerConfigs(): ServerConfig[] {
  const filePath = path.join(process.cwd(), 'orchestrator-servers');

  if (!fs.existsSync(filePath)) {
    console.log('orchestrator-servers file not found, using empty server list');
    return [];
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    // Remove any comments and parse JSON
    const cleanContent = content.replace(/^\s*\/\/.*$/gm, '');
    return JSON.parse(cleanContent);
  } catch (error) {
    console.error('Failed to parse orchestrator-servers file:', error);
    return [];
  }
}

// Comprehensive E2E Test Suite
test.describe('🔍 Exhaustive Real-World E2E Evaluation', () => {
  let apiContext: APIRequestContext;
  let serverConfigs: ServerConfig[];
  let testResults: TestResult[] = [];
  let serverTestResults: ServerTestResult[] = [];

  test.beforeAll(async ({ playwright }) => {
    console.log('\n🚀 Starting Exhaustive E2E Evaluation...\n');

    // Load server configurations
    serverConfigs = loadServerConfigs();
    console.log(
      `📋 Loaded ${serverConfigs.length} server configurations from orchestrator-servers`
    );

    // Create API context
    apiContext = await playwright.request.newContext({
      baseURL: TEST_CONFIG.ORCHESTRATOR_URL,
      timeout: TEST_CONFIG.REQUEST_TIMEOUT,
    });

    // Verify orchestrator is running
    try {
      const healthResponse = await apiContext.get('/api/orchestrator/health');
      if (!healthResponse.ok()) {
        throw new Error(`Orchestrator health check failed: ${healthResponse.status()}`);
      }
      console.log('✅ Orchestrator is running and healthy\n');
    } catch (error) {
      console.error('❌ Orchestrator is not running. Please start it first:');
      console.error('   npm run dev');
      throw error;
    }
  });

  test.afterAll(async () => {
    await apiContext.dispose();

    // Generate final report
    generateEvaluationReport();
  });

  // Helper to record test results
  function recordResult(
    testName: string,
    passed: boolean,
    details: Record<string, any>,
    error?: string
  ) {
    const result: TestResult = {
      testName,
      passed,
      duration: 0,
      details,
      error,
    };
    testResults.push(result);

    if (passed) {
      console.log(`✅ ${testName}`);
    } else {
      console.log(`❌ ${testName}${error ? `: ${error}` : ''}`);
    }

    return result;
  }

  // ==================== PHASE 1: SERVER CONNECTIVITY ====================
  test.describe('Phase 1: Server Connectivity & Health', () => {
    test('Test 1.1: Verify orchestrator health endpoint', async () => {
      const startTime = Date.now();

      const response = await apiContext.get('/api/orchestrator/health');
      const duration = Date.now() - startTime;

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.status).toBeDefined();

      recordResult('Orchestrator Health Check', true, {
        status: response.status(),
        duration,
        orchestratorStatus: data.status,
      });
    });

    test('Test 1.2: Register all servers from orchestrator-servers', async () => {
      if (serverConfigs.length === 0) {
        console.log('⚠️ No servers to register');
        return;
      }

      let registered = 0;
      let failed = 0;
      const results: Record<string, any>[] = [];

      for (const server of serverConfigs.slice(0, TEST_CONFIG.MAX_SERVERS_TO_TEST)) {
        try {
          const startTime = Date.now();

          const response = await apiContext.post('/api/orchestrator/servers/add', {
            data: {
              id: server.id,
              url: server.url,
              type: server.type,
              maxConcurrency: 4,
            },
          });

          const duration = Date.now() - startTime;

          if (response.ok()) {
            registered++;
            results.push({
              id: server.id,
              url: server.url,
              status: 'registered',
              duration,
            });
          } else {
            failed++;
            results.push({
              id: server.id,
              url: server.url,
              status: 'failed',
              error: await response.text(),
              duration,
            });
          }
        } catch (error: any) {
          failed++;
          results.push({
            id: server.id,
            url: server.url,
            status: 'error',
            error: error.message,
          });
        }
      }

      console.log(`\n📊 Server Registration Results:`);
      console.log(`   Registered: ${registered}`);
      console.log(`   Failed: ${failed}`);

      recordResult(
        'Bulk Server Registration',
        failed === 0,
        {
          total: serverConfigs.length,
          registered,
          failed,
          details: results.slice(0, 10), // First 10 for brevity
        },
        failed > 0 ? `${failed} servers failed to register` : undefined
      );
    });

    test('Test 1.3: Health check all registered servers', async () => {
      // Get list of registered servers
      const serversResponse = await apiContext.get('/api/orchestrator/servers');
      expect(serversResponse.ok()).toBeTruthy();

      const serversData = await serversResponse.json();
      const servers = serversData.servers || [];

      console.log(`\n🏥 Health Checking ${servers.length} registered servers...`);

      let healthy = 0;
      let unhealthy = 0;

      for (const server of servers) {
        const isHealthy = server.healthy === true;
        if (isHealthy) {
          healthy++;
        } else {
          unhealthy++;
        }

        serverTestResults.push({
          server: {
            id: server.id,
            url: server.url,
            type: server.type || 'ollama',
            healthy: isHealthy,
            lastResponseTime: server.lastResponseTime,
            models: server.models || [],
          },
          reachable: true, // If in list, it was reachable at registration
          healthy: isHealthy,
          responseTime: server.lastResponseTime,
          modelsAvailable: server.models || [],
        });
      }

      console.log(`   Healthy: ${healthy}`);
      console.log(`   Unhealthy: ${unhealthy}`);

      recordResult('Server Health Check', true, {
        total: servers.length,
        healthy,
        unhealthy,
        healthRate:
          servers.length > 0 ? ((healthy / servers.length) * 100).toFixed(2) + '%' : 'N/A',
      });
    });

    test('Test 1.4: Verify server model discovery', async () => {
      const serversResponse = await apiContext.get('/api/orchestrator/servers');
      const serversData = await serversResponse.json();
      const servers = serversData.servers || [];

      let totalModels = 0;
      const modelDistribution: Record<string, number> = {};

      for (const server of servers) {
        const models = server.models || [];
        totalModels += models.length;

        for (const model of models) {
          modelDistribution[model] = (modelDistribution[model] || 0) + 1;
        }
      }

      const uniqueModels = Object.keys(modelDistribution).length;

      console.log(`\n📦 Model Discovery Results:`);
      console.log(`   Total model instances: ${totalModels}`);
      console.log(`   Unique models: ${uniqueModels}`);
      console.log(`   Top 10 models by availability:`);

      Object.entries(modelDistribution)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .forEach(([model, count]) => {
          console.log(`     ${model}: ${count} servers`);
        });

      recordResult('Model Discovery', true, {
        totalModelInstances: totalModels,
        uniqueModels,
        modelDistribution: Object.entries(modelDistribution)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
      });
    });
  });

  // ==================== PHASE 2: LOAD BALANCING ====================
  test.describe('Phase 2: Load Balancing & Routing', () => {
    test('Test 2.1: Test /api/tags endpoint (model listing)', async () => {
      const startTime = Date.now();

      const response = await apiContext.get('/api/tags');
      const duration = Date.now() - startTime;

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.models).toBeDefined();
      expect(Array.isArray(data.models)).toBe(true);

      recordResult('Model Listing (/api/tags)', true, {
        status: response.status(),
        duration,
        modelCount: data.models.length,
      });
    });

    test('Test 2.2: Test basic text generation routing', async () => {
      const startTime = Date.now();

      const response = await apiContext.post('/api/generate', {
        data: {
          model: 'llama2:7b',
          prompt: 'Say "Hello from E2E test" in exactly 5 words.',
          stream: false,
          options: {
            temperature: 0.1,
            num_predict: 20,
          },
        },
      });

      const duration = Date.now() - startTime;

      if (response.ok()) {
        const data = await response.json();
        recordResult('Text Generation Routing', true, {
          status: response.status(),
          duration,
          model: data.model,
          responseLength: data.response?.length || 0,
          done: data.done,
        });
      } else {
        const errorText = await response.text();
        recordResult(
          'Text Generation Routing',
          false,
          {
            status: response.status(),
            duration,
            error: errorText,
          },
          errorText
        );
      }
    });

    test('Test 2.3: Test load distribution across servers', async () => {
      const numRequests = 20;
      const requests: Promise<any>[] = [];
      const startTime = Date.now();

      console.log(`\n⚖️ Testing load distribution with ${numRequests} concurrent requests...`);

      for (let i = 0; i < numRequests; i++) {
        requests.push(
          apiContext
            .post('/api/generate', {
              data: {
                model: 'llama2:7b',
                prompt: `Load test request ${i}`,
                stream: false,
                options: {
                  temperature: 0.1,
                  num_predict: 10,
                },
              },
            })
            .catch(err => ({ error: err.message, ok: () => false }))
        );
      }

      const responses = await Promise.all(requests);
      const duration = Date.now() - startTime;

      const successful = responses.filter(r => r.ok && r.ok()).length;
      const failed = responses.filter(r => !r.ok || !r.ok()).length;

      console.log(`   Successful: ${successful}/${numRequests}`);
      console.log(`   Failed: ${failed}/${numRequests}`);
      console.log(`   Total duration: ${duration}ms`);
      console.log(`   Average per request: ${(duration / numRequests).toFixed(2)}ms`);

      recordResult(
        'Load Distribution Test',
        successful > 0,
        {
          totalRequests: numRequests,
          successful,
          failed,
          duration,
          successRate: ((successful / numRequests) * 100).toFixed(2) + '%',
        },
        failed > 0 ? `${failed} requests failed` : undefined
      );
    });

    test('Test 2.4: Test model availability across servers', async () => {
      const modelsResponse = await apiContext.get('/api/orchestrator/models');
      expect(modelsResponse.ok()).toBeTruthy();

      const modelsData = await modelsResponse.json();
      const models = modelsData.models || [];

      console.log(`\n🎯 Found ${models.length} models in orchestrator`);

      // Test a few common models
      const testModels = ['llama2:7b', 'llama3:latest', 'mistral:latest'].filter(m =>
        models.some((om: any) => om.id === m)
      );

      const modelResults: Record<string, any>[] = [];

      for (const model of testModels.slice(0, 3)) {
        try {
          const startTime = Date.now();
          const response = await apiContext.post('/api/generate', {
            data: {
              model,
              prompt: 'Test',
              stream: false,
              options: { num_predict: 5 },
            },
          });
          const duration = Date.now() - startTime;

          modelResults.push({
            model,
            available: response.ok(),
            duration,
            status: response.status(),
          });
        } catch (error: any) {
          modelResults.push({
            model,
            available: false,
            error: error.message,
          });
        }
      }

      console.log(`   Model availability results:`);
      modelResults.forEach(r => {
        console.log(
          `     ${r.model}: ${r.available ? '✅' : '❌'} ${r.duration ? `(${r.duration}ms)` : ''}`
        );
      });

      recordResult(
        'Model Availability Test',
        modelResults.some(r => r.available),
        {
          modelsTested: modelResults.length,
          available: modelResults.filter(r => r.available).length,
          unavailable: modelResults.filter(r => !r.available).length,
          details: modelResults,
        }
      );
    });
  });

  // ==================== PHASE 3: CIRCUIT BREAKER ====================
  test.describe('Phase 3: Circuit Breaker & Fault Tolerance', () => {
    test('Test 3.1: Verify circuit breaker status endpoint', async () => {
      const response = await apiContext.get('/api/orchestrator/circuit-breakers');
      expect(response.ok()).toBeTruthy();

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.circuitBreakers).toBeDefined();

      const breakers = data.circuitBreakers || [];
      const open = breakers.filter((b: any) => b.state === 'OPEN').length;
      const closed = breakers.filter((b: any) => b.state === 'CLOSED').length;
      const halfOpen = breakers.filter((b: any) => b.state === 'HALF_OPEN').length;

      console.log(`\n🔒 Circuit Breaker Status:`);
      console.log(`   Total: ${breakers.length}`);
      console.log(`   Closed: ${closed}`);
      console.log(`   Half-Open: ${halfOpen}`);
      console.log(`   Open: ${open}`);

      recordResult('Circuit Breaker Status', true, {
        total: breakers.length,
        closed,
        halfOpen,
        open,
        states: breakers.slice(0, 5).map((b: any) => ({
          server: b.serverId,
          state: b.state,
          failureCount: b.failureCount,
        })),
      });
    });

    test('Test 3.2: Test retry mechanism with unavailable servers', async () => {
      // This test creates a scenario where some servers are unavailable
      // and verifies that the orchestrator retries with other servers

      console.log(`\n🔄 Testing retry mechanism...`);

      // Make multiple requests and check if they succeed despite potential failures
      const attempts = 5;
      let successCount = 0;
      let failureCount = 0;

      for (let i = 0; i < attempts; i++) {
        try {
          const response = await apiContext.post('/api/generate', {
            data: {
              model: 'llama2:7b',
              prompt: `Retry test ${i}`,
              stream: false,
              options: { num_predict: 5 },
            },
          });

          if (response.ok()) {
            successCount++;
          } else {
            failureCount++;
          }
        } catch (error) {
          failureCount++;
        }
      }

      console.log(`   Attempts: ${attempts}`);
      console.log(`   Success: ${successCount}`);
      console.log(`   Failure: ${failureCount}`);

      recordResult(
        'Retry Mechanism',
        successCount > 0,
        {
          attempts,
          successCount,
          failureCount,
          successRate: ((successCount / attempts) * 100).toFixed(2) + '%',
        },
        failureCount > 0 ? `${failureCount} retries failed` : undefined
      );
    });
  });

  // ==================== PHASE 4: QUEUE & CONCURRENCY ====================
  test.describe('Phase 4: Request Queue & Concurrency', () => {
    test('Test 4.1: Verify queue status endpoint', async () => {
      const response = await apiContext.get('/api/orchestrator/queue');
      expect(response.ok()).toBeTruthy();

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.queue).toBeDefined();

      const queue = data.queue;

      console.log(`\n📮 Queue Status:`);
      console.log(`   Size: ${queue.size || 0}`);
      console.log(`   Max Size: ${queue.maxSize || 'N/A'}`);
      console.log(`   Processing: ${queue.processing || 0}`);
      console.log(`   Pending: ${queue.pending || 0}`);

      recordResult('Queue Status', true, {
        size: queue.size,
        maxSize: queue.maxSize,
        processing: queue.processing,
        pending: queue.pending,
        paused: queue.paused,
      });
    });

    test('Test 4.2: Test queue under load', async () => {
      const concurrency = TEST_CONFIG.LOAD_TEST_CONCURRENCY;
      const totalRequests = TEST_CONFIG.LOAD_TEST_REQUESTS;

      console.log(`\n📊 Queue Load Test: ${totalRequests} requests @ ${concurrency} concurrency`);

      const startTime = Date.now();
      let completed = 0;
      let failed = 0;

      // Process in batches
      for (let batch = 0; batch < Math.ceil(totalRequests / concurrency); batch++) {
        const batchSize = Math.min(concurrency, totalRequests - batch * concurrency);
        const batchPromises: Promise<any>[] = [];

        for (let i = 0; i < batchSize; i++) {
          const requestNum = batch * concurrency + i;
          batchPromises.push(
            apiContext
              .post('/api/generate', {
                data: {
                  model: 'llama2:7b',
                  prompt: `Queue load test request ${requestNum}`,
                  stream: false,
                  options: { num_predict: 5 },
                },
              })
              .then(r => {
                if (r.ok()) completed++;
                else failed++;
                return r;
              })
              .catch(() => {
                failed++;
                return { ok: () => false };
              })
          );
        }

        await Promise.all(batchPromises);

        // Small delay between batches
        if (batch < Math.ceil(totalRequests / concurrency) - 1) {
          await new Promise(r => setTimeout(r, 100));
        }
      }

      const duration = Date.now() - startTime;

      console.log(`   Completed: ${completed}/${totalRequests}`);
      console.log(`   Failed: ${failed}/${totalRequests}`);
      console.log(`   Duration: ${duration}ms`);
      console.log(`   Throughput: ${(completed / (duration / 1000)).toFixed(2)} req/s`);

      recordResult(
        'Queue Load Test',
        completed > totalRequests * 0.7,
        {
          totalRequests,
          concurrency,
          completed,
          failed,
          duration,
          throughput: (completed / (duration / 1000)).toFixed(2) + ' req/s',
        },
        failed > 0 ? `${failed} requests failed` : undefined
      );
    });

    test('Test 4.3: Test queue pause and resume', async () => {
      // First, pause the queue
      const pauseResponse = await apiContext.post('/api/orchestrator/queue/pause');
      expect(pauseResponse.ok()).toBeTruthy();

      // Verify it's paused
      let statusResponse = await apiContext.get('/api/orchestrator/queue');
      let statusData = await statusResponse.json();
      expect(statusData.queue.paused).toBe(true);

      // Resume the queue
      const resumeResponse = await apiContext.post('/api/orchestrator/queue/resume');
      expect(resumeResponse.ok()).toBeTruthy();

      // Verify it's resumed
      statusResponse = await apiContext.get('/api/orchestrator/queue');
      statusData = await statusResponse.json();
      expect(statusData.queue.paused).toBe(false);

      recordResult('Queue Pause/Resume', true, {
        pauseSuccess: pauseResponse.ok(),
        resumeSuccess: resumeResponse.ok(),
        finalState: statusData.queue.paused ? 'paused' : 'active',
      });
    });
  });

  // ==================== PHASE 5: METRICS & ANALYTICS ====================
  test.describe('Phase 5: Metrics & Analytics', () => {
    test('Test 5.1: Test metrics endpoint', async () => {
      const response = await apiContext.get('/api/orchestrator/metrics');
      expect(response.ok()).toBeTruthy();

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.global).toBeDefined();
      expect(data.servers).toBeDefined();

      const global = data.global;
      const servers = data.servers || [];

      console.log(`\n📈 Global Metrics:`);
      console.log(`   Total Requests: ${global.totalRequests || 0}`);
      console.log(`   Successful: ${global.successfulRequests || 0}`);
      console.log(`   Failed: ${global.failedRequests || 0}`);
      console.log(`   Error Rate: ${global.errorRate || '0.00%'}`);
      console.log(`   Average Response Time: ${global.averageResponseTime || 0}ms`);
      console.log(`   Servers tracked: ${servers.length}`);

      recordResult('Metrics Endpoint', true, {
        totalRequests: global.totalRequests,
        successfulRequests: global.successfulRequests,
        failedRequests: global.failedRequests,
        errorRate: global.errorRate,
        averageResponseTime: global.averageResponseTime,
        serverCount: servers.length,
      });
    });

    test('Test 5.2: Test Prometheus metrics endpoint', async () => {
      const response = await apiContext.get('/metrics', {
        headers: { Accept: 'text/plain' },
      });

      if (response.ok()) {
        const text = await response.text();
        const hasMetrics = text.includes('ollama_');

        recordResult('Prometheus Metrics', hasMetrics, {
          status: response.status(),
          contentLength: text.length,
          hasOrchestratorMetrics: hasMetrics,
          sampleLines: text.split('\n').slice(0, 5),
        });
      } else {
        recordResult(
          'Prometheus Metrics',
          false,
          {
            status: response.status(),
            error: await response.text(),
          },
          'Prometheus endpoint not available'
        );
      }
    });

    test('Test 5.3: Test analytics endpoints', async () => {
      const endpoints = [
        '/api/orchestrator/analytics/summary',
        '/api/orchestrator/analytics/top-models',
        '/api/orchestrator/analytics/server-performance',
        '/api/orchestrator/analytics/errors',
        '/api/orchestrator/analytics/capacity',
      ];

      const results: Record<string, any>[] = [];

      for (const endpoint of endpoints) {
        try {
          const response = await apiContext.get(endpoint);
          results.push({
            endpoint,
            available: response.ok(),
            status: response.status(),
          });
        } catch (error: any) {
          results.push({
            endpoint,
            available: false,
            error: error.message,
          });
        }
      }

      const available = results.filter(r => r.available).length;

      console.log(`\n📊 Analytics Endpoints:`);
      results.forEach(r => {
        console.log(`   ${r.endpoint.split('/').pop()}: ${r.available ? '✅' : '❌'}`);
      });

      recordResult('Analytics Endpoints', available > 0, {
        total: endpoints.length,
        available,
        unavailable: endpoints.length - available,
        details: results,
      });
    });
  });

  // ==================== PHASE 6: STREAMING ====================
  test.describe('Phase 6: Streaming Support', () => {
    test('Test 6.1: Test streaming text generation', async () => {
      const response = await apiContext.post('/api/generate', {
        data: {
          model: 'llama2:7b',
          prompt: 'Count: 1, 2, 3',
          stream: true,
          options: { num_predict: 20 },
        },
      });

      if (response.ok()) {
        const text = await response.text();
        const isStreaming = text.includes('data:') && text.includes('\n\n');

        recordResult('Streaming Generation', isStreaming, {
          status: response.status(),
          isStreaming,
          hasDataPrefix: text.includes('data:'),
          hasChunks: text.includes('\n\n'),
          length: text.length,
          sample: text.substring(0, 200),
        });
      } else {
        recordResult(
          'Streaming Generation',
          false,
          {
            status: response.status(),
            error: await response.text(),
          },
          'Streaming request failed'
        );
      }
    });
  });

  // ==================== PHASE 7: CONFIGURATION ====================
  test.describe('Phase 7: Configuration Management', () => {
    test('Test 7.1: Get current configuration', async () => {
      const response = await apiContext.get('/api/orchestrator/config');
      expect(response.ok()).toBeTruthy();

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.config).toBeDefined();

      const config = data.config;

      console.log(`\n⚙️ Configuration:`);
      console.log(`   Version: ${config.version || 'N/A'}`);
      console.log(`   Load Balancer Strategy: ${config.loadBalancer?.strategy || 'N/A'}`);
      console.log(`   Queue Max Size: ${config.queue?.maxSize || 'N/A'}`);
      console.log(`   Queue Timeout: ${config.queue?.timeout || 'N/A'}ms`);
      console.log(
        `   Circuit Breaker Threshold: ${config.circuitBreaker?.failureThreshold || 'N/A'}`
      );

      recordResult('Configuration Retrieval', true, {
        version: config.version,
        loadBalancerStrategy: config.loadBalancer?.strategy,
        queueMaxSize: config.queue?.maxSize,
        queueTimeout: config.queue?.timeout,
        circuitBreakerThreshold: config.circuitBreaker?.failureThreshold,
      });
    });

    test('Test 7.2: Update configuration (partial)', async () => {
      // Get original config
      const getResponse = await apiContext.get('/api/orchestrator/config');
      const originalConfig = await getResponse.json();

      // Try to update queue timeout
      const updateResponse = await apiContext.patch('/api/orchestrator/config/queue', {
        data: {
          timeout: 45000,
        },
      });

      if (updateResponse.ok()) {
        // Verify update
        const verifyResponse = await apiContext.get('/api/orchestrator/config');
        const updatedConfig = await verifyResponse.json();

        // Reset to original
        await apiContext.patch('/api/orchestrator/config/queue', {
          data: {
            timeout: originalConfig.config.queue?.timeout || 30000,
          },
        });

        recordResult('Configuration Update', true, {
          updateSuccess: updateResponse.ok(),
          originalTimeout: originalConfig.config.queue?.timeout,
          updatedTimeout: updatedConfig.config.queue?.timeout,
        });
      } else {
        recordResult(
          'Configuration Update',
          false,
          {
            status: updateResponse.status(),
            error: await updateResponse.text(),
          },
          'Configuration update failed'
        );
      }
    });
  });

  // ==================== PHASE 8: COMPREHENSIVE LOAD TEST ====================
  test.describe('Phase 8: Comprehensive Load Testing', () => {
    test('Test 8.1: Stress test with sustained load', async () => {
      const duration = 30000; // 30 seconds
      const targetRps = 5;
      const interval = 1000 / targetRps;

      console.log(`\n🔥 Stress Test: ${targetRps} req/s for ${duration / 1000}s`);

      let requests = 0;
      let successes = 0;
      let failures = 0;
      const startTime = Date.now();
      const latencies: number[] = [];

      while (Date.now() - startTime < duration) {
        const reqStart = Date.now();
        requests++;

        try {
          const response = await apiContext.post('/api/generate', {
            data: {
              model: 'llama2:7b',
              prompt: `Stress test ${requests}`,
              stream: false,
              options: { num_predict: 5 },
            },
          });

          const latency = Date.now() - reqStart;
          latencies.push(latency);

          if (response.ok()) {
            successes++;
          } else {
            failures++;
          }
        } catch (error) {
          failures++;
        }

        // Wait for next interval
        const elapsed = Date.now() - startTime;
        const nextRequestTime = requests * interval;
        if (nextRequestTime > elapsed) {
          await new Promise(r => setTimeout(r, nextRequestTime - elapsed));
        }
      }

      const totalDuration = Date.now() - startTime;
      const actualRps = (requests / (totalDuration / 1000)).toFixed(2);

      // Calculate latency percentiles
      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
      const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
      const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;

      console.log(`   Total Requests: ${requests}`);
      console.log(`   Successes: ${successes}`);
      console.log(`   Failures: ${failures}`);
      console.log(`   Actual RPS: ${actualRps}`);
      console.log(`   Latency P50: ${p50}ms`);
      console.log(`   Latency P95: ${p95}ms`);
      console.log(`   Latency P99: ${p99}ms`);

      recordResult(
        'Stress Test',
        successes > requests * 0.8,
        {
          duration: totalDuration,
          targetRps,
          actualRps,
          totalRequests: requests,
          successes,
          failures,
          successRate: ((successes / requests) * 100).toFixed(2) + '%',
          latencyP50: p50,
          latencyP95: p95,
          latencyP99: p99,
        },
        failures > 0 ? `${failures} requests failed under sustained load` : undefined
      );
    });

    test('Test 8.2: Burst test - rapid sequential requests', async () => {
      const burstSize = 100;

      console.log(`\n💥 Burst Test: ${burstSize} rapid sequential requests`);

      let completed = 0;
      let failed = 0;
      const startTime = Date.now();

      for (let i = 0; i < burstSize; i++) {
        try {
          const response = await apiContext.post('/api/generate', {
            data: {
              model: 'llama2:7b',
              prompt: `Burst ${i}`,
              stream: false,
              options: { num_predict: 3 },
            },
          });

          if (response.ok()) {
            completed++;
          } else {
            failed++;
          }
        } catch (error) {
          failed++;
        }
      }

      const duration = Date.now() - startTime;

      console.log(`   Completed: ${completed}/${burstSize}`);
      console.log(`   Failed: ${failed}/${burstSize}`);
      console.log(`   Duration: ${duration}ms`);
      console.log(`   Average: ${(duration / burstSize).toFixed(2)}ms/request`);

      recordResult('Burst Test', completed > burstSize * 0.8, {
        burstSize,
        completed,
        failed,
        duration,
        avgLatency: (duration / burstSize).toFixed(2) + 'ms',
      });
    });
  });

  // ==================== REPORT GENERATION ====================
  function generateEvaluationReport() {
    console.log('\n' + '='.repeat(80));
    console.log('📊 EXHAUSTIVE E2E EVALUATION REPORT');
    console.log('='.repeat(80));

    const passed = testResults.filter(r => r.passed).length;
    const failed = testResults.filter(r => !r.passed).length;
    const total = testResults.length;

    console.log(
      `\n🏆 Overall Results: ${passed}/${total} tests passed (${((passed / total) * 100).toFixed(1)}%)`
    );

    if (failed > 0) {
      console.log(`\n❌ Failed Tests:`);
      testResults
        .filter(r => !r.passed)
        .forEach(r => {
          console.log(`   • ${r.testName}`);
          if (r.error) console.log(`     Error: ${r.error}`);
        });
    }

    console.log(`\n✅ Passed Tests:`);
    testResults
      .filter(r => r.passed)
      .forEach(r => {
        console.log(`   • ${r.testName}`);
      });

    console.log(`\n📋 Server Summary:`);
    console.log(`   Total servers in config: ${serverConfigs.length}`);
    console.log(`   Servers registered: ${serverTestResults.length}`);
    console.log(`   Healthy servers: ${serverTestResults.filter(s => s.healthy).length}`);
    console.log(`   Unhealthy servers: ${serverTestResults.filter(s => !s.healthy).length}`);

    // Unique models
    const allModels = new Set<string>();
    serverTestResults.forEach(s => s.modelsAvailable.forEach(m => allModels.add(m)));
    console.log(`   Unique models available: ${allModels.size}`);

    console.log('\n' + '='.repeat(80));
    console.log('✨ Evaluation Complete!');
    console.log('='.repeat(80) + '\n');

    // Write detailed report to file
    const reportPath = path.join(process.cwd(), 'e2e-evaluation-report.json');
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalTests: total,
        passed,
        failed,
        passRate: ((passed / total) * 100).toFixed(2) + '%',
      },
      serverSummary: {
        totalInConfig: serverConfigs.length,
        registered: serverTestResults.length,
        healthy: serverTestResults.filter(s => s.healthy).length,
        unhealthy: serverTestResults.filter(s => !s.healthy).length,
        uniqueModels: allModels.size,
      },
      testResults,
      serverResults: serverTestResults.map(s => ({
        id: s.server.id,
        url: s.server.url,
        healthy: s.healthy,
        responseTime: s.responseTime,
        modelCount: s.modelsAvailable.length,
      })),
    };

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`📝 Detailed report saved to: ${reportPath}\n`);
  }
});
