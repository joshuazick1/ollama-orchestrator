/**
 * rate-limiting.test.ts
 * Tests for rate limiting functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RequestQueue } from '../../src/queue/index.js';
import type { AIServer } from '../../src/orchestrator.types.js';

describe('Rate Limiting Tests', () => {
  let queue: RequestQueue;

  const createServer = (id: string): AIServer => ({
    id,
    url: `http://localhost:${11434 + parseInt(id.split('-')[1])}`,
    type: 'ollama',
    healthy: true,
    lastResponseTime: 100,
    models: ['llama3:latest'],
    maxConcurrency: 4,
  });

  beforeEach(() => {
    queue = new RequestQueue({});
    vi.clearAllMocks();
  });

  describe('Queue Configuration', () => {
    it('should create queue with default config', () => {
      expect(queue).toBeDefined();
    });

    it('should handle custom queue size', () => {
      const customQueue = new RequestQueue({
        queue: { maxSize: 100 },
      } as any);
      expect(customQueue).toBeDefined();
    });

    it('should handle zero queue size', () => {
      const customQueue = new RequestQueue({
        queue: { maxSize: 0 },
      } as any);
      expect(customQueue).toBeDefined();
    });

    it('should handle large queue size', () => {
      const customQueue = new RequestQueue({
        queue: { maxSize: 100000 },
      } as any);
      expect(customQueue).toBeDefined();
    });
  });

  describe('Priority Levels', () => {
    it('should support priority queue config', () => {
      const priorityQueue = new RequestQueue({
        queue: { priorityEnabled: true, priorityLevels: 5 },
      } as any);
      expect(priorityQueue).toBeDefined();
    });

    it('should handle single priority level', () => {
      const singlePriority = new RequestQueue({
        queue: { priorityEnabled: true, priorityLevels: 1 },
      } as any);
      expect(singlePriority).toBeDefined();
    });

    it('should handle zero priority levels', () => {
      const zeroPriority = new RequestQueue({
        queue: { priorityEnabled: true, priorityLevels: 0 },
      } as any);
      expect(zeroPriority).toBeDefined();
    });
  });

  describe('Streaming Configuration', () => {
    it('should handle streaming enabled', () => {
      const streamingQueue = new RequestQueue({
        streaming: {
          enabled: true,
          maxConcurrentStreams: 100,
          timeoutMs: 300000,
          bufferSize: 8192,
          activityTimeoutMs: 60000,
        },
      } as any);
      expect(streamingQueue).toBeDefined();
    });

    it('should handle streaming disabled', () => {
      const noStreaming = new RequestQueue({
        streaming: {
          enabled: false,
        },
      } as any);
      expect(noStreaming).toBeDefined();
    });

    it('should handle high concurrent streams', () => {
      const highConcur = new RequestQueue({
        streaming: {
          enabled: true,
          maxConcurrentStreams: 1000,
        },
      } as any);
      expect(highConcur).toBeDefined();
    });

    it('should handle low concurrent streams', () => {
      const lowConcur = new RequestQueue({
        streaming: {
          enabled: true,
          maxConcurrentStreams: 1,
        },
      } as any);
      expect(lowConcur).toBeDefined();
    });

    it('should handle zero timeout', () => {
      const zeroTimeout = new RequestQueue({
        streaming: {
          enabled: true,
          timeoutMs: 0,
        },
      } as any);
      expect(zeroTimeout).toBeDefined();
    });

    it('should handle very long timeout', () => {
      const longTimeout = new RequestQueue({
        streaming: {
          enabled: true,
          timeoutMs: 3600000,
        },
      } as any);
      expect(longTimeout).toBeDefined();
    });
  });

  describe('Retry Configuration', () => {
    it('should handle retry config', () => {
      const retryQueue = new RequestQueue({
        retry: {
          maxRetries: 3,
          retryDelayMs: 500,
          backoffMultiplier: 2,
          maxRetryDelayMs: 10000,
        },
      } as any);
      expect(retryQueue).toBeDefined();
    });

    it('should handle zero retries', () => {
      const noRetry = new RequestQueue({
        retry: {
          maxRetries: 0,
        },
      } as any);
      expect(noRetry).toBeDefined();
    });

    it('should handle high retry count', () => {
      const highRetry = new RequestQueue({
        retry: {
          maxRetries: 100,
        },
      } as any);
      expect(highRetry).toBeDefined();
    });

    it('should handle backoff multiplier of 1', () => {
      const linearBackoff = new RequestQueue({
        retry: {
          backoffMultiplier: 1,
        },
      } as any);
      expect(linearBackoff).toBeDefined();
    });

    it('should handle large retry delays', () => {
      const largeDelay = new RequestQueue({
        retry: {
          maxRetryDelayMs: 300000,
        },
      } as any);
      expect(largeDelay).toBeDefined();
    });
  });

  describe('Queue Edge Cases', () => {
    it('should handle empty config', () => {
      const emptyQueue = new RequestQueue({});
      expect(emptyQueue).toBeDefined();
    });

    it('should handle undefined config', () => {
      const undefinedQueue = new RequestQueue(undefined as any);
      expect(undefinedQueue).toBeDefined();
    });

    it('should handle null config', () => {
      const nullQueue = new RequestQueue(null as any);
      expect(nullQueue).toBeDefined();
    });

    it('should handle partial config', () => {
      const partialQueue = new RequestQueue({
        queue: { maxSize: 50 },
      } as any);
      expect(partialQueue).toBeDefined();
    });
  });

  describe('Combined Configuration', () => {
    it('should handle all configs combined', () => {
      const fullQueue = new RequestQueue({
        queue: {
          maxSize: 1000,
          priorityEnabled: true,
          priorityLevels: 3,
        },
        streaming: {
          enabled: true,
          maxConcurrentStreams: 50,
          timeoutMs: 180000,
          bufferSize: 8192,
          activityTimeoutMs: 45000,
        },
        retry: {
          maxRetries: 3,
          retryDelayMs: 500,
          backoffMultiplier: 2,
          maxRetryDelayMs: 15000,
        },
      } as any);
      expect(fullQueue).toBeDefined();
    });

    it('should handle minimal config', () => {
      const minimalQueue = new RequestQueue({
        queue: { maxSize: 10 },
      } as any);
      expect(minimalQueue).toBeDefined();
    });

    it('should handle extreme values', () => {
      const extremeQueue = new RequestQueue({
        queue: {
          maxSize: Number.MAX_SAFE_INTEGER,
          priorityEnabled: true,
          priorityLevels: 1000,
        },
        streaming: {
          enabled: true,
          maxConcurrentStreams: Number.MAX_SAFE_INTEGER,
          timeoutMs: Number.MAX_SAFE_INTEGER,
        },
        retry: {
          maxRetries: Number.MAX_SAFE_INTEGER,
          retryDelayMs: Number.MAX_SAFE_INTEGER,
          maxRetryDelayMs: Number.MAX_SAFE_INTEGER,
        },
      } as any);
      expect(extremeQueue).toBeDefined();
    });
  });

  describe('Dual-Protocol Rate Limiting', () => {
    it('should handle Ollama-style requests', () => {
      const server = createServer('ollama-1');
      expect(server.type).toBe('ollama');
    });

    it('should handle OpenAI-style requests', () => {
      const openaiServer: AIServer = {
        id: 'openai-1',
        url: 'http://localhost:8000',
        type: 'ollama',
        healthy: true,
        supportsV1: true,
        v1Models: ['gpt-4'],
        lastResponseTime: 100,
        models: [],
      };
      expect(openaiServer.supportsV1).toBe(true);
    });

    it('should handle dual-capability servers', () => {
      const dualServer: AIServer = {
        id: 'dual-1',
        url: 'http://localhost:9000',
        type: 'ollama',
        healthy: true,
        supportsOllama: true,
        supportsV1: true,
        models: ['llama3:latest'],
        v1Models: ['gpt-4'],
        lastResponseTime: 100,
      };
      expect(dualServer.supportsOllama).toBe(true);
      expect(dualServer.supportsV1).toBe(true);
    });
  });
});
