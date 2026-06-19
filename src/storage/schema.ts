/**
 * schema.ts
 * SQLite DDL statements and migration management for long-term metrics storage.
 *
 * Schema version is stored in SQLite's PRAGMA user_version.
 * Each migration is applied in sequence on startup.
 */

import type Database from 'better-sqlite3';

export const CURRENT_SCHEMA_VERSION = 6;

/**
 * All DDL statements for schema version 1.
 * Executed inside a single transaction on a fresh database.
 */
export const SCHEMA_V1 = `
-- ============================================================
-- requests: per-request history (replaces analytics-engine.json
--           requestHistory + request-history.json)
-- ============================================================
CREATE TABLE IF NOT EXISTS requests (
  id                    TEXT PRIMARY KEY,
  parent_request_id     TEXT,
  is_retry              INTEGER NOT NULL DEFAULT 0,
  timestamp             INTEGER NOT NULL,
  server_id             TEXT NOT NULL,
  model                 TEXT NOT NULL,
  endpoint              TEXT NOT NULL,
  streaming             INTEGER NOT NULL DEFAULT 0,

  -- Outcome
  success               INTEGER NOT NULL,
  duration_ms           REAL,
  error_type            TEXT,
  error_message         TEXT,

  -- Tokens
  tokens_prompt         INTEGER,
  tokens_generated      INTEGER,
  tokens_per_second     REAL,

  -- Streaming metrics
  ttft_ms               REAL,
  streaming_duration_ms REAL,
  chunk_count           INTEGER,
  total_bytes           INTEGER,
  max_chunk_gap_ms      REAL,
  avg_chunk_size        REAL,

  -- Ollama-specific durations (nanoseconds)
  eval_duration         INTEGER,
  prompt_eval_duration  INTEGER,
  total_duration        INTEGER,
  load_duration         INTEGER,
  is_cold_start         INTEGER NOT NULL DEFAULT 0,

  -- Queue/scheduling
  queue_wait_ms         REAL,

  -- Denormalized UTC time dimensions for fast GROUP BY
  hour_of_day           INTEGER NOT NULL,
  day_of_week           INTEGER NOT NULL,
  date_str              TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_requests_ts
  ON requests (timestamp);
CREATE INDEX IF NOT EXISTS idx_requests_server_ts
  ON requests (server_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_requests_model_ts
  ON requests (model, timestamp);
CREATE INDEX IF NOT EXISTS idx_requests_server_model_ts
  ON requests (server_id, model, timestamp);
CREATE INDEX IF NOT EXISTS idx_requests_date
  ON requests (date_str);
CREATE INDEX IF NOT EXISTS idx_requests_parent
  ON requests (parent_request_id)
  WHERE parent_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requests_temporal
  ON requests (server_id, model, hour_of_day, day_of_week);

-- ============================================================
-- decisions: load balancer decision log (replaces decision-history.json)
-- ============================================================
CREATE TABLE IF NOT EXISTS decisions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp             INTEGER NOT NULL,
  model                 TEXT NOT NULL,
  selected_server       TEXT NOT NULL,
  algorithm             TEXT NOT NULL,
  selection_reason      TEXT,
  candidate_count       INTEGER NOT NULL,

  -- Winner score breakdown (denormalized)
  total_score           REAL,
  latency_score         REAL,
  success_rate_score    REAL,
  load_score            REAL,
  capacity_score        REAL,
  cb_score              REAL,
  timeout_score         REAL,
  throughput_score      REAL,
  vram_score            REAL,

  -- Winner raw metric snapshot
  p95_latency           REAL,
  success_rate          REAL,
  in_flight             INTEGER,
  throughput            REAL,

  -- Denormalized UTC time dimensions
  hour_of_day           INTEGER NOT NULL,
  day_of_week           INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_decisions_ts
  ON decisions (timestamp);
CREATE INDEX IF NOT EXISTS idx_decisions_server_ts
  ON decisions (selected_server, timestamp);
CREATE INDEX IF NOT EXISTS idx_decisions_model_ts
  ON decisions (model, timestamp);

-- ============================================================
-- decision_candidates: full candidate scores per decision
-- ============================================================
CREATE TABLE IF NOT EXISTS decision_candidates (
  decision_id           INTEGER NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  server_id             TEXT NOT NULL,
  total_score           REAL,
  latency_score         REAL,
  success_rate_score    REAL,
  load_score            REAL,
  capacity_score        REAL,
  p95_latency           REAL,
  success_rate          REAL,
  in_flight             INTEGER,
  throughput            REAL,

  PRIMARY KEY (decision_id, server_id)
);

CREATE INDEX IF NOT EXISTS idx_dc_server
  ON decision_candidates (server_id, decision_id);

-- ============================================================
-- failover_attempts: failover chain records (previously not persisted)
-- ============================================================
CREATE TABLE IF NOT EXISTS failover_attempts (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp             INTEGER NOT NULL,
  request_id            TEXT NOT NULL,
  model                 TEXT NOT NULL,
  phase                 INTEGER NOT NULL,
  server_id             TEXT NOT NULL,
  result                TEXT NOT NULL,
  error_type            TEXT,
  latency_ms            REAL
);

CREATE INDEX IF NOT EXISTS idx_failover_request
  ON failover_attempts (request_id);
CREATE INDEX IF NOT EXISTS idx_failover_ts
  ON failover_attempts (timestamp);
CREATE INDEX IF NOT EXISTS idx_failover_server
  ON failover_attempts (server_id, timestamp);

-- ============================================================
-- hourly_rollups: pre-computed hourly aggregates
-- ============================================================
CREATE TABLE IF NOT EXISTS hourly_rollups (
  server_id             TEXT NOT NULL,
  model                 TEXT NOT NULL,
  hour_start            INTEGER NOT NULL,

  total_requests        INTEGER NOT NULL DEFAULT 0,
  user_requests         INTEGER NOT NULL DEFAULT 0,
  successes             INTEGER NOT NULL DEFAULT 0,
  failures              INTEGER NOT NULL DEFAULT 0,
  cold_starts           INTEGER NOT NULL DEFAULT 0,

  latency_sum           REAL NOT NULL DEFAULT 0,
  latency_sq_sum        REAL NOT NULL DEFAULT 0,
  latency_min           REAL,
  latency_max           REAL,
  latency_p50           REAL,
  latency_p95           REAL,
  latency_p99           REAL,

  ttft_count            INTEGER NOT NULL DEFAULT 0,
  ttft_sum              REAL NOT NULL DEFAULT 0,
  ttft_p50              REAL,
  ttft_p95              REAL,

  tokens_generated      INTEGER NOT NULL DEFAULT 0,
  tokens_prompt         INTEGER NOT NULL DEFAULT 0,
  avg_tokens_per_second REAL,

  errors_timeout        INTEGER NOT NULL DEFAULT 0,
  errors_oom            INTEGER NOT NULL DEFAULT 0,
  errors_connection     INTEGER NOT NULL DEFAULT 0,
  errors_other          INTEGER NOT NULL DEFAULT 0,

  hour_of_day           INTEGER NOT NULL,
  day_of_week           INTEGER NOT NULL,

  PRIMARY KEY (server_id, model, hour_start)
);

CREATE INDEX IF NOT EXISTS idx_hourly_ts
  ON hourly_rollups (hour_start);
CREATE INDEX IF NOT EXISTS idx_hourly_model
  ON hourly_rollups (model, hour_start);
CREATE INDEX IF NOT EXISTS idx_hourly_temporal
  ON hourly_rollups (server_id, model, hour_of_day, day_of_week);

-- ============================================================
-- daily_rollups: pre-computed daily aggregates
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_rollups (
  server_id             TEXT NOT NULL,
  model                 TEXT NOT NULL,
  date_str              TEXT NOT NULL,

  total_requests        INTEGER NOT NULL DEFAULT 0,
  user_requests         INTEGER NOT NULL DEFAULT 0,
  successes             INTEGER NOT NULL DEFAULT 0,
  failures              INTEGER NOT NULL DEFAULT 0,
  cold_starts           INTEGER NOT NULL DEFAULT 0,

  latency_sum           REAL NOT NULL DEFAULT 0,
  latency_sq_sum        REAL NOT NULL DEFAULT 0,
  latency_min           REAL,
  latency_max           REAL,
  latency_p50           REAL,
  latency_p95           REAL,
  latency_p99           REAL,

  ttft_count            INTEGER NOT NULL DEFAULT 0,
  ttft_sum              REAL NOT NULL DEFAULT 0,
  ttft_p50              REAL,
  ttft_p95              REAL,

  tokens_generated      INTEGER NOT NULL DEFAULT 0,
  tokens_prompt         INTEGER NOT NULL DEFAULT 0,
  avg_tokens_per_second REAL,

  errors_timeout        INTEGER NOT NULL DEFAULT 0,
  errors_oom            INTEGER NOT NULL DEFAULT 0,
  errors_connection     INTEGER NOT NULL DEFAULT 0,
  errors_other          INTEGER NOT NULL DEFAULT 0,

  day_of_week           INTEGER NOT NULL,

  PRIMARY KEY (server_id, model, date_str)
);

CREATE INDEX IF NOT EXISTS idx_daily_model
  ON daily_rollups (model, date_str);

-- ============================================================
-- temporal_profiles: performance by (hour_of_day, day_of_week)
-- Supports three profile types: exact, model-wide, server-wide
-- ============================================================
CREATE TABLE IF NOT EXISTS temporal_profiles (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id             TEXT,
  model                 TEXT,
  hour_of_day           INTEGER NOT NULL,
  day_of_week           INTEGER NOT NULL,
  profile_type          TEXT NOT NULL,

  sample_count          INTEGER NOT NULL DEFAULT 0,
  total_requests        INTEGER NOT NULL DEFAULT 0,
  avg_latency_ms        REAL,
  avg_latency_stddev    REAL,
  p95_latency_ms        REAL,
  success_rate          REAL,
  avg_tokens_per_second REAL,
  cold_start_rate       REAL,
  avg_ttft_ms           REAL,

  confidence            REAL NOT NULL DEFAULT 0,
  updated_at            INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_lookup ON temporal_profiles (
  COALESCE(server_id, ''),
  COALESCE(model, ''),
  hour_of_day,
  day_of_week
);

CREATE INDEX IF NOT EXISTS idx_profiles_model_temporal
  ON temporal_profiles (model, hour_of_day, day_of_week)
  WHERE server_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_server_temporal
  ON temporal_profiles (server_id, hour_of_day, day_of_week)
  WHERE model IS NULL;
`;

