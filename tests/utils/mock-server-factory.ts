/**
 * Diverse Mock Ollama Server Types for Realistic Testing
 *
 * This module provides various mock server behaviors to simulate real-world
 * deployment scenarios including failures, degradation, and edge cases.
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http';

import { logger } from '../../src/utils/logger.js';
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
  | 'partial-failure'
  | 'partition'
  | 'oom'
  | 'disk-full'
  | 'clock-skew';

export interface MockServerConfig {
  port: number;
  type: MockServerType;
  models?: string[];
  latency?: number;
  failureRate?: number;
  requestLimit?: number;
  warmupTime?: number;
  partialFailureEndpoint?: string;
  // New type-specific options
  partitionAfterRequests?: number;
  oomAfterRequests?: number;
  diskFullAfterRequests?: number;
  clockSkewMs?: number;
  degradeAfterRequests?: number;
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
    partitionAfterRequests = 5,
    oomAfterRequests = 10,
    diskFullAfterRequests = 10,
  } = config;

  const state: ServerState = {
    requestCount: 0,
    healthy: true,
    startTime: Date.now(),
    failurePattern: generateFailurePattern(type, failureRate),
  };

  return new Promise((resolve, reject) => {
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
      if (
        shouldFailRequest(type, state, behavior, req.url || '', {
          partitionAfterRequests,
          oomAfterRequests,
          diskFullAfterRequests,
        })
      ) {
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
      logger.error(`Mock server error on port ${port}`, { error: err });
      reject(err);
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
      return {
        latency: config.latency || 100,
        shouldFail: false,
      };

    case 'partition':
      return {
        latency: config.latency || 50,
        shouldFail: false,
      };

    case 'oom':
      return {
        latency: config.latency || 200,
        shouldFail: false,
      };

    case 'disk-full':
      return {
        latency: config.latency || 100,
        shouldFail: false,
      };

    case 'clock-skew':
      return {
        latency: config.latency || 50,
        shouldFail: false,
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
  url: string,
  config: {
    partitionAfterRequests?: number;
    oomAfterRequests?: number;
    diskFullAfterRequests?: number;
  }
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

  if (
    type === 'partition' &&
    config.partitionAfterRequests &&
    state.requestCount >= config.partitionAfterRequests
  ) {
    return true;
  }

  if (type === 'oom' && config.oomAfterRequests && state.requestCount >= config.oomAfterRequests) {
    return true;
  }

  if (
    type === 'disk-full' &&
    config.diskFullAfterRequests &&
    state.requestCount >= config.diskFullAfterRequests
  ) {
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
      const errors = [
        { status: 500, body: realErrorResponses.runnerTerminated },
        { status: 503, body: { error: 'Server temporarily unavailable' } },
        { status: 504, body: { error: 'Gateway timeout' } },
      ];
      const chosen = errors[Math.floor(Math.random() * errors.length)];
      statusCode = chosen.status;
      errorBody = chosen.body;
      break;

    case 'partition':
      statusCode = 503;
      errorBody = { error: 'Connection refused - network partition detected' };
      break;

    case 'oom':
      statusCode = 500;
      errorBody = { error: 'out of memory', model: 'unknown', message: 'allocation failed' };
      break;

    case 'disk-full':
      statusCode = 500;
      errorBody = { error: 'no space left on device', message: 'disk full' };
      break;

    case 'clock-skew':
      statusCode = 500;
      errorBody = { error: 'request timeout', message: 'clock skew detected' };
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

  if (type === 'clock-skew') {
    const wrongTime = new Date(Date.now() - 86400000).toUTCString();
    res.setHeader('Date', wrongTime);
    res.setHeader('X-Response-Time', `${Math.floor(Math.random() * 100)}`);
  }

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
        logger.info('Chaos server switched', { port, behavior: currentBehavior });
      },
      10000 + Math.random() * 20000
    );

    // Store interval for cleanup
    (server as any).behaviorInterval = behaviorInterval;

    return server;
  });
}

/**
 * Create a degrading server that starts healthy and becomes degraded over time/requests
 */
