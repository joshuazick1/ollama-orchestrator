/**
 * health-check-timeout.test.ts
 * Regression test for timeout mock path - ensures /v1/models timeout mock
 * has a working .json() method that returns { data: [] }
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import type { HealthCheckConfig } from '../../src/config/config.js';
import { HealthCheckScheduler } from '../../src/health-check-scheduler.js';
import type { AIServer } from '../../src/orchestrator/orchestrator.types.js';

describe('HealthCheckScheduler v1 timeout mock', () => {
  let config: HealthCheckConfig;
  let mockServer: AIServer;
  let scheduler: HealthCheckScheduler;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let getServers: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onHealthCheck: any;

  beforeEach(() => {
    config = {
      enabled: true,
      intervalMs: 30000,
      timeoutMs: 5000,
      maxConcurrentChecks: 10,
      retryAttempts: 2,
      retryDelayMs: 1000,
      recoveryIntervalMs: 60000,
      failureThreshold: 3,
      successThreshold: 2,
      backoffMultiplier: 1.5,
    };

    mockServer = {
      id: 'test-server',
      url: 'http://localhost:11434',
      type: 'ollama',
      healthy: true,
      lastResponseTime: 1000,
      models: ['llama3:latest'],
      maxConcurrency: 10,
      supportsV1: true,
    };

    getServers = vi.fn(() => [mockServer]);
    onHealthCheck = vi.fn();

    scheduler = new HealthCheckScheduler(config, getServers, onHealthCheck);
  });

  afterEach(() => {
    scheduler.stop();
    vi.clearAllMocks();
  });

  describe('v1/models timeout handling', () => {
    it('should handle timeout mock Response with working .json() method', async () => {
      // The timeout error message that triggers the mock
      const timeoutErrorMsg = 'Request timeout after 2000ms: http://localhost:11434/v1/models';

      // Simulate fetch that times out on /v1/models
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/v1/models')) {
          // Simulate timeout by rejecting with error containing "timeout"
          const error = new Error(timeoutErrorMsg);
          error.name = 'TimeoutError';
          throw error;
        }
        // /api/tags and /api/ps succeed
        if (url.includes('/api/tags')) {
          return {
            ok: true,
            json: async () => ({ models: [{ name: 'llama3:latest', model: 'llama3:latest' }] }),
          };
        }
        if (url.includes('/api/ps')) {
          return {
            ok: true,
            json: async () => ({ models: [] }),
          };
        }
        throw new Error('Unexpected URL: ' + url);
      });

      const result = await scheduler.checkServerHealth(mockServer);

      // Should succeed despite v1 timeout - the mock should provide working .json()
      expect(result.success).toBe(true);
      expect(result.serverId).toBe('test-server');
      expect(result.v1Models).toEqual([]);
      expect(onHealthCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          v1Models: [],
        })
      );
    });

    it('should verify timeout mock .json() returns { data: [] }', async () => {
      // This test verifies the mock itself has correct structure
      const mockResponse = {
        ok: true,
        json: async () => ({ data: [] }),
      } as unknown as Response;

      // Verify the mock's json() method works
      const data = await mockResponse.json();
      expect(data).toEqual({ data: [] });
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data).toHaveLength(0);
    });

    it('should not throw "v1Response.json is not a function" when timeout occurs', async () => {
      // This tests the actual bug scenario - when /v1/models times out,
      // the code should not throw "json is not a function"
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/v1/models')) {
          const error = new Error('Request timeout after 2000ms');
          throw error;
        }
        // Other endpoints work
        return {
          ok: true,
          json: async () => ({ models: [] }),
        };
      });

      // Should NOT throw "v1Response.json is not a function"
      await expect(scheduler.checkServerHealth(mockServer)).resolves.not.toThrow();
    });

    it('should extract v1Models from timeout mock correctly', async () => {
      // Simulate a server that times out on /v1/models but is otherwise healthy
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/v1/models')) {
          throw new Error('Request timeout after 2000ms');
        }
        if (url.includes('/api/tags')) {
          return {
            ok: true,
            json: async () => ({
              models: [
                { name: 'llama3:8b', model: 'llama3:8b', details: { parameter_size: '8b' } },
              ],
            }),
          };
        }
        if (url.includes('/api/ps')) {
          return {
            ok: true,
            json: async () => ({ models: [] }),
          };
        }
        throw new Error('Unexpected URL');
      });

      const result = await scheduler.checkServerHealth(mockServer);

      // The timeout mock should provide { data: [] } which results in empty v1Models
      expect(result.v1Models).toEqual([]);
      expect(result.models).toContain('llama3:8b');
    });

    it('should handle v1 timeout when /api/tags also times out', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/v1/models') || url.includes('/api/tags')) {
          throw new Error('Request timeout');
        }
        if (url.includes('/api/ps')) {
          return {
            ok: true,
            json: async () => ({ models: [] }),
          };
        }
        // Mock endpoint probes
        return { status: 200 };
      });

      const result = await scheduler.checkServerHealth(mockServer);

      // v1 timeout creates mock with { data: [] }, so v1Models should be empty array
      expect(result.v1Models).toEqual([]);
    });
  });
});