export const SCHEMA_V2_MIGRATION = `
-- ============================================================
-- bans: permanent ban tracking with history (F-DB-1)
-- ============================================================
CREATE TABLE IF NOT EXISTS bans (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id     TEXT NOT NULL,
  model         TEXT NOT NULL,
  reason        TEXT,
  banned_at     INTEGER NOT NULL,
  unbanned_at   INTEGER,
  UNIQUE(server_id, model, banned_at)
);
CREATE INDEX IF NOT EXISTS idx_bans_active ON bans(server_id, model) WHERE unbanned_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bans_ts ON bans(banned_at);

-- ============================================================
-- adaptive_timeouts: full TimeoutState persistence (F-DB-2, F-TO-8)
-- ============================================================
CREATE TABLE IF NOT EXISTS adaptive_timeouts (
  key              TEXT PRIMARY KEY,
  server_id        TEXT NOT NULL,
  model            TEXT,
  base_timeout_ms  REAL NOT NULL,
  current_timeout  REAL NOT NULL,
  ema_latency      REAL,
  sample_count     INTEGER DEFAULT 0,
  last_updated     INTEGER NOT NULL,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_timeouts_server ON adaptive_timeouts(server_id);

-- ============================================================
-- circuit_breaker_state: operational CB state (F-DB-3)
-- ============================================================
CREATE TABLE IF NOT EXISTS circuit_breaker_state (
  server_id                    TEXT NOT NULL,
  model                        TEXT NOT NULL,
  state                        TEXT NOT NULL,
  failure_count                INTEGER DEFAULT 0,
  success_count                INTEGER DEFAULT 0,
  last_failure_at              INTEGER,
  last_success_at              INTEGER,
  opened_at                    INTEGER,
  next_retry_at                INTEGER,
  error_window                 TEXT,
  adaptive_threshold           INTEGER,
  consecutive_failed_recoveries INTEGER DEFAULT 0,
  half_open_attempts           INTEGER DEFAULT 0,
  updated_at                   INTEGER NOT NULL,
  PRIMARY KEY (server_id, model)
);

-- circuit_breaker_transitions: state transition log
CREATE TABLE IF NOT EXISTS circuit_breaker_transitions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id   TEXT NOT NULL,
  model       TEXT NOT NULL,
  from_state  TEXT NOT NULL,
  to_state    TEXT NOT NULL,
  reason      TEXT,
  timestamp   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cb_transitions_ts ON circuit_breaker_transitions(timestamp);
CREATE INDEX IF NOT EXISTS idx_cb_transitions_server ON circuit_breaker_transitions(server_id, model, timestamp);

-- ============================================================
-- server_metrics_snapshot: hot operational metrics (F-DB-4)
-- ============================================================
CREATE TABLE IF NOT EXISTS server_metrics_snapshot (
  server_id         TEXT NOT NULL,
  model             TEXT NOT NULL,
  latency_avg       REAL,
  latency_p95       REAL,
  latency_p99       REAL,
  success_rate      REAL,
  throughput        REAL,
  tokens_per_second REAL,
  ttft_avg          REAL,
  in_flight         INTEGER DEFAULT 0,
  total_requests    INTEGER DEFAULT 0,
  recent_errors     INTEGER DEFAULT 0,
  parameter_size    TEXT,
  family            TEXT,
  quantization      TEXT,
  last_request_at   INTEGER,
  updated_at        INTEGER NOT NULL,
  PRIMARY KEY (server_id, model)
);
CREATE INDEX IF NOT EXISTS idx_metrics_snap_updated ON server_metrics_snapshot(updated_at);

-- ============================================================
-- recovery_failures: per-server recovery tracking (F-DB-5)
-- ============================================================
CREATE TABLE IF NOT EXISTS recovery_failures (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id          TEXT NOT NULL,
  model              TEXT,
  error_type         TEXT NOT NULL,
  error_message      TEXT,
  phase              TEXT,
  recovery_attempted INTEGER DEFAULT 0,
  recovery_success   INTEGER,
  latency_ms         REAL,
  timestamp          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recovery_server_ts ON recovery_failures(server_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_recovery_ts ON recovery_failures(timestamp);
CREATE INDEX IF NOT EXISTS idx_recovery_error ON recovery_failures(error_type, timestamp);

-- ============================================================
-- metrics_summary: hourly analytics snapshots (F-DB-6)
-- ============================================================
CREATE TABLE IF NOT EXISTS metrics_summary (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp            INTEGER NOT NULL,
  total_servers        INTEGER,
  healthy_servers      INTEGER,
  total_models         INTEGER,
  total_requests_1h    INTEGER,
  avg_latency_ms       REAL,
  overall_success_rate REAL,
  total_in_flight      INTEGER,
  snapshot_data        TEXT,
  hour_of_day          INTEGER,
  day_of_week          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_summary_ts ON metrics_summary(timestamp);
CREATE INDEX IF NOT EXISTS idx_summary_temporal ON metrics_summary(hour_of_day, day_of_week);
`;

