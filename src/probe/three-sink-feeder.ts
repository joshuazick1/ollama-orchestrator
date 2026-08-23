/**
 * three-sink-feeder.ts
 * Single-dispatch wrapper around RequestTelemetry for probe run results.
 *
 * After Task 2, the manual triplet fan-out (`metricsAggregator.recordRequest` +
 * `getRequestHistory().recordRequest` + `getMetricsStore().recordRequest`) has
 * moved into `src/metrics/request-telemetry.ts`. This file keeps the public
 * export so callers (perf-probe-controller, perf-probe-runner daily scheduler)
 * continue to call `feedThreeSinks(...)` unchanged; the body delegates to the
 * new boundary so probe outcomes flow through the same contract as routed and
 * direct-server completions.
 */

import { getAnalyticsEngine } from '../analytics/analytics-engine.js';
import { RequestTelemetry } from '../metrics/request-telemetry.js';
import { getOrchestratorInstance } from '../orchestrator/orchestrator-instance.js';
import { getErrorEventStore } from '../storage/error-event-store.js';
import type { ProbeRunResult } from '../types/perf-probe.types.js';
import { logger } from '../utils/logger.js';
import { buildProbeRequestContext } from '../utils/probe-to-request-context.js';

let _telemetry: RequestTelemetry | undefined;

function getTelemetry(): RequestTelemetry {
  if (_telemetry) {
    return _telemetry;
  }
  const orch = getOrchestratorInstance();
  _telemetry = new RequestTelemetry(
    {
      metricsAggregators: orch.getMetricsAggregator() as unknown as {
        recordRequest: (ctx: Parameters<RequestTelemetry['recordRequest']>[0]) => unknown;
      },
      getRequestHistory: () =>
        orch.getRequestHistory() as unknown as {
          recordRequest: (
            ctx: Parameters<RequestTelemetry['recordRequest']>[0],
            queueWaitTime?: number
          ) => unknown;
        },
      getMetricsStore: () =>
        orch.getMetricsStore() as unknown as {
          recordRequest: (
            ctx: Parameters<RequestTelemetry['recordRequest']>[0],
            opts?: unknown
          ) => unknown;
        },
      getAnalyticsEngine: () =>
        getAnalyticsEngine() as unknown as {
          recordRequest: (ctx: Parameters<RequestTelemetry['recordRequest']>[0]) => unknown;
        },
    },
    {
      getErrorEventStore: () =>
        getErrorEventStore() as unknown as {
          recordError: (event: unknown) => Promise<unknown>;
        },
    }
  );
  return _telemetry;
}

/** Reset for tests. */
export function resetThreeSinkFeederForTesting(): void {
  _telemetry = undefined;
}

/**
 * Feed a probe run result into the shared completion boundary.
 * Sync helper — returns void, no async, no Promise.
 */
export function feedThreeSinks(result: ProbeRunResult, probeTaskId: string, dryRun: boolean): void {
  if (dryRun || result.skipped) {
    return;
  }
  const ctx = buildProbeRequestContext(result, probeTaskId);
  try {
    getTelemetry().recordRequest(ctx);
  } catch (err) {
    logger.warn('[perf-probe] RequestTelemetry.recordRequest failed', {
      serverId: result.serverId,
      model: result.model,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
