/**
 * Diverse Mock Ollama Server Types for Realistic Testing
 *
 * This module provides various mock server behaviors to simulate real-world
 * deployment scenarios including failures, degradation, and edge cases.
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import {
  realApiTagsResponse,
  realApiGenerateResponse,
  realApiChatResponse,
  realApiEmbeddingsResponse,
  realApiVersionResponse,
  realApiPsResponse,
  realErrorResponses,
} from '../fixtures/real-responses.js';

// Track all created servers for cleanup
const mockServers: Server[] = [];

export type MockServerType =
  | 'healthy'
  | 'unhealthy'
  | 'slow'
  | 'flaky'
  | 'degraded'
  | 'rate-limited'
  | 'oom-prone'
  | 'warmup'
  | 'intermittent'
  | 'partial-failure';

export interface MockServerConfig {
  port: number;
  type: MockServerType;
  models?: string[];
  latency?: number;
  failureRate?: number;
  requestLimit?: number;
  warmupTime?: number;
  partialFailureEndpoint?: string;
}

interface ServerState {
  requestCount: number;
  healthy: boolean;
  startTime: number;
  failurePattern: number[];
}

/**
 * Create a mock Ollama server with diverse behaviors
 */
export function createDiverseMockServer(config: MockServerConfig): Promise<Server> {
  const {
    port,
    type,
    models = ['smollm2:135m', 'llama3.2:latest'],
    latency = 0,
    failureRate = 0,
    requestLimit = 100,
    warmupTime = 5000,
    partialFailureEndpoint = '/api/generate',
  } = config;

  const state: ServerState = {
    requestCount: 0,
    healthy: true,
    startTime: Date.now(),
    failurePattern: generateFailurePattern(type, failureRate),
  };

  return new Promise(resolve => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      state.requestCount++;

      // Apply server-type specific behavior
      const behavior = getServerBehavior(type, state, {
        latency,
        failureRate,
        requestLimit,
        warmupTime,
        partialFailureEndpoint,
      });

      // Check if this request should fail
      if (shouldFailRequest(type, state, behavior, req.url || '')) {
        handleFailure(res, type, state.requestCount);
        return;
      }

      // Apply latency
      setTimeout(() => {
        handleSuccess(res, req, models, type);
      }, behavior.latency);
    });

    server.listen(port, () => {
      mockServers.push(server);
      resolve(server);
    });

    server.on('error', err => {
      console.error(`Mock server error on port ${port}:`, err);
    });
  });
}

/**
 * Generate a failure pattern based on server type
 */
function generateFailurePattern(type: MockServerType, baseRate: number): number[] {
  switch (type) {
    case 'flaky':
      // Alternating pattern: fail every other request
      return Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? 0 : 1));
    case 'intermittent':
      // Bursty failures: 5 successes, then 3 failures
      return Array.from({ length: 100 }, (_, i) => {
        const cycle = i % 8;
        return cycle < 5 ? 0 : 1;
      });
    case 'degraded':
      // Gradually increasing failure rate
      return Array.from({ length: 100 }, (_, i) => {
        const rate = Math.min(0.5, (i / 100) * 0.5);
        return Math.random() < rate ? 1 : 0;
      });
    default:
      // Random failures at base rate
      return Array.from({ length: 100 }, () => (Math.random() < baseRate ? 1 : 0));
  }
}

/**
 * Get behavior parameters for a specific server type
 */
function getServerBehavior(
  type: MockServerType,
  state: ServerState,
  config: {
    latency: number;
    failureRate: number;
    requestLimit: number;
    warmupTime: number;
    partialFailureEndpoint: string;
  }
): { latency: number; shouldFail: boolean } {
  const uptime = Date.now() - state.startTime;

  switch (type) {
    case 'healthy':
      return { latency: config.latency || 50, shouldFail: false };

    case 'unhealthy':
      return { latency: 100, shouldFail: true };

    case 'slow':
      // Variable latency: 500ms-3000ms
      return {
        latency: config.latency || 500 + Math.random() * 2500,
        shouldFail: false,
      };

    case 'flaky':
      // Alternating success/failure
      return {
        latency: config.latency || 100,
        shouldFail: state.failurePattern[state.requestCount % 100] === 1,
      };

    case 'degraded':
      // Slow and increasingly unreliable
      const degradation = Math.min(0.8, state.requestCount / 50);
      return {
        latency: config.latency || 1000 + Math.random() * 1000,
        shouldFail: Math.random() < degradation,
      };

    case 'rate-limited':
      // Fail after request limit
      return {
        latency: config.latency || 100,
        shouldFail: state.requestCount > config.requestLimit,
      };

    case 'oom-prone':
      // Fail on large prompts (simulated by checking request size)
      return {
        latency: config.latency || 200,
        shouldFail: false, // Actual check happens in request handling
      };

    case 'warmup':
      // Start slow, improve over time
      const warmupFactor = Math.min(1, uptime / config.warmupTime);
      return {
        latency: config.latency || 3000 * (1 - warmupFactor) + 100,
        shouldFail: false,
      };

    case 'intermittent':
      // Bursty failures
      return {
        latency: config.latency || 150,
        shouldFail: state.failurePattern[state.requestCount % 100] === 1,
      };

    case 'partial-failure':
      // Only specific endpoints fail
      return {
        latency: config.latency || 100,
        shouldFail: false, // Checked per-endpoint
      };

    default:
      return { latency: config.latency || 100, shouldFail: false };
  }
}

