/**
 * probe-to-request-context.ts
 * Builds a RequestContext from a ProbeRunResult so probe metrics can be
 * recorded through the shared completion boundary (`RequestTelemetry`).
 */

import type { RequestContext } from '../orchestrator/orchestrator.types.js';
import type { ProbeRunResult } from '../types/perf-probe.types.js';

import { logger } from './logger.js';

/**
 * Converts a ProbeRunResult into a RequestContext suitable for passing to
 * `RequestTelemetry.recordRequest()`.
 *
 * @param result  - The probe run result
 * @param taskId - The task ID of the probe that produced this result
 */
export function buildProbeRequestContext(result: ProbeRunResult, taskId: string): RequestContext {
  const now = Date.now();
  const startTime = now - result.totalDurationMs;

  const ctx: RequestContext = {
    id: `probe-${taskId}-${result.serverId}-${result.model}`,
    serverId: result.serverId,
    model: result.model,
    endpoint: 'ollama_generate',
    streaming: true,
    isProbe: true,
    startTime,
    endTime: now,
    duration: result.totalDurationMs,
    success: result.success,
  };

  if (result.success) {
    if (result.ttftMs !== undefined) {
      ctx.ttft = result.ttftMs;
      ctx.firstTokenTime = startTime + result.ttftMs;
    }
    if (result.tokensPerSec !== undefined) {
      ctx.tokensPerSecond = result.tokensPerSec;
    }
    if (result.evalCount !== undefined) {
      ctx.tokensGenerated = result.evalCount;
    }
    if (result.evalDuration !== undefined) {
      ctx.evalDuration = result.evalDuration;
    }
    if (result.promptEvalDuration !== undefined) {
      ctx.promptEvalDuration = result.promptEvalDuration;
    }
    if (result.totalDuration !== undefined) {
      ctx.totalDuration = result.totalDuration;
    }
    if (result.loadDuration !== undefined) {
      ctx.loadDuration = result.loadDuration;
      ctx.isColdStart = result.loadDuration > 100_000_000; // > 100ms
    }
    if (result.chunkCount !== undefined) {
      ctx.chunkCount = result.chunkCount;
    }
    if (result.totalBytes !== undefined) {
      ctx.totalBytes = result.totalBytes;
    }
  }

  if (!result.success) {
    ctx.error = new Error(result.error ?? 'probe failed');
    if (result.errorType !== undefined) {
      ctx.errorType = result.errorType;
    }
    logger.debug('probe request context error', {
      serverId: result.serverId,
      model: result.model,
      error: ctx.error.message,
      errorType: result.errorType,
    });
  }

  return ctx;
}
