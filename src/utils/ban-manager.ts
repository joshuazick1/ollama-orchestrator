import { getConfigManager } from '../config/config.js';
import { logger } from './logger.js';

export interface FailureTracker {
  count: number;
  lastSuccess: number;
}

export interface BanInfo {
  serverId: string;
  model: string;
  type: 'permanent' | 'cooldown';
  timestamp?: number;
  expiresAt?: number;
}

export interface BanManagerState {
  failureCooldown: Record<string, number>;
  permanentBan: string[];
  serverFailureCount: Record<string, number>;
  modelFailureTracker: Record<string, FailureTracker>;
}

export interface BanManagerConfig {
  failureCooldownMs: number;
}

let managerInstance: BanManager | undefined;

export class BanManager {
  private failureCooldown: Map<string, number> = new Map();
  private permanentBan: Set<string> = new Set();
  private serverFailureCount: Map<string, number> = new Map();
  private modelFailureTracker: Map<string, FailureTracker> = new Map();
  private config: BanManagerConfig;

  constructor(config?: Partial<BanManagerConfig>) {
    const defaultConfig = getConfigManager().getConfig();
    this.config = {
      failureCooldownMs: defaultConfig.cooldown?.failureCooldownMs ?? 120000,
      ...config,
    };
  }

  isInCooldown(serverId: string, model: string): boolean {
    const key = `${serverId}:${model}`;
    const lastFail = this.failureCooldown.get(key);
    if (!lastFail) return false;
    return Date.now() - lastFail < this.config.failureCooldownMs;
  }

  markFailure(serverId: string, model: string): void {
    const key = `${serverId}:${model}`;
    this.failureCooldown.set(key, Date.now());
    const ban = `${serverId}:${model}`;
    if (this.permanentBan.has(ban)) {
      return;
    }
  }

  clearCooldown(serverId: string, model: string): void {
    if (!model) {
      // Clear all cooldowns for server
      const keysToDelete: string[] = [];
      for (const key of this.failureCooldown.keys()) {
        if (key.startsWith(`${serverId}:`)) {
          keysToDelete.push(key);
        }
      }
      for (const key of keysToDelete) {
        this.failureCooldown.delete(key);
      }
    } else {
      const key = `${serverId}:${model}`;
      this.failureCooldown.delete(key);
    }
  }

  clearAllCooldowns(): void {
    this.failureCooldown.clear();
    logger.info('All cooldowns cleared');
  }

  addBan(serverId: string, model: string): void {
    const key = `${serverId}:${model}`;
    this.permanentBan.add(key);
    logger.info(`Server ${serverId} banned for model ${model}`);
  }

  removeBan(serverId: string, model: string): boolean {
    const key = `${serverId}:${model}`;
    const existed = this.permanentBan.has(key);
    if (existed) {
      this.permanentBan.delete(key);
      logger.info(`Removed ban for ${key}`);
    }
    return existed;
  }

  removeServerBans(serverId: string): number {
    let removed = 0;
    const toRemove: string[] = [];
    for (const ban of this.permanentBan) {
      if (ban.startsWith(`${serverId}:`)) {
        toRemove.push(ban);
      }
    }
    for (const ban of toRemove) {
      this.permanentBan.delete(ban);
      removed++;
    }
    logger.info(`Removed ${removed} bans for server ${serverId}`);
    return removed;
  }

  removeModelBans(model: string): number {
    let removed = 0;
    const toRemove: string[] = [];
    for (const ban of this.permanentBan) {
      const [, modelPart] = ban.split(':');
      if (modelPart === model) {
        toRemove.push(ban);
      }
    }
    for (const ban of toRemove) {
      this.permanentBan.delete(ban);
      removed++;
    }
    logger.info(`Removed ${removed} bans for model ${model}`);
    return removed;
  }

