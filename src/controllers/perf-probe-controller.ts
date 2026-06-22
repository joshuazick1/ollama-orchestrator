/**
 * perf-probe-controller.ts
 * Async performance probe controller with adaptive retry.
 *
 * POST /api/orchestrator/perf-probe          — start a probe task (202 immediately)
 * GET  /api/orchestrator/perf-probe/:taskId  — get task state
 * DELETE /api/orchestrator/perf-probe/:taskId — cancel a running task
 *
 * Background execution is fire-and-forget; the POST returns before any probe runs.
 *
 * Adaptive probing: after the initial pass, servers with all-failed probes
 * are retried using alternative non-cloud models that overlap with working servers.
 * The canServe(tuple, 'probe') filter is applied throughout — only tuples
 * with CB state === RECOVERING are ever probed.
 *
 * CRITICAL canServe semantic:
 *   probeOrchestrator.canServe(tuple, 'probe') returns true ONLY when state === 'RECOVERING'.
 *   HEALTHY → false, SUSPECT → false, UNHEALTHY (OPEN) → false, Unknown → false.
 *   This means in practice we only re-probe tuples already in active recovery.
 */

import type { Request, Response, NextFunction } from 'express';

import { getOrchestratorInstance } from '../orchestrator/orchestrator-instance.js';
import { getOperationalStore } from '../storage/operational-store.js';
import type {
  PerfProbeRequest,
  ServerScore,
  ProbeRunResult,
  ProbeMetadata,
} from '../types/perf-probe.types.js';
import { filterNonCloudModels } from '../utils/cloud-model-filter.js';
import { logger } from '../utils/logger.js';
import { runAdaptiveRound } from '../utils/perf-probe-adaptive.js';
import { runProbe } from '../utils/perf-probe-runner.js';
import {
  computeCompositeScore,
  rankServers,
  selectBestResultPerServer,
} from '../utils/perf-probe-scorer.js';
import {
  getPerfProbeTaskStore,
  TaskConflictError,
  type PerfProbeTask,
} from '../utils/perf-probe-task-store.js';
import { selectProbeModels } from '../utils/probe-model-selector.js';

// asyncHandler — inline per monitoring.routes.ts / auth.routes.ts pattern
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => void | Promise<void>) =>
  (req: any, res: any, next: any) => {
    void Promise.resolve(fn(req as Request, res as Response, next as NextFunction)).catch(
      next as (err: unknown) => void
    );
  };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const FRESH_SNAPSHOT_MS = 5 * 60 * 1000; // 5 minutes

function isSnapshotFresh(snapshot: { lastRequestAt: number | null } | null | undefined): boolean {
  if (!snapshot || !snapshot.lastRequestAt) {
    return false;
  }
  return Date.now() - snapshot.lastRequestAt < FRESH_SNAPSHOT_MS;
}

