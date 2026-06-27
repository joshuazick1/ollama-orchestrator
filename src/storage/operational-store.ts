import fs from 'fs';
import path from 'path';

import Database, { Statement } from 'better-sqlite3';

import { logger } from '../utils/logger.js';
import type { TimeoutState } from '../utils/timeout-manager.js';

import { applySchema } from './schema.js';
import { DEFAULT_STORAGE_CONFIG } from './types.js';

// ──────────────────────────────────────────────────────────────────────────────
// Shared row types
// ──────────────────────────────────────────────────────────────────────────────

interface BanRow {
  id: number;
  server_id: string;
  model: string;
  reason: string | null;
  banned_at: number;
  unbanned_at: number | null;
}

interface TimeoutRow {
  key: string;
  server_id: string;
  model: string | null;
  base_timeout_ms: number;
  current_timeout: number;
  ema_latency: number | null;
  sample_count: number | null;
  last_updated: number;
  created_at: number;
}

interface CBStateRow {
  server_id: string;
  model: string;
  state: string;
  failure_count: number;
  success_count: number;
  last_failure_at: number | null;
  last_success_at: number | null;
  opened_at: number | null;
  next_retry_at: number | null;
  error_window: string | null;
  adaptive_threshold: number | null;
  consecutive_failed_recoveries: number | null;
  half_open_attempts: number | null;
  updated_at: number;
}

interface CBTransitionRow {
  id: number;
  server_id: string;
  model: string;
  from_state: string;
  to_state: string;
  reason: string | null;
  timestamp: number;
}

interface ProbeStateRow {
  tuple_key: string;
  server_id: string;
  model: string;
  endpoint: string;
  state: string;
  consecutive_successes: number;
  consecutive_failures: number;
  error_window: string | null;
  last_transition: number | null;
  last_probe_at: number | null;
  next_probe_at: number | null;
  recovery_attempts: number;
  last_error_kind: string | null;
  updated_at: number;
}

interface MetricsSnapshotRow {
  server_id: string;
  model: string;
  latency_avg: number | null;
  latency_p95: number | null;
  latency_p99: number | null;
  success_rate: number | null;
  throughput: number | null;
  tokens_per_second: number | null;
  ttft_avg: number | null;
  in_flight: number | null;
  total_requests: number | null;
  recent_errors: number | null;
  parameter_size: string | null;
  family: string | null;
  quantization: string | null;
  last_request_at: number | null;
  updated_at: number;
}

interface RecoveryFailureRow {
  id: number;
  server_id: string;
  model: string | null;
  error_type: string;
  error_message: string | null;
  phase: string | null;
  recovery_attempted: number;
  recovery_success: number | null;
  latency_ms: number | null;
  timestamp: number;
}

interface MetricsSummaryRow {
  id: number;
  timestamp: number;
  total_servers: number | null;
  healthy_servers: number | null;
  total_models: number | null;
  total_requests_1h: number | null;
  avg_latency_ms: number | null;
  overall_success_rate: number | null;
  total_in_flight: number | null;
  snapshot_data: string | null;
  hour_of_day: number | null;
  day_of_week: number | null;
}