  clearAllBans(): void {
    const count = this.permanentBan.size;
    this.permanentBan.clear();
    logger.info(`Cleared ${count} permanent bans`);
  }

  getBanDetails(): BanInfo[] {
    const details: BanInfo[] = [];
    for (const ban of this.permanentBan) {
      const [serverId, model] = ban.split(':');
      details.push({
        serverId,
        model,
        type: 'permanent',
        timestamp: Date.now(),
      });
    }
    for (const [key, timestamp] of this.failureCooldown) {
      const [serverId, model] = key.split(':');
      const expiresAt = timestamp + this.config.failureCooldownMs;
      if (Date.now() < expiresAt) {
        details.push({
          serverId,
          model,
          type: 'cooldown',
          timestamp,
          expiresAt,
        });
      }
    }
    return details;
  }

  isBanned(serverId: string, model: string): boolean {
    return this.permanentBan.has(`${serverId}:${model}`);
  }

  recordSuccess(serverId: string, model?: string): void {
    if (model) {
      const key = `${serverId}:${model}`;
      this.modelFailureTracker.delete(key);
    }
    this.serverFailureCount.delete(serverId);
  }

  recordFailure(serverId: string, model?: string): void {
    const count = (this.serverFailureCount.get(serverId) ?? 0) + 1;
    this.serverFailureCount.set(serverId, count);
    if (model) {
      const key = `${serverId}:${model}`;
      const tracker = this.modelFailureTracker.get(key) || { count: 0, lastSuccess: 0 };
      tracker.count++;
      this.modelFailureTracker.set(key, tracker);
    }
  }

  getFailureCount(serverId: string): number {
    return this.serverFailureCount.get(serverId) ?? 0;
  }

  resetFailureCount(serverId: string): void {
    this.serverFailureCount.delete(serverId);
  }

  getModelFailureCount(serverId: string, model: string): number {
    const key = `${serverId}:${model}`;
    return this.modelFailureTracker.get(key)?.count ?? 0;
  }

  getCooldownStatus(serverId: string, model: string): { inCooldown: boolean; remainingMs: number } {
    const key = `${serverId}:${model}`;
    const timestamp = this.failureCooldown.get(key);
    if (!timestamp) {
      return { inCooldown: false, remainingMs: 0 };
    }
    const remaining = timestamp + this.config.failureCooldownMs - Date.now();
    return {
      inCooldown: remaining > 0,
      remainingMs: Math.max(0, remaining),
    };
  }

  cleanupExpiredCooldowns(): number {
    const now = Date.now();
    let cleaned = 0;
    const keysToDelete: string[] = [];

    for (const [key, timestamp] of this.failureCooldown) {
      if (timestamp + this.config.failureCooldownMs <= now) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.failureCooldown.delete(key);
      cleaned++;
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} expired cooldowns`);
    }

    return cleaned;
  }

  loadState(state: BanManagerState): void {
    if (state.failureCooldown) {
      this.failureCooldown = new Map(Object.entries(state.failureCooldown));
    }
    if (state.permanentBan) {
      this.permanentBan = new Set(state.permanentBan);
    }
    if (state.serverFailureCount) {
      this.serverFailureCount = new Map(Object.entries(state.serverFailureCount));
    }
    if (state.modelFailureTracker) {
      this.modelFailureTracker = new Map(Object.entries(state.modelFailureTracker));
    }
    logger.info('BanManager state loaded');
  }

  getState(): BanManagerState {
    return {
      failureCooldown: Object.fromEntries(this.failureCooldown),
      permanentBan: Array.from(this.permanentBan),
      serverFailureCount: Object.fromEntries(this.serverFailureCount),
      modelFailureTracker: Object.fromEntries(this.modelFailureTracker),
    };
  }
}

export function getBanManager(): BanManager {
  if (!managerInstance) {
    managerInstance = new BanManager();
  }
  return managerInstance;
}

export function resetBanManager(): void {
  managerInstance = undefined;
}