/**
 * Determine if a request should fail based on server state
 */
function shouldFailRequest(
  type: MockServerType,
  state: ServerState,
  behavior: { latency: number; shouldFail: boolean },
  url: string
): boolean {
  if (type === 'unhealthy') {
    return true;
  }

  if (type === 'partial-failure' && url === '/api/generate') {
    return true;
  }

  if (type === 'rate-limited' && state.requestCount > 100) {
    return true;
  }

  return behavior.shouldFail;
}

/**
 * Handle failure response based on server type
 */
function handleFailure(res: ServerResponse, type: MockServerType, requestCount: number): void {
  let statusCode = 500;
  let errorBody: object;

  switch (type) {
    case 'unhealthy':
      statusCode = 503;
      errorBody = { error: 'Service Unavailable' };
      break;

    case 'rate-limited':
      statusCode = 429;
      errorBody = { error: 'Rate limit exceeded', retry_after: 60 };
      break;

    case 'oom-prone':
      statusCode = 500;
      errorBody = realErrorResponses.oomError;
      break;

    case 'degraded':
    case 'flaky':
    case 'intermittent':
      // Randomly choose between different error types
      const errors = [
        { status: 500, body: realErrorResponses.runnerTerminated },
        { status: 503, body: { error: 'Server temporarily unavailable' } },
        { status: 504, body: { error: 'Gateway timeout' } },
      ];
      const chosen = errors[Math.floor(Math.random() * errors.length)];
      statusCode = chosen.status;
      errorBody = chosen.body;
      break;

    default:
      statusCode = 500;
      errorBody = { error: 'Internal Server Error' };
  }

  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(errorBody));
}

/**
 * Handle successful response
 */
function handleSuccess(
  res: ServerResponse,
  req: IncomingMessage,
  models: string[],
  type: MockServerType
): void {
  res.setHeader('Content-Type', 'application/json');

  const url = req.url || '';

  switch (url) {
    case '/api/tags':
      // Filter models based on server type (some servers have limited models)
      const filteredModels =
        type === 'oom-prone'
          ? realApiTagsResponse.models.filter(m => {
              const size = m.details.parameter_size || '';
              return (!size.includes('70B') && !size.includes('B')) || parseFloat(size) < 15;
            })
          : realApiTagsResponse.models;
      res.writeHead(200);
      res.end(JSON.stringify({ models: filteredModels.slice(0, models.length) }));
      break;

    case '/api/generate':
      res.writeHead(200);
      res.end(JSON.stringify(realApiGenerateResponse));
      break;

    case '/api/chat':
      res.writeHead(200);
      res.end(JSON.stringify(realApiChatResponse));
      break;

    case '/api/embeddings':
      res.writeHead(200);
      // Return truncated embedding for performance
      res.end(
        JSON.stringify({
          embedding: realApiEmbeddingsResponse.embedding.slice(0, 10),
        })
      );
      break;

    case '/api/ps':
      res.writeHead(200);
      res.end(JSON.stringify(realApiPsResponse));
      break;

    case '/api/version':
      res.writeHead(200);
      res.end(JSON.stringify(realApiVersionResponse));
      break;

    case '/api/pull':
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'success' }));
      break;

    case '/api/delete':
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'success' }));
      break;

    case '/api/copy':
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'success' }));
      break;

    case '/api/create':
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'success' }));
      break;

    default:
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not Found' }));
  }
}

/**
 * Create a "chaos" server that randomly switches behaviors
 * Useful for testing circuit breakers and resilience
 */