export class OperationalStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? DEFAULT_STORAGE_CONFIG.dbPath;

    // Ensure data directory exists
    const dir = path.dirname(path.resolve(resolvedPath));
    if (resolvedPath !== ':memory:' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    applySchema(this.db);

    logger.info(`[OperationalStore] Opened SQLite database at ${resolvedPath}`);
  }

  close(): void {
    this.db.close();
    logger.info('[OperationalStore] Database closed');
  }

  /**
   * Run a callback inside a SQLite transaction.
   * Used by WALStore and other wrappers for atomic multi-statement operations.
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Expose prepared statement access for wrappers like WALStore.
   */
  prepare(sql: string): Statement {
    return this.db.prepare(sql);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Bans CRUD (Task 7.3)
  // ══════════════════════════════════════════════════════════════════════════

  addBan(serverId: string, model: string, reason?: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO bans (server_id, model, reason, banned_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(serverId, model, reason ?? null, Date.now());
  }

  removeBan(serverId: string, model: string): void {
    this.db
      .prepare(
        `UPDATE bans SET unbanned_at = ?
         WHERE server_id = ? AND model = ? AND unbanned_at IS NULL`
      )
      .run(Date.now(), serverId, model);
  }

  cleanupStaleState(activeServerIds: string[]): void {
    const ids = new Set(activeServerIds);

    const staleCB = this.db.prepare(`SELECT server_id, model FROM circuit_breaker_state`).all() as {
      server_id: string;
      model: string;
    }[];
    for (const row of staleCB) {
      if (!ids.has(row.server_id)) {
        this.db
          .prepare(`DELETE FROM circuit_breaker_state WHERE server_id = ? AND model = ?`)
          .run(row.server_id, row.model);
      }
    }

    const staleBans = this.db.prepare(`SELECT id, server_id FROM bans`).all() as {
      id: number;
      server_id: string;
    }[];
    for (const row of staleBans) {
      if (!ids.has(row.server_id)) {
        this.db.prepare(`DELETE FROM bans WHERE id = ?`).run(row.id);
      }
    }

    logger.info(`OperationalStore: cleaned stale state, removed entries for unknown servers`, {
      activeCount: activeServerIds.length,
    });
  }

  getActiveBans(): Array<{
    serverId: string;
    model: string;
    reason: string | null;
    bannedAt: number;
  }> {
    const rows = this.db
      .prepare(
        `SELECT server_id, model, reason, banned_at
         FROM bans WHERE unbanned_at IS NULL`
      )
      .all() as Array<Pick<BanRow, 'server_id' | 'model' | 'reason' | 'banned_at'>>;
    return rows.map(r => ({
      serverId: r.server_id,
      model: r.model,
      reason: r.reason,
      bannedAt: r.banned_at,
    }));
  }

  removeServerBans(serverId: string): number {
    const result = this.db
      .prepare(
        `UPDATE bans SET unbanned_at = ?
         WHERE server_id = ? AND unbanned_at IS NULL`
      )
      .run(Date.now(), serverId);
    return result.changes;
  }

  removeModelBans(model: string): number {
    const result = this.db
      .prepare(
        `UPDATE bans SET unbanned_at = ?
         WHERE model = ? AND unbanned_at IS NULL`
      )
      .run(Date.now(), model);
    return result.changes;
  }

  clearAllBans(): number {
    const result = this.db
      .prepare(`UPDATE bans SET unbanned_at = ? WHERE unbanned_at IS NULL`)
      .run(Date.now());
    return result.changes;
  }

  getBanHistory(
    serverId?: string,
    since?: number
  ): Array<{
    id: number;
    serverId: string;
    model: string;
    reason: string | null;
    bannedAt: number;
    unbannedAt: number | null;
  }> {
    let sql = `SELECT id, server_id, model, reason, banned_at, unbanned_at FROM bans WHERE 1=1`;
    const params: (string | number)[] = [];
    if (serverId !== undefined) {
      sql += ` AND server_id = ?`;
      params.push(serverId);
    }
    if (since !== undefined) {
      sql += ` AND banned_at >= ?`;
      params.push(since);
    }
    sql += ` ORDER BY banned_at DESC`;
    const rows = this.db.prepare(sql).all(...params) as BanRow[];
    return rows.map(r => ({
      id: r.id,
      serverId: r.server_id,
      model: r.model,
      reason: r.reason,
      bannedAt: r.banned_at,
      unbannedAt: r.unbanned_at,
    }));
  }

  private migrateJsonBans(filePath: string): void {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as string[];
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO bans (server_id, model, reason, banned_at) VALUES (?, ?, ?, ?)`
    );
    const now = Date.now();
    const migrate = this.db.transaction(() => {
      for (const entry of data) {
        const colonIdx = entry.indexOf(':');
        if (colonIdx === -1) {
          continue;
        }
        const serverId = entry.slice(0, colonIdx);
        const model = entry.slice(colonIdx + 1);
        insert.run(serverId, model, 'migrated from bans.json', now);
      }
    });
    migrate();
    fs.renameSync(filePath, `${filePath}.bak`);
    logger.info(`[OperationalStore] Migrated bans from ${filePath}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Adaptive Timeouts CRUD (Task 7.4)
  // ══════════════════════════════════════════════════════════════════════════

  saveTimeout(key: string, state: TimeoutState): void {
    const colonIdx = key.indexOf(':');
    const serverId = colonIdx !== -1 ? key.slice(0, colonIdx) : key;
    const model = colonIdx !== -1 ? key.slice(colonIdx + 1) : null;
    const now = Date.now();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO adaptive_timeouts
           (key, server_id, model, base_timeout_ms, current_timeout, ema_latency, sample_count, last_updated, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?,
           ?,
           COALESCE((SELECT created_at FROM adaptive_timeouts WHERE key = ?), ?)
         )`
      )
      .run(
        key,
        serverId,
        model,
        state.baseTimeout,
        state.currentTimeout,
        null,
        null,
        state.lastUpdated ?? now,
        key,
        now
      );
  }

  getTimeout(key: string): TimeoutState | undefined {
    const row = this.db.prepare(`SELECT * FROM adaptive_timeouts WHERE key = ?`).get(key) as
      | TimeoutRow
      | undefined;
    if (!row) {
      return undefined;
    }
    return {
      baseTimeout: row.base_timeout_ms,
      currentTimeout: row.current_timeout,
      lastUpdated: row.last_updated,
    };
  }

  getAllTimeouts(): Record<string, TimeoutState> {
    const rows = this.db.prepare(`SELECT * FROM adaptive_timeouts`).all() as TimeoutRow[];
    const result: Record<string, TimeoutState> = {};
    for (const row of rows) {
      result[row.key] = {
        baseTimeout: row.base_timeout_ms,
        currentTimeout: row.current_timeout,
        lastUpdated: row.last_updated,
      };
    }
    return result;
  }

  pruneStaleTimeouts(maxAgeDays = 30): number {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const result = this.db
      .prepare(`DELETE FROM adaptive_timeouts WHERE last_updated < ?`)
      .run(cutoff);
    return result.changes;
  }

  private migrateJsonTimeouts(filePath: string): void {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as Record<string, number | TimeoutState>;
    const now = Date.now();
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO adaptive_timeouts
         (key, server_id, model, base_timeout_ms, current_timeout, ema_latency, sample_count, last_updated, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const migrate = this.db.transaction(() => {
      for (const [key, value] of Object.entries(data)) {
        const colonIdx = key.indexOf(':');
        const serverId = colonIdx !== -1 ? key.slice(0, colonIdx) : key;
        const model = colonIdx !== -1 ? key.slice(colonIdx + 1) : null;
        if (typeof value === 'number') {
          insert.run(key, serverId, model, value, value, null, null, now, now);
        } else {
          const ts = value;
          insert.run(
            key,
            serverId,
            model,
            ts.baseTimeout,
            ts.currentTimeout,
            null,
            null,
            ts.lastUpdated ?? now,
            now
          );
        }
      }
    });
    migrate();
    fs.renameSync(filePath, `${filePath}.bak`);
    logger.info(`[OperationalStore] Migrated timeouts from ${filePath}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Circuit Breaker State CRUD (Task 7.5)
  // ══════════════════════════════════════════════════════════════════════════

  saveCircuitBreakerState(
    serverId: string,
    model: string,
    data: {
      state: string;
      failureCount: number;
      successCount: number;
      lastFailureAt?: number;
      lastSuccessAt?: number;
      openedAt?: number;
      nextRetryAt?: number;
      errorWindow?: string;
      adaptiveThreshold?: number;
      consecutiveFailedRecoveries?: number;
      halfOpenAttempts?: number;
    }
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO circuit_breaker_state
           (server_id, model, state, failure_count, success_count,
            last_failure_at, last_success_at, opened_at, next_retry_at,
            error_window, adaptive_threshold, consecutive_failed_recoveries,
            half_open_attempts, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        serverId,
        model,
        data.state,
        data.failureCount,
        data.successCount,
        data.lastFailureAt ?? null,
        data.lastSuccessAt ?? null,
        data.openedAt ?? null,
        data.nextRetryAt ?? null,
        data.errorWindow ?? null,
        data.adaptiveThreshold ?? null,
        data.consecutiveFailedRecoveries ?? null,
        data.halfOpenAttempts ?? null,
        Date.now()
      );
  }

  getCircuitBreakerState(
    serverId: string,
    model: string
  ):
    | {
        serverId: string;
        model: string;
        endpoint: string | null;
        state: string;
        failureCount: number;
        successCount: number;
        lastFailureAt: number | null;
        lastSuccessAt: number | null;
        openedAt: number | null;
        nextRetryAt: number | null;
        errorWindow: string | null;
        adaptiveThreshold: number | null;
        consecutiveFailedRecoveries: number | null;
        halfOpenAttempts: number | null;
        updatedAt: number;
      }
    | undefined {
    const row = this.db
      .prepare(`SELECT * FROM circuit_breaker_state WHERE server_id = ? AND model = ?`)
      .get(serverId, model) as CBStateRow | undefined;
    if (!row) {
      return undefined;
    }
    return {
      serverId: row.server_id,
      model: row.model,
      endpoint: null,
      state: row.state,
      failureCount: row.failure_count,
      successCount: row.success_count,
      lastFailureAt: row.last_failure_at,
      lastSuccessAt: row.last_success_at,
      openedAt: row.opened_at,
      nextRetryAt: row.next_retry_at,
      errorWindow: row.error_window,
      adaptiveThreshold: row.adaptive_threshold,
      consecutiveFailedRecoveries: row.consecutive_failed_recoveries,
      halfOpenAttempts: row.half_open_attempts,
      updatedAt: row.updated_at,
    };
  }

  getAllCircuitBreakerStates(): Array<{
    serverId: string;
    model: string;
    state: string;
    failureCount: number;
    successCount: number;
    lastFailureAt: number | null;
    lastSuccessAt: number | null;
    openedAt: number | null;
    nextRetryAt: number | null;
    errorWindow: string | null;
    adaptiveThreshold: number | null;
    consecutiveFailedRecoveries: number | null;
    halfOpenAttempts: number | null;
    updatedAt: number;
  }> {
    const rows = this.db.prepare(`SELECT * FROM circuit_breaker_state`).all() as CBStateRow[];
    return rows.map(r => ({
      serverId: r.server_id,
      model: r.model,
      state: r.state,
      failureCount: r.failure_count,
      successCount: r.success_count,
      lastFailureAt: r.last_failure_at,
      lastSuccessAt: r.last_success_at,
      openedAt: r.opened_at,
      nextRetryAt: r.next_retry_at,
      errorWindow: r.error_window,
      adaptiveThreshold: r.adaptive_threshold,
      consecutiveFailedRecoveries: r.consecutive_failed_recoveries,
      halfOpenAttempts: r.half_open_attempts,
      updatedAt: r.updated_at,
    }));
  }

  recordCBTransition(
    serverId: string,
    model: string,
    fromState: string,
    toState: string,
    reason: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO circuit_breaker_transitions
           (server_id, model, from_state, to_state, reason, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(serverId, model, fromState, toState, reason, Date.now());
  }

  getCBTransitions(
    serverId?: string,
    model?: string,
    limit = 1000
  ): Array<{
    id: number;
    serverId: string;
    model: string;
    fromState: string;
    toState: string;
    reason: string | null;
    timestamp: number;
  }> {
    let sql = `SELECT * FROM circuit_breaker_transitions WHERE 1=1`;
    const params: (string | number)[] = [];
    if (serverId !== undefined) {
      sql += ` AND server_id = ?`;
      params.push(serverId);
    }
    if (model !== undefined) {
      sql += ` AND model = ?`;
      params.push(model);
    }
    sql += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);
    const rows = this.db.prepare(sql).all(...params) as CBTransitionRow[];
    return rows.map(r => ({
      id: r.id,
      serverId: r.server_id,
      model: r.model,
      fromState: r.from_state,
      toState: r.to_state,
      reason: r.reason,
      timestamp: r.timestamp,
    }));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Probe State CRUD (Task G1: CB State Persistence)
  // Direct persistence for ProbeOrchestrator tuple states
  // Complements WAL-based persistence with direct CRUD access
  // ══════════════════════════════════════════════════════════════════════════

  saveProbeTupleState(
    tupleKey: string,
    serverId: string,
    model: string,
    endpoint: string,
    data: {
      state: string;
      consecutiveSuccesses: number;
      consecutiveFailures: number;
      errorWindow?: number[];
      lastTransition?: number;
      lastProbeAt?: number;
      nextProbeAt?: number;
      recoveryAttempts?: number;
      lastErrorKind?: string;
    }
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO probe_state
           (tuple_key, server_id, model, endpoint, state,
            consecutive_successes, consecutive_failures, error_window,
            last_transition, last_probe_at, next_probe_at,
            recovery_attempts, last_error_kind, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        tupleKey,
        serverId,
        model,
        endpoint,
        data.state,
        data.consecutiveSuccesses,
        data.consecutiveFailures,
        data.errorWindow ? JSON.stringify(data.errorWindow) : null,
        data.lastTransition ?? null,
        data.lastProbeAt ?? null,
        data.nextProbeAt ?? null,
        data.recoveryAttempts ?? 0,
        data.lastErrorKind ?? null,
        Date.now()
      );
  }

  getProbeTupleState(tupleKey: string):
    | {
        tupleKey: string;
        serverId: string;
        model: string;
        endpoint: string;
        state: string;
        consecutiveSuccesses: number;
        consecutiveFailures: number;
        errorWindow: number[];
        lastTransition: number | null;
        lastProbeAt: number | null;
        nextProbeAt: number | null;
        recoveryAttempts: number;
        lastErrorKind: string | null;
        updatedAt: number;
      }
    | undefined {
    const row = this.db.prepare(`SELECT * FROM probe_state WHERE tuple_key = ?`).get(tupleKey) as
      | ProbeStateRow
      | undefined;
    if (!row) {
      return undefined;
    }
    return {
      tupleKey: row.tuple_key,
      serverId: row.server_id,
      model: row.model,
      endpoint: row.endpoint,
      state: row.state,
      consecutiveSuccesses: row.consecutive_successes,
      consecutiveFailures: row.consecutive_failures,
      errorWindow: row.error_window ? JSON.parse(row.error_window) : [],
      lastTransition: row.last_transition,
      lastProbeAt: row.last_probe_at,
      nextProbeAt: row.next_probe_at,
      recoveryAttempts: row.recovery_attempts,
      lastErrorKind: row.last_error_kind,
      updatedAt: row.updated_at,
    };
  }

  getAllProbeStates(): Array<{
    tupleKey: string;
    serverId: string;
    model: string;
    endpoint: string;
    state: string;
    consecutiveSuccesses: number;
    consecutiveFailures: number;
    errorWindow: number[];
    lastTransition: number | null;
    lastProbeAt: number | null;
    nextProbeAt: number | null;
    recoveryAttempts: number;
    lastErrorKind: string | null;
    updatedAt: number;
  }> {
    const rows = this.db.prepare(`SELECT * FROM probe_state`).all() as ProbeStateRow[];
    return rows.map(r => ({
      tupleKey: r.tuple_key,
      serverId: r.server_id,
      model: r.model,
      endpoint: r.endpoint,
      state: r.state,
      consecutiveSuccesses: r.consecutive_successes,
      consecutiveFailures: r.consecutive_failures,
      errorWindow: r.error_window ? JSON.parse(r.error_window) : [],
      lastTransition: r.last_transition,
      lastProbeAt: r.last_probe_at,
      nextProbeAt: r.next_probe_at,
      recoveryAttempts: r.recovery_attempts,
      lastErrorKind: r.last_error_kind,
      updatedAt: r.updated_at,
    }));
  }

  deleteProbeTupleState(tupleKey: string): void {
    this.db.prepare(`DELETE FROM probe_state WHERE tuple_key = ?`).run(tupleKey);
  }

  deleteAllProbeStatesForServer(serverId: string): number {
    const result = this.db.prepare(`DELETE FROM probe_state WHERE server_id = ?`).run(serverId);
    return result.changes;
  }

  private migrateJsonCircuitBreakers(filePath: string): void {
    const raw = fs.readFileSync(filePath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = JSON.parse(raw) as { timestamp: number; breakers: Record<string, any> };
    const migrate = this.db.transaction(() => {
      for (const [key, breaker] of Object.entries(data.breakers)) {
        const colonIdx = key.indexOf(':');
        const serverId = colonIdx !== -1 ? key.slice(0, colonIdx) : key;
        const model = colonIdx !== -1 ? key.slice(colonIdx + 1) : key;
        this.saveCircuitBreakerState(serverId, model, {
          state: breaker.state ?? 'closed',
          failureCount: breaker.failureCount ?? 0,
          successCount: breaker.successCount ?? 0,
          lastFailureAt: breaker.lastFailure ?? null,
          lastSuccessAt: breaker.lastSuccess ?? null,
          nextRetryAt: breaker.nextRetryAt ?? null,
        });
      }
    });
    migrate();
    fs.renameSync(filePath, `${filePath}.bak`);
    logger.info(`[OperationalStore] Migrated circuit breakers from ${filePath}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Server Metrics Snapshot CRUD (Task 7.6)
  // ══════════════════════════════════════════════════════════════════════════

  saveMetricsSnapshot(
    serverId: string,
    model: string,
    data: {
      latencyAvg?: number;
      latencyP95?: number;
      latencyP99?: number;
      successRate?: number;
      throughput?: number;
      tokensPerSecond?: number;
      ttftAvg?: number;
      inFlight?: number;
      totalRequests?: number;
      recentErrors?: number;
      parameterSize?: string;
      family?: string;
      quantization?: string;
      lastRequestAt?: number;
      updatedAt?: number;
    }
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO server_metrics_snapshot
           (server_id, model, latency_avg, latency_p95, latency_p99,
            success_rate, throughput, tokens_per_second, ttft_avg,
            in_flight, total_requests, recent_errors,
            parameter_size, family, quantization,
            last_request_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        serverId,
        model,
        data.latencyAvg ?? null,
        data.latencyP95 ?? null,
        data.latencyP99 ?? null,
        data.successRate ?? null,
        data.throughput ?? null,
        data.tokensPerSecond ?? null,
        data.ttftAvg ?? null,
        data.inFlight ?? null,
        data.totalRequests ?? null,
        data.recentErrors ?? null,
        data.parameterSize ?? null,
        data.family ?? null,
        data.quantization ?? null,
        data.lastRequestAt ?? null,
        data.updatedAt ?? Date.now()
      );
  }

  getMetricsSnapshot(
    serverId: string,
    model: string
  ):
    | {
        serverId: string;
        model: string;
        latencyAvg: number | null;
        latencyP95: number | null;
        latencyP99: number | null;
        successRate: number | null;
        throughput: number | null;
        tokensPerSecond: number | null;
        ttftAvg: number | null;
        inFlight: number | null;
        totalRequests: number | null;
        recentErrors: number | null;
        parameterSize: string | null;
        family: string | null;
        quantization: string | null;
        lastRequestAt: number | null;
        updatedAt: number;
      }
    | undefined {
    const row = this.db
      .prepare(`SELECT * FROM server_metrics_snapshot WHERE server_id = ? AND model = ?`)
      .get(serverId, model) as MetricsSnapshotRow | undefined;
    if (!row) {
      return undefined;
    }
    return this.mapSnapshotRow(row);
  }

  getAllMetricsSnapshots(): Array<{
    serverId: string;
    model: string;
    latencyAvg: number | null;
    latencyP95: number | null;
    latencyP99: number | null;
    successRate: number | null;
    throughput: number | null;
    tokensPerSecond: number | null;
    ttftAvg: number | null;
    inFlight: number | null;
    totalRequests: number | null;
    recentErrors: number | null;
    parameterSize: string | null;
    family: string | null;
    quantization: string | null;
    lastRequestAt: number | null;
    updatedAt: number;
  }> {
    const rows = this.db
      .prepare(`SELECT * FROM server_metrics_snapshot`)
      .all() as MetricsSnapshotRow[];
    return rows.map(r => this.mapSnapshotRow(r));
  }

  pruneStaleSnapshots(maxAgeMs = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    const result = this.db
      .prepare(
        `DELETE FROM server_metrics_snapshot WHERE updated_at < ? AND (in_flight IS NULL OR in_flight = 0)`
      )
      .run(cutoff);
    return result.changes;
  }

  private mapSnapshotRow(row: MetricsSnapshotRow): {
    serverId: string;
    model: string;
    latencyAvg: number | null;
    latencyP95: number | null;
    latencyP99: number | null;
    successRate: number | null;
    throughput: number | null;
    tokensPerSecond: number | null;
    ttftAvg: number | null;
    inFlight: number | null;
    totalRequests: number | null;
    recentErrors: number | null;
    parameterSize: string | null;
    family: string | null;
    quantization: string | null;
    lastRequestAt: number | null;
    updatedAt: number;
  } {
    return {
      serverId: row.server_id,
      model: row.model,
      latencyAvg: row.latency_avg,
      latencyP95: row.latency_p95,
      latencyP99: row.latency_p99,
      successRate: row.success_rate,
      throughput: row.throughput,
      tokensPerSecond: row.tokens_per_second,
      ttftAvg: row.ttft_avg,
      inFlight: row.in_flight,
      totalRequests: row.total_requests,
      recentErrors: row.recent_errors,
      parameterSize: row.parameter_size,
      family: row.family,
      quantization: row.quantization,
      lastRequestAt: row.last_request_at,
      updatedAt: row.updated_at,
    };
  }

  private migrateJsonMetrics(filePath: string): void {
    const raw = fs.readFileSync(filePath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = JSON.parse(raw) as { timestamp: number; servers: Record<string, any> };
    const migrate = this.db.transaction(() => {
      for (const [key, metrics] of Object.entries(data.servers)) {
        const colonIdx = key.indexOf(':');
        const serverId = colonIdx !== -1 ? key.slice(0, colonIdx) : key;
        const model = colonIdx !== -1 ? key.slice(colonIdx + 1) : key;
        this.saveMetricsSnapshot(serverId, model, {
          latencyAvg: metrics.percentiles?.p50 ?? null,
          latencyP95: metrics.percentiles?.p95 ?? null,
          latencyP99: metrics.percentiles?.p99 ?? null,
          successRate: metrics.successRate ?? null,
          throughput: metrics.throughput ?? null,
          tokensPerSecond: metrics.avgTokensPerSecond ?? null,
          inFlight: metrics.inFlight ?? null,
          totalRequests: metrics.windows?.['1h']?.count ?? null,
          parameterSize: metrics.parameterSize ?? null,
          family: metrics.family ?? null,
          quantization: metrics.quantization ?? null,
          lastRequestAt: metrics.lastUpdated ?? null,
        });
      }
    });
    migrate();
    fs.renameSync(filePath, `${filePath}.bak`);
    logger.info(`[OperationalStore] Migrated metrics from ${filePath}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Recovery Failures CRUD (Task 7.7)
  // ══════════════════════════════════════════════════════════════════════════

  recordRecoveryFailure(failure: {
    serverId: string;
    model?: string;
    errorType: string;
    errorMessage?: string;
    phase?: string;
    recoveryAttempted?: boolean;
    recoverySuccess?: boolean;
    latencyMs?: number;
    timestamp?: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO recovery_failures
           (server_id, model, error_type, error_message, phase,
            recovery_attempted, recovery_success, latency_ms, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        failure.serverId,
        failure.model ?? null,
        failure.errorType,
        failure.errorMessage ?? null,
        failure.phase ?? null,
        failure.recoveryAttempted ? 1 : 0,
        failure.recoverySuccess !== undefined ? (failure.recoverySuccess ? 1 : 0) : null,
        failure.latencyMs ?? null,
        failure.timestamp ?? Date.now()
      );
  }

  getRecoveryFailures(
    serverId?: string,
    limit = 1000
  ): Array<{
    id: number;
    serverId: string;
    model: string | null;
    errorType: string;
    errorMessage: string | null;
    phase: string | null;
    recoveryAttempted: number;
    recoverySuccess: number | null;
    latencyMs: number | null;
    timestamp: number;
  }> {
    let sql = `SELECT * FROM recovery_failures WHERE 1=1`;
    const params: (string | number)[] = [];
    if (serverId !== undefined) {
      sql += ` AND server_id = ?`;
      params.push(serverId);
    }
    sql += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);
    const rows = this.db.prepare(sql).all(...params) as RecoveryFailureRow[];
    return rows.map(r => ({
      id: r.id,
      serverId: r.server_id,
      model: r.model,
      errorType: r.error_type,
      errorMessage: r.error_message,
      phase: r.phase,
      recoveryAttempted: r.recovery_attempted,
      recoverySuccess: r.recovery_success,
      latencyMs: r.latency_ms,
      timestamp: r.timestamp,
    }));
  }

  pruneOldRecoveryFailures(maxAgeDays = 30): number {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const result = this.db.prepare(`DELETE FROM recovery_failures WHERE timestamp < ?`).run(cutoff);
    return result.changes;
  }

  private migrateJsonRecoveryFailures(filePath: string): void {
    const raw = fs.readFileSync(filePath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = JSON.parse(raw) as {
      version: number;
      records: any[];
      circuitBreakerTransitions: any[];
    };
    const migrate = this.db.transaction(() => {
      for (const record of data.records ?? []) {
        this.recordRecoveryFailure({
          serverId: record.serverId ?? 'unknown',
          model: record.model ?? undefined,
          errorType: record.errorType ?? record.error ?? 'unknown',
          errorMessage: record.error ?? undefined,
          phase: record.source ?? undefined,
          recoveryAttempted: false,
          timestamp: record.timestamp ?? Date.now(),
        });
      }
      for (const transition of data.circuitBreakerTransitions ?? []) {
        this.recordCBTransition(
          transition.serverId ?? 'unknown',
          transition.model ?? 'unknown',
          transition.previousState ?? 'closed',
          transition.newState ?? 'open',
          transition.reason ?? 'migrated'
        );
      }
    });
    migrate();
    fs.renameSync(filePath, `${filePath}.bak`);
    logger.info(`[OperationalStore] Migrated recovery failures from ${filePath}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Metrics Summary CRUD (Task 7.8)
  // ══════════════════════════════════════════════════════════════════════════

  recordMetricsSummary(snapshot: {
    timestamp: number;
    totalServers?: number;
    healthyServers?: number;
    totalModels?: number;
    totalRequests1h?: number;
    avgLatencyMs?: number;
    overallSuccessRate?: number;
    totalInFlight?: number;
    snapshotData?: string;
    hourOfDay?: number;
    dayOfWeek?: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO metrics_summary
           (timestamp, total_servers, healthy_servers, total_models,
            total_requests_1h, avg_latency_ms, overall_success_rate,
            total_in_flight, snapshot_data, hour_of_day, day_of_week)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        snapshot.timestamp,
        snapshot.totalServers ?? null,
        snapshot.healthyServers ?? null,
        snapshot.totalModels ?? null,
        snapshot.totalRequests1h ?? null,
        snapshot.avgLatencyMs ?? null,
        snapshot.overallSuccessRate ?? null,
        snapshot.totalInFlight ?? null,
        snapshot.snapshotData ?? null,
        snapshot.hourOfDay ?? null,
        snapshot.dayOfWeek ?? null
      );
  }

  getMetricsSummaries(
    limit = 720,
    since?: number
  ): Array<{
    id: number;
    timestamp: number;
    totalServers: number | null;
    healthyServers: number | null;
    totalModels: number | null;
    totalRequests1h: number | null;
    avgLatencyMs: number | null;
    overallSuccessRate: number | null;
    totalInFlight: number | null;
    snapshotData: string | null;
    hourOfDay: number | null;
    dayOfWeek: number | null;
  }> {
    let sql = `SELECT * FROM metrics_summary WHERE 1=1`;
    const params: (string | number)[] = [];
    if (since !== undefined) {
      sql += ` AND timestamp >= ?`;
      params.push(since);
    }
    sql += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);
    const rows = this.db.prepare(sql).all(...params) as MetricsSummaryRow[];
    return rows.map(r => ({
      id: r.id,
      timestamp: r.timestamp,
      totalServers: r.total_servers,
      healthyServers: r.healthy_servers,
      totalModels: r.total_models,
      totalRequests1h: r.total_requests_1h,
      avgLatencyMs: r.avg_latency_ms,
      overallSuccessRate: r.overall_success_rate,
      totalInFlight: r.total_in_flight,
      snapshotData: r.snapshot_data,
      hourOfDay: r.hour_of_day,
      dayOfWeek: r.day_of_week,
    }));
  }

  getLatestMetricsSummary():
    | {
        id: number;
        timestamp: number;
        totalServers: number | null;
        healthyServers: number | null;
        totalModels: number | null;
        totalRequests1h: number | null;
        avgLatencyMs: number | null;
        overallSuccessRate: number | null;
        totalInFlight: number | null;
        snapshotData: string | null;
        hourOfDay: number | null;
        dayOfWeek: number | null;
      }
    | undefined {
    const row = this.db
      .prepare(`SELECT * FROM metrics_summary ORDER BY timestamp DESC LIMIT 1`)
      .get() as MetricsSummaryRow | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: row.id,
      timestamp: row.timestamp,
      totalServers: row.total_servers,
      healthyServers: row.healthy_servers,
      totalModels: row.total_models,
      totalRequests1h: row.total_requests_1h,
      avgLatencyMs: row.avg_latency_ms,
      overallSuccessRate: row.overall_success_rate,
      totalInFlight: row.total_in_flight,
      snapshotData: row.snapshot_data,
      hourOfDay: row.hour_of_day,
      dayOfWeek: row.day_of_week,
    };
  }

  pruneOldMetricsSummaries(maxAgeDays = 90): number {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const result = this.db.prepare(`DELETE FROM metrics_summary WHERE timestamp < ?`).run(cutoff);
    return result.changes;
  }

  private migrateJsonMetricsSummary(filePath: string): void {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as {
      timestamp: number;
      snapshots: Array<{ timestamp: number; servers: unknown }>;
    };
    const migrate = this.db.transaction(() => {
      for (const snapshot of data.snapshots ?? []) {
        const d = new Date(snapshot.timestamp);
        this.recordMetricsSummary({
          timestamp: snapshot.timestamp,
          snapshotData: JSON.stringify(snapshot),
          hourOfDay: d.getUTCHours(),
          dayOfWeek: d.getUTCDay(),
        });
      }
    });
    migrate();
    fs.renameSync(filePath, `${filePath}.bak`);
    logger.info(`[OperationalStore] Migrated metrics summary from ${filePath}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Quarantine CRUD (Tarpit Quarantine Pool)
  // ══════════════════════════════════════════════════════════════════════════

  quarantineServer(entry: {
    serverId: string;
    quarantinedAt: number;
    reason: string;
    evidence: Record<string, unknown> | null;
    expiresAt: number | null;
    consecutiveCleanCycles: number;
    isManual: boolean;
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO quarantine
           (server_id, quarantined_at, reason, evidence, expires_at, consecutive_clean_cycles, is_manual)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.serverId,
        entry.quarantinedAt,
        entry.reason,
        entry.evidence ? JSON.stringify(entry.evidence) : null,
        entry.expiresAt ?? null,
        entry.consecutiveCleanCycles,
        entry.isManual ? 1 : 0
      );
  }

  deleteQuarantine(serverId: string): void {
    this.db.prepare(`DELETE FROM quarantine WHERE server_id = ?`).run(serverId);
  }

  updateQuarantineCleanCycles(serverId: string, cycles: number): void {
    this.db
      .prepare(`UPDATE quarantine SET consecutive_clean_cycles = ? WHERE server_id = ?`)
      .run(cycles, serverId);
  }

  getQuarantinedServers(): Array<{
    serverId: string;
    quarantinedAt: number;
    reason: string;
    evidence: Record<string, unknown> | null;
    expiresAt: number | null;
    consecutiveCleanCycles: number;
    isManual: boolean;
  }> {
    const rows = this.db.prepare(`SELECT * FROM quarantine`).all() as Array<{
      server_id: string;
      quarantined_at: number;
      reason: string;
      evidence: string | null;
      expires_at: number | null;
      consecutive_clean_cycles: number;
      is_manual: number;
    }>;
    return rows.map(r => ({
      serverId: r.server_id,
      quarantinedAt: r.quarantined_at,
      reason: r.reason,
      evidence: r.evidence ? JSON.parse(r.evidence) : null,
      expiresAt: r.expires_at,
      consecutiveCleanCycles: r.consecutive_clean_cycles,
      isManual: r.is_manual === 1,
    }));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Startup Migrations (Task 7.9)
  // ══════════════════════════════════════════════════════════════════════════

  runStartupMigrations(): void {
    const migrations: Array<{ file: string; fn: (f: string) => void }> = [
      {
        file: path.join(process.cwd(), 'data', 'bans.json'),
        fn: f => this.migrateJsonBans(f),
      },
      {
        file: path.join(process.cwd(), 'data', 'timeouts.json'),
        fn: f => this.migrateJsonTimeouts(f),
      },
      {
        file: path.join(process.cwd(), 'data', 'circuit-breakers.json'),
        fn: f => this.migrateJsonCircuitBreakers(f),
      },
      {
        file: path.join(process.cwd(), 'data', 'metrics.json'),
        fn: f => this.migrateJsonMetrics(f),
      },
      {
        file: path.join(process.cwd(), 'data', 'recovery-failures.json'),
        fn: f => this.migrateJsonRecoveryFailures(f),
      },
      {
        file: path.join(process.cwd(), 'data', 'metrics-summary.json'),
        fn: f => this.migrateJsonMetricsSummary(f),
      },
    ];

    for (const { file, fn } of migrations) {
      if (fs.existsSync(file)) {
        logger.info(`[OperationalStore] Migrating ${file} to SQLite...`);
        try {
          fn(file);
          logger.info(`[OperationalStore] Migrated ${file} → ${file}.bak`);
        } catch (err) {
          logger.error(`[OperationalStore] Migration failed for ${file}`, { error: err });
        }
      }
    }
  }
}

let _instance: OperationalStore | undefined;

export function getOperationalStore(dbPath?: string): OperationalStore {
  if (!_instance) {
    _instance = new OperationalStore(dbPath);
  }
  return _instance;
}

export function setOperationalStore(store: OperationalStore): void {
  _instance = store;
}

export function resetOperationalStore(): void {
  if (_instance) {
    try {
      _instance.close();
    } catch {
      // ignore errors during reset
    }
    _instance = undefined;
  }
}
