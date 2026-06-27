/**
 * perf-probe-adaptive.ts
 * Adaptive probing module for performance probes.
 *
 * Selects which (server, model) tuples to probe next based on overlap analysis:
 * - For each failed server, find non-cloud models that exist on overlapping servers
 * - Prefer models that overlap with MANY other servers (higher discovery value)
 * - Filter out tuples where canServe returns false (CB already OPEN/SUSPECT)
 *
 * CRITICAL SEMANTIC NOTE on canServe(tuple, 'probe'):
 * The probeOrchestrator.canServe(tuple, 'probe') returns true ONLY when state === 'RECOVERING'.
 * This is a semantic mismatch with the plan's stated intent of "filtering out OPEN/SUSPECT".
 * The actual behavior filters to ONLY RECOVERING tuples:
 *   - HEALTHY  → false
 *   - RECOVERING → true
 *   - SUSPECT  → false
 *   - UNHEALTHY (OPEN) → false
 *   - Unknown tuple → false (treated as routing/admin eligible, probe blocked)
 *
 * This module accepts canServe as an injected function so callers can decide
 * what semantic to use. In production, probeOrchestrator.canServe is passed directly.
 * The adaptive module itself does NOT interpret CB state — it defers to the injected fn.
 */

import type { ProbeRunResult } from '../types/perf-probe.types.js';

import { filterNonCloudModels } from './cloud-model-filter.js';
import { logger } from './logger.js';

/**
 * Maximum number of adaptive probes to return per round.
 * Prevents overwhelming the system on first pass.
 */
export const MAX_ADAPTIVE_PER_ROUND = 50;

/**
 * A (serverId, model) tuple without endpoint — used for adaptive probe selection.
 * Unlike the full Tuple type from probe/types.ts, this omits endpoint because
 * adaptive probing works at the server:model level (endpoint is resolved later).
 */
export interface ServerModelTuple {
  serverId: string;
  model: string;
}

/**
 * Callback type for canServe check.
 * In production: probeOrchestrator.canServe(tuple, 'probe')
 * In tests: mock with configurable return values
 *
 * IMPORTANT: The 'probe' caller semantic means true ONLY when CB state is RECOVERING.
 * See module-level docstring for details.
 */
export type CanServeFn = (
  tuple: ServerModelTuple,
  caller: 'routing' | 'probe' | 'admin'
) => boolean;

/**
 * A candidate adaptive probe with its overlap analysis.
 */
export interface AdaptiveProbeCandidate {
  /** The model to probe */
  model: string;
  /** Servers that share this model (excluding the failed server itself) */
  overlapServers: string[];
  /** Count of valid overlap servers (used for scoring/sorting) */
  overlapCount: number;
}

/**
 * Result of selectAdaptiveProbes: maps failed server → probe recommendation.
 */
export type AdaptiveProbeMap = Map<string, { model: string; overlapServers: string[] }>;

/**
 * Minimal task state interface for runAdaptiveRound.
 *
 * This represents the parts of PerfProbeTask that the adaptive module needs.
 * The full PerfProbeTask type (with state machine, TTL, persistence) is defined
 * in the task store (T11) and is not imported here to keep the adaptive module
 * independently testable.
 */
export interface PerfProbeTaskState {
  /** Servers that had all CBs open on all probed models — candidates for adaptive probing */
  failedServers: string[];
  /** Set of already-tried "serverId:model" pairs (serialized strings) */
  triedPairs: Set<string>;
  /** Number of adaptive rounds already completed for this task */
  adaptiveRound: number;
  /** Results from all probe runs so far */
  results: ProbeRunResult[];
}

/**
 * Select adaptive probes for failed servers.
 *
 * Algorithm:
 * 1. For each failed server, get its non-cloud models
 * 2. For each model, find overlap servers (other servers that have this model)
 * 3. Filter out:
 *    - Models already in triedPairs (for this failed server)
 *    - Tuples where canServe returns false (CB not RECOVERING)
 *    - Overlap servers that are themselves in triedPairs for this model
 *    - Overlap servers where canServe returns false
 * 4. Score by overlap count (prefer models shared with MANY other servers)
 * 5. Pick the highest-scoring model per failed server
 * 6. Cap at MAX_ADAPTIVE_PER_ROUND results
 *
 * @param failedServers - List of server IDs that had all CBs open
 * @param serverToModels - Mapping of serverId → models on that server
 * @param allModelToServers - Mapping of model → all servers that have it
 * @param triedPairs - Set of already-tried "serverId:model" strings
 * @param canServe - CB state checker (typically probeOrchestrator.canServe)
 * @returns Map of serverId → { model, overlapServers } for new probes to run
 */
