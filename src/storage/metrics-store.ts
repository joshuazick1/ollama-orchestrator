/**
 * metrics-store.ts
 * SQLite-backed long-term metrics storage.
 *
 * Phase 1: Dual-write mode — accepts writes from the orchestrator and persists
 * them to SQLite alongside existing JSON files. Reads are not yet migrated.
 *
 * Architecture:
 * - Write buffer: requests/decisions/failovers are queued in memory and
 *   flushed in a single transaction every batchFlushIntervalMs or when
 *   batchSize is reached.
 * - Rollup worker: hourly rollups are computed during low-traffic windows
 *   (in-flight = 0) up to rollupDeadlineMinutes past the hour.
 * - Retention pruning: runs every retentionCheckIntervalMs to delete expired rows.
 */

import fs from 'fs';
import path from 'path';

import Database from 'better-sqlite3';

import type { RequestContext } from '../orchestrator.types.js';
import { logger } from '../utils/logger.js';
import { applySchema } from './schema.js';
import type {
  DecisionCandidateRow,
  DecisionDetail,
  DecisionQuery,
  DecisionRow,
  DailyRollupRow,
  FailoverAttemptRow,
  HourlyRollupRow,
  MetricsStoreConfig,
  RequestQuery,
  RequestRow,
  RequestStats,
  RollupQuery,
  StorageRetentionConfig,
  TemporalProfileRow,
  UnifiedErrorType,
} from './types.js';
import { DEFAULT_STORAGE_CONFIG } from './types.js';

// ============================================================
// Internal buffer types
// ============================================================

interface BufferedRequest {
  context: RequestContext;
  queueWaitMs?: number;
}

interface BufferedDecision {
  timestamp: number;
  model: string;
  selectedServerId: string;
  algorithm: string;
  selectionReason: string;
  candidates: Array<{
    serverId: string;
    totalScore: number;
    latencyScore: number;
    successRateScore: number;
    loadScore: number;
    capacityScore: number;
    cbScore?: number;
    timeoutScore?: number;
    throughputScore?: number;
    vramScore?: number;
    p95Latency?: number;
    successRate?: number;
    inFlight?: number;
    throughput?: number;
  }>;
}

interface BufferedFailover {
  requestId: string;
  timestamp: number;
  model: string;
  phase: 1 | 2 | 3;
  serverId: string;
  result: 'success' | 'failure' | 'skipped';
  errorType?: string;
  latencyMs?: number;
}

// ============================================================
// Helpers
// ============================================================

function utcHourOfDay(ts: number): number {
  return new Date(ts).getUTCHours();
}

function utcDayOfWeek(ts: number): number {
  return new Date(ts).getUTCDay();
}

