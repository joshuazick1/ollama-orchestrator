import { logger } from './logger.js';

export interface InFlightManagerConfig {
  maxConcurrentPerModel?: number;
  maxConcurrentPerServer?: number;
}

export class InFlightManager {
  private inFlight: Map<string, number> = new Map();
  private inFlightBypass: Map<string, number> = new Map();

  constructor(_config?: InFlightManagerConfig) {}

  incrementInFlight(serverId: string, model: string, bypass: boolean = false): void {
    const key = `${serverId}:${model}`;

    if (bypass) {
      const current = this.inFlightBypass.get(key) ?? 0;
      this.inFlightBypass.set(key, current + 1);
    } else {
      const current = this.inFlight.get(key) ?? 0;
      this.inFlight.set(key, current + 1);
    }

    logger.debug(
      `In-flight incremented for ${key}, bypass: ${bypass}, total: ${this.getInFlight(serverId, model)}`
    );
  }

  decrementInFlight(serverId: string, model: string, bypass: boolean = false): void {
    const key = `${serverId}:${model}`;

    if (bypass) {
      const current = this.inFlightBypass.get(key) ?? 1;
      if (current <= 1) {
        this.inFlightBypass.delete(key);
      } else {
        this.inFlightBypass.set(key, current - 1);
      }
    } else {
      const current = this.inFlight.get(key) ?? 1;
      if (current <= 1) {
        this.inFlight.delete(key);
      } else {
        this.inFlight.set(key, current - 1);
      }
    }

    logger.debug(
      `In-flight decremented for ${key}, bypass: ${bypass}, total: ${this.getInFlight(serverId, model)}`
    );
  }

  getInFlight(serverId: string, model: string): number {
    const key = `${serverId}:${model}`;
    return (this.inFlight.get(key) ?? 0) + (this.inFlightBypass.get(key) ?? 0);
  }

  getTotalInFlight(serverId: string): number {
    let total = 0;

    for (const [key, count] of this.inFlight.entries()) {
      if (key.startsWith(`${serverId}:`)) {
        total += count;
      }
    }

    for (const [key, count] of this.inFlightBypass.entries()) {
      if (key.startsWith(`${serverId}:`)) {
        total += count;
      }
    }

    return total;
  }

  getInFlightByServer(serverId: string): Record<string, number> {
    const result: Record<string, number> = {};

    for (const [key, count] of this.inFlight.entries()) {
      if (key.startsWith(`${serverId}:`)) {
        const model = key.slice(serverId.length + 1);
        result[model] = (result[model] ?? 0) + count;
      }
    }

    for (const [key, count] of this.inFlightBypass.entries()) {
      if (key.startsWith(`${serverId}:`)) {
        const model = key.slice(serverId.length + 1);
        result[model] = (result[model] ?? 0) + count;
      }
    }

    return result;
  }

  getAllInFlight(): Record<string, Record<string, number>> {
    const result: Record<string, Record<string, number>> = {};

    for (const [key, count] of this.inFlight.entries()) {
      const [serverId, model] = key.split(':');
      if (!result[serverId]) {
        result[serverId] = {};
      }
      result[serverId][model] = (result[serverId][model] ?? 0) + count;
    }

    for (const [key, count] of this.inFlightBypass.entries()) {
      const [serverId, model] = key.split(':');
      if (!result[serverId]) {
        result[serverId] = {};
      }
      result[serverId][model] = (result[serverId][model] ?? 0) + count;
    }

    return result;
  }

  getInFlightDetailed(): Record<
    string,
    { total: number; byModel: Record<string, { regular: number; bypass: number }> }
  > {
    const result: Record<
      string,
      { total: number; byModel: Record<string, { regular: number; bypass: number }> }
    > = {};

    // Process regular in-flight requests
    for (const [key, count] of this.inFlight.entries()) {
      const colonIdx = key.indexOf(':');
      const serverId = key.slice(0, colonIdx);
      const model = key.slice(colonIdx + 1);
      if (!result[serverId]) {
        result[serverId] = { total: 0, byModel: {} };
      }
      result[serverId].total += count;
      if (!result[serverId].byModel[model]) {
        result[serverId].byModel[model] = { regular: 0, bypass: 0 };
      }
      result[serverId].byModel[model].regular = count;
    }

    // Process bypass in-flight requests
    for (const [key, count] of this.inFlightBypass.entries()) {
      const colonIdx = key.indexOf(':');
      const serverId = key.slice(0, colonIdx);
      const model = key.slice(colonIdx + 1);
      if (!result[serverId]) {
        result[serverId] = { total: 0, byModel: {} };
      }
      result[serverId].total += count;
      if (!result[serverId].byModel[model]) {
        result[serverId].byModel[model] = { regular: 0, bypass: 0 };
      }
      result[serverId].byModel[model].bypass = count;
    }

    return result;
  }

  clear(): void {
    this.inFlight.clear();
    this.inFlightBypass.clear();
  }

  getActiveServerIds(): string[] {
    const activeServers = new Set<string>();

    for (const key of this.inFlight.keys()) {
      const [serverId] = key.split(':');
      activeServers.add(serverId);
    }

    for (const key of this.inFlightBypass.keys()) {
      const [serverId] = key.split(':');
      activeServers.add(serverId);
    }

    return Array.from(activeServers);
  }

  hasActiveRequests(serverId: string): boolean {
    for (const key of this.inFlight.keys()) {
      if (key.startsWith(`${serverId}:`)) {
        return true;
      }
    }
    for (const key of this.inFlightBypass.keys()) {
      if (key.startsWith(`${serverId}:`)) {
        return true;
      }
    }
    return false;
  }
}

let managerInstance: InFlightManager | undefined;

export function getInFlightManager(): InFlightManager {
  if (!managerInstance) {
    managerInstance = new InFlightManager();
  }
  return managerInstance;
}

export function resetInFlightManager(): void {
  managerInstance = undefined;
}