export function selectAdaptiveProbes(
  failedServers: string[],
  serverToModels: Record<string, string[]>,
  allModelToServers: Record<string, string[]>,
  triedPairs: Set<string>,
  canServe: CanServeFn
): AdaptiveProbeMap {
  const candidates = new Map<string, { model: string; overlapServers: string[] }>();

  for (const failedServer of failedServers) {
    const serverModels = filterNonCloudModels(serverToModels[failedServer] || []);

    const scoredCandidates: AdaptiveProbeCandidate[] = [];

    for (const model of serverModels) {
      const triedKey = `${failedServer}:${model}`;
      if (triedPairs.has(triedKey)) {
        logger.debug(`[perf-probe-adaptive] Skipping ${triedKey} — already tried`);
        continue;
      }

      // CRITICAL: Exclude tuples where canServe returns false
      // This filters out OPEN/SUSPECT/HEALTHY (non-RECOVERING) CB states
      if (!canServe({ serverId: failedServer, model }, 'probe')) {
        logger.debug(
          `[perf-probe-adaptive] Skipping ${triedKey} — canServe returned false (CB not RECOVERING)`
        );
        continue;
      }

      // Find servers that have this model (excluding the failed server itself)
      const overlapServers = (allModelToServers[model] || []).filter(s => s !== failedServer);

      // Filter overlap servers:
      // 1. Not already tried for this model
      // 2. canServe returns true (CB is RECOVERING on that server too)
      const validOverlap = overlapServers.filter(s => {
        const overlapKey = `${s}:${model}`;
        if (triedPairs.has(overlapKey)) {
          return false;
        }
        if (!canServe({ serverId: s, model }, 'probe')) {
          return false;
        }
        return true;
      });

      // Skip if no valid overlap servers remain
      if (validOverlap.length === 0) {
        logger.debug(
          `[perf-probe-adaptive] Model ${model} on ${failedServer} has no valid overlap servers`
        );
        continue;
      }

      scoredCandidates.push({
        model,
        overlapServers: validOverlap,
        overlapCount: validOverlap.length,
      });
    }

    if (scoredCandidates.length === 0) {
      continue;
    }

    // Sort: highest overlap count first, then model name alphabetically for tie-breaking
    scoredCandidates.sort((a, b) => {
      if (b.overlapCount !== a.overlapCount) {
        return b.overlapCount - a.overlapCount;
      }
      return a.model.localeCompare(b.model);
    });

    const best = scoredCandidates[0];
    candidates.set(failedServer, {
      model: best.model,
      overlapServers: best.overlapServers,
    });

    logger.debug(
      `[perf-probe-adaptive] Selected ${failedServer}:${best.model} ` +
        `(overlap with ${best.overlapServers.length} servers: ${best.overlapServers.join(', ')})`
    );

    // Cap at MAX_ADAPTIVE_PER_ROUND to prevent overwhelming the system
    if (candidates.size >= MAX_ADAPTIVE_PER_ROUND) {
      logger.debug(
        `[perf-probe-adaptive] Hit cap of ${MAX_ADAPTIVE_PER_ROUND}, stopping selection`
      );
      break;
    }
  }

  return candidates;
}

/**
 * Progress callback type for runAdaptiveRound.
 * Called after each individual probe result is received.
 */
export type ProgressCallback = (result: ProbeRunResult) => void;

