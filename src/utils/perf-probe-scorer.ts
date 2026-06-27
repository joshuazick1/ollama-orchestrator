/**
 * perf-probe-scorer.ts
 * Score computation utilities for performance probe results.
 */

import type { ServerScore } from '../types/perf-probe.types.js';
import type { ProbeRunResult } from '../types/perf-probe.types.js';

/**
 * Compute composite score from TTFT and tokens-per-second.
 *
 * Formula: 0.6 * (1 / (1 + ttftMs / 1000)) + 0.4 * min(tokensPerSec, 100) / 100
 *
 * TTFT score: 0.6 weight, in (0, 1] decreasing in ttftMs
 * TPS score: 0.4 weight, in [0, 1] capped at 100 tokens/sec
 *
 * @param ttftMs - Time to first token in milliseconds
 * @param tokensPerSec - Tokens per second throughput
 * @returns Composite score in [0, 1] (higher is better)
 */
export function computeCompositeScore(ttftMs: number, tokensPerSec: number): number {
  const ttftScore = 1 / (1 + ttftMs / 1000);
  const tpsScore = Math.min(tokensPerSec, 100) / 100;
  return 0.6 * ttftScore + 0.4 * tpsScore;
}

/**
 * Rank servers by composite score (descending).
 *
 * Returns a NEW array sorted by score descending, with 1-based rank assigned.
 * Ties receive sequential ranks (index + 1 after sort).
 *
 * @param servers - Array of ServerScore objects
 * @returns New sorted array with rank field assigned (1 = best)
 */
export function rankServers(servers: ServerScore[]): ServerScore[] {
  return servers
    .map(server => ({ ...server }))
    .sort((a, b) => b.score - a.score)
    .map((server, index) => ({
      ...server,
      rank: index + 1,
    }));
}

/**
 * Select the highest-scoring successful probe result per server.
 *
 * Filters to only successful results with a defined score,
 * then picks the best score per serverId.
 *
 * @param results - Array of ProbeRunResult (mix of success/failure)
 * @returns Map of serverId -> best-scoring ProbeRunResult per server
 */
export function selectBestResultPerServer(results: ProbeRunResult[]): Map<string, ProbeRunResult> {
  const best = new Map<string, ProbeRunResult>();

  for (const result of results) {
    if (result.success && typeof result.score === 'number') {
      const existing = best.get(result.serverId);
      if (!existing || result.score > existing.score!) {
        best.set(result.serverId, result);
      }
    }
  }

  return best;
}
