import { logger } from './logger.js';

export interface InFlightManagerConfig {
  maxConcurrentPerModel?: number;
  maxConcurrentPerServer?: number;
  promptTokenWeight?: number;
  outputTokenWeight?: number;
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
  accumulatedText: string; // Accumulated text chunks for handoff
  lastContext?: number[]; // Ollama context array for continuation
  originalPrompt?: string; // Original prompt for retry (generate endpoint)
  originalMessages?: unknown[]; // Original messages array for retry (chat endpoint)
  protocol: 'ollama' | 'openai' | 'anthropic'; // Track protocol for handoff logic
  endpoint: 'generate' | 'chat'; // Track endpoint for handoff logic
  handoffCount: number; // Number of handoff attempts made
  hasReceivedFirstChunk: boolean; // Whether first chunk has been received (stall detection applies after this)
}

export class InFlightManager {
  private inFlight: Map<string, number> = new Map();
  private inFlightBypass: Map<string, number> = new Map();
  private streamingRequests: Map<string, StreamingRequestProgress> = new Map();
  private cleanupInterval?: ReturnType<typeof setInterval>;
  private cleanedUpStreamingRequestIds: Set<string> = new Set();
  private cleanupsByReason: Map<string, number> = new Map();
  private leaksPrevented: number = 0;
  private staleSweepsByReason: Map<string, number> = new Map();
  private tokenWeightedLoad: Map<string, number> = new Map();
  private promptTokenWeight: number;
  private outputTokenWeight: number;

  constructor(config?: InFlightManagerConfig) {
    this.cleanupsByReason.set('client_disconnect', 0);
    this.cleanupsByReason.set('stale_sweep', 0);
    this.cleanupsByReason.set('normal_completion', 0);
    this.promptTokenWeight = config?.promptTokenWeight ?? 1.0;
    this.outputTokenWeight = config?.outputTokenWeight ?? 4.0;
  }

  private tokenWeightedKey(serverId: string, model: string): string {
    return `${serverId}:${model}`;
  }

