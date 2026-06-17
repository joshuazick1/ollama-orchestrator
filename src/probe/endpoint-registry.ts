import { logger } from '../utils/logger.js';

import {
  type ProbeEndpoint,
  EMBEDDING_ENDPOINTS,
  GENERATION_ENDPOINTS,
  EMBEDDING_MODEL_PATTERNS,
} from './types.js';

/**
 * Tracks the capability state of a single probed endpoint on a server.
 *
 * Lifecycle: declare → confirm → (revoke | evict)
 * - declared: endpoint was discovered but not yet confirmed working
 * - confirmed: endpoint responded successfully and is active (lastSeen recent)
 * - failureCount: increments on each probe failure; resets on confirm
 */
export interface EndpointCapability {
  endpoint: ProbeEndpoint;
  declared: boolean;
  confirmed: boolean;
  lastSeen: number;
  failureCount: number;
  consecutiveFailures: number;
}

/**
 * In-memory registry of endpoint capabilities per server.
 *
 * Replaces the `probedEndpoints` field on AIServer with a richer capability model:
 * - tracks declared vs confirmed state
 * - records failure counts for adaptive probing
 * - supports time-based eviction of stale capabilities
 * - infers model type from name to filter active endpoints
 *
 * This is the SOURCE OF TRUTH for what endpoints a server actually serves.
 */
export class EndpointRegistry {
  /**
   * Map of serverId → Map of endpoint → EndpointCapability
   */
  private capabilities = new Map<string, Map<ProbeEndpoint, EndpointCapability>>();

  /**
   * Declare an endpoint capability for a server (discovered but not yet confirmed).
   * If the endpoint already exists, updates declared=true but preserves confirmed state.
   */
  declare(serverId: string, endpoint: ProbeEndpoint): void {
    let serverMap = this.capabilities.get(serverId);
    if (!serverMap) {
      serverMap = new Map();
      this.capabilities.set(serverId, serverMap);
    }

    const existing = serverMap.get(endpoint);
    if (existing) {
      existing.declared = true;
    } else {
      serverMap.set(endpoint, {
        endpoint,
        declared: true,
        confirmed: false,
        lastSeen: 0,
        failureCount: 0,
        consecutiveFailures: 0,
      });
    }
  }

  /**
   * Confirm an endpoint is active (responded successfully).
   * Sets lastSeen = now and resets failureCount.
   */
  confirm(serverId: string, endpoint: ProbeEndpoint): void {
    const cap = this.getCapability(serverId, endpoint);
    if (!cap) {
      this.declare(serverId, endpoint);
      const newCap = this.getCapability(serverId, endpoint);
      if (newCap) {
        newCap.confirmed = true;
        newCap.lastSeen = Date.now();
        newCap.failureCount = 0;
        newCap.consecutiveFailures = 0;
      }
    } else {
      cap.confirmed = true;
      cap.lastSeen = Date.now();
      cap.failureCount = 0;
      cap.consecutiveFailures = 0;
    }
  }

  /**
   * Revoke (remove) a specific endpoint capability for a server.
   */
  revoke(serverId: string, endpoint: ProbeEndpoint): void {
    const serverMap = this.capabilities.get(serverId);
    if (serverMap) {
      serverMap.delete(endpoint);
    }
  }

  /**
   * Revoke all endpoint capabilities for a server (used on server removal).
   */
  revokeAll(serverId: string): void {
    this.capabilities.delete(serverId);
  }

  /**
   * Soft-revoke an endpoint: marks confirmed=false but keeps the entry for inspection.
   * Sets lastSeen=0. Does NOT delete the entry.
   */
  softRevoke(serverId: string, endpoint: ProbeEndpoint): void {
    const cap = this.getCapability(serverId, endpoint);
    if (cap) {
      cap.confirmed = false;
      cap.lastSeen = 0;
      logger.info('Endpoint soft-revoked', { serverId, endpoint, reason: 'soft_revoke' });
    }
  }

