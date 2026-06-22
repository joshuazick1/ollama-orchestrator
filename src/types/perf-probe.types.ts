/**
 * perf-probe.types.ts
 * Type definitions for the performance probe subsystem.
 * Request body, response shape, and supporting types for fleet-wide probe execution.
 */

import type { ServerScore as LBServerScore } from '../load-balancer/load-balancer.js';

/**
 * Request body for the performance probe endpoint.
 * When dryRun is true, probes execute but recordProbeResult is not called.
 * When forceRefresh is false, probes are skipped where a fresh snapshot already exists.
 */
export interface PerfProbeRequest {
  /** Number of probe models to select from the fleet (default: auto) */
  probeModelCount?: number;
  /** Number of sample runs per server:model (default: 1) */
  sampleRuns?: number;
  /** Timeout per probe request in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Concurrency limit for simultaneous probe runs (default: 10) */
  concurrency?: number;
  /** When true, probes run but recordProbeResult is NOT called (default: false) */
  dryRun?: boolean;
  /** When false, skip probes where a fresh snapshot already exists (default: false) */
  forceRefresh?: boolean;
  /** Cap adaptive retry iterations; 0 disables adaptive probing (default: 3) */
  maxAdaptiveRounds?: number;
}

/**
 * Response shape returned after a full probe run.
 */
export interface PerfProbeResponse {
  /** Models that were used for probing */
  probeModels: string[];
  /**
   * Venn-style overlap data mapping each model to the servers that were probed with it.
   * Key = model name, Value = array of server IDs that have that model.
   */
  vennData: Record<string, string[]>;
  /** Per-server scores with rank ordering (best = rank 1) */
  serverScores: ServerScore[];
  /** Flat list of every individual probe run result */
  flat: ProbeRunResult[];
  /** Probe execution metadata and diagnostics */
  metadata: ProbeMetadata;
}

/**
 * Score result for a single server from the probe run.
 * The modelUsed field indicates which probe model produced the best score for this server.
 */
export interface ServerScore {
  /** Server identifier */
  serverId: string;
  /** Composite score 0-1 (higher is better) */
  score: number;
  /** Time-to-first-token in milliseconds for the best probe run */
  ttftMs: number;
  /** Tokens per second for the best probe run */
  tokensPerSec: number;
  /** The probe model that produced the best score for this server */
  modelUsed: string;
  /** Rank order (1 = best server) */
  rank: number;
}

/**
 * Result of a single probe run against one server:model combination.
 */
export interface ProbeRunResult {
  /** Server identifier */
  serverId: string;
  /** Model used in this probe run */
  model: string;
  /** Whether the probe succeeded */
  success: boolean;
  /** Time-to-first-token in milliseconds (undefined if failure) */
  ttftMs?: number;
  /** Tokens per second (undefined if failure) */
  tokensPerSec?: number;
  /** Total end-to-end duration in milliseconds */
  totalDurationMs: number;
  /** Computed score 0-1 (undefined if failure) */
  score?: number;
  /** Error message if failure */
  error?: string;
  /** Classified error type if failure */
  errorType?: string;
  /** Error classification string for passing to recordProbeResult */
  classification?: string;
  /**
   * Full load-balancer ServerScore object from getLBScoreForServerModel.
   * May be undefined if no live score exists for this server:model.
   */
  existingLBScore?: LBServerScore;
  /**
   * Score value alone extracted from existingLBScore for convenience.
   * Undefined if no live score exists.
   */
  existingTotalScore?: number;
  /** Ollama eval_count (number of tokens generated), raw count */
  evalCount?: number;
  /** Ollama eval_duration in nanoseconds */
  evalDuration?: number;
  /** Ollama prompt_eval_duration in nanoseconds */
  promptEvalDuration?: number;
  /** Ollama total_duration in nanoseconds (end-to-end) */
  totalDuration?: number;
  /** Ollama load_duration in nanoseconds (model load time) */
  loadDuration?: number;
  /** Number of chunks received in streaming response */
  chunkCount?: number;
  /** Total bytes received in streaming response */
  totalBytes?: number;
  /** Whether this probe was skipped (fresh snapshot or in-flight cap) */
  skipped?: boolean;
  /** Reason for skipping when skipped is true */
  skipReason?: 'fresh_snapshot' | 'in_flight_cap';
}

/**
 * Metadata about the probe execution including counts, timing, and diagnostics.
 */
export interface ProbeMetadata {
  /** Total wall-clock time for the probe run in milliseconds */
  probeDurationMs: number;
  /** Number of models considered for probing */
  modelsConsidered: number;
  /** Number of models filtered out before probing */
  modelsFiltered: number;
  /** Number of servers considered for probing */
  serversConsidered: number;
  /** Number of servers actually probed */
  serversProbed: number;
  /** Number of servers excluded (no matching model, CB open, etc.) */
  serversExcluded: number;
  /** Concurrency limit used for this probe run */
  concurrency: number;
  /** ISO-8601 timestamp when probing started */
  startedAt: string;
  /** ISO-8601 timestamp when probing completed */
  completedAt: string;
  /** Whether this was a dry run (probes executed, results not recorded) */
  dryRun: boolean;
  /**
   * Servers where every probed model resulted in an open circuit breaker.
   * All CBs for these servers are now OPEN.
   */
  serversWithAllOpenCBs: string[];
  /**
   * Servers that had no models to probe or where all models were filtered out.
   */
  serversWithNoCBEntries: string[];
  /**
   * True when getMetricsSnapshot() returned fresh data before any probe ran.
   * Indicates the probe was skipped because forceRefresh was false.
   */
  usedExistingSnapshot: boolean;
}
