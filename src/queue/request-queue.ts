/**
 * request-queue.ts
 * Holds pending requests when all servers are at capacity and re-dispatches
 * as capacity frees up.
 */

import { logger } from '../utils/logger.js';

export interface QueueEntry<T = unknown> {
  id: string;
  model: string;
  retryFn: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason: unknown) => void;
  enqueuedAt: number;
  priority: number;
  timeoutMs: number;
  signalCapacityCheck: () => Promise<boolean>;
}

export interface RequestQueueOptions {
  maxSize: number;
  drainIntervalMs?: number;
  expirySweepIntervalMs?: number;
  onDispatched?: (entry: QueueEntry, waitMs: number) => void;
  onExpired?: (entry: QueueEntry) => void;
}

export class RequestQueue {
  private readonly entries: QueueEntry[] = [];
  private readonly options: Required<RequestQueueOptions>;
  private drainTimer?: ReturnType<typeof setInterval>;
  private expiryTimer?: ReturnType<typeof setInterval>;
  private drainingModels = new Set<string>();
  private stats = { enqueued: 0, dispatched: 0, expired: 0, failed: 0 };

  constructor(options: RequestQueueOptions) {
    this.options = {
      maxSize: options.maxSize,
      drainIntervalMs: options.drainIntervalMs ?? 500,
      expirySweepIntervalMs: options.expirySweepIntervalMs ?? 5000,
      onDispatched: options.onDispatched ?? (() => {}),
      onExpired: options.onExpired ?? (() => {}),
    };
  }

  start(): void {
    if (!this.drainTimer) {
      this.drainTimer = setInterval(() => this.tryDrain(), this.options.drainIntervalMs);
      this.drainTimer.unref();
    }
    if (!this.expiryTimer) {
      this.expiryTimer = setInterval(() => this.removeExpired(), this.options.expirySweepIntervalMs);
      this.expiryTimer.unref();
    }
  }

  stop(): void {
    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = undefined;
    }
    if (this.expiryTimer) {
      clearInterval(this.expiryTimer);
      this.expiryTimer = undefined;
    }
  }

  enqueueAndWait<T>(entry: Omit<QueueEntry<T>, 'resolve' | 'reject'>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const fullEntry: QueueEntry<T> = {
        ...entry,
        resolve,
        reject,
      } as QueueEntry<T>;

      if (this.entries.length >= this.options.maxSize) {
        reject(new Error(`Queue full (max ${this.options.maxSize})`));
        return;
      }

      this.entries.push(fullEntry as unknown as QueueEntry);
      this.stats.enqueued++;

      this.entries.sort((a, b) => {
        if (a.priority !== b.priority) {return b.priority - a.priority;}
        return a.enqueuedAt - b.enqueuedAt;
      });

      setImmediate(() => this.tryDrain());
    });
  }

  get size(): number {
    return this.entries.length;
  }

  getStats() {
    return { ...this.stats, currentSize: this.entries.length };
  }

  tryDrain(): void {
    if (this.entries.length === 0) {return;}

    const snapshot = [...this.entries];

    for (let i = snapshot.length - 1; i >= 0; i--) {
      const entry = snapshot[i];
      if (this.drainingModels.has(entry.model)) {continue;}

      const index = this.entries.indexOf(entry);
      if (index === -1) {continue;}

      this.drainingModels.add(entry.model);

      if (Date.now() - entry.enqueuedAt >= entry.timeoutMs) {
        this.entries.splice(index, 1);
        this.stats.expired++;
        this.options.onExpired(entry);
        entry.reject(new Error(`Request timed out in queue (${entry.timeoutMs}ms)`));
        this.drainingModels.delete(entry.model);
        continue;
      }

      entry
        .retryFn()
        .then((result) => {
          const idx = this.entries.indexOf(entry);
          if (idx !== -1) {this.entries.splice(idx, 1);}
          this.stats.dispatched++;
          const waitMs = Date.now() - entry.enqueuedAt;
          this.options.onDispatched(entry, waitMs);
          entry.resolve(result);
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          if (
            msg.includes('at capacity') ||
            msg.includes('concurrency') ||
            msg.includes('Retry budget') ||
            msg.includes('retry budget')
          ) {
            // Still at capacity — leave in queue for next drain cycle
          } else {
            const idx = this.entries.indexOf(entry);
            if (idx !== -1) {this.entries.splice(idx, 1);}
            this.stats.failed++;
            entry.reject(err);
          }
        })
        .finally(() => {
          this.drainingModels.delete(entry.model);
        });
    }
  }

  onCapacityFreed(serverId: string, model: string): void {
    if (this.entries.length === 0) {return;}
    setImmediate(() => this.tryDrain());
  }

  private removeExpired(): void {
    const now = Date.now();
    let removed = 0;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (now - entry.enqueuedAt >= entry.timeoutMs) {
        this.entries.splice(i, 1);
        this.stats.expired++;
        this.options.onExpired(entry);
        entry.reject(new Error(`Request timed out in queue (${entry.timeoutMs}ms)`));
        removed++;
      }
    }
  }
}
