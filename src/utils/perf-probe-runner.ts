/**
 * perf-probe-runner.ts
 * Runs a single performance probe for a server:model pair.
 * Measures TTFT, tokens/sec, and total duration via streaming response.
 * Does NOT update circuit breaker state — caller is responsible for that.
 */

import { TTFTTracker } from '../metrics/ttft-tracker.js';
import type { ProbeRunResult } from '../types/perf-probe.types.js';
import { classifyError } from '../utils/error-classifier.js';
import { logger } from '../utils/logger.js';

export interface RunProbeOptions {
  /** Timeout in milliseconds (default: 10000) */
  timeoutMs?: number;
  /** Prompt to send (default: "Respond with 'ok'") */
  prompt?: string;
}

/**
 * Run a single performance probe against a server:model pair.
 * Sends a streaming request to the Ollama /api/generate endpoint and measures:
 * - Time to first token (TTFT)
 * - Tokens per second (eval_count / eval_duration in seconds)
 * - Total duration
 *
 * @param serverId - Server identifier for result attribution
 * @param model - Model name to probe
 * @param serverUrl - Base URL of the Ollama server (e.g., "http://localhost:11434")
 * @param options - Optional probe configuration
 * @returns ProbeRunResult with metrics on success, or success:false with classification on failure
 */
export async function runProbe(
  serverId: string,
  model: string,
  serverUrl: string,
  options: RunProbeOptions = {}
): Promise<ProbeRunResult> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const prompt = options.prompt ?? "Respond with 'ok'";
  const startTime = Date.now();

  // Create fresh TTFT tracker for this probe
  const tracker = new TTFTTracker({ serverId, model });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const url = `${serverUrl}/api/generate`;
    logger.debug('[perf-probe] Starting probe', { serverId, model, serverUrl, prompt, timeoutMs });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: true }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      const classification = classifyError(`HTTP ${response.status}: ${errorText}`);
      clearTimeout(timeoutId);
      return {
        serverId,
        model,
        success: false,
        totalDurationMs: Date.now() - startTime,
        error: `HTTP ${response.status}: ${errorText.slice(0, 200)}`,
        errorType: 'http_error',
        classification: classification.type,
      };
    }

    if (!response.body) {
      const classification = classifyError('Response body is null');
      clearTimeout(timeoutId);
      return {
        serverId,
        model,
        success: false,
        totalDurationMs: Date.now() - startTime,
        error: 'Response body is null',
        errorType: 'http_error',
        classification: classification.type,
      };
    }

    // Stream the response and parse NDJSON
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalData: Record<string, unknown> | null = null;
    let firstChunkProcessed = false;
    let chunkCount = 0;
    let totalBytes = 0;

    for (;;) {
      const { done, value } = await reader.read();

      const chunk = value ? decoder.decode(value, { stream: !done }) : '';
      buffer += chunk;

      if (done) {
        break;
      }

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        try {
          const data = JSON.parse(line) as Record<string, unknown>;

          if (!firstChunkProcessed) {
            tracker.markFirstChunk(value.length);
            firstChunkProcessed = true;
          }

          chunkCount++;
          totalBytes += value.length;

          if ('eval_count' in data && 'eval_duration' in data) {
            finalData = data;
          }
        } catch {
          // Skip invalid JSON lines
        }
      }
    }

    const lines = buffer.split('\n');
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      try {
        const data = JSON.parse(line) as Record<string, unknown>;

        if (!firstChunkProcessed) {
          tracker.markFirstChunk(buffer.length);
          firstChunkProcessed = true;
        }

        chunkCount++;
        totalBytes += Buffer.byteLength(line);

        if ('eval_count' in data && 'eval_duration' in data) {
          finalData = data;
        }
      } catch {
        // Skip invalid JSON
      }
    }

    clearTimeout(timeoutId);

    if (!finalData) {
      const classification = classifyError('No valid response data received');
      return {
        serverId,
        model,
        success: false,
        totalDurationMs: Date.now() - startTime,
        error: 'No valid response data received',
        errorType: 'http_error',
        classification: classification.type,
      };
    }

    const evalCount = finalData.eval_count as number;
    const evalDuration = finalData.eval_duration as number;

    // eval_duration is in nanoseconds, convert to seconds for tokens/sec calculation
    const evalDurationSeconds = evalDuration / 1e9;
    const tokensPerSec = evalCount / evalDurationSeconds;

    const metrics = tracker.getMetrics();
    const ttftMs = metrics.ttft ?? metrics.timeToFirstChunk ?? Date.now() - startTime;

    logger.debug('[perf-probe] Probe completed', {
      serverId,
      model,
      ttftMs,
      tokensPerSec,
      evalCount,
      evalDuration,
    });

    return {
      serverId,
      model,
      success: true,
      ttftMs,
      tokensPerSec,
      totalDurationMs: Date.now() - startTime,
      score: undefined, // Score computed by caller
      evalCount: finalData.eval_count as number,
      evalDuration: finalData.eval_duration as number,
      promptEvalDuration: finalData.prompt_eval_duration as number | undefined,
      totalDuration: finalData.total_duration as number | undefined,
      loadDuration: finalData.load_duration as number | undefined,
      chunkCount,
      totalBytes,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const totalDurationMs = Date.now() - startTime;

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        // Timeout
        const classification = classifyError(`Timeout after ${timeoutMs}ms`);
        logger.debug('[perf-probe] Probe timeout', { serverId, model, timeoutMs });
        return {
          serverId,
          model,
          success: false,
          totalDurationMs,
          error: `Timeout after ${timeoutMs}ms`,
          errorType: 'timeout',
          classification: classification.type,
        };
      }

      // Network or other fetch error
      const classification = classifyError(error);
      logger.debug('[perf-probe] Probe network error', {
        serverId,
        model,
        error: error.message,
      });
      return {
        serverId,
        model,
        success: false,
        totalDurationMs,
        error: error.message,
        errorType: 'network_error',
        classification: classification.type,
      };
    }

    // Unknown error
    const errorMessage = String(error);
    const classification = classifyError(errorMessage);
    return {
      serverId,
      model,
      success: false,
      totalDurationMs,
      error: errorMessage,
      errorType: 'unknown',
      classification: classification.type,
    };
  }
}
