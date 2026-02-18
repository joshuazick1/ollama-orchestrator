/**
 * request-queue.ts
 * Priority queue for request management with backpressure
 */

import { logger } from '../utils/logger.js';

export interface QueuedRequest {
  id: string;
  model: string;
  priority: number;
  enqueueTime: number;
  deadline: number;
  clientId?: string;
  requestBody: unknown;
  endpoint: 'generate' | 'chat' | 'embeddings';
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

export interface QueueStats {
  currentSize: number;
  maxSize: number;
  totalQueued: number;
  totalDropped: number;
  avgWaitTime: number;
  paused: boolean;
  byModel: Record<string, number>;
}

export interface QueueConfig {
  maxSize: number;
  timeout: number;
  priorityBoostInterval: number;
  priorityBoostAmount: number;
  maxPriority: number; // Maximum priority value (default: 100)
}

export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  maxSize: 1000,
  timeout: 30000,
  priorityBoostInterval: 5000,
  priorityBoostAmount: 5,
  maxPriority: 100,
};

/**
 * Priority queue implementation using binary heap
 */
export class RequestQueue {
  private queue: QueuedRequest[] = [];
  private config: QueueConfig;
  private stats = {
    totalQueued: 0,
    totalDropped: 0,
    totalWaitTime: 0,
    processedCount: 0,
  };
  private paused = false;
  private boostInterval?: NodeJS.Timeout;

  constructor(config: Partial<QueueConfig> = {}) {
    this.config = { ...DEFAULT_QUEUE_CONFIG, ...config };
    this.startPriorityBoost();
  }

  /**
   * Add request to queue
   */
  enqueue(request: Omit<QueuedRequest, 'enqueueTime'>): boolean {
    if (this.paused) {
      request.reject(new Error('Queue is paused'));
      return false;
    }

    if (this.queue.length >= this.config.maxSize) {
      this.stats.totalDropped++;
      request.reject(new Error('Queue is full'));
      logger.warn(`Request dropped: queue full (${this.config.maxSize})`);
      return false;
    }

    const queuedRequest: QueuedRequest = {
      ...request,
      enqueueTime: Date.now(),
    };

    this.queue.push(queuedRequest);
    this.heapifyUp(this.queue.length - 1);
    this.stats.totalQueued++;

    logger.info(`Request queued`, {
      requestId: request.id,
      model: request.model,
      priority: request.priority,
      queueSize: this.queue.length,
      endpoint: request.endpoint,
    });
    return true;
  }

  /**
   * Remove and return highest priority request
   * Checks deadline and rejects expired requests
   */
  dequeue(): QueuedRequest | undefined {
    while (this.queue.length > 0) {
      const request = this.queue[0];
      const last = this.queue.pop();

      if (this.queue.length > 0 && last) {
        this.queue[0] = last;
        this.heapifyDown(0);
      }

      // Check if deadline has been exceeded
      if (request.deadline > 0 && Date.now() > request.deadline) {
        const waitTime = Date.now() - request.enqueueTime;
        this.stats.totalDropped++;
        request.reject(new Error(`Request deadline exceeded after ${waitTime}ms`));
        logger.warn(`Request deadline exceeded`, {
          requestId: request.id,
          model: request.model,
          waitTime,
          deadline: request.deadline,
        });
        continue; // Skip to next request
      }

      // Update wait time stats
      const waitTime = Date.now() - request.enqueueTime;
      this.stats.totalWaitTime += waitTime;
      this.stats.processedCount++;

      logger.info(`Request dequeued`, {
        requestId: request.id,
        model: request.model,
        waitTime,
        queueSize: this.queue.length,
      });
      return request;
    }

    return undefined;
  }

  /**
   * Peek at highest priority request without removing
   */
  peek(): QueuedRequest | undefined {
    return this.queue[0];
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    const byModel: Record<string, number> = {};
    for (const req of this.queue) {
      byModel[req.model] = (byModel[req.model] || 0) + 1;
    }

    return {
      currentSize: this.queue.length,
      maxSize: this.config.maxSize,
      totalQueued: this.stats.totalQueued,
      totalDropped: this.stats.totalDropped,
      avgWaitTime:
        this.stats.processedCount > 0 ? this.stats.totalWaitTime / this.stats.processedCount : 0,
      paused: this.paused,
      byModel,
    };
  }

  /**
   * Pause queue (reject new requests)
   */
  pause(): void {
    this.paused = true;
    logger.info('Request queue paused');
  }

  /**
   * Resume queue
   */
  resume(): void {
    this.paused = false;
    logger.info('Request queue resumed');
  }