function utcDateStr(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

function truncateToHour(ts: number): number {
  return Math.floor(ts / 3_600_000) * 3_600_000;
}

/**
 * Classify an error message into the unified error type.
 * Combines logic from analytics-engine.ts and request-history.ts classifiers.
 */
function classifyError(error: Error | string | undefined): UnifiedErrorType {
  if (!error) return 'unknown';
  const msg = (typeof error === 'string' ? error : error.message).toLowerCase();

  if (msg.includes('timeout')) return 'timeout';
  if (msg.includes('oom') || msg.includes('out of memory') || msg.includes('cuda out of memory'))
    return 'oom';
  if (
    msg.includes('connection') ||
    msg.includes('refused') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound')
  )
    return 'connection';
  if ((msg.includes('model') && msg.includes('not found')) || msg.includes('no such model'))
    return 'model_not_found';
  if (msg.includes('circuit breaker')) return 'circuit_breaker';
  if (msg.includes('capacity') || msg.includes('queue full') || msg.includes('too many'))
    return 'capacity';
  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many requests'))
    return 'rate_limited';
  if (
    msg.includes('internal server') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503')
  )
    return 'server_error';

  return 'unknown';
}

/**
 * Compute the percentile value from a sorted array.
 * Returns null if the array is empty.
 */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

// ============================================================
// MetricsStore
// ============================================================

export class MetricsStore {
  private db: Database.Database;
  private config: MetricsStoreConfig;

  // Write buffers
  private requestBuffer: BufferedRequest[] = [];
  private decisionBuffer: BufferedDecision[] = [];
  private failoverBuffer: BufferedFailover[] = [];

  // Timers
  private flushTimer?: NodeJS.Timeout;
  private retentionTimer?: NodeJS.Timeout;
  private profileRebuildTimer?: NodeJS.Timeout;

  // Rollup scheduling state
  private pendingRollupHours: Set<number> = new Set();
  private rollupCheckTimer?: NodeJS.Timeout;

  // Prepared statements (populated lazily after schema is applied)
  private stmts!: ReturnType<typeof this.prepareStatements>;

  constructor(
    config: Partial<Omit<MetricsStoreConfig, 'retention' | 'performance' | 'temporal'>> & {
      retention?: Partial<StorageRetentionConfig>;
      performance?: Partial<MetricsStoreConfig['performance']>;
      temporal?: Partial<MetricsStoreConfig['temporal']>;
      getInFlightCount?: () => number;
    } = {}
  ) {
    this.config = {
      dbPath: config.dbPath ?? DEFAULT_STORAGE_CONFIG.dbPath,
      retention: { ...DEFAULT_STORAGE_CONFIG.retention, ...config.retention },
      performance: { ...DEFAULT_STORAGE_CONFIG.performance, ...config.performance },
      temporal: { ...DEFAULT_STORAGE_CONFIG.temporal, ...config.temporal },
      getInFlightCount: config.getInFlightCount ?? DEFAULT_STORAGE_CONFIG.getInFlightCount,
    };

    // Ensure data directory exists
    const dir = path.dirname(path.resolve(this.config.dbPath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Open database with WAL mode for concurrent reads during writes
    this.db = new Database(this.config.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('cache_size = -2000'); // 2 MB page cache

    applySchema(this.db);
    this.stmts = this.prepareStatements();

    this.startTimers();

    logger.info(`[MetricsStore] Opened SQLite database at ${this.config.dbPath}`);
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  /**
   * Flush any buffered writes and close the database.
   * Should be called on process shutdown.
   */
  close(): void {
    this.stopTimers();
    this.flushBatch(); // flush remaining buffer
    this.db.close();
    logger.info('[MetricsStore] Database closed');
  }

  // ============================================================
  // Write API
  // ============================================================

  /**
   * Buffer a completed request context for insertion.
   * Non-blocking — the actual INSERT happens on the next flush.
   */
  recordRequest(context: RequestContext, queueWaitMs?: number): void {
    this.requestBuffer.push({ context, queueWaitMs });
    if (this.requestBuffer.length >= this.config.performance.batchSize) {
      this.flushBatch();
    }
  }

  /**
   * Buffer a load balancer decision for insertion.
   */
  recordDecision(decision: BufferedDecision): void {
    this.decisionBuffer.push(decision);
    if (this.decisionBuffer.length >= this.config.performance.batchSize) {
      this.flushBatch();
    }
  }

  /**
   * Buffer a failover attempt for insertion.
   */
  recordFailover(attempt: BufferedFailover): void {
    this.failoverBuffer.push(attempt);
  }

  // ============================================================
  // Read API — Requests
  // ============================================================

  getRequests(opts: RequestQuery = {}): RequestRow[] {
    const conditions: string[] = [];
    const params: (string | number | null)[] = [];

    if (opts.serverId !== undefined) {
      conditions.push('server_id = ?');
      params.push(opts.serverId);
    }
    if (opts.model !== undefined) {
      conditions.push('model = ?');
      params.push(opts.model);
    }
    if (opts.endpoint !== undefined) {
      conditions.push('endpoint = ?');
      params.push(opts.endpoint);
    }
    if (opts.success !== undefined) {
      conditions.push('success = ?');
      params.push(opts.success ? 1 : 0);
    }
    if (opts.isRetry !== undefined) {
      conditions.push('is_retry = ?');
      params.push(opts.isRetry ? 1 : 0);
    }
    if (opts.startTime !== undefined) {
      conditions.push('timestamp >= ?');
      params.push(opts.startTime);
    }
    if (opts.endTime !== undefined) {
      conditions.push('timestamp <= ?');
      params.push(opts.endTime);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;

    const sql = `SELECT * FROM requests ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    return this.db.prepare(sql).all(...params, limit, offset) as RequestRow[];
  }

  getRequestById(id: string): RequestRow | null {
    return (this.stmts.getRequestById.get(id) as RequestRow | undefined) ?? null;
  }

  getRequestsByParent(parentId: string): RequestRow[] {
    return this.stmts.getRequestsByParent.all(parentId) as RequestRow[];
  }

  getRequestStats(serverId?: string, model?: string, since?: number): RequestStats {
    const cutoff = since ?? Date.now() - 86_400_000;
    const params: (string | number)[] = [cutoff];
    const conditions: string[] = ['timestamp >= ?'];

    if (serverId) {
      conditions.push('server_id = ?');
      params.push(serverId);
    }
    if (model) {
      conditions.push('model = ?');
      params.push(model);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const row = this.db
      .prepare(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN is_retry = 0 THEN 1 ELSE 0 END) AS user_requests,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS successes,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failures,
          AVG(duration_ms) AS avg_duration,
          AVG(tokens_per_second) AS avg_tps,
          SUM(is_cold_start) AS cold_starts
        FROM requests ${where}`
      )
      .get(...params) as {
      total: number;
      user_requests: number;
      successes: number;
      failures: number;
      avg_duration: number | null;
      avg_tps: number | null;
      cold_starts: number;
    };

    if (!row || row.total === 0) {
      return {
        totalRequests: 0,
        userRequests: 0,
        successes: 0,
        failures: 0,
        errorRate: 0,
        avgDurationMs: null,
        p50DurationMs: null,
        p95DurationMs: null,
        p99DurationMs: null,
        avgTokensPerSecond: null,
        coldStartCount: 0,
      };
    }

    // Compute percentiles from sorted durations
    const durations = (
      this.db
        .prepare(
          `SELECT duration_ms FROM requests ${where} AND duration_ms IS NOT NULL ORDER BY duration_ms`
        )
        .all(...params) as Array<{ duration_ms: number }>
    ).map(r => r.duration_ms);

    return {
      totalRequests: row.total,
      userRequests: row.user_requests,
      successes: row.successes,
      failures: row.failures,
      errorRate: row.total > 0 ? row.failures / row.total : 0,
      avgDurationMs: row.avg_duration,
      p50DurationMs: percentile(durations, 50),
      p95DurationMs: percentile(durations, 95),
      p99DurationMs: percentile(durations, 99),
      avgTokensPerSecond: row.avg_tps,
      coldStartCount: row.cold_starts,
    };
  }

  // ============================================================
  // Read API — Decisions
  // ============================================================

  getDecisions(opts: DecisionQuery = {}): DecisionRow[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (opts.model !== undefined) {
      conditions.push('model = ?');
      params.push(opts.model);
    }
    if (opts.serverId !== undefined) {
      conditions.push('selected_server = ?');
      params.push(opts.serverId);
    }
    if (opts.startTime !== undefined) {
      conditions.push('timestamp >= ?');
      params.push(opts.startTime);
    }
    if (opts.endTime !== undefined) {
      conditions.push('timestamp <= ?');
      params.push(opts.endTime);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;

    return this.db
      .prepare(`SELECT * FROM decisions ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as DecisionRow[];
  }

  getDecisionWithCandidates(id: number): DecisionDetail | null {
    const decision = this.db.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as
      | DecisionRow
      | undefined;
    if (!decision) return null;

    const candidates = this.db
      .prepare('SELECT * FROM decision_candidates WHERE decision_id = ?')
      .all(id) as DecisionCandidateRow[];

    return { ...decision, candidates };
  }

  // ============================================================
  // Read API — Rollups
  // ============================================================

  getHourlyRollups(opts: RollupQuery = {}): HourlyRollupRow[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (opts.serverId) {
      conditions.push('server_id = ?');
      params.push(opts.serverId);
    }
    if (opts.model) {
      conditions.push('model = ?');
      params.push(opts.model);
    }
    if (opts.startTime !== undefined) {
      conditions.push('hour_start >= ?');
      params.push(opts.startTime);
    }
    if (opts.endTime !== undefined) {
      conditions.push('hour_start <= ?');
      params.push(opts.endTime);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return this.db
      .prepare(`SELECT * FROM hourly_rollups ${where} ORDER BY hour_start DESC`)
      .all(...params) as HourlyRollupRow[];
  }

  getDailyRollups(opts: RollupQuery = {}): DailyRollupRow[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (opts.serverId) {
      conditions.push('server_id = ?');
      params.push(opts.serverId);
    }
    if (opts.model) {
      conditions.push('model = ?');
      params.push(opts.model);
    }
    if (opts.startTime !== undefined) {
      // Convert epoch ms to date string for comparison
      conditions.push("date_str >= date(?, 'unixepoch', 'utc')");
      params.push(Math.floor(opts.startTime / 1000));
    }
    if (opts.endTime !== undefined) {
      conditions.push("date_str <= date(?, 'unixepoch', 'utc')");
      params.push(Math.floor(opts.endTime / 1000));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return this.db
      .prepare(`SELECT * FROM daily_rollups ${where} ORDER BY date_str DESC`)
      .all(...params) as DailyRollupRow[];
  }

  // ============================================================
  // Read API — Temporal Profiles
  // ============================================================

  getTemporalProfile(
    serverId: string,
    model: string,
    hourOfDay: number,
    dayOfWeek: number
  ): TemporalProfileRow | null {
    return (
      (this.stmts.getProfile.get(serverId, model, hourOfDay, dayOfWeek) as
        | TemporalProfileRow
        | undefined) ?? null
    );
  }

  getTemporalProfiles(serverId: string, model: string): TemporalProfileRow[] {
    return this.db
      .prepare(
        'SELECT * FROM temporal_profiles WHERE server_id = ? AND model = ? AND profile_type = ?'
      )
      .all(serverId, model, 'exact') as TemporalProfileRow[];
  }

  getAllProfiles(): TemporalProfileRow[] {
    return this.db.prepare('SELECT * FROM temporal_profiles').all() as TemporalProfileRow[];
  }

  // ============================================================
  // Internal: Prepared Statements
  // ============================================================

  private prepareStatements() {
    return {
      insertRequest: this.db.prepare(`
        INSERT OR IGNORE INTO requests (
          id, parent_request_id, is_retry, timestamp,
          server_id, model, endpoint, streaming,
          success, duration_ms, error_type, error_message,
          tokens_prompt, tokens_generated, tokens_per_second,
          ttft_ms, streaming_duration_ms, chunk_count, total_bytes,
          max_chunk_gap_ms, avg_chunk_size,
          eval_duration, prompt_eval_duration, total_duration, load_duration,
          is_cold_start, queue_wait_ms,
          hour_of_day, day_of_week, date_str
        ) VALUES (
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?,
          ?, ?, ?, ?,
          ?, ?,
          ?, ?, ?
        )
      `),

      insertDecision: this.db.prepare(`
        INSERT INTO decisions (
          timestamp, model, selected_server, algorithm,
          selection_reason, candidate_count,
          total_score, latency_score, success_rate_score, load_score,
          capacity_score, cb_score, timeout_score, throughput_score, vram_score,
          p95_latency, success_rate, in_flight, throughput,
          hour_of_day, day_of_week
        ) VALUES (
          ?, ?, ?, ?,
          ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?
        )
      `),

      insertCandidate: this.db.prepare(`
        INSERT INTO decision_candidates (
          decision_id, server_id,
          total_score, latency_score, success_rate_score, load_score, capacity_score,
          p95_latency, success_rate, in_flight, throughput
        ) VALUES (
          ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?
        )
      `),

      insertFailover: this.db.prepare(`
        INSERT INTO failover_attempts (
          timestamp, request_id, model, phase, server_id,
          result, error_type, latency_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),

      getRequestById: this.db.prepare('SELECT * FROM requests WHERE id = ?'),

      getRequestsByParent: this.db.prepare(
        'SELECT * FROM requests WHERE parent_request_id = ? ORDER BY timestamp ASC'
      ),

      getProfile: this.db.prepare(
        `SELECT * FROM temporal_profiles
         WHERE server_id = ? AND model = ?
           AND hour_of_day = ? AND day_of_week = ?
           AND profile_type = 'exact'`
      ),
    };
  }

  // ============================================================
  // Internal: Flush write buffer
  // ============================================================

  private flushBatch(): void {
    if (
      this.requestBuffer.length === 0 &&
      this.decisionBuffer.length === 0 &&
      this.failoverBuffer.length === 0
    ) {
      return;
    }

    const requests = this.requestBuffer.splice(0);
    const decisions = this.decisionBuffer.splice(0);
    const failovers = this.failoverBuffer.splice(0);

    try {
      this.db.transaction(() => {
        for (const { context: c, queueWaitMs } of requests) {
          const ts = c.startTime;
          this.stmts.insertRequest.run(
            c.id,
            c.parentRequestId ?? null,
            c.isRetry ? 1 : 0,
            ts,
            c.serverId ?? 'unknown',
            c.model,
            c.endpoint,
            c.streaming ? 1 : 0,
            c.success ? 1 : 0,
            c.duration ?? null,
            c.error ? classifyError(c.error) : null,
            c.error?.message ?? null,
            c.tokensPrompt ?? null,
            c.tokensGenerated ?? null,
            c.tokensPerSecond ?? null,
            c.ttft ?? null,
            c.streamingDuration ?? null,
            c.chunkCount ?? null,
            c.totalBytes ?? null,
            c.maxChunkGapMs ?? null,
            c.avgChunkSizeBytes ?? null,
            c.evalDuration ?? null,
            c.promptEvalDuration ?? null,
            c.totalDuration ?? null,
            c.loadDuration ?? null,
            c.isColdStart ? 1 : 0,
            queueWaitMs ?? null,
            utcHourOfDay(ts),
            utcDayOfWeek(ts),
            utcDateStr(ts)
          );
        }

        for (const d of decisions) {
          const winner = d.candidates.find(c => c.serverId === d.selectedServerId);
          const info = this.stmts.insertDecision.run(
            d.timestamp,
            d.model,
            d.selectedServerId,
            d.algorithm,
            d.selectionReason,
            d.candidates.length,
            winner?.totalScore ?? null,
            winner?.latencyScore ?? null,
            winner?.successRateScore ?? null,
            winner?.loadScore ?? null,
            winner?.capacityScore ?? null,
            winner?.cbScore ?? null,
            winner?.timeoutScore ?? null,
            winner?.throughputScore ?? null,
            winner?.vramScore ?? null,
            winner?.p95Latency ?? null,
            winner?.successRate ?? null,
            winner?.inFlight ?? null,
            winner?.throughput ?? null,
            utcHourOfDay(d.timestamp),
            utcDayOfWeek(d.timestamp)
          );

          const decisionId = info.lastInsertRowid;
          for (const cand of d.candidates) {
            this.stmts.insertCandidate.run(
              decisionId,
              cand.serverId,
              cand.totalScore,
              cand.latencyScore,
              cand.successRateScore,
              cand.loadScore,
              cand.capacityScore,
              cand.p95Latency ?? null,
              cand.successRate ?? null,
              cand.inFlight ?? null,
              cand.throughput ?? null
            );
          }
        }

        for (const f of failovers) {
          this.stmts.insertFailover.run(
            f.timestamp,
            f.requestId,
            f.model,
            f.phase,
            f.serverId,
            f.result,
            f.errorType ?? null,
            f.latencyMs ?? null
          );
        }
      })();
    } catch (err) {
      logger.error('[MetricsStore] Batch flush failed', { error: err });
      // On error, discard the batch rather than retrying to avoid
      // duplicate rows on re-insert of partial-success transactions.
    }
  }

  // ============================================================
  // Internal: Rollup computation
  // ============================================================

  /**
   * Schedule rollup computation for the just-completed hour.
   * Waits for in-flight count to reach 0 or until the deadline.
   */
  scheduleHourlyRollup(hourStart: number): void {
    this.pendingRollupHours.add(hourStart);
    this.maybeRunRollups();
  }

  private maybeRunRollups(): void {
    if (this.pendingRollupHours.size === 0) return;

    const inFlight = this.config.getInFlightCount();
    const now = Date.now();

    const toCompute: number[] = [];
    for (const hourStart of this.pendingRollupHours) {
      const deadline =
        hourStart + 3_600_000 + this.config.performance.rollupDeadlineMinutes * 60_000;
      if (inFlight === 0 || now >= deadline) {
        toCompute.push(hourStart);
      }
    }

    for (const hourStart of toCompute) {
      this.pendingRollupHours.delete(hourStart);
      this.computeHourlyRollup(hourStart);
    }

    // Reschedule check if there are still pending rollups
    if (this.pendingRollupHours.size > 0) {
      clearTimeout(this.rollupCheckTimer);
      this.rollupCheckTimer = setTimeout(() => this.maybeRunRollups(), 5_000);
    }
  }

  computeHourlyRollup(hourStart: number): void {
    const hourEnd = hourStart + 3_600_000;
    const hourOfDay = utcHourOfDay(hourStart);
    const dayOfWeek = utcDayOfWeek(hourStart);

    const startMs = Date.now();

    try {
      // Flush buffer first to ensure all requests for this hour are in the DB
      this.flushBatch();

      this.db.transaction(() => {
        // Aggregate counts and sums
        this.db
          .prepare(
            `INSERT OR REPLACE INTO hourly_rollups (
              server_id, model, hour_start,
              total_requests, user_requests, successes, failures, cold_starts,
              latency_sum, latency_sq_sum, latency_min, latency_max,
              tokens_generated, tokens_prompt,
              ttft_count, ttft_sum,
              errors_timeout, errors_oom, errors_connection, errors_other,
              avg_tokens_per_second,
              hour_of_day, day_of_week
            )
            SELECT
              server_id, model, :hourStart,
              COUNT(*),
              SUM(CASE WHEN is_retry = 0 THEN 1 ELSE 0 END),
              SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END),
              SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END),
              SUM(is_cold_start),
              COALESCE(SUM(duration_ms), 0),
              COALESCE(SUM(duration_ms * duration_ms), 0),
              MIN(duration_ms),
              MAX(duration_ms),
              COALESCE(SUM(tokens_generated), 0),
              COALESCE(SUM(tokens_prompt), 0),
              COUNT(CASE WHEN ttft_ms IS NOT NULL THEN 1 END),
              COALESCE(SUM(ttft_ms), 0),
              COUNT(CASE WHEN error_type = 'timeout' THEN 1 END),
              COUNT(CASE WHEN error_type = 'oom' THEN 1 END),
              COUNT(CASE WHEN error_type = 'connection' THEN 1 END),
              COUNT(CASE WHEN error_type NOT IN ('timeout','oom','connection') AND success = 0 THEN 1 END),
              AVG(tokens_per_second),
              :hourOfDay,
              :dayOfWeek
            FROM requests
            WHERE timestamp >= :hourStart AND timestamp < :hourEnd
            GROUP BY server_id, model`
          )
          .run({ hourStart, hourEnd, hourOfDay, dayOfWeek });

        // Compute percentiles for each server:model in this hour
        const groups = this.db
          .prepare(
            `SELECT DISTINCT server_id, model FROM requests
             WHERE timestamp >= ? AND timestamp < ?`
          )
          .all(hourStart, hourEnd) as Array<{ server_id: string; model: string }>;

        for (const { server_id, model } of groups) {
          this.updateRollupPercentiles(server_id, model, hourStart);
        }
      })();

      const elapsed = Date.now() - startMs;
      if (elapsed > 500) {
        logger.warn(`[MetricsStore] Hourly rollup took ${elapsed}ms (exceeds 500ms threshold)`, {
          hourStart,
        });
      } else {
        logger.info(`[MetricsStore] Hourly rollup completed in ${elapsed}ms`, { hourStart });
      }
    } catch (err) {
      logger.error('[MetricsStore] Hourly rollup failed', { error: err, hourStart });
    }
  }

  private updateRollupPercentiles(serverId: string, model: string, hourStart: number): void {
    const hourEnd = hourStart + 3_600_000;

    const durations = (
      this.db
        .prepare(
          `SELECT duration_ms FROM requests
           WHERE server_id = ? AND model = ?
             AND timestamp >= ? AND timestamp < ?
             AND duration_ms IS NOT NULL
           ORDER BY duration_ms`
        )
        .all(serverId, model, hourStart, hourEnd) as Array<{ duration_ms: number }>
    ).map(r => r.duration_ms);

    const ttfts = (
      this.db
        .prepare(
          `SELECT ttft_ms FROM requests
           WHERE server_id = ? AND model = ?
             AND timestamp >= ? AND timestamp < ?
             AND ttft_ms IS NOT NULL
           ORDER BY ttft_ms`
        )
        .all(serverId, model, hourStart, hourEnd) as Array<{ ttft_ms: number }>
    ).map(r => r.ttft_ms);

    this.db
      .prepare(
        `UPDATE hourly_rollups
         SET latency_p50 = ?, latency_p95 = ?, latency_p99 = ?,
             ttft_p50 = ?, ttft_p95 = ?
         WHERE server_id = ? AND model = ? AND hour_start = ?`
      )
      .run(
        percentile(durations, 50),
        percentile(durations, 95),
        percentile(durations, 99),
        percentile(ttfts, 50),
        percentile(ttfts, 95),
        serverId,
        model,
        hourStart
      );
  }

  computeDailyRollup(dateStr: string): void {
    // Aggregate from hourly rollups for the given date
    const dayOfWeek = utcDayOfWeek(new Date(dateStr + 'T00:00:00Z').getTime());

    try {
      this.db.transaction(() => {
        this.db
          .prepare(
            `INSERT OR REPLACE INTO daily_rollups (
              server_id, model, date_str,
              total_requests, user_requests, successes, failures, cold_starts,
              latency_sum, latency_sq_sum, latency_min, latency_max,
              latency_p50, latency_p95, latency_p99,
              tokens_generated, tokens_prompt, avg_tokens_per_second,
              ttft_count, ttft_sum, ttft_p50, ttft_p95,
              errors_timeout, errors_oom, errors_connection, errors_other,
              day_of_week
            )
            SELECT
              server_id, model, :dateStr,
              SUM(total_requests), SUM(user_requests), SUM(successes), SUM(failures),
              SUM(cold_starts),
              SUM(latency_sum), SUM(latency_sq_sum), MIN(latency_min), MAX(latency_max),
              -- Weighted average of hourly p50/p95/p99
              SUM(latency_p50 * total_requests) / NULLIF(SUM(
                CASE WHEN latency_p50 IS NOT NULL THEN total_requests ELSE 0 END
              ), 0),
              SUM(latency_p95 * total_requests) / NULLIF(SUM(
                CASE WHEN latency_p95 IS NOT NULL THEN total_requests ELSE 0 END
              ), 0),
              SUM(latency_p99 * total_requests) / NULLIF(SUM(
                CASE WHEN latency_p99 IS NOT NULL THEN total_requests ELSE 0 END
              ), 0),
              SUM(tokens_generated), SUM(tokens_prompt),
              SUM(avg_tokens_per_second * total_requests) / NULLIF(SUM(total_requests), 0),
              SUM(ttft_count), SUM(ttft_sum),
              SUM(ttft_p50 * ttft_count) / NULLIF(SUM(
                CASE WHEN ttft_p50 IS NOT NULL THEN ttft_count ELSE 0 END
              ), 0),
              SUM(ttft_p95 * ttft_count) / NULLIF(SUM(
                CASE WHEN ttft_p95 IS NOT NULL THEN ttft_count ELSE 0 END
              ), 0),
              SUM(errors_timeout), SUM(errors_oom), SUM(errors_connection),
              SUM(errors_other),
              :dayOfWeek
            FROM hourly_rollups
            WHERE date(hour_start / 1000, 'unixepoch') = :dateStr
            GROUP BY server_id, model`
          )
          .run({ dateStr, dayOfWeek });
      })();

      logger.info(`[MetricsStore] Daily rollup completed for ${dateStr}`);
    } catch (err) {
      logger.error('[MetricsStore] Daily rollup failed', { error: err, dateStr });
    }
  }

  // ============================================================
  // Internal: Retention pruning
  // ============================================================

  pruneOldData(): void {
    const now = Date.now();
    const requestCutoff = now - this.config.retention.requests * 86_400_000;
    const decisionCutoff = now - this.config.retention.decisions * 86_400_000;
    const rollupCutoff = now - this.config.retention.rollups * 86_400_000;

    try {
      this.db.transaction(() => {
        const reqDel = this.db
          .prepare('DELETE FROM requests WHERE timestamp < ?')
          .run(requestCutoff);
        const decDel = this.db
          .prepare('DELETE FROM decisions WHERE timestamp < ?')
          .run(decisionCutoff);
        // Cascade via ON DELETE CASCADE on decision_candidates
        const foDel = this.db
          .prepare('DELETE FROM failover_attempts WHERE timestamp < ?')
          .run(requestCutoff);
        const hrDel = this.db
          .prepare('DELETE FROM hourly_rollups WHERE hour_start < ?')
          .run(rollupCutoff);

        // daily_rollups: cutoff by date string
        const rollupCutoffDate = utcDateStr(rollupCutoff);
        const drDel = this.db
          .prepare('DELETE FROM daily_rollups WHERE date_str < ?')
          .run(rollupCutoffDate);

        const total =
          reqDel.changes + decDel.changes + foDel.changes + hrDel.changes + drDel.changes;
        if (total > 0) {
          logger.info(`[MetricsStore] Pruned ${total} expired rows`, {
            requests: reqDel.changes,
            decisions: decDel.changes,
            failovers: foDel.changes,
            hourlyRollups: hrDel.changes,
            dailyRollups: drDel.changes,
          });
          // Reclaim space incrementally
          this.db.pragma('incremental_vacuum(100)');
        }
      })();
    } catch (err) {
      logger.error('[MetricsStore] Retention pruning failed', { error: err });
    }
  }

  // ============================================================
  // Internal: Timers
  // ============================================================

  private startTimers(): void {
    // Periodic flush
    this.flushTimer = setInterval(
      () => this.flushBatch(),
      this.config.performance.batchFlushIntervalMs
    );

    // Retention pruning
    this.retentionTimer = setInterval(
      () => this.pruneOldData(),
      this.config.performance.retentionCheckIntervalMs
    );

    // Profile rebuild (phase 3 — no-op in phase 1)
    this.profileRebuildTimer = setInterval(() => {
      /* Phase 3: this.rebuildTemporalProfiles() */
    }, this.config.performance.profileRebuildIntervalMs);

    // Hourly rollup scheduling: check once per minute whether a new hour
    // has started and schedule a rollup for the previous hour
    let lastScheduledHour = truncateToHour(Date.now());
    setInterval(() => {
      const currentHour = truncateToHour(Date.now());
      if (currentHour > lastScheduledHour) {
        this.scheduleHourlyRollup(lastScheduledHour);
        // Also compute yesterday's daily rollup at midnight UTC
        const currentDate = utcDateStr(Date.now());
        const prevDate = utcDateStr(Date.now() - 86_400_000);
        if (utcHourOfDay(Date.now()) === 1) {
          // ~1 AM UTC — yesterday's data is complete
          this.computeDailyRollup(prevDate);
          logger.info(`[MetricsStore] Triggered daily rollup for ${prevDate}`);
        }
        lastScheduledHour = currentHour;
      }
    }, 60_000);
  }

  private stopTimers(): void {
    clearInterval(this.flushTimer);
    clearInterval(this.retentionTimer);
    clearInterval(this.profileRebuildTimer);
    clearTimeout(this.rollupCheckTimer);
  }

  // ============================================================
  // Diagnostics
  // ============================================================

  /**
   * Returns row counts for all tables. Useful for logging and health checks.
   */
  getTableCounts(): Record<string, number> {
    const tables = [
      'requests',
      'decisions',
      'decision_candidates',
      'failover_attempts',
      'hourly_rollups',
      'daily_rollups',
      'temporal_profiles',
    ];
    const result: Record<string, number> = {};
    for (const t of tables) {
      const row = this.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number };
      result[t] = row.n;
    }
    return result;
  }

  /**
   * Returns the SQLite database file size in bytes.
   */
  getDbSizeBytes(): number {
    try {
      return fs.statSync(this.config.dbPath).size;
    } catch {
      return 0;
    }
  }
}

// ============================================================
// Singleton
// ============================================================

let _instance: MetricsStore | undefined;

export function getMetricsStore(
  config?: Partial<Omit<MetricsStoreConfig, 'retention' | 'performance' | 'temporal'>> & {
    retention?: Partial<StorageRetentionConfig>;
    performance?: Partial<MetricsStoreConfig['performance']>;
    temporal?: Partial<MetricsStoreConfig['temporal']>;
    getInFlightCount?: () => number;
  }
): MetricsStore {
  if (!_instance) {
    _instance = new MetricsStore(config);
  }
  return _instance;
}

/** Reset the singleton (used in tests) */
export function resetMetricsStore(): void {
  if (_instance) {
    try {
      _instance.close();
    } catch {
      // ignore close errors during test teardown
    }
    _instance = undefined;
  }
}
