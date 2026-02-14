/**
 * Integration test setup
 * Starts the server and provides utilities for testing API endpoints
 */

import { createServer } from 'http';
import { AddressInfo } from 'net';
import express from 'express';
import { getPrometheusMetrics } from '../../src/controllers/metricsController.js';
import { AIOrchestrator } from '../../src/orchestrator.js';
import router from '../../src/routes/orchestrator.js';

// Test server instance
let server: ReturnType<typeof createServer>;
let baseUrl: string;

/**
 * Setup integration test environment
 */
export async function setupIntegrationTest() {
  // Create orchestrator instance
  const orchestrator = new AIOrchestrator(undefined, undefined, undefined, {
    enabled: false,
    intervalMs: 30000,
    timeoutMs: 5000,
    maxConcurrentChecks: 10,
    retryAttempts: 2,
    retryDelayMs: 1000,
    recoveryIntervalMs: 60000,
    failureThreshold: 3,
    successThreshold: 2,
    backoffMultiplier: 1.5,
  });

  // Create Express app
  const app = express();
  app.use(express.json());
  app.use('/api/orchestrator', router);

  // Add Prometheus metrics endpoint
  app.get('/metrics', getPrometheusMetrics);

  // Add error handling middleware
  app.use((err: any, req: any, res: any, next: any) => {
    console.error('Integration test error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  // Start server
  server = createServer(app);
  await new Promise<void>(resolve => {
    server.listen(0, 'localhost', () => resolve());
  });

  const address = server.address() as AddressInfo;
  baseUrl = `http://localhost:${address.port}`;

  return { orchestrator, baseUrl };
}

/**
 * Teardown integration test environment
 */
export async function teardownIntegrationTest() {
  if (server) {
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
  }
}

/**
 * Helper to make HTTP requests in tests
 */
export async function makeRequest(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: any
): Promise<{ status: number; data: any }> {
  const url = `${baseUrl}${path}`;

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data;
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    try {
      data = await response.text();
    } catch {
      data = null;
    }
  }

  return {
    status: response.status,
    data,
  };
}
