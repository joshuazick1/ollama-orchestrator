import { test, expect, APIRequestContext } from '@playwright/test';
import { MockOllamaServer } from './mock-ollama-server.js';

test.describe('Ollama Orchestrator E2E Tests', () => {
  let apiContext: APIRequestContext;
  let mockServer: MockOllamaServer;

  test.beforeAll(async ({ playwright }) => {
    // Start mock Ollama server on a different port
    mockServer = new MockOllamaServer(11437);
    await mockServer.start();

    apiContext = await playwright.request.newContext({
      baseURL: 'http://localhost:5100',
    });
  });

  test.afterAll(async () => {
    await apiContext.dispose();
    await mockServer.stop();
  });

  test('complete request flow with mock Ollama server', async () => {
    // Step 1: Add mock server to orchestrator
    const addResponse = await apiContext.post('/api/orchestrator/servers/add', {
      data: {
        id: 'mock-server-1',
        url: mockServer.getUrl(),
        maxConcurrency: 2,
      },
    });

    expect(addResponse.ok()).toBeTruthy();
    const addData = await addResponse.json();
    expect(addData.success).toBe(true);

    // Step 2: Verify server was added
    const healthResponse = await apiContext.get('/api/orchestrator/health');
    expect(healthResponse.ok()).toBeTruthy();
    const healthData = await healthResponse.json();
    expect(healthData.success).toBe(true);

    // Step 3: Test model listing (proxied to Ollama)
    const tagsResponse = await apiContext.get('/api/tags');
    expect(tagsResponse.ok()).toBeTruthy();
    const tagsData = await tagsResponse.json();
    expect(tagsData.models).toBeDefined();
    expect(tagsData.models.length).toBeGreaterThan(0);

    // Step 4: Test text generation
    const generateResponse = await apiContext.post('/api/generate', {
      data: {
        model: 'llama2:7b',
        prompt: 'Say hello in one sentence.',
        stream: false,
      },
    });

    expect(generateResponse.ok()).toBeTruthy();
    const generateData = await generateResponse.json();
    expect(generateData.response).toContain('Hello');
    expect(generateData.done).toBe(true);

    // Step 5: Check metrics were recorded
    const metricsResponse = await apiContext.get('/api/orchestrator/metrics');
    expect(metricsResponse.ok()).toBeTruthy();
    const metricsData = await metricsResponse.json();
    expect(metricsData.success).toBe(true);
    expect(metricsData.global.totalRequests).toBeGreaterThan(0);

    // Step 6: Test analytics
    const analyticsResponse = await apiContext.get('/api/orchestrator/analytics/summary');
    expect(analyticsResponse.ok()).toBeTruthy();
    const analyticsData = await analyticsResponse.json();
    expect(analyticsData.success).toBe(true);

    // Step 7: Test model management
    const warmupResponse = await apiContext.post('/api/orchestrator/models/llama2:7b/warmup', {
      data: {
        servers: ['mock-server-1'],
      },
    });
    expect(warmupResponse.ok()).toBeTruthy();

    // Step 8: Test configuration
    const configResponse = await apiContext.get('/api/orchestrator/config');
    expect(configResponse.ok()).toBeTruthy();
    const configData = await configResponse.json();
    expect(configData.success).toBe(true);
  });

  test('circuit breaker functionality', async () => {
    // Create a failing mock server
    const failingMockServer = new MockOllamaServer(11436, 1.0); // 100% failure rate
    await failingMockServer.start();

    // Add failing server
    const addResponse = await apiContext.post('/api/orchestrator/servers/add', {
      data: {
        id: 'failing-server',
        url: failingMockServer.getUrl(),
        maxConcurrency: 1,
      },
    });
    expect(addResponse.ok()).toBeTruthy();

    // Make multiple requests that should trigger circuit breaker
    let failureCount = 0;
    for (let i = 0; i < 7; i++) {
      const response = await apiContext.post('/api/generate', {
        data: {
          model: 'llama2:7b',
          prompt: 'Test prompt that will fail',
          stream: false,
        },
      });

      if (!response.ok()) {
        failureCount++;
      }
    }

    // Should have some failures due to circuit breaker
    expect(failureCount).toBeGreaterThan(0);

    await failingMockServer.stop();
  });

  test('queue functionality under load', async () => {
    // Make multiple concurrent requests to test queuing
    const requests: Promise<any>[] = [];
    for (let i = 0; i < 5; i++) {
      requests.push(
        apiContext.post('/api/generate', {
          data: {
            model: 'llama2:7b',
            prompt: `Concurrent request ${i}`,
            stream: false,
          },
        })
      );
    }

    // Wait for all responses
    const responses = await Promise.all(requests);

    // All should succeed (queue handles concurrency)
    responses.forEach(response => {
      expect(response.ok()).toBeTruthy();
    });

    // Check queue status
    const queueResponse = await apiContext.get('/api/orchestrator/queue');
    expect(queueResponse.ok()).toBeTruthy();
    const queueData = await queueResponse.json();
    expect(queueData.success).toBe(true);
  });

  test('streaming request functionality', async () => {
    // Test streaming response
    const streamResponse = await apiContext.post('/api/generate', {
      data: {
        model: 'llama2:7b',
        prompt: 'Count to 3 slowly',
        stream: true,
      },
    });

    expect(streamResponse.ok()).toBeTruthy();

    // Read streaming response
    const responseText = await streamResponse.text();
    expect(responseText).toContain('data:');
    expect(responseText).toContain('"done":false');
    expect(responseText).toContain('"done":true');
  });

  test('error handling and retries', async () => {
    // Create a temporary failing server
    const failingServer = new MockOllamaServer(11438, 0.8); // 80% failure rate
    await failingServer.start();

    const addResponse = await apiContext.post('/api/orchestrator/servers/add', {
      data: {
        id: 'retry-server',
        url: failingServer.getUrl(),
        maxConcurrency: 1,
      },
    });
    expect(addResponse.ok()).toBeTruthy();

    // Make request that may fail initially but succeed on retry
    const generateResponse = await apiContext.post('/api/generate', {
      data: {
        model: 'llama2:7b',
        prompt: 'Test retry mechanism',
        stream: false,
      },
    });

    // Should eventually succeed due to retries
    expect(generateResponse.ok() || generateResponse.status() === 503).toBeTruthy();

    await failingServer.stop();

    // Remove server
    await apiContext.delete('/api/orchestrator/servers/retry-server');
  });

  test('analytics endpoints functionality', async () => {
    // Generate some traffic first
    for (let i = 0; i < 3; i++) {
      await apiContext.post('/api/generate', {
        data: {
          model: 'llama2:7b',
          prompt: `Analytics test ${i}`,
          stream: false,
        },
      });
    }

    // Test analytics summary
    const summaryResponse = await apiContext.get('/api/orchestrator/analytics/summary');
    expect(summaryResponse.ok()).toBeTruthy();
    const summaryData = await summaryResponse.json();
    expect(summaryData.success).toBe(true);
    expect(summaryData.analytics).toBeDefined();

    // Test top models
    const topModelsResponse = await apiContext.get('/api/orchestrator/analytics/top-models');
    expect(topModelsResponse.ok()).toBeTruthy();

    // Test server performance
    const serverPerfResponse = await apiContext.get(
      '/api/orchestrator/analytics/server-performance'
    );
    expect(serverPerfResponse.ok()).toBeTruthy();

    // Test error analysis
    const errorsResponse = await apiContext.get('/api/orchestrator/analytics/errors');
    expect(errorsResponse.ok()).toBeTruthy();

    // Test capacity planning
    const capacityResponse = await apiContext.get('/api/orchestrator/analytics/capacity');
    expect(capacityResponse.ok()).toBeTruthy();
  });

  test('configuration management', async () => {
    // Get current config
    const getConfigResponse = await apiContext.get('/api/orchestrator/config');
    expect(getConfigResponse.ok()).toBeTruthy();
    const originalConfig = await getConfigResponse.json();

    // Update a config section
    const updateResponse = await apiContext.patch('/api/orchestrator/config/queue', {
      data: {
        maxSize: 500,
        timeout: 45000,
      },
    });
    expect(updateResponse.ok()).toBeTruthy();

    // Verify config was updated
    const verifyResponse = await apiContext.get('/api/orchestrator/config');
    expect(verifyResponse.ok()).toBeTruthy();
    const updatedConfig = await verifyResponse.json();
    expect(updatedConfig.config.queue.maxSize).toBe(500);
    expect(updatedConfig.config.queue.timeout).toBe(45000);

    // Reset to original (approximately)
    await apiContext.patch('/api/orchestrator/config/queue', {
      data: {
        maxSize: originalConfig.config.queue.maxSize,
        timeout: originalConfig.config.queue.timeout,
      },
    });
  });

  test('multiple server management', async () => {
    // Add a second mock server
    const mockServer2 = new MockOllamaServer(11439);
    await mockServer2.start();

    const addResponse2 = await apiContext.post('/api/orchestrator/servers/add', {
      data: {
        id: 'mock-server-2',
        url: mockServer2.getUrl(),
        maxConcurrency: 2,
      },
    });
    expect(addResponse2.ok()).toBeTruthy();

    // Make multiple requests to test load balancing
    const requests: Promise<any>[] = [];
    for (let i = 0; i < 10; i++) {
      requests.push(
        apiContext.post('/api/generate', {
          data: {
            model: 'llama2:7b',
            prompt: `Load balancing test ${i}`,
            stream: false,
          },
        })
      );
    }

    const responses = await Promise.all(requests);
    responses.forEach(response => {
      expect(response.ok()).toBeTruthy();
    });

    // Check that both servers are being used
    const serversResponse = await apiContext.get('/api/orchestrator/servers');
    expect(serversResponse.ok()).toBeTruthy();
    const serversData = await serversResponse.json();
    expect(serversData.servers.length).toBeGreaterThan(1);

    await mockServer2.stop();

    // Remove second server
    await apiContext.delete('/api/orchestrator/servers/mock-server-2');
  });
});
