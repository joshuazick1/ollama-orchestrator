import type { TestConnectionResult } from './test-server-capabilities.js';

export type TestStoreEntry = {
  testId: string;
  status: 'running' | 'completed' | 'failed';
  progress: number;
  startedAt: number;
  expiresAt: number;
  result?: TestConnectionResult;
  error?: string;
};

const TTL_MS = 5 * 60 * 1000;

export class TestStore {
  private entries: Map<string, TestStoreEntry> = new Map();
  private cleanupInterval?: ReturnType<typeof setInterval>;

  create(testId: string): TestStoreEntry {
    const now = Date.now();
    const entry: TestStoreEntry = {
      testId,
      status: 'running',
      progress: 0,
      startedAt: now,
      expiresAt: now + TTL_MS,
    };
    this.entries.set(testId, entry);
    return entry;
  }

  get(testId: string): TestStoreEntry | undefined {
    const entry = this.entries.get(testId);
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(testId);
      return undefined;
    }
    return entry;
  }

  update(testId: string, partial: Partial<TestStoreEntry>): void {
    const entry = this.entries.get(testId);
    if (!entry) {
      return;
    }
    Object.assign(entry, partial);
  }

  cleanup(): number {
    const now = Date.now();
    let evicted = 0;
    const keysToDelete: string[] = [];

    for (const [testId, entry] of this.entries) {
      if (now > entry.expiresAt) {
        keysToDelete.push(testId);
      }
    }

    for (const key of keysToDelete) {
      this.entries.delete(key);
      evicted++;
    }

    return evicted;
  }

  getOrphanTestIds(): string[] {
    const now = Date.now();
    const orphans: string[] = [];

    for (const [testId, entry] of this.entries) {
      if (entry.status === 'running' && now - entry.startedAt > TTL_MS) {
        orphans.push(testId);
      }
    }

    return orphans;
  }

  startPeriodicCleanup(intervalMs: number = 60 * 1000): void {
    this.stopPeriodicCleanup();
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, intervalMs);
    this.cleanupInterval.unref();
  }

  stopPeriodicCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }
}
