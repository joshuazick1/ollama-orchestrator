/**
 * RuntimeSnapshotV1 — versioned DTO for the /api/orchestrator/events SSE stream.
 *
 * Schema version '1' is the initial coherent contract. All seven data groups
 * that the backend emits are formalised here so the frontend can consume them
 * with typed confidence and the payload is self-describing for forward compat.
 *
 * Additive changes only — no field is ever removed or renamed in a later
 * schema version.
 */

import type { TupleState } from '../probe/probe-orchestrator.js';
import type { TupleKey } from '../probe/types.js';

export interface RuntimeSnapshotV1 {
  /** Discriminator so consumers can branch on schema version without type gymnastics. */
  schemaVersion: '1';
  /** Monotonically increasing integer. Each SSE event increments by 1. */
  sequence: number;
  /** Epoch milliseconds at which this snapshot was emitted. */
  timestamp: number;

  // ── Group a) stats ────────────────────────────────────────────────────────
  stats: {
    totalServers: number;
    healthyServers: number;
    totalModels: number;
    inFlightRequests: number;
    circuitBreakers: Record<string, { state: string; failureCount: number }>;
    circuitBreakersByState: Record<string, number>;
  };

  // ── Group b) metrics.global ────────────────────────────────────────────────
  metrics: {
    timestamp: number;
    global: {
      totalRequests: number;
      errorRate: number;
      avgLatency: number;
      requestsPerSecond: number;
    };
  };

  // ── Group c) legacy circuitBreakers count (root level, backward compat) ─────
  circuitBreakers: number;

  // ── Group d) servers ───────────────────────────────────────────────────────
  servers: Array<{
    id: string;
    url: string;
    healthy: boolean;
    lastResponseTime: number;
    models: string[];
    maxConcurrency: number;
    version: string;
    supportsOllama: boolean;
    supportsV1: boolean;
    v1Models: string[];
  }>;

  // ── Group e) modelMap ─────────────────────────────────────────────────────
  modelMap: {
    modelToServers: Record<string, string[]>;
    serverToModels: Record<string, string[]>;
  };

  // ── Group f) inFlight ──────────────────────────────────────────────────────
  inFlight: {
    total: number;
    inFlight: Array<{
      serverId: string;
      serverUrl?: string;
      healthy: boolean;
      total: number;
      byModel: Record<string, { regular: number; bypass: number }>;
      streamingRequests: Array<{
        id: string;
        serverId: string;
        model: string;
        startTime: number;
        chunkCount: number;
        lastChunkTime: number;
        isStalled: boolean;
      }>;
    }>;
  };

  // ── Group g) circuitBreakerDetails (additive rich map) ────────────────────
  /** Full TupleState map — richer than the stats-level circuitBreakers summary. */
  circuitBreakerDetails: Record<TupleKey, TupleState>;
}