function parseAndValidateBody(body: unknown): { opts: PerfProbeRequest; errors: string[] } {
  const errors: string[] = [];
  if (body === null || body === undefined || typeof body !== 'object') {
    return { opts: {}, errors: ['Request body must be a JSON object'] };
  }

  const b = body as Record<string, unknown>;
  const opts: PerfProbeRequest = {};

  if (b.concurrency !== undefined) {
    if (typeof b.concurrency !== 'number' || !Number.isFinite(b.concurrency)) {
      errors.push('concurrency must be a number');
    } else {
      opts.concurrency = clamp(Math.round(b.concurrency), 1, 64);
    }
  }

  if (b.timeoutMs !== undefined) {
    if (typeof b.timeoutMs !== 'number' || !Number.isFinite(b.timeoutMs)) {
      errors.push('timeoutMs must be a number');
    } else {
      opts.timeoutMs = clamp(Math.round(b.timeoutMs), 5000, 300000);
    }
  }

  if (b.probeModelCount !== undefined) {
    if (
      typeof b.probeModelCount !== 'number' ||
      !Number.isInteger(b.probeModelCount) ||
      b.probeModelCount < 1
    ) {
      errors.push('probeModelCount must be a positive integer');
    } else {
      opts.probeModelCount = b.probeModelCount;
    }
  }

  if (b.maxAdaptiveRounds !== undefined) {
    if (typeof b.maxAdaptiveRounds !== 'number' || !Number.isInteger(b.maxAdaptiveRounds)) {
      errors.push('maxAdaptiveRounds must be an integer');
    } else {
      opts.maxAdaptiveRounds = clamp(Math.round(b.maxAdaptiveRounds), 0, 10);
    }
  }

  if (b.dryRun !== undefined) {
    if (typeof b.dryRun !== 'boolean') {
      errors.push('dryRun must be a boolean');
    } else {
      opts.dryRun = b.dryRun;
    }
  }

  if (b.forceRefresh !== undefined) {
    if (typeof b.forceRefresh !== 'boolean') {
      errors.push('forceRefresh must be a boolean');
    } else {
      opts.forceRefresh = b.forceRefresh;
    }
  }

  return { opts, errors };
}
// Concurrency pool
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let inFlight = 0;
  const queue: T[] = [...items];

  return new Promise<void>((resolve, reject) => {
    const launchNext = () => {
      if (queue.length === 0 && inFlight === 0) {
        return resolve();
      }
      while (inFlight < limit && queue.length > 0) {
        const item = queue.shift()!;
        inFlight++;
        fn(item)
          .finally(() => {
            inFlight--;
            launchNext();
          })
          .catch(reject);
      }
    };
    launchNext();
  });
}
// Background probe task
interface ProbeTuple {
  serverId: string;
  model: string;
  serverUrl: string;
}