export function createDegradingServer(
  port: number,
  options?: {
    healthyForRequests?: number;
    degradeAfterRequests?: number;
  }
): Promise<Server> {
  const healthyForRequests = options?.healthyForRequests || 5;
  const degradeAfterRequests = options?.degradeAfterRequests || 10;

  const requestCount = 0;
  let isDegrading = false;

  return createDiverseMockServer({
    port,
    type: 'healthy',
    latency: 50,
  }).then(server => {
    const checkInterval = setInterval(() => {
      if (!isDegrading && requestCount >= healthyForRequests) {
        isDegrading = true;
        logger.info('Degrading server starting degradation phase', { port });
      }
    }, 1000);

    (server as any).degrading = true;
    (server as any).getRequestCount = () => requestCount;
    (server as any).isDegrading = () => isDegrading;

    const originalHandler = (server as any)._requestHandler;
    return server;
  });
}

/**
 * Behavioral verification method to check server is behaving as expected
 */
export function verifyBehavior(
  server: Server,
  expectedType: MockServerType
): { isValid: boolean; message: string; details?: Record<string, unknown> } {
  const serverAny = server as any;

  switch (expectedType) {
    case 'healthy':
      return { isValid: true, message: 'Healthy server responds correctly' };

    case 'partition':
      if (serverAny.partitionFailures !== undefined) {
        return {
          isValid: serverAny.partitionFailures >= 1,
          message:
            serverAny.partitionFailures >= 1
              ? `Partition server has failed ${serverAny.partitionFailures} requests`
              : 'Partition server has not yet triggered',
          details: { partitionFailures: serverAny.partitionFailures },
        };
      }
      return { isValid: true, message: 'Partition server initialized' };

    case 'oom':
      if (serverAny.oomFailures !== undefined) {
        return {
          isValid: serverAny.oomFailures >= 1,
          message:
            serverAny.oomFailures >= 1
              ? `OOM server has failed ${serverAny.oomFailures} requests with memory errors`
              : 'OOM server has not yet triggered',
          details: { oomFailures: serverAny.oomFailures },
        };
      }
      return { isValid: true, message: 'OOM server initialized' };

    case 'disk-full':
      if (serverAny.diskFullFailures !== undefined) {
        return {
          isValid: serverAny.diskFullFailures >= 1,
          message:
            serverAny.diskFullFailures >= 1
              ? `Disk-full server has failed ${serverAny.diskFullFailures} requests`
              : 'Disk-full server has not yet triggered',
          details: { diskFullFailures: serverAny.diskFullFailures },
        };
      }
      return { isValid: true, message: 'Disk-full server initialized' };

    case 'clock-skew':
      if (serverAny.clockSkewResponses !== undefined) {
        return {
          isValid: serverAny.clockSkewResponses >= 1,
          message: 'Clock skew server responds with wrong timestamps',
          details: { clockSkewResponses: serverAny.clockSkewResponses },
        };
      }
      return { isValid: true, message: 'Clock skew server initialized' };

    case 'degraded':
      if (serverAny.isDegrading && typeof serverAny.isDegrading === 'function') {
        const isDegrading = serverAny.isDegrading();
        const requestCount = serverAny.getRequestCount ? serverAny.getRequestCount() : 0;
        return {
          isValid: isDegrading || requestCount < 5,
          message: isDegrading
            ? 'Degrading server is in degradation phase'
            : `Degrading server is still healthy (${requestCount} requests)`,
          details: { isDegrading, requestCount },
        };
      }
      return { isValid: true, message: 'Degrading server initialized' };

    default:
      return { isValid: true, message: `${expectedType} server behavior verified` };
  }
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
 * Create a mock server where all inference endpoints return 404 model not found.
 * Admin/listing endpoints return success.
 */
export function modelNotFound(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url || '';

      // Inference endpoints return 404 with model not found error
      const inferenceEndpoints = [
        '/api/generate',
        '/api/chat',
        '/api/embeddings',
        '/api/ps',
        '/api/version',
        '/api/pull',
        '/api/delete',
      ];

      const isInference = inferenceEndpoints.some(ep => url.startsWith(ep));

      if (isInference) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error:
              "model '__neg_probe_definitely_not_a_model_xyz_12345__' not found, try pulling it first",
          })
        );
        return;
      }

      // Admin/listing endpoints return success
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success' }));
    });

    server.listen(port, () => {
      mockServers.push(server);
      resolve(server);
    });

    server.on('error', err => {
      logger.error(`Mock server error on port ${port}`, { error: err });
      reject(err);
    });
  });
}

