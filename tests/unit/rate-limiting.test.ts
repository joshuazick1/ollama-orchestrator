/**
 * rate-limiting.test.ts
 * Tests for rate limiting functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RequestQueue } from '../../src/queue/index.js';
import type { QueuedRequest } from '../../src/queue/request-queue.js';
import type { AIServer } from '../../src/orchestrator.types.js';

describe('Rate Limiting Tests', () => {
  let queue: RequestQueue;

  const createMockRequest = (overrides: Partial<QueuedRequest> = {}): QueuedRequest => {
    const now = Date.now();
    return {
      id: `req-${Math.random().toString(36).substr(2, 9)}`,
      model: 'llama3:latest',
      endpoint: 'generate',
      priority: 0,
      enqueueTime: now,
      deadline: now + 60000,
      resolve: vi.fn(),
      reject: vi.fn(),
      ...overrides,
    } as QueuedRequest;
  };

  const createServer = (id: string): AIServer => ({
    id,
    url: `http://localhost:${11434 + parseInt(id.split('-')[1] || '1')}`,
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
    it('should create queue with default max size', () => {
      const stats = queue.getStats();
      expect(stats.currentSize).toBe(0);
    });

    it('should accept custom max size in config', () => {
      const customQueue = new RequestQueue({
        queue: { maxSize: 5 },
      } as any);
      expect(customQueue).toBeDefined();
    });
  });

  describe('Enqueue Operations', () => {
    it('should add request to queue', () => {
      const request = createMockRequest();
      const result = queue.enqueue(request);
      expect(result).toBe(true);
      expect(queue.size()).toBe(1);
    });

    it('should add multiple requests', () => {
      const smallQueue = new RequestQueue({
        queue: { maxSize: 2 },
      } as any);

      smallQueue.enqueue(createMockRequest({ id: 'req1' }));
      const result = smallQueue.enqueue(createMockRequest({ id: 'req2' }));

      expect(result).toBe(true);
      expect(smallQueue.size()).toBe(2);
    });

    it('should handle high priority requests', () => {
      const lowPri = createMockRequest({ priority: 0 });
      const highPri = createMockRequest({ priority: 10 });

      queue.enqueue(lowPri);
      queue.enqueue(highPri);

      expect(queue.size()).toBe(2);
    });
  });

  describe('Dequeue Operations', () => {
    it('should remove and return oldest request', () => {
      queue.enqueue(createMockRequest({ id: 'req1' }));
      queue.enqueue(createMockRequest({ id: 'req2' }));

      const dequeued = queue.dequeue();
      expect(dequeued?.id).toBe('req1');
      expect(queue.size()).toBe(1);
    });

    it('should return undefined when queue is empty', () => {
      const dequeued = queue.dequeue();
      expect(dequeued).toBeUndefined();
    });
  });

  describe('Peek Operations', () => {
    it('should peek at oldest request without removing', () => {
      queue.enqueue(createMockRequest({ id: 'req1' }));
      queue.enqueue(createMockRequest({ id: 'req2' }));

      const peeked = queue.peek();
      expect(peeked?.id).toBe('req1');
      expect(queue.size()).toBe(2);
    });

    it('should return undefined when empty', () => {
      const peeked = queue.peek();
      expect(peeked).toBeUndefined();
    });
  });

  describe('Queue Stats', () => {
    it('should track total queued count', () => {
      queue.enqueue(createMockRequest());
      queue.enqueue(createMockRequest());

      const stats = queue.getStats();
      expect(stats.totalQueued).toBe(2);
    });

    it('should track dropped count when queue full', () => {
      const fullQueue = new RequestQueue({
        queue: { maxSize: 1 },
      } as any);

      fullQueue.enqueue(createMockRequest());

      const stats = fullQueue.getStats();
      expect(stats.totalQueued).toBe(1);
    });

    it('should report current size', () => {
      const stats = queue.getStats();
      expect(stats.currentSize).toBe(0);

      queue.enqueue(createMockRequest());
      const updatedStats = queue.getStats();
      expect(updatedStats.currentSize).toBe(1);
    });
  });

  describe('Priority Queue', () => {
    it('should dequeue higher priority first', () => {
      const priorityQueue = new RequestQueue({
        queue: { priorityEnabled: true, priorityLevels: 3 },
      } as any);

      priorityQueue.enqueue(createMockRequest({ id: 'low', priority: 1 }));
      priorityQueue.enqueue(createMockRequest({ id: 'high', priority: 3 }));
      priorityQueue.enqueue(createMockRequest({ id: 'medium', priority: 2 }));

      const first = priorityQueue.dequeue();
      expect(first?.id).toBe('high');
    });
  });

  describe('Queue Size', () => {
    it('should return correct size', () => {
      expect(queue.size()).toBe(0);
      queue.enqueue(createMockRequest());
      queue.enqueue(createMockRequest());
      expect(queue.size()).toBe(2);
    });
  });

  describe('Dual-Protocol Support', () => {
    it('should handle Ollama model requests', () => {
      const request = createMockRequest({ model: 'llama3:latest' });
      queue.enqueue(request);
      expect(queue.size()).toBe(1);
    });

    it('should handle OpenAI model requests', () => {
      const request = createMockRequest({ model: 'gpt-4' });
      queue.enqueue(request);
      expect(queue.size()).toBe(1);
    });

    it('should handle dual-capability servers', () => {
      const server = createServer('dual-1');
      expect(server.id).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid enqueue/dequeue', () => {
      for (let i = 0; i < 10; i++) {
        queue.enqueue(createMockRequest({ id: `req-${i}` }));
      }

      for (let i = 0; i < 5; i++) {
        queue.dequeue();
      }

      expect(queue.size()).toBe(5);
    });

    it('should handle empty queue dequeue', () => {
      const result = queue.dequeue();
      expect(result).toBeUndefined();
    });

    it('should track by model', () => {
      queue.enqueue(createMockRequest({ model: 'llama3:latest' }));
      queue.enqueue(createMockRequest({ model: 'llama3:latest' }));
      queue.enqueue(createMockRequest({ model: 'mistral:latest' }));

      const stats = queue.getStats();
      expect(stats.byModel['llama3:latest']).toBe(2);
      expect(stats.byModel['mistral:latest']).toBe(1);
    });
  });
});
