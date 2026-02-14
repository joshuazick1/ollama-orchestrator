/**
 * Test utilities for Ollama Orchestrator
 * Mock server creation, assertions, and helpers
 */

import { createServer, Server } from 'http';
import type { AIServer } from '../../src/orchestrator.types';
import { mockResponses, mockModels } from '../fixtures';

// Track created mock servers for cleanup
const mockServers: Server[] = [];

/**
 * Create a mock Ollama server for testing
 */
export function createMockOllamaServer(
  port: number,
  options: {
    healthy?: boolean;
    models?: (typeof mockModels.llama3)[];
    latency?: number;
    failRate?: number;
  } = {}
): Promise<Server> {
  const { healthy = true, models = [mockModels.llama3], latency = 0, failRate = 0 } = options;

  return new Promise(resolve => {
    const server = createServer((req, res) => {
      // Simulate latency
      setTimeout(() => {
        // Simulate random failures
        if (failRate > 0 && Math.random() < failRate) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'Internal Server Error' }));
          return;
        }

        if (!healthy) {
          res.writeHead(503);
          res.end(JSON.stringify({ error: 'Service Unavailable' }));
          return;
        }

        res.setHeader('Content-Type', 'application/json');

        switch (req.url) {
          case '/api/tags':
            res.writeHead(200);
            res.end(JSON.stringify({ models }));
            break;

          case '/api/generate':
            res.writeHead(200);
            res.end(JSON.stringify(mockResponses.generate));
            break;

          case '/api/chat':
            res.writeHead(200);
            res.end(JSON.stringify(mockResponses.chat));
            break;

          case '/api/embeddings':
            res.writeHead(200);
            res.end(JSON.stringify(mockResponses.embeddings));
            break;

          case '/api/ps':
            res.writeHead(200);
            res.end(JSON.stringify(mockResponses.ps));
            break;

          case '/api/version':
            res.writeHead(200);
            res.end(JSON.stringify({ version: '0.1.0' }));
            break;

          default:
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not Found' }));
        }
      }, latency);
    });

    server.listen(port, () => {
      mockServers.push(server);
      resolve(server);
    });
  });
}

/**
 * Stop all mock servers
 */
export async function cleanupMockServers(): Promise<void> {
  await Promise.all(
    mockServers.map(
      server =>
        new Promise<void>(resolve => {
          server.close(() => resolve());
        })
    )
  );
  mockServers.length = 0;
}

/**
 * Wait for a server to be ready
 */
export async function waitForServer(url: string, timeout = 5000): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        return true;
      }
    } catch {
      // Ignore errors, keep trying
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}

/**
 * Custom assertions for testing
 */
export const assertions = {
  /**
   * Assert that a server is in the expected state
   */
  serverState(server: AIServer, expected: Partial<AIServer>): void {
    for (const [key, value] of Object.entries(expected)) {
      const actual = (server as unknown as Record<string, unknown>)[key];
      if (actual !== value) {
        throw new Error(`Expected server.${key} to be ${value}, but got ${actual}`);
      }
    }
  },

  /**
   * Assert that a promise rejects with specific error
   */
  async rejects(promise: Promise<unknown>, expectedError: string | RegExp): Promise<void> {
    try {
      await promise;
      throw new Error(`Expected promise to reject with ${expectedError}, but it resolved`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (typeof expectedError === 'string') {
        if (!errorMessage.includes(expectedError)) {
          throw new Error(
            `Expected error to include "${expectedError}", but got "${errorMessage}"`
          );
        }
      } else if (!expectedError.test(errorMessage)) {
        throw new Error(`Expected error to match ${expectedError}, but got "${errorMessage}"`);
      }
    }
  },

  /**
   * Assert that an async function completes within timeout
   */
  async completesWithin(fn: () => Promise<unknown>, timeoutMs: number): Promise<void> {
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    await Promise.race([fn(), timeout]);
  },
};

/**
 * Create a spy function for testing
 */
export function createSpy<T extends (...args: unknown[]) => unknown>(
  implementation?: T
): { fn: T; calls: unknown[][]; callCount: number; mockClear: () => void } {
  const calls: unknown[][] = [];

  const fn = ((...args: unknown[]) => {
    calls.push(args);
    return implementation?.(...args);
  }) as T;

  return {
    fn,
    get calls() {
      return calls;
    },
    get callCount() {
      return calls.length;
    },
    mockClear: () => {
      calls.length = 0;
    },
  };
}

/**
 * Measure execution time of a function
 */
export async function measureTime<T>(
  fn: () => Promise<T>
): Promise<{ result: T; duration: number }> {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;
  return { result, duration };
}

/**
 * Create a delayed promise
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function until it succeeds or max attempts reached
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; delay?: number } = {}
): Promise<T> {
  const { maxAttempts = 3, delay: delayMs = 100 } = options;
  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxAttempts) {
        await delay(delayMs * attempt);
      }
    }
  }

  throw lastError!;
}

/**
 * Enhanced mock server factory with diverse server types
 * Import from mock-server-factory.ts for advanced use cases
 *
 * Example usage:
 *   import { mockServerFactory } from './test-helpers.js';
 *   const server = await mockServerFactory.slow(11434);
 */
export {
  // Core factory functions (new functionality)
  createDiverseMockServer,
  createChaosServer,
  createMockServerFleet,
  mockServerFactory,
  // Types
  type MockServerType,
  type MockServerConfig,
} from './mock-server-factory.js';