/**
 * Create a mock server where all inference endpoints return 404 HTML (not supported).
 * Tests /v1/messages on Ollama which doesn't support Anthropic format.
 * Admin/listing endpoints return success.
 */
export function notSupported(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url || '';

      // Inference endpoints return 404 HTML
      const inferenceEndpoints = [
        '/api/generate',
        '/api/chat',
        '/api/embeddings',
        '/api/ps',
        '/api/version',
        '/api/pull',
        '/api/delete',
      ];

      const isInference = inferenceEndpoints.some(ep => url.startsWith(ep));

      if (isInference) {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('404 page not found');
        return;
      }

      // Admin/listing endpoints return success
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success' }));
    });

    server.listen(port, () => {
      mockServers.push(server);
      resolve(server);
    });

    server.on('error', err => {
      logger.error(`Mock server error on port ${port}`, { error: err });
      reject(err);
    });
  });
}

/**
 * Create a mock server where all inference endpoints return 429 rate limited.
 * Admin/listing endpoints return success.
 */
export function rateLimitedOnInvalid(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url || '';

      // Inference endpoints return 429 rate limited
      const inferenceEndpoints = [
        '/api/generate',
        '/api/chat',
        '/api/embeddings',
        '/api/ps',
        '/api/version',
        '/api/pull',
        '/api/delete',
      ];

      const isInference = inferenceEndpoints.some(ep => url.startsWith(ep));

      if (isInference) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '5' });
        res.end(JSON.stringify({ error: 'rate limit exceeded' }));
        return;
      }

      // Admin/listing endpoints return success
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success' }));
    });

    server.listen(port, () => {
      mockServers.push(server);
      resolve(server);
    });

    server.on('error', err => {
      logger.error(`Mock server error on port ${port}`, { error: err });
      reject(err);
    });
  });
}

/**
 * Create a mock server where ALL endpoints (11 total) return 404 HTML.
 * Tests the "every endpoint is broken" scenario.
 */
export function html404(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('404 page not found');
    });

    server.listen(port, () => {
      mockServers.push(server);
      resolve(server);
    });

    server.on('error', err => {
      logger.error(`Mock server error on port ${port}`, { error: err });
      reject(err);
    });
  });
}

/**
 * Create a mock server that only lists models via Ollama API.
 * /api/tags returns 200 with 3 models; /v1/models returns 404.
 * Admin endpoints return success.
 */
export function modelListingOllama(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url || '';

      if (url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            models: [
              { name: 'llama3:8b', model: 'llama3:8b', size: 4660676344, digest: 'abc123' },
              { name: 'mistral:7b', model: 'mistral:7b', size: 4109746344, digest: 'def456' },
              { name: 'qwen2:1.5b', model: 'qwen2:1.5b', size: 980000000, digest: 'ghi789' },
            ],
          })
        );
        return;
      }

      if (url === '/v1/models') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
        return;
      }

      if (url === '/api/ps' || url === '/api/version') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success' }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    });

    server.listen(port, () => {
      mockServers.push(server);
      resolve(server);
    });

    server.on('error', err => {
      logger.error(`Mock server error on port ${port}`, { error: err });
      reject(err);
    });
  });
}

/**
 * Create a mock server that only lists models via OpenAI API.
 * /v1/models returns 200 with 3 models; /api/tags returns 404.
 */
export function modelListingOpenAI(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url || '';

      if (url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            object: 'list',
            data: [
              { id: 'gpt-4', object: 'model', created: 1687882411, owned_by: 'openai' },
              { id: 'gpt-3.5-turbo', object: 'model', created: 1677610602, owned_by: 'openai' },
              { id: 'claude-3-opus', object: 'model', created: 1709596745, owned_by: 'anthropic' },
            ],
          })
        );
        return;
      }

      if (url === '/api/tags') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    });

    server.listen(port, () => {
      mockServers.push(server);
      resolve(server);
    });

    server.on('error', err => {
      logger.error(`Mock server error on port ${port}`, { error: err });
      reject(err);
    });
  });
}

