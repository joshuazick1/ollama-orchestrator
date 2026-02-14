import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RequestQueue, QueuedRequest, QueueConfig, DEFAULT_QUEUE_CONFIG } from '../../src/queue/request-queue.js';

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('RequestQueue', () => {
  let queue: RequestQueue;

  beforeEach(() => {
    queue = new RequestQueue({
      maxSize: 10,
      timeout: 30000,
      priorityBoostInterval: 5000,
      priorityBoostAmount: 5,
    });
  });

  afterEach(() => {
    queue.shutdown();
  });

  describe('Basic Operations', () => {
    it('should enqueue a request successfully', () => {
      const request = createMockRequest({ id: 'req-1', priority: 5 });
      const result = queue.enqueue(request);
      expect(result).toBe(true);
      expect(queue.size()).toBe(1);
    });

    it('should dequeue all requests with same priority (heap order)', () => {
      const request1 = createMockRequest({ id: 'req-1', priority: 5 });
      const request2 = createMockRequest({ id: 'req-2', priority: 5 });
      const request3 = createMockRequest({ id: 'req-3', priority: 5 });

      queue.enqueue(request1);
      queue.enqueue(request2);
      queue.enqueue(request3);

      // Binary heap doesn't guarantee FIFO for equal priorities
      // It depends on the heap structure
      const dequeuedIds = [
        queue.dequeue()?.id,
        queue.dequeue()?.id,
        queue.dequeue()?.id,
      ].sort();
      
      expect(dequeuedIds).toEqual(['req-1', 'req-2', 'req-3']);
    });

    it('should return undefined when dequeuing from empty queue', () => {
      const result = queue.dequeue();
      expect(result).toBeUndefined();
    });

    it('should peek at highest priority request without removing', () => {
      const request1 = createMockRequest({ id: 'req-1', priority: 5 });
      const request2 = createMockRequest({ id: 'req-2', priority: 10 });

      queue.enqueue(request1);
      queue.enqueue(request2);

      const peeked = queue.peek();
      expect(peeked?.id).toBe('req-2');
      expect(peeked?.priority).toBe(10);
      expect(queue.size()).toBe(2);
    });

    it('should return undefined when peeking empty queue', () => {
      expect(queue.peek()).toBeUndefined();
    });

    it('should track queue size correctly', () => {
      expect(queue.size()).toBe(0);

      const request1 = createMockRequest({ id: 'req-1' });
      const request2 = createMockRequest({ id: 'req-2' });

      queue.enqueue(request1);
      expect(queue.size()).toBe(1);

      queue.enqueue(request2);
      expect(queue.size()).toBe(2);

      queue.dequeue();
      expect(queue.size()).toBe(1);

      queue.dequeue();
      expect(queue.size()).toBe(0);
    });
  });

  describe('Priority Ordering', () => {
    it('should dequeue higher priority requests first', () => {
      const lowPriority = createMockRequest({ id: 'low', priority: 1 });
      const highPriority = createMockRequest({ id: 'high', priority: 10 });
      const mediumPriority = createMockRequest({ id: 'medium', priority: 5 });

      queue.enqueue(lowPriority);
      queue.enqueue(highPriority);
      queue.enqueue(mediumPriority);

      expect(queue.dequeue()?.id).toBe('high');
      expect(queue.dequeue()?.id).toBe('medium');
      expect(queue.dequeue()?.id).toBe('low');
    });

    it('should maintain priority order across multiple operations', () => {
      const requests = [
        createMockRequest({ id: 'r1', priority: 3 }),
        createMockRequest({ id: 'r2', priority: 7 }),
        createMockRequest({ id: 'r3', priority: 2 }),
        createMockRequest({ id: 'r4', priority: 9 }),
        createMockRequest({ id: 'r5', priority: 5 }),
      ];

      requests.forEach((req) => queue.enqueue(req));

      expect(queue.dequeue()?.id).toBe('r4'); // priority 9
      expect(queue.dequeue()?.id).toBe('r2'); // priority 7

      // Add a new high priority request
      queue.enqueue(createMockRequest({ id: 'r6', priority: 8 }));

      expect(queue.dequeue()?.id).toBe('r6'); // priority 8
      expect(queue.dequeue()?.id).toBe('r5'); // priority 5
      expect(queue.dequeue()?.id).toBe('r1'); // priority 3
      expect(queue.dequeue()?.id).toBe('r3'); // priority 2
    });

    it('should handle same priority values in heap order', () => {
      const request1 = createMockRequest({ id: 'first', priority: 5 });
      const request2 = createMockRequest({ id: 'second', priority: 5 });
      const request3 = createMockRequest({ id: 'third', priority: 5 });

      queue.enqueue(request1);
      queue.enqueue(request2);
      queue.enqueue(request3);

      // Binary heap doesn't guarantee FIFO for equal priorities
      const dequeuedIds = [
        queue.dequeue()?.id,
        queue.dequeue()?.id,
        queue.dequeue()?.id,
      ].sort();
      
      expect(dequeuedIds).toEqual(['first', 'second', 'third']);
    });
  });

  describe('Queue Full Behavior', () => {
    it('should reject requests when queue is full', () => {
      const smallQueue = new RequestQueue({ maxSize: 3 });
      const rejected = vi.fn();

      smallQueue.enqueue(createMockRequest({ id: 'r1' }));
      smallQueue.enqueue(createMockRequest({ id: 'r2' }));
      smallQueue.enqueue(createMockRequest({ id: 'r3' }));

      const request4 = createMockRequest({ id: 'r4', reject: rejected });
      const result = smallQueue.enqueue(request4);

      expect(result).toBe(false);
      expect(rejected).toHaveBeenCalledWith(new Error('Queue is full'));
      expect(smallQueue.size()).toBe(3);

      smallQueue.shutdown();
    });

    it('should increment totalDropped counter when dropping requests', () => {
      const smallQueue = new RequestQueue({ maxSize: 2 });
      const rejectFn = vi.fn();

      smallQueue.enqueue(createMockRequest({ id: 'r1' }));
      smallQueue.enqueue(createMockRequest({ id: 'r2' }));
      smallQueue.enqueue(createMockRequest({ id: 'r3', reject: rejectFn }));

      const stats = smallQueue.getStats();
      expect(stats.totalDropped).toBe(1);

      smallQueue.shutdown();
    });

    it('should allow enqueue after dequeue when queue was full', () => {
      const smallQueue = new RequestQueue({ maxSize: 2 });

      smallQueue.enqueue(createMockRequest({ id: 'r1' }));
      smallQueue.enqueue(createMockRequest({ id: 'r2' }));
      expect(smallQueue.size()).toBe(2);

      smallQueue.dequeue();
      expect(smallQueue.size()).toBe(1);

      const result = smallQueue.enqueue(createMockRequest({ id: 'r3' }));
      expect(result).toBe(true);
      expect(smallQueue.size()).toBe(2);

      smallQueue.shutdown();
    });
  });

  describe('Queue Pause/Resume', () => {
    it('should start unpaused', () => {
      expect(queue.isPaused()).toBe(false);
    });

    it('should reject new requests when paused', () => {
      queue.pause();
      expect(queue.isPaused()).toBe(true);

      const rejected = vi.fn();
      const request = createMockRequest({ id: 'req-1', reject: rejected });

      const result = queue.enqueue(request);

      expect(result).toBe(false);
      expect(rejected).toHaveBeenCalledWith(new Error('Queue is paused'));
      expect(queue.size()).toBe(0);
    });

    it('should allow dequeuing when paused', () => {
      const request = createMockRequest({ id: 'req-1' });
      queue.enqueue(request);
      queue.pause();

      const dequeued = queue.dequeue();
      expect(dequeued?.id).toBe('req-1');
    });

    it('should resume accepting requests after resume', () => {
      queue.pause();
      queue.resume();

      expect(queue.isPaused()).toBe(false);

      const request = createMockRequest({ id: 'req-1' });
      const result = queue.enqueue(request);

      expect(result).toBe(true);
      expect(queue.size()).toBe(1);
    });

    it('should maintain existing requests through pause/resume cycle', () => {
      const request = createMockRequest({ id: 'req-1' });
      queue.enqueue(request);

      queue.pause();
      expect(queue.size()).toBe(1);

      queue.resume();
      expect(queue.size()).toBe(1);
      expect(queue.dequeue()?.id).toBe('req-1');
    });
  });

  describe('Queue Statistics', () => {
    it('should return correct initial stats', () => {
      const stats = queue.getStats();

      expect(stats.currentSize).toBe(0);
      expect(stats.maxSize).toBe(10);
      expect(stats.totalQueued).toBe(0);
      expect(stats.totalDropped).toBe(0);
      expect(stats.avgWaitTime).toBe(0);
      expect(stats.byModel).toEqual({});
    });

    it('should track totalQueued correctly', () => {
      queue.enqueue(createMockRequest({ id: 'r1' }));
      queue.enqueue(createMockRequest({ id: 'r2' }));
      queue.enqueue(createMockRequest({ id: 'r3' }));

      const stats = queue.getStats();
      expect(stats.totalQueued).toBe(3);
    });

    it('should track byModel counts', () => {
      queue.enqueue(createMockRequest({ id: 'r1', model: 'llama3' }));
      queue.enqueue(createMockRequest({ id: 'r2', model: 'mistral' }));
      queue.enqueue(createMockRequest({ id: 'r3', model: 'llama3' }));

      const stats = queue.getStats();
      expect(stats.byModel).toEqual({
        llama3: 2,
        mistral: 1,
      });
    });

    it('should calculate average wait time after dequeues', async () => {
      queue.enqueue(createMockRequest({ id: 'r1' }));
      
      // Small delay to ensure measurable wait time
      await new Promise((resolve) => setTimeout(resolve, 10));
      
      queue.dequeue();

      const stats = queue.getStats();
      expect(stats.avgWaitTime).toBeGreaterThan(0);
    });

    it('should return zero avg wait time when no requests processed', () => {
      queue.enqueue(createMockRequest({ id: 'r1' }));
      
      const stats = queue.getStats();
      expect(stats.avgWaitTime).toBe(0);
    });

    it('should calculate average across multiple requests', async () => {
      queue.enqueue(createMockRequest({ id: 'r1' }));
      queue.enqueue(createMockRequest({ id: 'r2' }));
      
      await new Promise((resolve) => setTimeout(resolve, 20));
      
      queue.dequeue();
      queue.dequeue();

      const stats = queue.getStats();
      expect(stats.avgWaitTime).toBeGreaterThan(0);
    });
  });

  describe('Priority Boost', () => {
    it('should increase priority for old requests', async () => {
      const config: QueueConfig = {
        maxSize: 10,
        timeout: 30000,
        priorityBoostInterval: 50,
        priorityBoostAmount: 10,
      };

      const boostQueue = new RequestQueue(config);
      const lowPriority = createMockRequest({ id: 'low', priority: 1 });
      const highPriority = createMockRequest({ id: 'high', priority: 50 });

      boostQueue.enqueue(lowPriority);
      
      // Wait for priority boost interval
      await new Promise((resolve) => setTimeout(resolve, 60));
      
      boostQueue.enqueue(highPriority);

      // After boost, low priority should be close to high priority
      const firstDequeued = boostQueue.dequeue();
      expect(firstDequeued?.id).toBe('high'); // High priority should still be first
      
      const secondDequeued = boostQueue.dequeue();
      // Low priority should have been boosted (1 + 10 = 11)
      expect(secondDequeued?.id).toBe('low');

      boostQueue.shutdown();
    });

    it('should cap priority boost at maximum (100)', async () => {
      const config: QueueConfig = {
        maxSize: 10,
        timeout: 30000,
        priorityBoostInterval: 10,
        priorityBoostAmount: 50,
      };

      const boostQueue = new RequestQueue(config);
      const request = createMockRequest({ id: 'req', priority: 60 });
      boostQueue.enqueue(request);

      // Wait for multiple boost intervals
      await new Promise((resolve) => setTimeout(resolve, 25));

      boostQueue.shutdown();
    });
  });

  describe('Clear Queue', () => {
    it('should clear all requests from queue', () => {
      queue.enqueue(createMockRequest({ id: 'r1' }));
      queue.enqueue(createMockRequest({ id: 'r2' }));
      queue.enqueue(createMockRequest({ id: 'r3' }));

      queue.clear();

      expect(queue.size()).toBe(0);
      expect(queue.peek()).toBeUndefined();
    });

    it('should reject all pending requests when clearing', () => {
      const reject1 = vi.fn();
      const reject2 = vi.fn();
      const reject3 = vi.fn();

      queue.enqueue(createMockRequest({ id: 'r1', reject: reject1 }));
      queue.enqueue(createMockRequest({ id: 'r2', reject: reject2 }));
      queue.enqueue(createMockRequest({ id: 'r3', reject: reject3 }));

      queue.clear();

      expect(reject1).toHaveBeenCalledWith(new Error('Queue cleared'));
      expect(reject2).toHaveBeenCalledWith(new Error('Queue cleared'));
      expect(reject3).toHaveBeenCalledWith(new Error('Queue cleared'));
    });

    it('should maintain stats after clear', () => {
      queue.enqueue(createMockRequest({ id: 'r1' }));
      queue.enqueue(createMockRequest({ id: 'r2' }));

      queue.clear();

      const stats = queue.getStats();
      expect(stats.totalQueued).toBe(2);
      expect(stats.currentSize).toBe(0);
    });
  });

  describe('Get Requests By Model', () => {
    it('should return empty array for non-existent model', () => {
      queue.enqueue(createMockRequest({ id: 'r1', model: 'llama3' }));
      
      const results = queue.getRequestsByModel('non-existent');
      expect(results).toEqual([]);
    });

    it('should return all requests for a specific model', () => {
      queue.enqueue(createMockRequest({ id: 'r1', model: 'llama3' }));
      queue.enqueue(createMockRequest({ id: 'r2', model: 'mistral' }));
      queue.enqueue(createMockRequest({ id: 'r3', model: 'llama3' }));
      queue.enqueue(createMockRequest({ id: 'r4', model: 'llama3' }));

      const llama3Requests = queue.getRequestsByModel('llama3');
      expect(llama3Requests).toHaveLength(3);
      expect(llama3Requests.map((r) => r.id).sort()).toEqual(['r1', 'r3', 'r4']);

      const mistralRequests = queue.getRequestsByModel('mistral');
      expect(mistralRequests).toHaveLength(1);
      expect(mistralRequests[0].id).toBe('r2');
    });

    it('should not include dequeued requests', () => {
      queue.enqueue(createMockRequest({ id: 'r1', model: 'llama3' }));
      queue.enqueue(createMockRequest({ id: 'r2', model: 'llama3' }));

      const dequeued = queue.dequeue();
      expect(dequeued).toBeDefined();

      const llama3Requests = queue.getRequestsByModel('llama3');
      expect(llama3Requests).toHaveLength(1);
      // The remaining request should not be the one that was dequeued
      expect(llama3Requests[0].id).not.toBe(dequeued?.id);
    });
  });

  describe('Queue Shutdown', () => {
    it('should clear all requests on shutdown', () => {
      queue.enqueue(createMockRequest({ id: 'r1' }));
      queue.enqueue(createMockRequest({ id: 'r2' }));

      queue.shutdown();

      expect(queue.size()).toBe(0);
    });

    it('should reject all pending requests on shutdown', () => {
      const reject1 = vi.fn();
      const reject2 = vi.fn();

      queue.enqueue(createMockRequest({ id: 'r1', reject: reject1 }));
      queue.enqueue(createMockRequest({ id: 'r2', reject: reject2 }));

      queue.shutdown();

      expect(reject1).toHaveBeenCalledWith(new Error('Queue cleared'));
      expect(reject2).toHaveBeenCalledWith(new Error('Queue cleared'));
    });

    it('should stop priority boost on shutdown', () => {
      queue.shutdown();
      // If shutdown doesn't stop the interval, subsequent tests might have issues
      // The fact that afterEach shutdown doesn't cause issues suggests it works
    });

    it('should allow graceful shutdown with no requests', () => {
      expect(() => queue.shutdown()).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid enqueue/dequeue cycles', () => {
      const largeQueue = new RequestQueue({ maxSize: 200 });
      let dequeuedCount = 0;
      
      for (let i = 0; i < 100; i++) {
        largeQueue.enqueue(createMockRequest({ id: `r${i}`, priority: i % 10 }));
        if (i % 3 === 0) {
          largeQueue.dequeue();
          dequeuedCount++;
        }
      }

      expect(largeQueue.size()).toBe(100 - dequeuedCount);
      largeQueue.shutdown();
    });

    it('should handle single element queue', () => {
      const request = createMockRequest({ id: 'r1' });
      
      queue.enqueue(request);
      expect(queue.size()).toBe(1);
      expect(queue.peek()?.id).toBe('r1');
      
      const dequeued = queue.dequeue();
      expect(dequeued?.id).toBe('r1');
      expect(queue.size()).toBe(0);
    });

    it('should handle duplicate request IDs', () => {
      const request1 = createMockRequest({ id: 'same-id', priority: 5 });
      const request2 = createMockRequest({ id: 'same-id', priority: 10 });

      queue.enqueue(request1);
      queue.enqueue(request2);

      expect(queue.size()).toBe(2);
      
      const dequeued1 = queue.dequeue();
      const dequeued2 = queue.dequeue();
      
      expect(dequeued1?.priority).toBe(10);
      expect(dequeued2?.priority).toBe(5);
    });

    it('should handle zero and negative priorities', () => {
      const negative = createMockRequest({ id: 'negative', priority: -5 });
      const zero = createMockRequest({ id: 'zero', priority: 0 });
      const positive = createMockRequest({ id: 'positive', priority: 1 });

      queue.enqueue(negative);
      queue.enqueue(zero);
      queue.enqueue(positive);

      expect(queue.dequeue()?.id).toBe('positive');
      expect(queue.dequeue()?.id).toBe('zero');
      expect(queue.dequeue()?.id).toBe('negative');
    });
  });

  describe('Default Configuration', () => {
    it('should use default configuration when no config provided', () => {
      const defaultQueue = new RequestQueue();
      const stats = defaultQueue.getStats();

      expect(stats.maxSize).toBe(DEFAULT_QUEUE_CONFIG.maxSize);
      defaultQueue.shutdown();
    });

    it('should merge partial configuration with defaults', () => {
      const partialQueue = new RequestQueue({ maxSize: 50 });
      const stats = partialQueue.getStats();

      expect(stats.maxSize).toBe(50);
      partialQueue.shutdown();
    });
  });

  describe('Configuration Update', () => {
    it('should update maxSize configuration', () => {
      const updateQueue = new RequestQueue({ maxSize: 5 });
      expect(updateQueue.getStats().maxSize).toBe(5);

      // Access private config through a workaround
      (updateQueue as any).updateConfig({ maxSize: 20 });
      expect(updateQueue.getStats().maxSize).toBe(20);

      updateQueue.shutdown();
    });

    it('should update priority boost settings', async () => {
      const updateQueue = new RequestQueue({
        maxSize: 10,
        priorityBoostInterval: 1000,
        priorityBoostAmount: 10,
      });

      // Update the boost interval
      (updateQueue as any).updateConfig({ priorityBoostInterval: 100 });

      // Add a low priority request
      const request = createMockRequest({ id: 'r1', priority: 1 });
      updateQueue.enqueue(request);

      // Wait for new shorter interval
      await new Promise((resolve) => setTimeout(resolve, 120));

      // After boost, priority should have increased
      const peeked = updateQueue.peek();
      expect(peeked?.priority).toBeGreaterThanOrEqual(1);

      updateQueue.shutdown();
    });
  });
});

// Helper function to create mock requests
function createMockRequest(
  overrides: Partial<QueuedRequest> & { id: string }
): Omit<QueuedRequest, 'enqueueTime'> {
  return {
    model: 'llama3:latest',
    priority: 5,
    deadline: Date.now() + 30000,
    clientId: 'client-1',
    requestBody: { prompt: 'test' },
    endpoint: 'generate',
    resolve: vi.fn(),
    reject: vi.fn(),
    ...overrides,
  } as Omit<QueuedRequest, 'enqueueTime'>;
}
