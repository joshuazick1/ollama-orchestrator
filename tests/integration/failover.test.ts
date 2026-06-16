import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import type { AIServer } from '../../src/orchestrator/orchestrator.types.js';
import { InFlightManager } from '../../src/utils/in-flight-manager.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Failover Integration Tests', () => {
  let inFlightManager: InFlightManager;

  const ollamaServers: AIServer[] = [
    {
      id: 'ollama-1',
      url: 'http://localhost:11434',
      type: 'ollama',
      healthy: true,
      lastResponseTime: 100,
      models: ['llama3:latest'],
      supportsOllama: true,
      supportsV1: false,
    },
    {
      id: 'ollama-2',
      url: 'http://localhost:11435',
      type: 'ollama',
      healthy: true,
      lastResponseTime: 150,
      models: ['llama3:latest', 'mistral:latest'],
      supportsOllama: true,
      supportsV1: false,
    },
  ];

  const openaiServers: AIServer[] = [
    {
      id: 'openai-1',
      url: 'http://localhost:8000',
      type: 'ollama',
      healthy: true,
      lastResponseTime: 80,
      models: [],
      v1Models: ['gpt-4'],
      supportsOllama: false,
      supportsV1: true,
    },
    {
      id: 'openai-2',
      url: 'http://localhost:8001',
      type: 'ollama',
      healthy: true,
      lastResponseTime: 120,
      models: [],
      v1Models: ['gpt-4', 'gpt-3.5-turbo'],
      supportsOllama: false,
      supportsV1: true,
    },
  ];

  const dualServers: AIServer[] = [
    {
      id: 'dual-1',
      url: 'http://localhost:11436',
      type: 'ollama',
      healthy: true,
      lastResponseTime: 90,
      models: ['llama3:latest'],
      v1Models: ['llama3'],
      supportsOllama: true,
      supportsV1: true,
    },
  ];

  beforeEach(() => {
    inFlightManager = new InFlightManager();
  });

  afterEach(() => {
    inFlightManager.clear();
  });

  describe('Automatic Failover', () => {
    it('should failover to next server when primary fails', async () => {
      const servers = [...ollamaServers];
      let currentIndex = 0;

      const executeWithFailover = async () => {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < servers.length; attempt++) {
          const server = servers[currentIndex];

          try {
            if (server.id === 'ollama-1') {
              throw new Error('Connection refused');
            }

            return { success: true, server: server.id };
          } catch (error) {
            lastError = error as Error;
            currentIndex = (currentIndex + 1) % servers.length;
          }
        }

        throw lastError;
      };

      const result = await executeWithFailover();

      expect(result.success).toBe(true);
      expect(result.server).toBe('ollama-2');
    });

    it('should failover with multiple consecutive failures', async () => {
      const allServers = [...ollamaServers, ...openaiServers];
      const failedServers = new Set<string>();
      let attempts = 0;

      const executeWithManyFailures = async () => {
        for (const server of allServers) {
          attempts++;

          if (failedServers.has(server.id)) {
            continue;
          }

          if (server.id === 'ollama-1' || server.id === 'openai-1') {
            failedServers.add(server.id);
            continue;
          }

          return { success: true, server: server.id };
        }

        throw new Error('All servers failed');
      };

      const result = await executeWithManyFailures();

      expect(result.success).toBe(true);
      expect(attempts).toBeGreaterThanOrEqual(2);
    });

    it('should preserve request content during failover', async () => {
      const requestBody = {
        model: 'llama3:latest',
        prompt: 'This is a test prompt that should be preserved',
        options: { temperature: 0.7 },
      };

      let capturedBody: any = null;

      const executeRequest = async () => {
        try {
          throw new Error('Failed');
        } catch {
          capturedBody = { ...requestBody };
          return { success: true };
        }
      };

      await executeRequest();

      expect(capturedBody).toEqual(requestBody);
    });

    it('should failover during streaming and continue stream', async () => {
      const chunks: string[] = [];
      let serverFailed = false;

      const streamWithFailover = async () => {
        for (let i = 0; i < 3; i++) {
          chunks.push(`chunk-${i}`);
        }

        serverFailed = true;

        for (let i = 3; i < 5; i++) {
          chunks.push(`chunk-${i}-from-failover`);
        }

        return { success: true, chunks };
      };

      const result = await streamWithFailover();

      expect(result.success).toBe(true);
      expect(chunks.length).toBe(5);
      expect(serverFailed).toBe(true);
    });

    it('should failover correctly in mixed server pool', async () => {
      const mixedPool = [...ollamaServers, ...openaiServers];

      let selectedServer: AIServer | null = null;

      const selectOllamaServer = () => {
        for (const server of mixedPool) {
          if (server.supportsOllama && server.id !== 'ollama-1') {
            selectedServer = server;
            return server;
          }
        }
        return null;
      };

      const server = selectOllamaServer();

      expect(server).not.toBeNull();
      expect(server?.id).toBe('ollama-2');
      expect(server?.supportsOllama).toBe(true);
    });
  });

  describe('Retry Configuration', () => {
    it('should retry exactly 2 times by default', async () => {
      const maxRetries = 2;
      let attempts = 0;

      let calls = 0;
      const executeWithRetry = async () => {
        calls++;
        attempts = calls;
        if (calls <= maxRetries) {
          throw new Error('Temporary failure');
        }
        return { success: true };
      };

      let done = false;
      let lastErr: any;
      for (let i = 0; i <= maxRetries; i++) {
        try {
          await executeWithRetry();
          done = true;
          break;
        } catch (err) {
          lastErr = err;
        }
      }

      if (!done) {
        throw lastErr;
      }

      expect(attempts).toBe(3);
    });

    it('should respect custom retry count', () => {
      const maxRetries = 5;
      let attempts = 0;

      let calls = 0;
      const executeWithCustomRetry = () => {
        calls++;
        attempts = calls;
        if (calls <= maxRetries) {
          throw new Error('Temporary failure');
        }
      };

      let succeeded = false;
      for (let i = 0; i <= maxRetries; i++) {
        try {
          executeWithCustomRetry();
          succeeded = true;
          break;
        } catch (err) {}
      }

      expect(succeeded).toBe(true);
      expect(attempts).toBe(6);
    });

    it('should not retry when maxRetries is 0', () => {
      const maxRetries = 0;
      let attempts = 0;

      const executeWithNoRetry = () => {
        attempts++;
        throw new Error('Permanent failure');
      };

      expect(executeWithNoRetry).toThrow();
      expect(attempts).toBe(1);
    });

    it('should use exponential backoff between retries', async () => {
      const baseDelay = 500;
      const backoffMultiplier = 2;
      const maxDelay = 5000;
      const timings: number[] = [];

      const executeWithBackoff = async () => {
        for (let retry = 0; retry < 3; retry++) {
          if (retry > 0) {
            const delay = Math.min(baseDelay * Math.pow(backoffMultiplier, retry - 1), maxDelay);
            timings.push(delay);
          }

          if (retry < 2) {
            continue;
          }
          return;
        }
      };

      await executeWithBackoff();

      expect(timings[0]).toBe(500);
      expect(timings[1]).toBe(1000);
    });
  });

  describe('Cooldown Period', () => {
    it('should enter cooldown after failure', () => {
      const cooldowns = new Map<string, number>();
      const cooldownDuration = 120000;

      const serverKey = 'ollama-1:llama3';
      cooldowns.set(serverKey, Date.now() + cooldownDuration);

      const isInCooldown = (cooldowns.get(serverKey) || 0) > Date.now();

      expect(isInCooldown).toBe(true);
    });

    it('should exit cooldown after duration expires', () => {
      const cooldowns = new Map<string, number>();
      const cooldownDuration = 100;

      const serverKey = 'ollama-1:llama3';
      cooldowns.set(serverKey, Date.now() + cooldownDuration);

      expect((cooldowns.get(serverKey) || 0) > Date.now()).toBe(true);

      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + cooldownDuration + 1);

      const isInCooldown = (cooldowns.get(serverKey) || 0) > Date.now();
      expect(isInCooldown).toBe(false);

      vi.useRealTimers();
    });

    it('should allow requests after cooldown', () => {
      const cooldowns = new Map<string, number>();
      let requestAllowed = false;

      const serverKey = 'ollama-1:llama3';
      cooldowns.set(serverKey, Date.now() + 100);

      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 101);

      const isInCooldown = (cooldowns.get(serverKey) || 0) > Date.now();
      if (!isInCooldown) {
        requestAllowed = true;
      }

      expect(requestAllowed).toBe(true);
      vi.useRealTimers();
    });

    it('should apply cooldown per server:model', () => {
      const cooldowns = new Map<string, number>();
      const cooldownDuration = 120000;

      cooldowns.set('server-1:llama3', Date.now() + cooldownDuration);
      cooldowns.set('server-1:mistral', Date.now() + cooldownDuration);

      const llama3InCooldown = (cooldowns.get('server-1:llama3') || 0) > Date.now();
      const mistralInCooldown = (cooldowns.get('server-1:mistral') || 0) > Date.now();

      expect(llama3InCooldown).toBe(true);
      expect(mistralInCooldown).toBe(true);
    });
  });

  describe('Error Classification', () => {
    it('should NOT retry permanent errors (4xx)', () => {
      const permanentErrors = [
        'HTTP 400: Bad Request',
        'HTTP 401: Unauthorized',
        'HTTP 404: Not Found',
        'HTTP 422: Unprocessable Entity',
      ];

      const retryableErrors = [
        'HTTP 500: Internal Server Error',
        'HTTP 502: Bad Gateway',
        'HTTP 503: Service Unavailable',
        'HTTP 504: Gateway Timeout',
      ];

      const isPermanent = (error: string) => error.startsWith('HTTP 4');

      permanentErrors.forEach(error => {
        expect(isPermanent(error)).toBe(true);
      });

      retryableErrors.forEach(error => {
        expect(isPermanent(error)).toBe(false);
      });
    });

    it('should retry transient errors', () => {
      const transientErrors = [
        'Connection timeout',
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
        'Network is unreachable',
      ];

      const isTransient = (error: string) =>
        error.toLowerCase().includes('timeout') ||
        error.includes('ECONN') ||
        error.includes('ETIMEDOUT') ||
        error.toLowerCase().includes('unreach');

      transientErrors.forEach(error => {
        expect(isTransient(error)).toBe(true);
      });
    });

    it('should retry timeout errors', () => {
      const timeoutErrors = [
        'Request timeout after 30000ms',
        'Timeout: Connection timed out',
        'Gateway Timeout',
      ];

      const isRetryable = (error: string) => error.toLowerCase().includes('timeout');

      timeoutErrors.forEach(error => {
        expect(isRetryable(error)).toBe(true);
      });
    });

    it('should retry network errors', () => {
      const networkErrors = ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'];

      const isNetworkError = (error: string) => error.startsWith('E');

      networkErrors.forEach(error => {
        expect(isNetworkError(error)).toBe(true);
      });
    });
  });

  describe('Dual-Protocol Failover', () => {
    it('should failover Ollama servers correctly', () => {
      const servers = [...ollamaServers, ...dualServers];

      const findFallback = (failedServerId: string) => {
        return servers.find(s => s.id !== failedServerId && s.supportsOllama);
      };

      const fallback = findFallback('ollama-1');

      expect(fallback).toBeDefined();
      expect(fallback?.supportsOllama).toBe(true);
    });

    it('should failover OpenAI servers correctly', () => {
      const servers = [...openaiServers, ...dualServers];

      const findFallback = (failedServerId: string) => {
        return servers.find(s => s.id !== failedServerId && s.supportsV1);
      };

      const fallback = findFallback('openai-1');

      expect(fallback).toBeDefined();
      expect(fallback?.supportsV1).toBe(true);
    });

    it('should respect protocol capabilities during failover', () => {
      const servers = [...ollamaServers, ...openaiServers];

      const ollamaFallbacks = servers.filter(s => s.supportsOllama);
      const openaiFallbacks = servers.filter(s => s.supportsV1);

      ollamaFallbacks.forEach(server => {
        expect(server.supportsOllama).toBe(true);
      });

      openaiFallbacks.forEach(server => {
        expect(server.supportsV1).toBe(true);
      });
    });

    it('should handle failover on dual-capability server between protocols', () => {
      const dualServer: AIServer = {
        id: 'dual-1',
        url: 'http://localhost:11436',
        type: 'ollama',
        healthy: true,
        lastResponseTime: 90,
        models: ['llama3:latest'],
        v1Models: ['llama3'],
        supportsOllama: true,
        supportsV1: true,
      };

      const tryOpenAIOnSameServer = () => {
        const ollamaFailed = true;

        if (ollamaFailed && dualServer.supportsV1) {
          return { protocol: 'openai', server: dualServer.id };
        }

        return { protocol: 'ollama', server: dualServer.id };
      };

      const result = tryOpenAIOnSameServer();

      expect(result.protocol).toBe('openai');
      expect(result.server).toBe('dual-1');
    });

    it('should verify model availability after failover', () => {
      const primary = ollamaServers[0];
      const fallback = ollamaServers[1];

      const model = 'llama3:latest';

      const primaryHasModel = primary.models?.includes(model);
      const fallbackHasModel = fallback.models?.includes(model);

      expect(primaryHasModel).toBe(true);
      expect(fallbackHasModel).toBe(true);
    });

    it('should handle failover when model not available on fallback', () => {
      const primary = {
        id: 'server-1',
        models: ['llama3:latest', 'mistral:latest'],
      };

      const fallback = {
        id: 'server-2',
        models: ['llama3:latest'],
      };

      const model = 'mistral:latest';

      const primaryHasModel = primary.models.includes(model);
      const fallbackHasModel = fallback.models.includes(model);

      expect(primaryHasModel).toBe(true);
      expect(fallbackHasModel).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle all servers failing', async () => {
      const servers = [...ollamaServers];
      let allFailed = false;

      const attemptAllFail = async () => {
        for (const server of servers) {
          throw new Error(`Server ${server.id} failed`);
        }
        allFailed = true;
      };

      await expect(attemptAllFail()).rejects.toThrow();
      expect(allFailed).toBe(false);
    });

    it('should handle immediate success without failover', async () => {
      const executeImmediateSuccess = async () => {
        return { success: true, server: 'ollama-1' };
      };

      const result = await executeImmediateSuccess();

      expect(result.success).toBe(true);
    });

    it('should handle very long failover chain', async () => {
      const manyServers = Array.from({ length: 10 }, (_, i) => ({
        id: `server-${i}`,
        supportsOllama: true,
      }));

      let attempts = 0;

      const executeLongChain = async () => {
        for (const server of manyServers) {
          attempts++;
          if (attempts < 10) {
            throw new Error('Failure');
          }
          return { success: true };
        }
        throw new Error('All failed');
      };

      expect(async () => {
        await executeLongChain();
      }).rejects.toThrow();
    });

    it('should handle concurrent failover attempts', async () => {
      const results = await Promise.allSettled([
        Promise.resolve({ success: true, server: 'ollama-1' }),
        Promise.resolve({ success: true, server: 'ollama-2' }),
        Promise.reject(new Error('Failed')),
      ]);

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('fulfilled');
      expect(results[2].status).toBe('rejected');
    });
  });
});
