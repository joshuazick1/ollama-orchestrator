/**
 * perf-probe-scheduler-instance.ts
 * Singleton accessor for PerformanceProbeScheduler.
 *
 * Lazily instantiates and caches the scheduler on first access.
 * Exposes reset for testing.
 */

import { getInFlightManager } from '../utils/in-flight-manager.js';
import { logger as loggerInstance } from '../utils/logger.js';
import { runProbe } from '../utils/perf-probe-runner.js';
import { getMetricsStore } from '../storage/metrics-store.js';

import { getOrchestratorInstance } from '../orchestrator/orchestrator-instance.js';
import { PerformanceProbeScheduler } from './perf-probe-scheduler.js';

// ============================================================
// Module-level singleton
// ============================================================

let scheduler: PerformanceProbeScheduler | null = null;

// Stable scheduler ID — generated once at module load
const SCHEDULER_ID = 'perf-probe-scheduler-001';

// ============================================================
// Config from env
// ============================================================

function getPerfProbeConfig() {
  const enabled = process.env.PERF_PROBE_ENABLED !== 'false';
  const intervalMs = parseInt(process.env.PERF_PROBE_INTERVAL_MS ?? '86400000', 10);
  const jitterMs = parseInt(process.env.PERF_PROBE_JITTER_MS ?? '300000', 10);
  const cooldownMs = parseInt(process.env.PERF_PROBE_COOLDOWN_MS ?? '300000', 10);
  const probeModelCount = parseInt(process.env.PERF_PROBE_MODEL_COUNT ?? '50', 10);
  const probeTimeoutMs = parseInt(process.env.PERF_PROBE_TIMEOUT_MS ?? '30000', 10);

  // Concurrency cap: scale with fleet size, bounded to [2, 16]
  const serverCount = getOrchestratorInstance().getServers().length;
  const maxConcurrent = parseInt(
    process.env.PERF_PROBE_MAX_CONCURRENT ??
      String(Math.max(2, Math.min(16, Math.floor(serverCount / 100)))),
    10
  );

  return {
    enabled,
    intervalMs,
    jitterMs,
    maxConcurrent,
    cooldownMs,
    probeModelCount,
    probeTimeoutMs,
  };
}

// ============================================================
// Public API
// ============================================================

export function getPerfProbeSchedulerInstance(): PerformanceProbeScheduler {
  if (!scheduler) {
    const orchestrator = getOrchestratorInstance();
    scheduler = new PerformanceProbeScheduler({
      orchestrator,
      runProbe,
      metricsStore: getMetricsStore(),
      inFlightManager: getInFlightManager(),
      logger: loggerInstance,
      schedulerId: SCHEDULER_ID,
      config: getPerfProbeConfig(),
    });
  }
  return scheduler;
}

export function resetPerfProbeSchedulerInstance(): void {
  if (scheduler) {
    void scheduler.stop();
  }
  scheduler = null;
}
