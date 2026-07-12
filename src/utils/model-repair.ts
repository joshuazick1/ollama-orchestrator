/**
 * modelRepair.ts
 * Attempts to repair corrupted models on remote Ollama servers
 * by removing and re-pulling them via the Ollama HTTP API.
 */

import { fetchWithTimeout } from './fetch-with-timeout.js';
import { logger } from './logger.js';

export interface ModelRepairResult {
  success: boolean;
  action: 'removed' | 'removed-and-pulled' | 'pull-failed' | 'delete-failed';
  error?: string;
}

/**
 * Try to repair a model on a remote Ollama server by removing it
 * and pulling a fresh copy from the registry.
 *
 * Strategy:
 *  1. DELETE /api/delete to remove the corrupted blob.
 *  2. POST /api/pull to download a fresh copy.
 *  3. Wait for "status":"success" in the pull's NDJSON progress stream.
 *
 * This runs fire-and-forget from the catch block so it does not block
 * failover.  The caller is expected to quarantine the server defensively;
 * on success the quarantine is lifted.
 */
export async function attemptModelRepair(
  serverUrl: string,
  modelName: string,
  deleteTimeoutMs = 30_000,
  pullTimeoutMs = 300_000
): Promise<ModelRepairResult> {
  process.stderr.write(
    `[DEBUG-REPAIR-FN] attemptModelRepair called for ${serverUrl} / ${modelName}\n`
  );
  // ── Step 1: Remove the corrupted model ──────────────────────────────
  try {
    process.stderr.write(`[DEBUG-REPAIR-FN] calling DELETE ${serverUrl}/api/delete\n`);
    const delRes = await fetchWithTimeout(`${serverUrl}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
      timeout: deleteTimeoutMs,
    });

    if (!delRes.ok && delRes.status !== 404) {
      // 404 = model didn't exist (maybe already removed) — still try pull
      const body = await delRes.text().catch(() => '(no body)');
      logger.warn(
        `[ModelRepair] DELETE returned ${delRes.status} for ${modelName} on ${serverUrl}: ${body}`
      );
      // Non-fatal — continue to pull
    }
  } catch (err) {
    logger.warn(
      `[ModelRepair] DELETE failed for ${modelName} on ${serverUrl}: ${err instanceof Error ? err.message : String(err)}`
    );
    // Non-fatal — continue to pull (pull might overwrite)
  }

  // ── Step 2: Pull a fresh copy ───────────────────────────────────────
  try {
    const pullRes = await fetchWithTimeout(`${serverUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
      timeout: pullTimeoutMs,
    });

    if (!pullRes.ok) {
      const body = await pullRes.text().catch(() => '(no body)');
      return {
        success: false,
        action: 'pull-failed',
        error: `Pull HTTP ${pullRes.status}: ${body}`,
      };
    }

    // Consume the NDJSON progress stream to wait for completion
    const raw = await pullRes.text();
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.status === 'success') {
          logger.info(`[ModelRepair] Successfully repaired model ${modelName} on ${serverUrl}`);
          return { success: true, action: 'removed-and-pulled' };
        }
        if (parsed.status === 'error') {
          return {
            success: false,
            action: 'pull-failed',
            error: `Pull error: ${parsed.error ?? parsed.status ?? 'unknown'}`,
          };
        }
      } catch {
        // skip unparseable progress lines
      }
    }

    // Stream ended but we never saw "success"
    return {
      success: false,
      action: 'pull-failed',
      error: 'Pull stream completed without success status',
    };
  } catch (err) {
    return {
      success: false,
      action: 'pull-failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Error message patterns that indicate a corrupted model blob
 * that may be repairable by re-pulling.
 */
export const CORRUPTED_MODEL_PATTERNS = [
  'unable to load model',
  'failed to load model',
  'llm server loading model',
] as const;

/**
 * Error message patterns that indicate the Ollama runner/backend
 * has crashed — a systemic server issue, not repairable per-model.
 */
export const RUNNER_CRASH_PATTERNS = [
  'runner process has terminated',
  'fatal model server error',
  'llama runner',
  'runner process',
  'process has terminated',
] as const;

/**
 * Check whether an error message matches a set of patterns (case-insensitive).
 */
export function matchesAny(errorMessage: string, patterns: readonly string[]): boolean {
  const lower = errorMessage.toLowerCase();
  return patterns.some(p => lower.includes(p));
}