/**
 * Run one adaptive probing round.
 *
 * Reads the current task state to find failed servers,
 * selects adaptive probes, runs them via probeFn, updates
 * the task's triedPairs, and returns the new results.
 *
 * @param task - Current task state (will be mutated: triedPairs + results updated)
 * @param probeFn - Function to execute a single probe (testable with mocks)
 * @param canServe - CB state checker (typically probeOrchestrator.canServe)
 * @param maxRounds - Maximum number of adaptive rounds (0 = no adaptive probing)
 * @param onProgress - Optional callback invoked after each probe result
 * @returns Array of new ProbeRunResult objects from this round
 */
export async function runAdaptiveRound(
  task: PerfProbeTaskState,
  probeFn: (serverId: string, model: string) => Promise<ProbeRunResult>,
  canServe: CanServeFn,
  maxRounds: number,
  onProgress?: ProgressCallback
): Promise<ProbeRunResult[]> {
  // No adaptive rounds requested — nothing to do
  if (maxRounds <= 0) {
    logger.debug('[perf-probe-adaptive] maxRounds is 0, skipping adaptive probing');
    return [];
  }

  // Check if we've exceeded max rounds
  if (task.adaptiveRound >= maxRounds) {
    logger.debug(
      `[perf-probe-adaptive] adaptiveRound ${task.adaptiveRound} >= maxRounds ${maxRounds}, skipping`
    );
    return [];
  }

  // Get current failed servers from task state
  const failedServers = task.failedServers;
  if (failedServers.length === 0) {
    logger.debug('[perf-probe-adaptive] No failed servers, skipping adaptive round');
    return [];
  }

  // Build serverToModels and allModelToServers from existing results
  // (These would normally come from the orchestrator's model registry)
  // For the adaptive module, we reconstruct them from what we know:
  // - serverToModels: models we've successfully probed on each server
  // - allModelToServers: reverse mapping
  const serverToModels: Record<string, string[]> = {};
  const allModelToServers: Record<string, string[]> = {};

  for (const result of task.results) {
    if (!result.success) {
      continue;
    }

    if (!serverToModels[result.serverId]) {
      serverToModels[result.serverId] = [];
    }
    if (!serverToModels[result.serverId].includes(result.model)) {
      serverToModels[result.serverId].push(result.model);
    }

    if (!allModelToServers[result.model]) {
      allModelToServers[result.model] = [];
    }
    if (!allModelToServers[result.model].includes(result.serverId)) {
      allModelToServers[result.model].push(result.serverId);
    }
  }

  // Select adaptive probes
  const probes = selectAdaptiveProbes(
    failedServers,
    serverToModels,
    allModelToServers,
    task.triedPairs,
    canServe
  );

  if (probes.size === 0) {
    logger.debug('[perf-probe-adaptive] No adaptive candidates found');
    return [];
  }

  logger.debug(
    `[perf-probe-adaptive] Running ${probes.size} adaptive probes (round ${task.adaptiveRound + 1}/${maxRounds})`
  );

  // Run all probes concurrently (limited by the probeFn implementation)
  const newResults: ProbeRunResult[] = [];

  await Promise.all(
    Array.from(probes.entries()).map(async ([serverId, { model }]) => {
      const triedKey = `${serverId}:${model}`;

      try {
        const result = await probeFn(serverId, model);
        newResults.push(result);

        // Record this pair as tried
        task.triedPairs.add(triedKey);

        if (onProgress) {
          onProgress(result);
        }

        logger.debug(
          `[perf-probe-adaptive] Probe ${triedKey}: ${result.success ? 'success' : 'failure'}`
        );
      } catch (err) {
        // Probe threw — treat as failure
        const failureResult: ProbeRunResult = {
          serverId,
          model,
          success: false,
          totalDurationMs: 0,
          error: err instanceof Error ? err.message : String(err),
        };
        newResults.push(failureResult);
        task.triedPairs.add(triedKey);

        if (onProgress) {
          onProgress(failureResult);
        }

        logger.debug(`[perf-probe-adaptive] Probe ${triedKey} threw: ${String(err)}`);
      }
    })
  );

  // Update task state
  task.results.push(...newResults);
  task.adaptiveRound++;

  logger.debug(
    `[perf-probe-adaptive] Round complete. ${newResults.length} results, ` +
      `total triedPairs: ${task.triedPairs.size}, total results: ${task.results.length}`
  );

  return newResults;
}
