import { logger } from './logger.js';

export interface InFlightManagerConfig {
  maxConcurrentPerModel?: number;
  maxConcurrentPerServer?: number;
}

/**
 * Individual streaming request progress tracking
 */
export interface StreamingRequestProgress {
  id: string;
  serverId: string;
  model: string;
  startTime: number;
  chunkCount: number;
  lastChunkTime: number;
  isStalled: boolean;
}

export class InFlightManager {
  private inFlight: Map<string, number> = new Map();
  private inFlightBypass: Map<string, number> = new Map();
  private streamingRequests: Map<string, StreamingRequestProgress> = new Map();

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
    this.streamingRequests.clear();
  }

  /**
   * Add a streaming request for tracking
   */
  addStreamingRequest(requestId: string, serverId: string, model: string): void {
    this.streamingRequests.set(requestId, {
      id: requestId,
      serverId,
      model,
      startTime: Date.now(),
      chunkCount: 0,
      lastChunkTime: Date.now(),
      isStalled: false,
    });
    logger.debug(`Added streaming request ${requestId} for ${serverId}:${model}`);
  }

  /**
   * Update chunk progress for a streaming request
   */
  updateChunkProgress(requestId: string, chunkCount: number): void {
    const request = this.streamingRequests.get(requestId);
    if (request) {
      request.chunkCount = chunkCount;
      request.lastChunkTime = Date.now();
      request.isStalled = false;
    }
  }

  /**
   * Mark a streaming request as stalled
   */
  markStalled(requestId: string): void {
    const request = this.streamingRequests.get(requestId);
    if (request) {
      request.isStalled = true;
    }
  }

  /**
   * Remove a streaming request (when completed)
   */
  removeStreamingRequest(requestId: string): StreamingRequestProgress | undefined {
    const removed = this.streamingRequests.get(requestId);
    this.streamingRequests.delete(requestId);
    return removed;
  }

  /**
   * Get progress for a specific streaming request
   */
  getStreamingRequestProgress(requestId: string): StreamingRequestProgress | undefined {
    return this.streamingRequests.get(requestId);
  }

  /**
   * Get all streaming requests for a server
   */
  getStreamingRequestsForServer(serverId: string): StreamingRequestProgress[] {
    const requests: StreamingRequestProgress[] = [];
    for (const request of this.streamingRequests.values()) {
      if (request.serverId === serverId) {
        requests.push(request);
      }
    }
    return requests;
  }

  /**
   * Get all streaming requests
   */
  getAllStreamingRequests(): StreamingRequestProgress[] {
    return Array.from(this.streamingRequests.values());
  }

  /**
   * Get streaming requests grouped by server
   */
  getStreamingRequestsByServer(): Record<string, StreamingRequestProgress[]> {
    const result: Record<string, StreamingRequestProgress[]> = {};
    for (const request of this.streamingRequests.values()) {
      if (!result[request.serverId]) {
        result[request.serverId] = [];
      }
      result[request.serverId].push(request);
    }
    return result;
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