/**
 * Create a mock server that lists models via both Ollama and OpenAI APIs.
 * /api/tags returns 2 Ollama models; /v1/models returns 2 OpenAI models.
 */
export function modelListingBoth(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url || '';

      if (url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            models: [
              { name: 'llama3:8b', model: 'llama3:8b', size: 4660676344, digest: 'abc123' },
              { name: 'mistral:7b', model: 'mistral:7b', size: 4109746344, digest: 'def456' },
            ],
          })
        );
        return;
      }

      if (url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            object: 'list',
            data: [
              { id: 'gpt-4', object: 'model', created: 1687882411, owned_by: 'openai' },
              {
                id: 'claude-3-sonnet',
                object: 'model',
                created: 1709596745,
                owned_by: 'anthropic',
              },
            ],
          })
        );
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    });

    server.listen(port, () => {
      mockServers.push(server);
      resolve(server);
    });

    server.on('error', err => {
      logger.error(`Mock server error on port ${port}`, { error: err });
      reject(err);
    });
  });
}

/**
 * Create a mock server where both model listing endpoints return 500.
 * Tests the "no model listing available" scenario.
 */
export function noModelListing(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url || '';

      if (url === '/api/tags' || url === '/v1/models') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    });

    server.listen(port, () => {
      mockServers.push(server);
      resolve(server);
    });

    server.on('error', err => {
      logger.error(`Mock server error on port ${port}`, { error: err });
      reject(err);
    });
  });
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
  partition: (port: number, afterRequests?: number) =>
    createDiverseMockServer({
      port,
      type: 'partition',
      partitionAfterRequests: afterRequests || 5,
    }),
  oom: (port: number, afterRequests?: number) =>
    createDiverseMockServer({ port, type: 'oom', oomAfterRequests: afterRequests || 10 }),
  diskFull: (port: number, afterRequests?: number) =>
    createDiverseMockServer({
      port,
      type: 'disk-full',
      diskFullAfterRequests: afterRequests || 10,
    }),
  clockSkew: (port: number) => createDiverseMockServer({ port, type: 'clock-skew' }),
  degrading: (port: number, healthyFor?: number, degradeAfter?: number) =>
    createDegradingServer(port, {
      healthyForRequests: healthyFor,
      degradeAfterRequests: degradeAfter,
    }),
  modelNotFound: (port: number) => modelNotFound(port),
  notSupported: (port: number) => notSupported(port),
  rateLimitedOnInvalid: (port: number) => rateLimitedOnInvalid(port),
  html404: (port: number) => html404(port),
  modelListingOllama: (port: number) => modelListingOllama(port),
  modelListingOpenAI: (port: number) => modelListingOpenAI(port),
  modelListingBoth: (port: number) => modelListingBoth(port),
  noModelListing: (port: number) => noModelListing(port),
};

export interface MockOllamaServerOptions {
  failGenerateFor?: number;
  healthy?: boolean;
  models?: any[];
  latency?: number;
}

export function createMockOllamaServer(
  port: number,
  options: MockOllamaServerOptions = {}
): { server: any; getRequestLog?: () => string[]; getRequestCount?: () => number } {
  const { failGenerateFor = 0, healthy = true, models = [], latency = 0 } = options;
  let requestCount = 0;
  const requestLog: string[] = [];

  const server = require('http').createServer((req: any, res: any) => {
    const path = req.url ?? '/';
    requestLog.push(`${req.method} ${path}`);

    setTimeout(() => {
      if (!healthy) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Service Unavailable' }));
        return;
      }

      res.setHeader('Content-Type', 'application/json');

      if (path === '/api/tags') {
        res.writeHead(200);
        res.end(JSON.stringify({ models }));
        return;
      }

      if (path === '/api/generate') {
        requestCount++;
        if (failGenerateFor > 0 && requestCount <= failGenerateFor) {
          res.writeHead(503, { 'Content-Type': 'text/plain' });
          res.end('Service Unavailable');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ response: 'test response', done: true }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }, latency);
  });

  return {
    server,
    getRequestLog: () => [...requestLog],
    getRequestCount: () => requestCount,
  };
}
