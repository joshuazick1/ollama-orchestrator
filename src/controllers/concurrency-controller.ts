/**
 * concurrency-controller.ts
 * Telemetry + admin endpoints for the per-(server, model) adaptive concurrency tuner.
 *
 * Mount points (Task 8 will wire routes):
 *   GET  /api/orchestrator/concurrency-stats         — getConcurrencyStats
 *   GET  /api/orchestrator/models/:model/concurrency-stats — getConcurrencyForPair
 *   POST /api/admin/concurrency/mode                 — setConcurrencyMode
 *   POST /api/admin/concurrency/reset                — resetConcurrency
 *   POST /api/admin/concurrency/seed-from-ollama     — seedConcurrencyFromOllama
 *
 * Admin endpoints are gated by `requireAdmin()` in the route file (Task 8 contract).
 */

import type { Request, Response } from 'express';

import type { AutoTunerMode, PairTelemetry } from '../concurrency/auto-tuner.js';
import { getConfigManager } from '../config/config.js';
import { getOrchestratorInstance } from '../orchestrator/orchestrator-instance.js';
import { logger } from '../utils/logger.js';

const VALID_MODES: readonly AutoTunerMode[] = ['off', 'local-adaptive', 'hybrid'] as const;

interface OllamaPsModel {
  name?: string;
  model?: string;
  num_parallel?: number;
  numParallel?: number;
}

interface OllamaPsResponse {
  models?: OllamaPsModel[];
}

/**
 * Lookup the singleton AutoTuner. Optional options are ignored on subsequent
 * calls so the long-lived instance keeps its original config.
 */
function resolveAutoTuner() {
  return getOrchestratorInstance().getAutoTuner();
}

/**
 * GET /api/orchestrator/concurrency-stats
 * Sanitized snapshot for the UI: per-pair caps + percentiles, NEVER raw latency buffer.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- sync today; async signature reserved for future streaming/telemetry
export async function getConcurrencyStats(_req: Request, res: Response): Promise<void> {
  try {
    const tuner = resolveAutoTuner();
    const pairs: PairTelemetry[] = tuner.getStateForTelemetry();
    const configEnabled = getConfigManager().getConfig().concurrencyTuner.enabled;

    res.status(200).json({
      success: true,
      mode: tuner.getMode(),
      enabled: configEnabled,
      pairs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[concurrency-controller] getConcurrencyStats failed', { error: message });
    res.status(500).json({ success: false, error: message });
  }
}

/**
 * POST /api/admin/concurrency/mode
 * Body: `{ mode: 'off' | 'local-adaptive' | 'hybrid' }`
 */
// eslint-disable-next-line @typescript-eslint/require-await -- async signature reserved for future validation pipeline
export async function setConcurrencyMode(req: Request, res: Response): Promise<void> {
  try {
    const body = (req.body ?? {}) as { mode?: unknown };
    const candidate = body.mode;

    if (typeof candidate !== 'string' || !VALID_MODES.includes(candidate as AutoTunerMode)) {
      res.status(400).json({
        success: false,
        error: `mode must be one of: ${VALID_MODES.join(', ')}`,
      });
      return;
    }

    const mode = candidate as AutoTunerMode;
    resolveAutoTuner().setMode(mode);

    res.status(200).json({ success: true, mode });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[concurrency-controller] setConcurrencyMode failed', { error: message });
    res.status(500).json({ success: false, error: message });
  }
}

/**
 * POST /api/admin/concurrency/reset
 * Clears all in-memory pair state; caps revert to model-memory floor.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- async signature reserved for future persisted-undo support
export async function resetConcurrency(_req: Request, res: Response): Promise<void> {
  try {
    resolveAutoTuner().reset();
    res.status(200).json({ success: true, message: 'all pair states cleared' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[concurrency-controller] resetConcurrency failed', { error: message });
    res.status(500).json({ success: false, error: message });
  }
}

/**
 * POST /api/admin/concurrency/seed-from-ollama
 * Body: `{ serverId?: string }`. When serverId is absent, iterate every server
 * known to the orchestrator. Reads `/api/ps` from each backend, extracts
 * `num_parallel` per loaded model, and calls
 * `AutoTuner.seedFromOllama(serverId, model, numParallel)` per model.
 *
 * Ollama `/api/ps` shape: `{ models: [{ name, size_vram, ..., num_parallel? }] }`.
 * We use `num_parallel` directly when present; if it's missing or non-positive
 * we fall back to `server.maxConcurrency` (a static admin-set ceiling) so the
 * tuner still gets a usable ceiling. Per-server failures are collected as
 * strings and DO NOT abort the loop.
 */