export const SCHEMA_V3_MIGRATION = `ALTER TABLE requests ADD COLUMN is_probe INTEGER NOT NULL DEFAULT 0;`;

export const SCHEMA_V4_MIGRATION = `
-- ============================================================
-- users: user accounts for access control
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  username            TEXT NOT NULL UNIQUE,
  email               TEXT NOT NULL UNIQUE,
  password_hash       TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'user',
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  api_key             TEXT UNIQUE,
  api_key_created_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ============================================================
-- user_server_access: servers each user can access
-- ============================================================
CREATE TABLE IF NOT EXISTS user_server_access (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id          TEXT NOT NULL,
  granted_at         INTEGER NOT NULL,
  UNIQUE(user_id, server_id)
);
CREATE INDEX IF NOT EXISTS idx_user_server_access_user ON user_server_access(user_id);

-- ============================================================
-- user_model_access: models each user can access
-- ============================================================
CREATE TABLE IF NOT EXISTS user_model_access (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id          TEXT NOT NULL,
  model              TEXT NOT NULL,
  granted_at         INTEGER NOT NULL,
  UNIQUE(user_id, server_id, model)
);
CREATE INDEX IF NOT EXISTS idx_user_model_access_user ON user_model_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_model_access_server ON user_model_access(server_id);
`;

