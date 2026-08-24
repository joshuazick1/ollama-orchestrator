/**
 * model-availability-provider.ts
 * Read contracts for loaded-model / runtime-health state.
 *
 * Provides a stable seam between the load-balancer scoring logic and the
 * underlying state sources (ps-poll, hardware snapshot, etc.).
 * The orchestrator owns the provider instance; the load-balancer only
 * reads through it so scoring always reflects owned state.
 */

import type { PsPollCoordinator } from './ps-poll-coordinator.js';

/**
 * Source of a loaded-model snapshot.
 * - 'psPoll': fresh data from the ps-poll coordinator (live)
 * - 'warmup': server self-reported via warmup response
 * - 'fallback': ps-poll data is stale (> 2× interval) — treat as uncertain
 */
export type LoadedModelSource = 'psPoll' | 'warmup' | 'fallback' | 'hardware';

/**
 * Snapshot of a model currently loaded on a server.
 * Returned by ModelAvailabilityProvider.getLoadedSnapshot().
 */
export interface LoadedModelSnapshot {
  serverId: string;
  model: string;
  /** When the server reported this model loaded */
  loadedAt: number;
  /** Estimated VRAM footprint in bytes (0 if unknown) */
  sizeVram: number;
  /** When the model is expected to be unloaded (0 if unknown) */
  expiresAt: number;
  /** When the provider last refreshed this snapshot */
  lastPolledAt: number;
  /** Provenance of this snapshot */
  source: LoadedModelSource;
}

/**
 * Interface for providing loaded-model state to the load balancer.
 * Implementations may read from ps-poll, hardware snapshots, or hybrid sources.
 */
export interface ModelAvailabilityProvider {
  /**
   * Get a snapshot of a loaded model, or undefined if not loaded.
   * The snapshot's `source` field indicates freshness:
   * - 'psPoll' = fresh from the poll coordinator
   * - 'fallback' = stale (> 2× interval since last poll); treat as uncertain
   */
  getLoadedSnapshot(serverId: string, model: string): LoadedModelSnapshot | undefined;

  /**
   * Get the set of models currently loaded on a given server.
   * The returned Set is a live view; do not mutate it.
   */
  getLoadedModels(serverId: string): Set<string>;
}

/**
 * PsPollBackedProvider — reads loaded-model state from PsPollCoordinator.
 *
 * State is considered stale when `lastPolledAt < now - 2 * intervalMs`.
 * Stale snapshots are returned with `source: 'fallback'` so callers can
 * apply a conservative penalty rather than discarding the data entirely.
 */
export class PsPollBackedProvider implements ModelAvailabilityProvider {
  constructor(
    private readonly coordinator: PsPollCoordinator,
    private readonly intervalMs: number = 60_000
  ) {}

  getLoadedSnapshot(serverId: string, model: string): LoadedModelSnapshot | undefined {
    const models = this.coordinator.getModelsOnServer(serverId);
    const lastPolledAt = this.coordinator.getServerLastPollAt(serverId);

    if (!models.has(model)) {
      return undefined;
    }

    const now = Date.now();
    const age = now - lastPolledAt;
    const isStale = lastPolledAt === 0 || age > 2 * this.intervalMs;

    return {
      serverId,
      model,
      loadedAt: lastPolledAt, // PsPoll doesn't expose per-model loadedAt; use lastPollAt as proxy
      sizeVram: 0, // PsPollCoordinator doesn't track sizeVram
      expiresAt: 0, // PsPollCoordinator doesn't track expiresAt
      lastPolledAt,
      source: isStale ? 'fallback' : 'psPoll',
    };
  }

  getLoadedModels(serverId: string): Set<string> {
    return this.coordinator.getModelsOnServer(serverId);
  }
}
