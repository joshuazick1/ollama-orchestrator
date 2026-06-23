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
import { getPerfProbeSchedulerInstance } from '../probe/perf-probe-scheduler-instance.js';
import { feedThreeSinks } from '../probe/three-sink-feeder.js';
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

const FRESH_SNAPSHOT_MS = 5 * 60 * 1000;

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
      // Concurrency cap raised from 64 to 200 to support 1000-server fleets
      // (per-server serialization still enforced; this is max SERVERS in flight)
      opts.concurrency = clamp(Math.round(b.concurrency), 1, 200);
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
    const serverIdFilter = opts.serverIds ? new Set(opts.serverIds) : null;
    const vennData: Record<string, string[]> = {};
    const serverUrlMap: Record<string, string> = {};

    for (const server of servers) {
      if (serverIdFilter && !serverIdFilter.has(server.id)) {
        continue;
      }
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
        // When forceRefresh=true, bypass the canServe filter entirely. This is the
        // cold-start case: we WANT to probe HEALTHY/SUSPECT/UNKNOWN servers to build
        // initial metrics. The filter is too strict for warmup (only allows RECOVERING).
        // When forceRefresh=false, the filter protects against probing OPEN breakers.
        if (
          !forceRefresh &&
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

    const inFlightManager = orchestrator.getInFlightManager();

    const serverProbes = new Map<string, string[]>();
    for (const tuple of tuples) {
      if (!serverProbes.has(tuple.serverId)) {
        serverProbes.set(tuple.serverId, []);
      }
      serverProbes.get(tuple.serverId)!.push(tuple.model);
    }

    await runWithConcurrency(
      Array.from(serverProbes.entries()),
      concurrency,
      async ([serverId, models]) => {
        const server = orchestrator.getServer(serverId);
        const serverMaxConcurrency = server?.maxConcurrency ?? 4;
        const serverUrl = serverUrlMap[serverId];

        for (const model of models) {
          const current = store.getTask(taskId);
          if (!current || current.status === 'cancelled') {
            return;
          }

          triedPairs.add(`${serverId}:${model}`);

          if (!forceRefresh) {
            const recent = orchestrator.getMetricsStore().getRequests({
              serverId,
              model,
              startTime: Date.now() - FRESH_SNAPSHOT_MS,
              limit: 1,
            });
            if (recent.length > 0) {
              logger.debug(`[perf-probe] Skipping fresh snapshot for ${serverId}:${model}`);
              usedExistingSnapshot = true;
              const existingScore = orchestrator.getLBScoreForServerModel(serverId, model);
              const skippedResult: ProbeRunResult = {
                serverId,
                model,
                success: false,
                totalDurationMs: 0,
                skipped: true,
                skipReason: 'fresh_snapshot',
                existingLBScore: existingScore ?? undefined,
                existingTotalScore: existingScore?.totalScore,
              };
              results.push(skippedResult);
              store.updateTask(taskId, { flat: [...results] });
              continue;
            }
          }

          const acquired = inFlightManager.tryIncrementInFlight(
            serverId,
            model,
            serverMaxConcurrency
          );
          if (!acquired) {
            logger.debug(`[perf-probe] Skipping ${serverId}:${model} — server at maxConcurrency`);
            const skippedResult: ProbeRunResult = {
              serverId,
              model,
              success: false,
              totalDurationMs: 0,
              skipped: true,
              skipReason: 'in_flight_cap',
            };
            results.push(skippedResult);
            store.updateTask(taskId, { flat: [...results] });
            continue;
          }

          let result: ProbeRunResult;
          try {
            result = await runProbe(serverId, model, serverUrl, { timeoutMs });
          } finally {
            inFlightManager.decrementInFlight(serverId, model);
          }

          const existingScore = orchestrator.getLBScoreForServerModel(serverId, model);
          if (existingScore) {
            result.existingLBScore = existingScore;
            result.existingTotalScore = existingScore.totalScore;
          }

          if (result.success && result.ttftMs !== undefined && result.tokensPerSec !== undefined) {
            result.score = computeCompositeScore(result.ttftMs, result.tokensPerSec);
          }

          if (!dryRun && result.success) {
            await probeOrchestrator.recordProbeResult(
              { serverId, model, endpoint: 'ollama_generate' },
              true
            );
          }

          results.push(result);
          store.updateTask(taskId, { flat: [...results] });
          feedThreeSinks(result, taskId, dryRun);
        }
      }
    );

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

    // When forceRefresh=true, bypass the canServe filter entirely during adaptive rounds too.
    // This mirrors the initial-pass behavior above: cold-start warmup probes all tuples.
    const canServe: Parameters<typeof runAdaptiveRound>[2] = (tuple, caller) =>
      forceRefresh || probeOrchestrator.canServe({ ...tuple, endpoint: 'ollama_generate' }, caller);

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

          if (!forceRefresh) {
            const recent = orchestrator.getMetricsStore().getRequests({
              serverId,
              model,
              startTime: Date.now() - FRESH_SNAPSHOT_MS,
              limit: 1,
            });
            if (recent.length > 0) {
              logger.debug(
                `[perf-probe] Skipping fresh snapshot for ${serverId}:${model} (adaptive)`
              );
              usedExistingSnapshot = true;
              const existingScore = orchestrator.getLBScoreForServerModel(serverId, model);
              const skippedResult: ProbeRunResult = {
                serverId,
                model,
                success: false,
                totalDurationMs: 0,
                skipped: true,
                skipReason: 'fresh_snapshot',
                existingLBScore: existingScore ?? undefined,
                existingTotalScore: existingScore?.totalScore,
              };
              return skippedResult;
            }
          }

          const server = orchestrator.getServer(serverId);
          const serverMaxConcurrency = server?.maxConcurrency ?? 4;
          const acquired = inFlightManager.tryIncrementInFlight(
            serverId,
            model,
            serverMaxConcurrency
          );
          if (!acquired) {
            logger.debug(
              `[perf-probe] Skipping ${serverId}:${model} — server at maxConcurrency (adaptive)`
            );
            return {
              serverId,
              model,
              success: false,
              totalDurationMs: 0,
              skipped: true,
              skipReason: 'in_flight_cap',
            } as ProbeRunResult;
          }

          let result: ProbeRunResult;
          try {
            result = await runProbe(serverId, model, url, { timeoutMs });
          } finally {
            inFlightManager.decrementInFlight(serverId, model);
          }

          if (result.success && result.ttftMs !== undefined && result.tokensPerSec !== undefined) {
            result.score = computeCompositeScore(result.ttftMs, result.tokensPerSec);
          }

          if (!dryRun && result.success) {
            await probeOrchestrator.recordProbeResult(
              { serverId, model, endpoint: 'ollama_generate' },
              true
            );
          }

          feedThreeSinks(result, taskId, dryRun);
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
      vennData,
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
      metadata: metadata as unknown as Record<string, unknown>,
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
 * POST /api/orchestrator/performance-probe/server/:serverId
 * Start a per-server performance probe task scoped to one server. Returns 202 immediately.
 */
export function runPerfProbeForServer(req: Request, res: Response): void {
  const { serverId } = req.params as { serverId: string };
  const { probeModelCount, timeoutMs } = req.body ?? {};

  const orchestrator = getOrchestratorInstance();

  const server = orchestrator.getServer(serverId);
  if (!server) {
    res.status(404).json({ error: `Server '${serverId}' not found` });
    return;
  }

  const store = getPerfProbeTaskStore();

  const opts: PerfProbeRequest = {
    concurrency: 16,
    timeoutMs: timeoutMs ?? 300000,
    maxAdaptiveRounds: 3,
    dryRun: false,
    forceRefresh: false,
    probeModelCount: probeModelCount ?? 50,
    serverIds: [serverId],
  };

  const nonCloudModels = filterNonCloudModels(server.models ?? []);
  const probeModels = nonCloudModels;
  const totalProbes = nonCloudModels.length;

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
        startedAt: new Date().toISOString(),
        serverIds: opts.serverIds,
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

  setImmediate(() => {
    executeProbeTask(task.id, opts).catch(err => {
      logger.error('[perf-probe] Background task threw', {
        taskId: task.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });

  res.status(202).json({ success: true, taskId: task.id });
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

/**
 * GET /api/orchestrator/performance-probe/history
 * Returns time-bucketed probe aggregation for a server (optionally filtered by model).
 *
 * Query params:
 *   serverId        (required) — single server filter
 *   model          (optional) — filter to specific model; if omitted, aggregates all models
 *   startTime      (required, epoch ms) — window start
 *   endTime        (required, epoch ms) — window end
 *   intervalMinutes (optional, default: 15) — bucket size; one of 1, 5, 15, 60, 360, 1440
 *
 * Response: { serverId, model, startTime, endTime, intervalMinutes, dataPoints[] }
 *
 * Empty data sets return { dataPoints: [] } when serverId is valid (not 404).
 * Returns 400 if bucket count would exceed 5000.
 */
export function getPerfProbeHistory(req: Request, res: Response): void {
  const serverId = req.query.serverId as string | undefined;
  const model = req.query.model as string | undefined;
  const startTime = parseInt(req.query.startTime as string, 10);
  const endTime = parseInt(req.query.endTime as string, 10);
  const intervalMinutes = parseInt((req.query.intervalMinutes as string) ?? '15', 10);

  // Validate required params
  if (!serverId) {
    res.status(400).json({ error: 'serverId is required' });
    return;
  }
  if (isNaN(startTime) || isNaN(endTime)) {
    res
      .status(400)
      .json({ error: 'startTime and endTime are required and must be valid epoch ms numbers' });
    return;
  }
  if (startTime >= endTime) {
    res.status(400).json({ error: 'startTime must be less than endTime' });
    return;
  }

  // Validate intervalMinutes
  const VALID_INTERVALS = [1, 5, 15, 60, 360, 1440];
  if (!VALID_INTERVALS.includes(intervalMinutes)) {
    res.status(400).json({
      error: `intervalMinutes must be one of ${VALID_INTERVALS.join(', ')}`,
    });
    return;
  }

  // Check server exists
  const orchestrator = getOrchestratorInstance();
  if (!orchestrator.getServer(serverId)) {
    res.status(404).json({ error: `server ${serverId} not found` });
    return;
  }

  // Check response size cap
  const intervalMs = intervalMinutes * 60 * 1000;
  const bucketCount = Math.ceil((endTime - startTime) / intervalMs);
  if (bucketCount > 5000) {
    res.status(400).json({ error: 'Reduce time range or increase intervalMinutes' });
    return;
  }

  // Query DB — no bucket limit, safety cap at 100 000 rows
  const allRows = orchestrator.getMetricsStore().getRequests({
    serverId,
    model,
    startTime,
    endTime,
    isProbe: true,
    limit: 100_000,
  });

  // Bucket results in JavaScript
  const buckets = new Map<
    number,
    { count: number; ttftSum: number; tokensSum: number; successSum: number; durationSum: number }
  >();

  for (const row of allRows) {
    const bucketTs = Math.floor(row.timestamp / intervalMs) * intervalMs;
    const existing = buckets.get(bucketTs) ?? {
      count: 0,
      ttftSum: 0,
      tokensSum: 0,
      successSum: 0,
      durationSum: 0,
    };
    existing.count++;
    existing.ttftSum += row.ttft_ms ?? 0;
    existing.tokensSum += row.tokens_per_second ?? 0;
    existing.successSum += row.success ? 1 : 0;
    existing.durationSum += row.duration_ms ?? 0;
    buckets.set(bucketTs, existing);
  }

  const dataPoints = Array.from(buckets.entries())
    .map(([timestamp, agg]) => ({
      timestamp,
      count: agg.count,
      ttft_avg: agg.count > 0 ? agg.ttftSum / agg.count : null,
      tokens_per_sec_avg: agg.count > 0 ? agg.tokensSum / agg.count : null,
      success_rate: agg.count > 0 ? agg.successSum / agg.count : null,
      latency_avg: agg.count > 0 ? agg.durationSum / agg.count : null,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  res.status(200).json({
    success: true,
    serverId,
    model: model ?? null,
    startTime,
    endTime,
    intervalMinutes,
    dataPoints,
  });
}

/**
 * GET /api/orchestrator/performance-probe/scheduler-status
 * Returns the current scheduler status (running, config, schedule, stats).
 */
export function getPerfProbeSchedulerStatus(req: Request, res: Response): void {
  try {
    const scheduler = getPerfProbeSchedulerInstance();
    const status = scheduler.getStatus();
    res.status(200).json({ success: true, ...status });
  } catch (err) {
    logger.warn('[perf-probe] Failed to get scheduler status', { error: String(err) });
    res.status(503).json({ error: 'scheduler not initialized' });
  }
}

/**
 * GET /api/orchestrator/performance-probe/recent?limit=N
 * Returns the most recent probe tasks sorted by creation time (most recent first).
 */
export function getRecentPerfProbeTasks(req: Request, res: Response): void {
  const limit = Math.min(parseInt((req.query.limit as string) ?? '5', 10) || 5, 20);
  try {
    const store = getPerfProbeTaskStore();
    const tasks = store.listTasks(limit);
    res.status(200).json(tasks);
  } catch (err) {
    logger.warn('[perf-probe] Failed to list recent tasks', { error: String(err) });
    res.status(500).json({ error: 'Failed to list recent tasks' });
  }
}

/**
 * GET /api/orchestrator/performance-probe/coverage-grid
 * Returns a 7×24 grid (day-of-week × hour-of-day) of probe counts.
 *
 * Query params:
 *   days    (optional, default: 7, max: 30) — lookback window
 *   serverId (optional) — filter to a specific server
 *
 * Response: { success: true, days: 7, grid: [{ hourOfDay, dayOfWeek, count }, ...] }
 * Always returns all 168 cells (7 days × 24 hours), with count=0 for missing data.
 */
export function getPerfProbeCoverageGrid(req: Request, res: Response): void {
  const days = Math.min(Math.max(parseInt((req.query.days as string) ?? '7', 10) || 7, 1), 30);
  const serverId = req.query.serverId as string | undefined;
  const startTime = Date.now() - days * 86_400_000;

  const orchestrator = getOrchestratorInstance();
  const db = orchestrator.getMetricsStore().getDb();

  const params: (string | number | null)[] = [startTime];
  const conditions = ['is_probe = 1', 'timestamp >= ?'];
  if (serverId) {
    conditions.push('server_id = ?');
    params.push(serverId);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;

  const rows = db
    .prepare(
      `SELECT
        CAST(strftime('%H', timestamp/1000, 'unixepoch') AS INTEGER) AS hour_of_day,
        CAST(strftime('%w', timestamp/1000, 'unixepoch') AS INTEGER) AS day_of_week,
        COUNT(*) AS count
      FROM requests
      ${where}
      GROUP BY hour_of_day, day_of_week`
    )
    .all(...params) as Array<{ hour_of_day: number; day_of_week: number; count: number }>;

  const grid: { hourOfDay: number; dayOfWeek: number; count: number }[] = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const found = rows.find(r => r.hour_of_day === h && r.day_of_week === d);
      grid.push({ hourOfDay: h, dayOfWeek: d, count: found?.count ?? 0 });
    }
  }

  res.status(200).json({ success: true, days, grid });
}

/**
 * CSV injection protection: prefix values starting with dangerous
 * spreadsheet meta-characters (=, +, -, @) with a single quote.
 */
function csvSafe(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (/^[=+\-@]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

/**
 * GET /api/orchestrator/performance-probe/history/export
 * Streams historical probe data as CSV or JSON download.
 *
 * Query params:
 *   serverId      (required) — single server filter
 *   model         (optional) — filter to specific model
 *   startTime     (required, epoch ms) — window start
 *   endTime       (required, epoch ms) — window end
 *   format        (optional, default: csv) — 'csv' or 'json'
 *
 * CSV injection protection: leading =, +, -, @ are escaped with a single quote prefix.
 * Safety cap: LIMIT 100 000 rows to prevent OOM.
 * Streams rows via res.write() in a loop — no full-buffered response.
 */
export function exportPerfProbeHistory(req: Request, res: Response): void {
  const serverId = req.query.serverId as string | undefined;
  const model = req.query.model as string | undefined;
  const startTime = parseInt(req.query.startTime as string, 10);
  const endTime = parseInt(req.query.endTime as string, 10);
  const format = (req.query.format as string) ?? 'csv';

  // Validate required params
  if (!serverId) {
    res.status(400).json({ error: 'serverId is required' });
    return;
  }
  if (isNaN(startTime) || isNaN(endTime)) {
    res
      .status(400)
      .json({ error: 'startTime and endTime are required and must be valid epoch ms numbers' });
    return;
  }
  if (startTime >= endTime) {
    res.status(400).json({ error: 'startTime must be less than endTime' });
    return;
  }

  if (format !== 'csv' && format !== 'json') {
    res.status(400).json({ error: 'format must be csv or json' });
    return;
  }

  // Check server exists
  const orchestrator = getOrchestratorInstance();
  if (!orchestrator.getServer(serverId)) {
    res.status(404).json({ error: `server ${serverId} not found` });
    return;
  }

  // Query raw probe rows — safety cap at 100 000
  const rows = orchestrator.getMetricsStore().getRequests({
    serverId,
    model,
    startTime,
    endTime,
    isProbe: true,
    limit: 100_000,
  });

  const startIso = new Date(startTime).toISOString().split('T')[0];
  const endIso = new Date(endTime).toISOString().split('T')[0];
  const filename = `perf-probe-history-${serverId}-${startIso}-${endIso}.${format}`;

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // JSON: full buffer is acceptable for 100k-row cap
    const jsonRows = rows.map(row => ({
      timestamp: row.timestamp,
      server_id: row.server_id,
      model: row.model,
      ttft_ms: row.ttft_ms,
      tokens_per_second: row.tokens_per_second,
      duration_ms: row.duration_ms,
      success: row.success,
      is_probe: row.is_probe,
    }));
    res.write(JSON.stringify(jsonRows, null, 2));
    res.end();
    return;
  }

  // CSV — stream row by row via res.write()
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.write('timestamp,server_id,model,ttft_ms,tokens_per_second,duration_ms,success,is_probe\n');
  for (const row of rows) {
    res.write(
      [
        row.timestamp,
        csvSafe(row.server_id),
        csvSafe(row.model),
        csvSafe(row.ttft_ms),
        csvSafe(row.tokens_per_second),
        csvSafe(row.duration_ms),
        row.success,
        row.is_probe,
      ].join(',') + '\n'
    );
  }
  res.end();
}

/**
 * GET /api/orchestrator/performance-probe/scheduled-probes
 * Returns upcoming auto-probes (newServerProbes) with server URL and model list.
 *
 * Response: { success: true, newServerProbes: [{ serverId, serverUrl, scheduledAt, firesAt, models }] }
 * Empty probes returns { success: true, newServerProbes: [] }
 */
export function getPerfProbeScheduledProbes(req: Request, res: Response): void {
  try {
    const scheduler = getPerfProbeSchedulerInstance();
    const orchestrator = getOrchestratorInstance();
    const status = scheduler.getStatus();

    const newServerProbes = status.currentProbes.map(probe => {
      const server = orchestrator.getServer(probe.serverId);
      return {
        serverId: probe.serverId,
        serverUrl: server?.url ?? '',
        scheduledAt: probe.scheduledAt,
        firesAt: probe.firesAt,
        models: server?.models ?? [],
      };
    });

    res.status(200).json({ success: true, newServerProbes });
  } catch (err) {
    logger.warn('[perf-probe] Failed to get scheduled probes', { error: String(err) });
    res.status(503).json({ error: 'scheduler not initialized' });
  }
}

// Route wiring (used by routes/perf-probe.routes.ts — T8)
export const perfProbeHandlers = {
  runPerfProbe: asyncHandler(runPerfProbe),
  getPerfProbeStatus: asyncHandler(getPerfProbeStatus),
  cancelPerfProbe: asyncHandler(cancelPerfProbe),
  getPerfProbeHistory: asyncHandler(getPerfProbeHistory),
  getPerfProbeSchedulerStatus: asyncHandler(getPerfProbeSchedulerStatus),
  getRecentPerfProbeTasks: asyncHandler(getRecentPerfProbeTasks),
  exportPerfProbeHistory: asyncHandler(exportPerfProbeHistory),
  getPerfProbeScheduledProbes: asyncHandler(getPerfProbeScheduledProbes),
};
