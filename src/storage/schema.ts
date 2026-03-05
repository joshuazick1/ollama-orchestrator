/**
 * schema.ts
 * SQLite DDL statements and migration management for long-term metrics storage.
 *
 * Schema version is stored in SQLite's PRAGMA user_version.
 * Each migration is applied in sequence on startup.
 */

import type Database from 'better-sqlite3';

export const CURRENT_SCHEMA_VERSION = 1;

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

/**
 * Migration map: version -> SQL to upgrade from (version-1) to version.
 * Version 1 is handled by SCHEMA_V1 on fresh databases.
 * Future migrations are added here, e.g.:
 *   2: 'ALTER TABLE requests ADD COLUMN new_col TEXT;'
 */
export const MIGRATIONS: Record<number, string> = {
  // Version 1 is applied as a full schema creation on empty databases.
  // Future: 2: 'ALTER TABLE ...;'
};

/**
 * Apply schema and run any outstanding migrations.
 * Must be called once after opening the database.
 */
export function applySchema(db: Database.Database): void {
  const currentVersion = (db.pragma('user_version', { simple: true }) as number) ?? 0;

  if (currentVersion === 0) {
    // Fresh database — apply full schema in one transaction
    db.transaction(() => {
      db.exec(SCHEMA_V1);
      db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
    })();
    return;
  }

  if (currentVersion === CURRENT_SCHEMA_VERSION) {
    // Already up to date
    return;
  }

  // Apply incremental migrations
  db.transaction(() => {
    for (let v = currentVersion + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
      const sql = MIGRATIONS[v];
      if (!sql) {
        throw new Error(`Missing migration for schema version ${v}`);
      }
      db.exec(sql);
    }
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
  })();
}
