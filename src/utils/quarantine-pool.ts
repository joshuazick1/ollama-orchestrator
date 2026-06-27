import { getOperationalStore } from '../storage/operational-store.js';

import { logger } from './logger.js';

export type QuarantineReason = 'honeypot-flagged' | 'manual' | 'auto-low-confidence';

export interface QuarantineEntry {
  serverId: string;
  quarantinedAt: number;
  reason: QuarantineReason;
  evidence: Record<string, unknown> | null;
  expiresAt: number | null;
  consecutiveCleanCycles: number;
  isManual: boolean;
}

class QuarantinePool {
  private entries = new Map<string, QuarantineEntry>();
  private initialized = false;

  initialize(): void {
    if (this.initialized) {
      return;
    }
    const stored = getOperationalStore().getQuarantinedServers();
    for (const entry of stored) {
      this.entries.set(entry.serverId, {
        ...entry,
        reason: entry.reason as QuarantineReason,
      });
    }
    this.initialized = true;
    logger.info(`[QuarantinePool] Initialized with ${this.entries.size} entries`);
  }

  quarantine(
    serverId: string,
    reason: QuarantineReason,
    evidence: Record<string, unknown> | null = null,
    isManual = false
  ): void {
    const entry: QuarantineEntry = {
      serverId,
      quarantinedAt: Date.now(),
      reason,
      evidence,
      expiresAt: null,
      consecutiveCleanCycles: 0,
      isManual,
    };
    this.entries.set(serverId, entry);
    getOperationalStore().quarantineServer({
      ...entry,
      reason: entry.reason as string,
    });
    logger.warn(`[QuarantinePool] Quarantined ${serverId} (reason=${reason}, manual=${isManual})`);
  }

  unquarantine(serverId: string): boolean {
    const existed = this.entries.delete(serverId);
    if (existed) {
      getOperationalStore().deleteQuarantine(serverId);
      logger.warn(`[QuarantinePool] Unquarantined ${serverId}`);
    }
    return existed;
  }

  isQuarantined(serverId: string): boolean {
    return this.entries.has(serverId);
  }

  getEntry(serverId: string): QuarantineEntry | undefined {
    return this.entries.get(serverId);
  }

  getAll(): QuarantineEntry[] {
    return Array.from(this.entries.values());
  }

  recordCleanCycle(serverId: string): number {
    const entry = this.entries.get(serverId);
    if (!entry) {
      return 0;
    }
    entry.consecutiveCleanCycles += 1;
    getOperationalStore().updateQuarantineCleanCycles(serverId, entry.consecutiveCleanCycles);
    return entry.consecutiveCleanCycles;
  }

  resetCleanCycles(serverId: string): void {
    const entry = this.entries.get(serverId);
    if (!entry) {
      return;
    }
    entry.consecutiveCleanCycles = 0;
    getOperationalStore().updateQuarantineCleanCycles(serverId, 0);
  }
}

let instance: QuarantinePool | null = null;

export function getQuarantinePool(): QuarantinePool {
  if (!instance) {
    instance = new QuarantinePool();
  }
  return instance;
}