export function createChaosServer(port: number): Promise<Server> {
  let currentBehavior: MockServerType = 'healthy';
  let lastBehaviorChange = Date.now();

  return createDiverseMockServer({
    port,
    type: currentBehavior,
    models: ['smollm2:135m', 'llama3.2:latest', 'mistral:latest'],
    latency: 100,
  }).then(server => {
    // Randomly switch behaviors every 10-30 seconds
    const behaviorInterval = setInterval(
      () => {
        const behaviors: MockServerType[] = [
          'healthy',
          'slow',
          'flaky',
          'degraded',
          'rate-limited',
        ];
        currentBehavior = behaviors[Math.floor(Math.random() * behaviors.length)];
        lastBehaviorChange = Date.now();
        console.log(`Chaos server on port ${port} switched to: ${currentBehavior}`);
      },
      10000 + Math.random() * 20000
    );

    // Store interval for cleanup
    (server as any).behaviorInterval = behaviorInterval;

    return server;
  });
}

/**
 * Create multiple mock servers with different characteristics
 * Returns a map of server characteristics for testing
 */
export async function createMockServerFleet(
  basePort: number = 11440,
  count: number = 5
): Promise<Array<{ server: Server; type: MockServerType; port: number }>> {
  const types: MockServerType[] = [
    'healthy',
    'slow',
    'flaky',
    'degraded',
    'rate-limited',
    'oom-prone',
    'warmup',
    'intermittent',
  ];

  const servers: Array<{ server: Server; type: MockServerType; port: number }> = [];

  for (let i = 0; i < count; i++) {
    const type = types[i % types.length];
    const port = basePort + i;
    const server = await createDiverseMockServer({
      port,
      type,
      models: getModelsForType(type),
    });
    servers.push({ server, type, port });
  }

  return servers;
}

/**
 * Get appropriate models for each server type
 */
function getModelsForType(type: MockServerType): string[] {
  switch (type) {
    case 'oom-prone':
      // Small models only
      return ['smollm2:135m', 'nomic-embed-text:latest'];
    case 'healthy':
    case 'slow':
      // Full range
      return ['smollm2:135m', 'llama3.2:latest', 'mistral:latest', 'gemma3:4b'];
    case 'rate-limited':
      // CPU-efficient models
      return ['smollm2:135m', 'llama3.2:latest'];
    default:
      return ['smollm2:135m', 'llama3.2:latest'];
  }
}

/**
 * Stop all mock servers and cleanup
 */
export async function cleanupMockServers(): Promise<void> {
  const closePromises = mockServers.map(
    server =>
      new Promise<void>(resolve => {
        if ((server as any).behaviorInterval) {
          clearInterval((server as any).behaviorInterval);
        }
        if ((server as any).availabilityInterval) {
          clearInterval((server as any).availabilityInterval);
        }
        server.close(() => resolve());
      })
  );
  await Promise.all(closePromises);
  mockServers.length = 0;
  await new Promise(resolve => setTimeout(resolve, 50));
}

/**
 * Wait for a server to be ready with retries
 */
export async function waitForServer(
  url: string,
  timeout = 5000,
  expectedStatus = 200
): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(`${url}/api/tags`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.status === expectedStatus) {
        return true;
      }
    } catch {
      // Keep trying
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}

/**
 * Create a server factory for testing scenarios
 */
export const mockServerFactory = {
  healthy: (port: number) => createDiverseMockServer({ port, type: 'healthy', latency: 50 }),
  slow: (port: number) => createDiverseMockServer({ port, type: 'slow', latency: 2000 }),
  flaky: (port: number) => createDiverseMockServer({ port, type: 'flaky', failureRate: 0.5 }),
  degraded: (port: number) => createDiverseMockServer({ port, type: 'degraded' }),
  rateLimited: (port: number, limit?: number) =>
    createDiverseMockServer({ port, type: 'rate-limited', requestLimit: limit || 10 }),
  oomProne: (port: number) => createDiverseMockServer({ port, type: 'oom-prone' }),
  warmup: (port: number, warmupMs?: number) =>
    createDiverseMockServer({ port, type: 'warmup', warmupTime: warmupMs || 5000 }),
  intermittent: (port: number) => createDiverseMockServer({ port, type: 'intermittent' }),
  partialFailure: (port: number, endpoint?: string) =>
    createDiverseMockServer({
      port,
      type: 'partial-failure',
      partialFailureEndpoint: endpoint || '/api/generate',
    }),
  chaos: (port: number) => createChaosServer(port),
  fleet: (basePort: number, count: number) => createMockServerFleet(basePort, count),
};
