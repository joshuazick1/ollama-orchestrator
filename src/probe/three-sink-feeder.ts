/**
 * three-sink-feeder.ts
 * Feeds probe run results into the three canonical sinks: MetricsAggregator,
 * RequestHistory, and MetricsStore. Extracted from perf-probe-controller so the
 * daily scheduler (which cannot import from src/controllers/) can reuse the same
 * helper without violating the DOX acyclic layer rule.
 */

import { getOrchestratorInstance } from '../orchestrator/orchestrator-instance.js';
import type { ProbeRunResult } from '../types/perf-probe.types.js';
import { logger } from '../utils/logger.js';
import { buildProbeRequestContext } from '../utils/probe-to-request-context.js';

/**
 * Feed a probe run result into the three canonical sinks.
 * Sync helper — returns void, no async, no Promise.
 */
export function feedThreeSinks(result: ProbeRunResult, probeTaskId: string, dryRun: boolean): void {
  if (dryRun || result.skipped) {
    return;
  }
  const orch = getOrchestratorInstance();
  const ctx = buildProbeRequestContext(result, probeTaskId);
  try {
    orch.getMetricsAggregator().recordRequest(ctx);
  } catch (err) {
    logger.warn('[perf-probe] Failed to feed MetricsAggregator', {
      serverId: result.serverId,
      model: result.model,
      err: String(err),
    });
  }
  try {
    orch.getRequestHistory().recordRequest(ctx);
  } catch (err) {
    logger.warn('[perf-probe] Failed to feed getRequestHistory', {
      serverId: result.serverId,
      model: result.model,
      err: String(err),
    });
  }
  try {
    orch.getMetricsStore().recordRequest(ctx, { isProbe: true });
  } catch (err) {
    logger.warn('[perf-probe] Failed to feed getMetricsStore', {
      serverId: result.serverId,
      model: result.model,
      err: String(err),
    });
  }
}