export async function seedConcurrencyFromOllama(req: Request, res: Response): Promise<void> {
  try {
    const body = (req.body ?? {}) as { serverId?: unknown };
    const requestedServerId = typeof body.serverId === 'string' ? body.serverId : undefined;

    const orchestrator = getOrchestratorInstance();
    const servers = orchestrator.getServers().filter((s) => !!s.url);

    const targetServers = requestedServerId
      ? servers.filter((s) => s.id === requestedServerId)
      : servers;

    if (requestedServerId && targetServers.length === 0) {
      res.status(404).json({
        success: false,
        error: `Server '${requestedServerId}' not found`,
      });
      return;
    }

    const tuner = resolveAutoTuner();
    const errors: string[] = [];
    let seeded = 0;

    const fetchController = new AbortController();
    const fetchTimeout = setTimeout(() => fetchController.abort(), 5_000);

    const settled = await Promise.allSettled(
      targetServers.map(async (server) => {
        const url = `${server.url.replace(/\/$/, '')}/api/ps`;
        const resp = await fetch(url, { signal: fetchController.signal });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const data = (await resp.json()) as OllamaPsResponse;
        const models = Array.isArray(data.models) ? data.models : [];
        return { server, models };
      }),
    );
    clearTimeout(fetchTimeout);

    for (const result of settled) {
      if (result.status === 'rejected') {
        const errMessage = result.reason instanceof Error ? result.reason.message : String(result.reason);
        errors.push(errMessage);
        continue;
      }

      const { server, models } = result.value;
      // If /api/ps reports no loaded models, skip silently (not an error).
      if (models.length === 0) {
        continue;
      }

      const fallback = typeof server.maxConcurrency === 'number' && server.maxConcurrency > 0
        ? server.maxConcurrency
        : null;

      for (const m of models) {
        const modelName = typeof m.name === 'string'
          ? m.name
          : typeof m.model === 'string'
            ? m.model
            : null;
        if (!modelName) {
          continue;
        }

        const reported = typeof m.num_parallel === 'number'
          ? m.num_parallel
          : typeof m.numParallel === 'number'
            ? m.numParallel
            : null;
        const numParallel = reported !== null && reported > 0 ? reported : fallback;
        if (numParallel === null) {
          continue;
        }

        tuner.seedFromOllama(server.id, modelName, numParallel);
        seeded += 1;
      }
    }

    res.status(200).json({ success: true, seeded, errors });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[concurrency-controller] seedConcurrencyFromOllama failed', { error: message });
    res.status(500).json({ success: false, error: message });
  }
}

/**
 * GET /api/orchestrator/models/:model/concurrency-stats
 * Filters the global telemetry to a single model. 404 if no pairs reference it.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- async signature reserved for future per-pair streaming telemetry
export async function getConcurrencyForPair(req: Request, res: Response): Promise<void> {
  try {
    const model = req.params.model;
    if (!model) {
      res.status(400).json({ success: false, error: 'model path param is required' });
      return;
    }

    const allPairs: PairTelemetry[] = resolveAutoTuner().getStateForTelemetry();
    const pairs = allPairs.filter((p) => p.model === model);

    if (pairs.length === 0) {
      res.status(404).json({
        success: false,
        error: `No concurrency data for model '${String(model)}'`,
      });
      return;
    }

    res.status(200).json({ success: true, model, pairs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[concurrency-controller] getConcurrencyForPair failed', { error: message });
    res.status(500).json({ success: false, error: message });
  }
}