  /**
   * Check if queue is paused
   */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Get current size
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Clear all requests
   */
  clear(): void {
    const count = this.queue.length;
    // Reject all pending requests
    for (const req of this.queue) {
      req.reject(new Error('Queue cleared'));
    }
    this.queue = [];
    logger.info(`Queue cleared (${count} requests rejected)`);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<QueueConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info(`Queue config updated: maxSize=${this.config.maxSize}`);
  }

  /**
   * Shutdown queue
   */
  shutdown(): void {
    if (this.boostInterval) {
      clearInterval(this.boostInterval);
    }
    this.clear();
    logger.info('Request queue shutdown');
  }

  /**
   * Get requests for a specific model
   */
  getRequestsByModel(model: string): QueuedRequest[] {
    return this.queue.filter(req => req.model === model);
  }

  /**
   * Get all queue items with details
   */
  getAllItems(): Array<{
    id: string;
    model: string;
    priority: number;
    enqueueTime: number;
    deadline: number;
    waitTime: number;
    endpoint: string;
    clientId?: string;
  }> {
    const now = Date.now();
    return this.queue.map(req => ({
      id: req.id,
      model: req.model,
      priority: req.priority,
      enqueueTime: req.enqueueTime,
      deadline: req.deadline,
      waitTime: now - req.enqueueTime,
      endpoint: req.endpoint,
      clientId: req.clientId,
    }));
  }

  /**
   * Compare two queue items for priority ordering
   * Returns true if item a has higher priority than item b
   * Uses enqueueTime as tiebreaker for FIFO within same priority (stable sort)
   */
  private hasHigherPriority(a: QueuedRequest, b: QueuedRequest): boolean {
    if (a.priority !== b.priority) {
      return a.priority > b.priority;
    }
    // Same priority: earlier enqueue time = higher priority (FIFO)
    return a.enqueueTime < b.enqueueTime;
  }

  /**
   * Binary heap: heapify up (for insertion)
   * Uses stable comparison that considers enqueueTime for same-priority items
   */
  private heapifyUp(index: number): void {
    if (index === 0) {
      return;
    }

    const parentIndex = Math.floor((index - 1) / 2);
    if (this.hasHigherPriority(this.queue[index], this.queue[parentIndex])) {
      this.swap(parentIndex, index);
      this.heapifyUp(parentIndex);
    }
  }

  /**
   * Binary heap: heapify down (for removal)
   * Uses stable comparison that considers enqueueTime for same-priority items
   */
  private heapifyDown(index: number): void {
    const leftChild = 2 * index + 1;
    const rightChild = 2 * index + 2;
    let largest = index;

    if (
      leftChild < this.queue.length &&
      this.hasHigherPriority(this.queue[leftChild], this.queue[largest])
    ) {
      largest = leftChild;
    }

    if (
      rightChild < this.queue.length &&
      this.hasHigherPriority(this.queue[rightChild], this.queue[largest])
    ) {
      largest = rightChild;
    }

    if (largest !== index) {
      this.swap(index, largest);
      this.heapifyDown(largest);
    }
  }

  /**
   * Swap two elements in queue
   */
  private swap(i: number, j: number): void {
    [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
  }

  /**
   * Start priority boost timer
   * Prevents starvation by boosting priority of old requests
   */
  private startPriorityBoost(): void {
    this.boostInterval = setInterval(() => {
      const now = Date.now();
      for (const req of this.queue) {
        const waitTime = now - req.enqueueTime;
        // Boost priority for requests waiting longer than interval
        if (waitTime > this.config.priorityBoostInterval) {
          req.priority = Math.min(
            this.config.maxPriority,
            req.priority + this.config.priorityBoostAmount
          );
        }
      }
      // Re-heapify after priority changes
      this.rebuildHeap();
    }, this.config.priorityBoostInterval);
  }

  /**
   * Rebuild heap after priority changes
   * Uses Floyd's algorithm for O(n) time complexity:
   * - Start from the last non-leaf node and heapify down each node
   * - This is more efficient than the O(n log n) approach of heapifying up from each node
   *
   * Time complexity: O(n) where n is the number of items in the queue
   * This is optimal for batch priority updates like priority boosting
   */
  private rebuildHeap(): void {
    // Floyd's algorithm: heapify from bottom-up starting at last non-leaf
    // The last non-leaf node is at index floor(n/2) - 1
    for (let i = Math.floor(this.queue.length / 2) - 1; i >= 0; i--) {
      this.heapifyDown(i);
    }
  }
}