async function executeProbeTask(taskId: string, opts: PerfProbeRequest): Promise<void> {
  const store = getPerfProbeTaskStore();
  const orchestrator = getOrchestratorInstance();
  const probeOrchestrator = orchestrator.getProbeOrchestrator();
  const operationalStore = getOperationalStore();

  const concurrency = opts.concurrency ?? 16;
  const timeoutMs = opts.timeoutMs ?? 300000;
  const maxAdaptiveRounds = opts.maxAdaptiveRounds ?? 3;
  const dryRun = opts.dryRun ?? false;
  const forceRefresh = opts.forceRefresh ?? false;

  let usedExistingSnapshot = false;

  const task = store.getTask(taskId);
  if (!task || task.status === 'cancelled') {
    return;
  }

  try {
    store.updateTask(taskId, { status: 'running' });

    // Collect servers and build model→servers mapping (vennData)
    const servers = orchestrator.getServers();
    const vennData: Record<string, string[]> = {};
    const serverUrlMap: Record<string, string> = {};

    for (const server of servers) {
      const nonCloudModels = filterNonCloudModels(server.models ?? []);
      if (nonCloudModels.length === 0) {
        continue;
      }
      serverUrlMap[server.id] = server.url;
      for (const model of nonCloudModels) {
        if (!vennData[model]) {
          vennData[model] = [];
        }
        vennData[model].push(server.id);
      }
    }

    const allServerIds = new Set(Object.values(vennData).flat());

    // Select probe models via greedy set cover
    const probeModels = selectProbeModels(vennData, opts.probeModelCount);

    // Build initial probe tuples, filtered by canServe(tuple, 'probe').
    // NOTE: canServe returns true ONLY when CB state === RECOVERING.
    // HEALTHY → false, SUSPECT → false, UNHEALTHY → false, Unknown → false.
    const tuples: ProbeTuple[] = [];
    const consideredServerIds = new Set<string>();

    for (const model of probeModels) {
      const serverIds = vennData[model] ?? [];
      for (const serverId of serverIds) {
        if (
          !probeOrchestrator.canServe({ serverId, model, endpoint: 'ollama_generate' }, 'probe')
        ) {
          continue;
        }
        consideredServerIds.add(serverId);
        tuples.push({ serverId, model, serverUrl: serverUrlMap[serverId] });
      }
    }

    const results: ProbeRunResult[] = [];
    const triedPairs = new Set<string>();

    // Initial probe run with concurrency limit
    await runWithConcurrency(tuples, concurrency, async tuple => {
      // Check cancellation between probes
      const current = store.getTask(taskId);
      if (!current || current.status === 'cancelled') {
        return;
      }

      const { serverId, model, serverUrl } = tuple;
      triedPairs.add(`${serverId}:${model}`);

      // Check for fresh snapshot before probing
      if (!forceRefresh) {
        const snapshot = operationalStore.getMetricsSnapshot(serverId, model);
        if (isSnapshotFresh(snapshot)) {
          logger.debug(`[perf-probe] Skipping fresh snapshot for ${serverId}:${model}`);
          usedExistingSnapshot = true;
          const existingScore = orchestrator.getLBScoreForServerModel(serverId, model);
          results.push({
            serverId,
            model,
            success: true,
            totalDurationMs: 0,
            existingLBScore: existingScore ?? undefined,
            existingTotalScore: existingScore?.totalScore,
          });
          store.updateTask(taskId, { flat: [...results] });
          return;
        }
      }

      const result = await runProbe(serverId, model, serverUrl, { timeoutMs });

      // Attach existing LB score for reference
      const existingScore = orchestrator.getLBScoreForServerModel(serverId, model);
      if (existingScore) {
        result.existingLBScore = existingScore;
        result.existingTotalScore = existingScore.totalScore;
      }

      // Compute composite score for successful probes
      if (result.success && result.ttftMs !== undefined && result.tokensPerSec !== undefined) {
        result.score = computeCompositeScore(result.ttftMs, result.tokensPerSec);
      }

      // Record through probe orchestrator unless dry run
      if (!dryRun && result.success) {
        await probeOrchestrator.recordProbeResult(
          { serverId, model, endpoint: 'ollama_generate' },
          true
        );
      }

      // Persist successful probe to server_metrics_snapshot
      if (result.success) {
        try {
          operationalStore.saveMetricsSnapshot(serverId, model, {
            latencyAvg: result.totalDurationMs,
            latencyP95: result.totalDurationMs,
            throughput: result.tokensPerSec,
            tokensPerSecond: result.tokensPerSec,
            ttftAvg: result.ttftMs,
            totalRequests: 1,
            lastRequestAt: Date.now(),
            updatedAt: Date.now(),
          });
        } catch (err) {
          logger.warn(`[perf-probe] Failed to persist metrics snapshot for ${serverId}:${model}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      results.push(result);
      store.updateTask(taskId, { flat: [...results] });
    });

    // Servers that were considered (had RECOVERING CBs) but received no probes
    // because all their tuples were filtered out
    const consideredButNotProbed = new Set(consideredServerIds);
    for (const r of results) {
      consideredButNotProbed.delete(r.serverId);
    }
    const serversWithAllOpenCBs = Array.from(consideredButNotProbed);

    // Servers with no non-cloud models at all
    const serversWithNoCBEntries = servers.map(s => s.id).filter(id => !allServerIds.has(id));

    // Adaptive probing: retry failed servers using alternative overlapping models
    const failedServers = Array.from(new Set(results.filter(r => !r.success).map(r => r.serverId)));

    const adaptiveState = {
      failedServers,
      triedPairs,
      adaptiveRound: 0,
      results,
    };

    const canServe: Parameters<typeof runAdaptiveRound>[2] = (tuple, caller) =>
      probeOrchestrator.canServe({ ...tuple, endpoint: 'ollama_generate' }, caller);

    for (let round = 0; round < maxAdaptiveRounds; round++) {
      const current = store.getTask(taskId);
      if (!current || current.status === 'cancelled') {
        return;
      }

      const newResults = await runAdaptiveRound(
        adaptiveState,
        async (serverId: string, model: string) => {
          const url = serverUrlMap[serverId];
          if (!url) {
            return {
              serverId,
              model,
              success: false,
              totalDurationMs: 0,
              error: 'Server URL not found',
            };
          }

          // Check for fresh snapshot before probing
          if (!forceRefresh) {
            const snapshot = operationalStore.getMetricsSnapshot(serverId, model);
            if (isSnapshotFresh(snapshot)) {
              logger.debug(
                `[perf-probe] Skipping fresh snapshot for ${serverId}:${model} (adaptive)`
              );
              usedExistingSnapshot = true;
              const existingScore = orchestrator.getLBScoreForServerModel(serverId, model);
              return {
                serverId,
                model,
                success: true,
                totalDurationMs: 0,
                existingLBScore: existingScore ?? undefined,
                existingTotalScore: existingScore?.totalScore,
              };
            }
          }

          const result = await runProbe(serverId, model, url, { timeoutMs });

          if (result.success && result.ttftMs !== undefined && result.tokensPerSec !== undefined) {
            result.score = computeCompositeScore(result.ttftMs, result.tokensPerSec);
          }

          if (!dryRun && result.success) {
            await probeOrchestrator.recordProbeResult(
              { serverId, model, endpoint: 'ollama_generate' },
              true
            );
          }

          // Persist successful probe to server_metrics_snapshot
          if (result.success) {
            try {
              operationalStore.saveMetricsSnapshot(serverId, model, {
                latencyAvg: result.totalDurationMs,
                latencyP95: result.totalDurationMs,
                throughput: result.tokensPerSec,
                tokensPerSecond: result.tokensPerSec,
                ttftAvg: result.ttftMs,
                totalRequests: 1,
                lastRequestAt: Date.now(),
                updatedAt: Date.now(),
              });
            } catch (err) {
              logger.warn(
                `[perf-probe] Failed to persist metrics snapshot for ${serverId}:${model}`,
                {
                  error: err instanceof Error ? err.message : String(err),
                }
              );
            }
          }

          return result;
        },
        canServe,
        maxAdaptiveRounds,
        undefined
      );

      if (newResults.length === 0) {
        break;
      }
    }

    // Compute final scores and rankings
    const bestPerServer = selectBestResultPerServer(results);
    const serverScoreList: ServerScore[] = [];

    for (const [serverId, result] of bestPerServer) {
      if (
        result.ttftMs !== undefined &&
        result.tokensPerSec !== undefined &&
        result.score !== undefined
      ) {
        serverScoreList.push({
          serverId,
          score: result.score,
          ttftMs: result.ttftMs,
          tokensPerSec: result.tokensPerSec,
          modelUsed: result.model,
          rank: 0,
        });
      }
    }

    const rankedServers = rankServers(serverScoreList);

    // T7b: Persist successful probes to server_metrics_snapshot via
    // operationalStore.saveMetricsSnapshot(...)

    const metadata: ProbeMetadata = {
      probeDurationMs: Date.now() - (task.createdAt ?? Date.now()),
      modelsConsidered: Object.keys(vennData).length,
      modelsFiltered: 0,
      serversConsidered: allServerIds.size,
      serversProbed: new Set(results.map(r => r.serverId)).size,
      serversExcluded: servers.length - allServerIds.size,
      concurrency,
      startedAt: new Date(task.createdAt ?? Date.now()).toISOString(),
      completedAt: new Date().toISOString(),
      dryRun,
      serversWithAllOpenCBs,
      serversWithNoCBEntries,
      usedExistingSnapshot,
    };

    store.updateTask(taskId, {
      status: 'completed',
      completedAt: Date.now(),
      probeModels,
      serverScores: rankedServers.reduce<Record<string, Record<string, number>>>((acc, s) => {
        acc[s.serverId] = {
          score: s.score,
          ttftMs: s.ttftMs,
          tokensPerSec: s.tokensPerSec,
          rank: s.rank,
        };
        return acc;
      }, {}),
      flat: results,
      metadata: {
        ...metadata,
        vennData,
      },
    });

    logger.info(`[perf-probe] Task ${taskId} completed`, {
      probesRun: results.length,
      serversProbed: metadata.serversProbed,
      serversWithAllOpenCBs: metadata.serversWithAllOpenCBs.length,
    });
  } catch (err) {
    logger.error(`[perf-probe] Task ${taskId} failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
    store.updateTask(taskId, { status: 'failed', completedAt: Date.now() });
  }
}
// Request handlers
/**
 * POST /api/orchestrator/perf-probe
 * Start a new performance probe task. Returns 202 immediately.
 */
export function runPerfProbe(req: Request, res: Response): void {
  const { opts, errors } = parseAndValidateBody(req.body);

  if (errors.length > 0) {
    res.status(400).json({ error: 'Validation failed', details: errors });
    return;
  }

  const store = getPerfProbeTaskStore();
  const orchestrator = getOrchestratorInstance();

  // Pre-compute probeModels and totalProbes for the response
  const servers = orchestrator.getServers();
  const vennData: Record<string, string[]> = {};

  for (const server of servers) {
    const nonCloudModels = filterNonCloudModels(server.models ?? []);
    if (nonCloudModels.length === 0) {
      continue;
    }
    for (const model of nonCloudModels) {
      if (!vennData[model]) {
        vennData[model] = [];
      }
      vennData[model].push(server.id);
    }
  }

  const probeModels = selectProbeModels(vennData, opts.probeModelCount);
  const totalProbes = probeModels.reduce((sum, model) => sum + (vennData[model]?.length ?? 0), 0);
  const startedAt = new Date().toISOString();

  let task: PerfProbeTask;
  try {
    task = store.createTask({
      status: 'pending',
      probeModels,
      metadata: {
        concurrency: opts.concurrency ?? 16,
        timeoutMs: opts.timeoutMs ?? 300000,
        maxAdaptiveRounds: opts.maxAdaptiveRounds ?? 3,
        dryRun: opts.dryRun ?? false,
        forceRefresh: opts.forceRefresh ?? false,
        totalProbes,
        startedAt,
        vennData,
      },
    });
  } catch (err) {
    if (err instanceof TaskConflictError) {
      res.status(409).json({
        error: 'Conflict',
        message:
          'An active performance probe task already exists. Please wait for it to complete or cancel it first.',
      });
      return;
    }
    res.status(500).json({ error: 'Failed to create task' });
    return;
  }

  // Fire-and-forget — controller returns 202 immediately
  setImmediate(() => {
    executeProbeTask(task.id, opts).catch(err => {
      logger.error('[perf-probe] Background task threw', {
        taskId: task.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });

  res.status(202).json({
    taskId: task.id,
    status: 'running',
    probeModels,
    totalProbes,
    startedAt,
  });
}

/**
 * GET /api/orchestrator/perf-probe/:taskId
 * Get the current state of a probe task.
 */
export function getPerfProbeStatus(req: Request, res: Response): void {
  const taskId = req.params.taskId as string;

  if (!taskId) {
    res.status(400).json({ error: 'taskId is required' });
    return;
  }

  const store = getPerfProbeTaskStore();
  const task = store.getTask(taskId);

  if (!task) {
    res.status(404).json({ error: 'Task not found', taskId });
    return;
  }

  res.status(200).json(task);
}

/**
 * DELETE /api/orchestrator/perf-probe/:taskId
 * Cancel a running or pending probe task.
 */
export function cancelPerfProbe(req: Request, res: Response): void {
  const taskId = req.params.taskId as string;

  if (!taskId) {
    res.status(400).json({ error: 'taskId is required' });
    return;
  }

  const store = getPerfProbeTaskStore();

  // First check if task exists and is already terminal
  const task = store.getTask(taskId);
  if (!task) {
    res.status(409).json({
      error: 'Conflict',
      message: 'Task not found',
      taskId,
    });
    return;
  }

  if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
    res.status(409).json({
      error: 'Conflict',
      message: `Cannot cancel task in ${task.status} state`,
      taskId,
    });
    return;
  }

  const cancelled = store.cancelTask(taskId);

  if (!cancelled) {
    res.status(409).json({
      error: 'Conflict',
      message: 'Failed to cancel task',
      taskId,
    });
    return;
  }

  res.status(200).json({ taskId, status: 'cancelled' });
}
// Route wiring (used by routes/perf-probe.routes.ts — T8)
export const perfProbeHandlers = {
  runPerfProbe: asyncHandler(runPerfProbe),
  getPerfProbeStatus: asyncHandler(getPerfProbeStatus),
  cancelPerfProbe: asyncHandler(cancelPerfProbe),
};