export const SCHEMA_V6_MIGRATION = `
ALTER TABLE decision_candidates ADD COLUMN cb_score REAL;
ALTER TABLE decision_candidates ADD COLUMN timeout_score REAL;
ALTER TABLE decision_candidates ADD COLUMN throughput_score REAL;
ALTER TABLE decision_candidates ADD COLUMN vram_score REAL;
`;

export const SCHEMA_V5_MIGRATION = `
-- ============================================================
-- V5: Drop old circuit_breaker tables, create probe WAL
-- ============================================================
DROP TABLE IF EXISTS circuit_breaker_state;
DROP TABLE IF EXISTS circuit_breaker_transitions;

-- probe_state_wal: append-only write-ahead log for probe state transitions
CREATE TABLE IF NOT EXISTS probe_state_wal (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tuple_key   TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  from_state  TEXT,
  to_state    TEXT,
  reason      TEXT,
  metadata    TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_probe_wal_tuple ON probe_state_wal (tuple_key, id);
CREATE INDEX IF NOT EXISTS idx_probe_wal_created ON probe_state_wal (created_at);

-- probe_state_snapshots: periodic snapshots of full probe state
CREATE TABLE IF NOT EXISTS probe_state_snapshots (
  id             INTEGER PRIMARY KEY,
  snapshot_data  TEXT,
  created_at     INTEGER NOT NULL
);
`;

export const MIGRATIONS: Record<number, string> = {
  // Version 1 is applied as a full schema creation on empty databases.
  2: SCHEMA_V2_MIGRATION,
  3: SCHEMA_V3_MIGRATION,
  4: SCHEMA_V4_MIGRATION,
  5: SCHEMA_V5_MIGRATION,
  6: SCHEMA_V6_MIGRATION,
};

/**
 * Apply schema and run any outstanding migrations.
 * Must be called once after opening the database.
 */
export function applySchema(db: Database.Database): void {
  const currentVersion = (db.pragma('user_version', { simple: true }) as number) ?? 0;

  if (currentVersion === CURRENT_SCHEMA_VERSION) {
    return;
  }

  db.transaction(() => {
    if (currentVersion === 0) {
      db.exec(SCHEMA_V1);
      for (let v = 2; v <= CURRENT_SCHEMA_VERSION; v++) {
        const sql = MIGRATIONS[v];
        if (sql) {
          db.exec(sql);
        }
      }
    } else {
      for (let v = currentVersion + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
        const sql = MIGRATIONS[v];
        if (!sql) {
          throw new Error(`Missing migration for schema version ${v}`);
        }
        db.exec(sql);
      }
    }
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
  })();
}