  /**
   * Record a probe failure for an endpoint (increments failureCount and consecutiveFailures).
   * Does NOT reset lastSeen or change confirmed state.
   * If threshold is provided and consecutiveFailures >= threshold, auto-soft-revokes.
   */
  recordFailure(serverId: string, endpoint: ProbeEndpoint, threshold?: number): void {
    const cap = this.getCapability(serverId, endpoint);
    if (cap) {
      cap.failureCount++;
      cap.consecutiveFailures++;
      if (threshold !== undefined && cap.consecutiveFailures >= threshold) {
        this.softRevoke(serverId, endpoint);
      }
    }
  }

  /**
   * Get all endpoint capabilities for a server.
   * Returns empty Map if server has no registered capabilities.
   */
  getCapabilities(serverId: string): Map<ProbeEndpoint, EndpointCapability> {
    return this.capabilities.get(serverId) ?? new Map();
  }

  /**
   * Get active endpoints for a model.
   * Returns only endpoints that are confirmed AND within the evictCold threshold.
   * Filters by model type: embedding models get only embedding endpoints,
   * generation models get generation endpoints.
   */
  getActiveEndpoints(serverId: string, model: string): ProbeEndpoint[] {
    const isEmbedding = this.isEmbeddingModel(model);
    const allowedEndpoints = isEmbedding ? EMBEDDING_ENDPOINTS : GENERATION_ENDPOINTS;

    const serverMap = this.capabilities.get(serverId);
    if (!serverMap) {
      return [];
    }

    const active: ProbeEndpoint[] = [];
    for (const endpoint of allowedEndpoints) {
      const cap = serverMap.get(endpoint);
      if (cap && cap.confirmed) {
        active.push(endpoint);
      }
    }
    return active;
  }

  /**
   * Get the consecutive failure count for an endpoint.
   * Returns 0 if endpoint is unknown.
   */
  getConsecutiveFailures(serverId: string, endpoint: ProbeEndpoint): number {
    const cap = this.getCapability(serverId, endpoint);
    return cap?.consecutiveFailures ?? 0;
  }

  /**
   * Reset the consecutive failure count for an endpoint to 0.
   */
  resetConsecutiveFailures(serverId: string, endpoint: ProbeEndpoint): void {
    const cap = this.getCapability(serverId, endpoint);
    if (cap) {
      cap.consecutiveFailures = 0;
    }
  }

  /**
   * Evict capabilities that have not been seen within thresholdMs.
   * Removes confirmed state from stale endpoints (they become declared only).
   */
  evictCold(thresholdMs: number): void {
    const now = Date.now();
    const cutoff = now - thresholdMs;

    for (const serverMap of this.capabilities.values()) {
      for (const [_endpoint, cap] of serverMap.entries()) {
        // Mark as stale if lastSeen is before cutoff (including lastSeen=0 which
        // indicates "never updated since confirmation" with fake timers)
        if (cap.lastSeen < cutoff) {
          cap.confirmed = false;
          cap.lastSeen = 0;
        }
      }
    }
  }

  /**
   * Infer whether a model is an embedding model based on its name.
   * Uses case-insensitive substring matching against known patterns.
   */
  isEmbeddingModel(model: string): boolean {
    const lower = model.toLowerCase();
    for (const pattern of EMBEDDING_MODEL_PATTERNS) {
      if (lower.includes(pattern.toLowerCase())) {
        return true;
      }
    }
    return false;
  }

  /**
   * Infer whether a model is a generation model.
   * Default: true if not an embedding model.
   */
  isGenerationModel(model: string): boolean {
    return !this.isEmbeddingModel(model);
  }

  private getCapability(serverId: string, endpoint: ProbeEndpoint): EndpointCapability | undefined {
    return this.capabilities.get(serverId)?.get(endpoint);
  }
}