  startPeriodicCleanup(intervalMs: number = 60_000, maxAgeMs: number = 10 * 60 * 1000): void {
    this.stopPeriodicCleanup();
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleStreamingRequests(maxAgeMs);
    }, intervalMs);
    this.cleanupInterval.unref();
  }

  stopPeriodicCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

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
      const current = this.inFlightBypass.get(key);
      if (current === undefined) {
        logger.warn(`decrementInFlight for ${key} but key does not exist in bypass map`);
        return;
      }
      if (current <= 1) {
        this.inFlightBypass.delete(key);
      } else {
        this.inFlightBypass.set(key, current - 1);
      }
    } else {
      const current = this.inFlight.get(key);
      if (current === undefined) {
        logger.warn(`decrementInFlight for ${key} but key does not exist`);
        return;
      }
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

  /**
   * Increment in-flight with token-weighted load tracking.
   * Adds weighted token contribution to tokenWeightedLoad map and also increments regular counter.
   */
  incrementInFlightWithTokens(
    serverId: string,
    model: string,
    promptTokens: number,
    outputTokens: number,
    bypass: boolean = false
  ): void {
    const k = this.tokenWeightedKey(serverId, model);
    const weight = promptTokens * this.promptTokenWeight + outputTokens * this.outputTokenWeight;
    const currentWeighted = this.tokenWeightedLoad.get(k) ?? 0;
    this.tokenWeightedLoad.set(k, currentWeighted + weight);

    // Also increment the simple counter for backward compat
    this.incrementInFlight(serverId, model, bypass);

    logger.debug(
      `Token-weighted in-flight incremented for ${k}, weight: ${weight}, total weighted: ${this.tokenWeightedLoad.get(k)}`
    );
  }

  /**
   * Decrement in-flight with token-weighted load tracking.
   * Subtracts weighted token contribution from tokenWeightedLoad map and also decrements regular counter.
   * Weighted load is clamped to 0 to prevent negative values.
   */
  decrementInFlightWithTokens(
    serverId: string,
    model: string,
    promptTokens: number,
    outputTokens: number,
    bypass: boolean = false
  ): void {
    const k = this.tokenWeightedKey(serverId, model);
    const weight = promptTokens * this.promptTokenWeight + outputTokens * this.outputTokenWeight;
    const currentWeighted = this.tokenWeightedLoad.get(k) ?? 0;
    this.tokenWeightedLoad.set(k, Math.max(0, currentWeighted - weight));

    // Also decrement the simple counter
    this.decrementInFlight(serverId, model, bypass);

    logger.debug(
      `Token-weighted in-flight decremented for ${k}, weight: ${weight}, total weighted: ${this.tokenWeightedLoad.get(k)}`
    );
  }

  /**
   * Get token-weighted load for a specific server:model combination.
   * Returns the sum of (promptTokens * promptTokenWeight + outputTokens * outputTokenWeight)
   * for all in-flight requests on this server:model.
   */
  getTokenWeightedLoad(serverId: string, model: string): number {
    return this.tokenWeightedLoad.get(this.tokenWeightedKey(serverId, model)) ?? 0;
  }

  /**
   * Get total token-weighted load across all models for a specific server.
   * Sums all token-weighted load entries that start with the serverId prefix.
   */
  getTotalTokenWeightedLoad(serverId: string): number {
    let total = 0;
    const prefix = `${serverId}:`;
    for (const [key, load] of this.tokenWeightedLoad.entries()) {
      if (key.startsWith(prefix)) {
        total += load;
      }
    }
    return total;
  }

  getInFlight(serverId: string, model: string): number {
    const key = `${serverId}:${model}`;
    return (this.inFlight.get(key) ?? 0) + (this.inFlightBypass.get(key) ?? 0);
  }

  /**
   * Get count for a specific server:model combination
   */
  getCount(serverId: string, model: string): number {
    const key = `${serverId}:${model}`;
    return (this.inFlight.get(key) ?? 0) + (this.inFlightBypass.get(key) ?? 0);
  }

  /**
   * Get total number of entries across both maps
   */
  getTotalEntries(): number {
    return this.inFlight.size + this.inFlightBypass.size;
  }

  /**
   * Atomically check and increment in-flight count if it wouldn't exceed maxConcurrency
   * Returns true if increment was successful, false if it would exceed the limit
   */
  tryIncrementInFlight(
    serverId: string,
    model: string,
    maxConcurrency: number,
    bypass: boolean = false
  ): boolean {
    const key = `${serverId}:${model}`;
    // REC-64: check total in-flight for server (not per-model) to match candidate filtering
    const totalCurrent = this.getTotalInFlight(serverId);

    if (totalCurrent >= maxConcurrency) {
      return false;
    }

    // Now increment since we know we're under the limit
    if (bypass) {
      const currentBypass = this.inFlightBypass.get(key) ?? 0;
      this.inFlightBypass.set(key, currentBypass + 1);
    } else {
      const currentRegular = this.inFlight.get(key) ?? 0;
      this.inFlight.set(key, currentRegular + 1);
    }

    logger.debug(
      `In-flight tryIncrement successful for ${key}, bypass: ${bypass}, total: ${this.getInFlight(serverId, model)}`
    );

    return true;
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

  /**
   * Returns the total number of in-flight requests across all servers and models.
   * Used by MetricsStore to find low-traffic windows for rollup computation.
   */
  getGlobalInFlightCount(): number {
    let total = 0;
    for (const count of this.inFlight.values()) {
      total += count;
    }
    for (const count of this.inFlightBypass.values()) {
      total += count;
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
    this.cleanedUpStreamingRequestIds.clear();
    this.cleanupsByReason.set('client_disconnect', 0);
    this.cleanupsByReason.set('stale_sweep', 0);
    this.cleanupsByReason.set('normal_completion', 0);
    this.leaksPrevented = 0;
    this.staleSweepsByReason.clear();
  }

  /**
   * Add a streaming request for tracking
   */
  addStreamingRequest(
    requestId: string,
    serverId: string,
    model: string,
    protocol: 'ollama' | 'openai' | 'anthropic' = 'ollama',
    endpoint: 'generate' | 'chat' = 'generate',
    originalPrompt?: string,
    originalMessages?: unknown[]
  ): void {
    this.streamingRequests.set(requestId, {
      id: requestId,
      serverId,
      model,
      startTime: Date.now(),
      chunkCount: 0,
      lastChunkTime: Date.now(),
      isStalled: false,
      accumulatedText: '',
      originalPrompt,
      originalMessages,
      protocol,
      endpoint,
      handoffCount: 0,
      hasReceivedFirstChunk: false,
    });
    // Gated debug: include a short caller stack to help correlate where requests are registered
    const stack = new Error().stack
      ?.split('\n')
      .slice(2, 6)
      .map(s => s.trim());
    logger.debug(`Added streaming request ${requestId} for ${serverId}:${model}`, {
      caller: stack,
      protocol,
      endpoint,
    });
  }

  /**
   * Update chunk progress for a streaming request
   */
  updateChunkProgress(
    requestId: string,
    chunkCount: number,
    accumulatedText?: string,
    context?: number[]
  ): void {
    const request = this.streamingRequests.get(requestId);
    if (request) {
      request.chunkCount = chunkCount;
      request.lastChunkTime = Date.now();
      request.isStalled = false;
      request.hasReceivedFirstChunk = true;
      if (accumulatedText !== undefined) {
        request.accumulatedText = accumulatedText;
      }
      if (context !== undefined) {
        request.lastContext = context;
      }
      logger.debug('InFlightManager.updateChunkProgress updated request', {
        requestId,
        chunkCount: request.chunkCount,
        serverId: request.serverId,
        model: request.model,
        hasReceivedFirstChunk: request.hasReceivedFirstChunk,
        accumulatedLength: request.accumulatedText.length,
      });
    } else {
      // When request not found, log a short caller stack and current tracked IDs
      const stack = new Error().stack
        ?.split('\n')
        .slice(2, 6)
        .map(s => s.trim());
      const trackedIds = Array.from(this.streamingRequests.keys());
      logger.debug('InFlightManager.updateChunkProgress: request not found', {
        requestId,
        chunkCount,
        caller: stack,
        trackedRequestCount: trackedIds.length,
        trackedRequestIds: trackedIds.slice(0, 20), // cap to avoid huge logs
      });
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
    if (removed) {
      this.streamingRequests.delete(requestId);
      const prev = this.cleanupsByReason.get('normal_completion') ?? 0;
      this.cleanupsByReason.set('normal_completion', prev + 1);
    }
    return removed;
  }

  cleanupInFlightTracking(
    serverId: string,
    model: string,
    streamingRequestId?: string,
    abortController?: AbortController,
    reason: 'client_disconnect' | 'stale_sweep' | 'normal_completion' = 'client_disconnect'
  ): {
    inFlightDecremented: boolean;
    streamingRequestRemoved: boolean;
    upstreamAborted: boolean;
    alreadyCleaned: boolean;
  } {
    const result = {
      inFlightDecremented: false,
      streamingRequestRemoved: false,
      upstreamAborted: false,
      alreadyCleaned: false,
    };

    if (streamingRequestId && this.cleanedUpStreamingRequestIds.has(streamingRequestId)) {
      result.alreadyCleaned = true;
      if (abortController && !abortController.signal.aborted) {
        try {
          abortController.abort();
          result.upstreamAborted = true;
        } catch (e) {
          logger.debug('AbortController.abort() threw during cleanup (idempotent path)', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      return result;
    }

    if (streamingRequestId) {
      const removed = this.streamingRequests.get(streamingRequestId);
      if (removed) {
        this.streamingRequests.delete(streamingRequestId);
        this.cleanedUpStreamingRequestIds.add(streamingRequestId);
        result.streamingRequestRemoved = true;
        const totalInFlight = this.getInFlight(serverId, model);
        if (totalInFlight > 0) {
          const key = `${serverId}:${model}`;
          const regular = this.inFlight.get(key) ?? 0;
          if (regular > 0) {
            if (regular <= 1) {
              this.inFlight.delete(key);
            } else {
              this.inFlight.set(key, regular - 1);
            }
            result.inFlightDecremented = true;
          } else {
            const bypass = this.inFlightBypass.get(key) ?? 0;
            if (bypass > 0) {
              if (bypass <= 1) {
                this.inFlightBypass.delete(key);
              } else {
                this.inFlightBypass.set(key, bypass - 1);
              }
              result.inFlightDecremented = true;
            }
          }
        }
        const prev = this.cleanupsByReason.get(reason) ?? 0;
        this.cleanupsByReason.set(reason, prev + 1);
        logger.info('In-flight tracking cleaned up', {
          reason,
          serverId,
          model,
          streamingRequestId,
          chunkCount: removed.chunkCount,
          inFlightDecremented: result.inFlightDecremented,
        });
      } else {
        result.alreadyCleaned = true;
        this.cleanedUpStreamingRequestIds.add(streamingRequestId);
      }
    } else {
      const totalInFlight = this.getInFlight(serverId, model);
      if (totalInFlight > 0) {
        const key = `${serverId}:${model}`;
        const regular = this.inFlight.get(key) ?? 0;
        if (regular > 0) {
          if (regular <= 1) {
            this.inFlight.delete(key);
          } else {
            this.inFlight.set(key, regular - 1);
          }
          result.inFlightDecremented = true;
        } else {
          const bypass = this.inFlightBypass.get(key) ?? 0;
          if (bypass > 0) {
            if (bypass <= 1) {
              this.inFlightBypass.delete(key);
            } else {
              this.inFlightBypass.set(key, bypass - 1);
            }
            result.inFlightDecremented = true;
          }
        }
      }
      const prev = this.cleanupsByReason.get(reason) ?? 0;
      this.cleanupsByReason.set(reason, prev + 1);
    }

    if (abortController && !abortController.signal.aborted) {
      try {
        abortController.abort();
        result.upstreamAborted = true;
      } catch (e) {
        logger.debug('AbortController.abort() threw during cleanup', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return result;
  }

  getCleanupStats(): {
    cleanupsByReason: Record<string, number>;
    leaksPrevented: number;
    staleSweepsByReason: Record<string, number>;
  } {
    return {
      cleanupsByReason: Object.fromEntries(this.cleanupsByReason),
      leaksPrevented: this.leaksPrevented,
      staleSweepsByReason: Object.fromEntries(this.staleSweepsByReason),
    };
  }

  recordLeakPrevented(count: number = 1): void {
    if (count > 0) {
      this.leaksPrevented += count;
    }
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

  /**
   * Get all stalled streaming requests (that have received at least one chunk)
   */
  getStalledRequests(): StreamingRequestProgress[] {
    const stalled: StreamingRequestProgress[] = [];
    for (const request of this.streamingRequests.values()) {
      if (request.isStalled && request.hasReceivedFirstChunk) {
        stalled.push(request);
      }
    }
    return stalled;
  }

  /**
   * Check if a server has any stalled requests
   */
  hasStalledRequests(serverId: string, model?: string): boolean {
    for (const request of this.streamingRequests.values()) {
      if (request.isStalled && request.serverId === serverId) {
        if (model === undefined || request.model === model) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Get count of stalled requests for a server:model combination
   */
  getStalledRequestCount(serverId: string, model?: string): number {
    let count = 0;
    for (const request of this.streamingRequests.values()) {
      if (request.isStalled && request.serverId === serverId) {
        if (model === undefined || request.model === model) {
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Increment handoff count for a request
   */
  incrementHandoffCount(requestId: string): void {
    const request = this.streamingRequests.get(requestId);
    if (request) {
      request.handoffCount++;
      logger.debug('Incremented handoff count', {
        requestId,
        handoffCount: request.handoffCount,
      });
    }
  }

  /**
   * Get requests that may be stalled based on time since last chunk
   * Only considers requests that have received at least one chunk
   */
  getPotentiallyStalledRequests(stallThresholdMs: number): StreamingRequestProgress[] {
    const now = Date.now();
    const potentiallyStalled: StreamingRequestProgress[] = [];
    for (const request of this.streamingRequests.values()) {
      if (request.hasReceivedFirstChunk && !request.isStalled) {
        if (now - request.lastChunkTime > stallThresholdMs) {
          potentiallyStalled.push(request);
        }
      }
    }
    return potentiallyStalled;
  }

  /**
   * Remove streaming requests that have been running longer than maxAgeMs.
   * Prevents leaked entries from accumulating when streams crash or disconnect
   * without proper cleanup.
   */
  cleanupStaleStreamingRequests(maxAgeMs: number = 10 * 60 * 1000): number {
    const now = Date.now();
    const staleEntries: Array<{ id: string; request: StreamingRequestProgress }> = [];

    for (const [id, request] of this.streamingRequests) {
      if (now - request.startTime > maxAgeMs) {
        staleEntries.push({ id, request });
      }
    }

    for (const { id, request } of staleEntries) {
      this.streamingRequests.delete(id);
      this.cleanedUpStreamingRequestIds.add(id);
      const key = `${request.serverId}:${request.model}`;
      const regular = this.inFlight.get(key) ?? 0;
      if (regular > 0) {
        if (regular <= 1) {
          this.inFlight.delete(key);
        } else {
          this.inFlight.set(key, regular - 1);
        }
      } else {
        const bypass = this.inFlightBypass.get(key) ?? 0;
        if (bypass > 0) {
          if (bypass <= 1) {
            this.inFlightBypass.delete(key);
          } else {
            this.inFlightBypass.set(key, bypass - 1);
          }
        }
      }
    }

    if (staleEntries.length > 0) {
      this.leaksPrevented += staleEntries.length;
      const prev = this.cleanupsByReason.get('stale_sweep') ?? 0;
      this.cleanupsByReason.set('stale_sweep', prev + staleEntries.length);
      logger.warn(`Cleaned up ${staleEntries.length} stale streaming request(s)`, {
        requestIds: staleEntries.slice(0, 10).map(e => e.id),
      });
    }

    return staleEntries.length;
  }
}

let managerInstance: InFlightManager | undefined;

export function getInFlightManager(): InFlightManager {
  if (!managerInstance) {
    managerInstance = new InFlightManager();
    managerInstance.startPeriodicCleanup();
  }
  return managerInstance;
}

export function resetInFlightManager(): void {
  if (managerInstance) {
    managerInstance.stopPeriodicCleanup();
  }
  managerInstance = undefined;
}
