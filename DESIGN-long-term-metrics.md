# DESIGN: Long-Term Metrics Retention & Temporal-Aware Load Balancing

## Status: Draft

## Date: 2026-03-05

---

## 1. Problem Statement

The orchestrator currently retains metrics for at most 24 hours (1 hour for windowed
aggregates, 24 hours for request history and decision logs). All storage is in-memory
arrays serialized to JSON files. This creates three problems:

1. **No long-term performance visibility.** Operators cannot see trends over days or weeks.
   The frontend's "7d" and "30d" time range options return data from a 1-hour window --
   they are aspirational labels with no real data behind them.

2. **No temporal pattern learning.** The load balancer has zero awareness of time-of-day
   or day-of-week patterns. A server that consistently degrades at 2 PM every weekday is
   not proactively avoided. Routing decisions are based exclusively on the immediate past.

3. **Memory and startup cost at scale.** Extending in-memory arrays to weeks of data
   would consume hundreds of megabytes of RAM and cause multi-second JSON parse times on
   startup. The current architecture does not scale.

The load balancer's scoring algorithm consumes metrics for latency (P95), success rate,
throughput, load, circuit breaker health, and VRAM state. Improving the quality, depth,
and temporal richness of these inputs directly improves routing decisions and end-user
response times.

---

## 2. Goals

| #   | Goal                                                       | Metric                                                                        |
| --- | ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| G1  | Retain per-request history for 30 days                     | Queryable request records covering full retention period                      |
| G2  | Retain decision history and failover attempts for 30 days  | Full score breakdowns and failover chains preserved                           |
| G3  | Provide hourly and daily aggregated rollups for 90 days    | Pre-computed rollups available for dashboard/API queries                      |
| G4  | Enable temporal-aware load balancing                       | Load balancer score incorporates time-of-day/day-of-week performance patterns |
| G5  | Reduce memory footprint vs. equivalent JSON approach       | Peak RSS increase < 20 MB for the storage layer                               |
| G6  | Maintain fast startup (< 2 seconds for storage layer init) | SQLite open + WAL recovery, no full-table scan on boot                        |
| G7  | Zero data loss on crash                                    | WAL mode with synchronous=NORMAL provides durability                          |
| G8  | Backward compatible                                        | Existing APIs continue to work; new capabilities are additive                 |

### Non-Goals

- Real-time replication or multi-node storage (single-process architecture unchanged)
- Replacing the in-memory MetricsAggregator windows for hot-path routing (sub-ms reads required)
- User-facing SQL query interface
- Migration of existing JSON data files (they will continue to exist during transition)

---

## 3. Architecture Overview

```
                    Hot Path (in-memory, unchanged)
                    ┌─────────────────────────────────┐
  Request ──────────▶  MetricsAggregator (windows)    │
                    │  InFlightManager                 │
                    │  CircuitBreaker                  │
                    │  LoadBalancer.select()           │◀── reads current windows
                    └──────────┬──────────────────────┘
                               │
                               │ completed request context
                               ▼
                    ┌─────────────────────────────────┐
                    │  MetricsStore (NEW)              │
                    │  ┌───────────────────────────┐  │
                    │  │  SQLite (WAL mode)         │  │
                    │  │  ├── requests              │  │
                    │  │  ├── decisions             │  │
                    │  │  ├── failover_attempts     │  │
                    │  │  ├── hourly_rollups        │  │
                    │  │  ├── daily_rollups         │  │
                    │  │  └── temporal_profiles     │  │
                    │  └───────────────────────────┘  │
                    │                                  │
                    │  Write Buffer (batch inserts)    │
                    │  Rollup Worker (hourly/daily)    │
                    │  Retention Worker (prune old)    │
                    └──────────┬──────────────────────┘
                               │
                  ┌────────────┼────────────────┐
                  ▼            ▼                ▼
           AnalyticsEngine  Dashboard API  TemporalScorer
           (queries)        (queries)      (reads profiles,
                                            feeds LoadBalancer)
```

### Key Design Decisions

1. **SQLite via `better-sqlite3`.** Synchronous API eliminates callback complexity.
   WAL mode allows concurrent reads during writes. Single-file database in `data/`.
   Node 22 is fully supported. No ORM -- raw SQL with prepared statements for
   performance.

2. **Write buffer.** Requests are batched in memory (up to 100 or 1 second, whichever
   comes first) and inserted in a single transaction. This keeps write latency off the
   hot path and achieves ~50,000 inserts/second on typical hardware.

3. **In-memory windows unchanged.** The MetricsAggregator's tumbling windows continue
   to serve the load balancer's hot path. SQLite is the system of record for anything
   beyond the current window.

4. **Rollup tables.** Hourly and daily rollups are pre-computed by a background timer,
   not computed on read. Dashboard queries hit rollup tables, not raw request rows.

5. **Temporal profiles.** A new `temporal_profiles` table stores per-server, per-model
   performance profiles bucketed by (hour-of-day, day-of-week). Updated during daily
   rollup. Consumed by a new `TemporalScorer` that feeds into the load balancer.

---

## 4. SQLite Schema

### 4.1 `requests` -- Per-Request History

Replaces: `analytics-engine.json` (requestHistory), `request-history.json`

```sql
CREATE TABLE requests (
  id               TEXT PRIMARY KEY,           -- RequestContext.id (UUID)
  parent_request_id TEXT,                      -- links retries to original
  is_retry         INTEGER NOT NULL DEFAULT 0, -- boolean
  timestamp        INTEGER NOT NULL,           -- epoch ms (startTime)
  server_id        TEXT NOT NULL,
  model            TEXT NOT NULL,
  endpoint         TEXT NOT NULL,              -- 'generate' | 'chat' | 'embeddings'
  streaming        INTEGER NOT NULL DEFAULT 0, -- boolean

  -- Outcome
  success          INTEGER NOT NULL,           -- boolean
  duration_ms      REAL,                       -- total duration
  error_type       TEXT,                       -- unified classification (see §4.7)
  error_message    TEXT,

  -- Tokens
  tokens_prompt    INTEGER,
  tokens_generated INTEGER,
  tokens_per_second REAL,

  -- Streaming metrics
  ttft_ms          REAL,                       -- time-to-first-token
  streaming_duration_ms REAL,
  chunk_count      INTEGER,
  total_bytes      INTEGER,
  max_chunk_gap_ms REAL,
  avg_chunk_size   REAL,

  -- Ollama-specific durations (nanoseconds)
  eval_duration    INTEGER,
  prompt_eval_duration INTEGER,
  total_duration   INTEGER,
  load_duration    INTEGER,                    -- >0 = cold start
  is_cold_start    INTEGER DEFAULT 0,          -- boolean

  -- Queue/scheduling
  queue_wait_ms    REAL,

  -- Derived time dimensions (denormalized for fast GROUP BY)
  hour_of_day      INTEGER NOT NULL,           -- 0-23 (local time)
  day_of_week      INTEGER NOT NULL,           -- 0=Sunday, 6=Saturday
  date_str         TEXT NOT NULL               -- 'YYYY-MM-DD' for daily partitioning
);

-- Primary query patterns
CREATE INDEX idx_requests_ts          ON requests (timestamp);
CREATE INDEX idx_requests_server_ts   ON requests (server_id, timestamp);
CREATE INDEX idx_requests_model_ts    ON requests (model, timestamp);
CREATE INDEX idx_requests_server_model_ts ON requests (server_id, model, timestamp);
CREATE INDEX idx_requests_date        ON requests (date_str);
CREATE INDEX idx_requests_parent      ON requests (parent_request_id)
                                      WHERE parent_request_id IS NOT NULL;
CREATE INDEX idx_requests_temporal    ON requests (server_id, model, hour_of_day,
                                                   day_of_week);
```

**Estimated row size:** ~350 bytes average (most fields are nullable).
**At 10,000 requests/day for 30 days:** 300,000 rows = ~105 MB.
**At 1,000 requests/day for 30 days:** 30,000 rows = ~10.5 MB.

**Note on `hour_of_day` and `day_of_week`:** Always stored in UTC (see §17, Q1).
The frontend converts to the operator's local timezone for display.

### 4.2 `decisions` -- Load Balancer Decision Log

Replaces: `decision-history.json`

```sql
CREATE TABLE decisions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp        INTEGER NOT NULL,           -- epoch ms
  model            TEXT NOT NULL,
  selected_server  TEXT NOT NULL,
  algorithm        TEXT NOT NULL,
  selection_reason TEXT,
  candidate_count  INTEGER NOT NULL,

  -- Winner's score breakdown (denormalized for fast queries)
  total_score      REAL,
  latency_score    REAL,
  success_rate_score REAL,
  load_score       REAL,
  capacity_score   REAL,
  cb_score         REAL,                       -- circuit breaker
  timeout_score    REAL,
  throughput_score  REAL,
  vram_score       REAL,

  -- Winner's raw metrics snapshot
  p95_latency      REAL,
  success_rate     REAL,
  in_flight        INTEGER,
  throughput       REAL,                       -- tokens/sec

  -- Derived time dimensions
  hour_of_day      INTEGER NOT NULL,
  day_of_week      INTEGER NOT NULL
);

CREATE INDEX idx_decisions_ts        ON decisions (timestamp);
CREATE INDEX idx_decisions_server_ts ON decisions (selected_server, timestamp);
CREATE INDEX idx_decisions_model_ts  ON decisions (model, timestamp);
```

### 4.3 `decision_candidates` -- Full Candidate Scores Per Decision

```sql
CREATE TABLE decision_candidates (
  decision_id      INTEGER NOT NULL REFERENCES decisions(id),
  server_id        TEXT NOT NULL,
  total_score      REAL,
  latency_score    REAL,
  success_rate_score REAL,
  load_score       REAL,
  capacity_score   REAL,
  p95_latency      REAL,
  success_rate     REAL,
  in_flight        INTEGER,
  throughput       REAL,

  PRIMARY KEY (decision_id, server_id)
);

CREATE INDEX idx_dc_server ON decision_candidates (server_id, decision_id);
```

### 4.4 `failover_attempts` -- Failover Chain Records

Currently not persisted at all (in-memory only, lost on restart).

```sql
CREATE TABLE failover_attempts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp        INTEGER NOT NULL,
  request_id       TEXT NOT NULL,              -- links to requests.id
  model            TEXT NOT NULL,
  phase            INTEGER NOT NULL,           -- 1, 2, or 3
  server_id        TEXT NOT NULL,
  result           TEXT NOT NULL,              -- 'success' | 'failure' | 'skipped'
  error_type       TEXT,
  latency_ms       REAL
);

CREATE INDEX idx_failover_request ON failover_attempts (request_id);
CREATE INDEX idx_failover_ts      ON failover_attempts (timestamp);
CREATE INDEX idx_failover_server  ON failover_attempts (server_id, timestamp);
```

### 4.5 `hourly_rollups` -- Pre-Computed Hourly Aggregates

Replaces: `metrics-summary.json` (MetricsSummarySnapshot[])

```sql
CREATE TABLE hourly_rollups (
  server_id        TEXT NOT NULL,
  model            TEXT NOT NULL,
  hour_start       INTEGER NOT NULL,           -- epoch ms, truncated to hour

  -- Counts
  total_requests   INTEGER NOT NULL DEFAULT 0,
  user_requests    INTEGER NOT NULL DEFAULT 0, -- excludes retries
  successes        INTEGER NOT NULL DEFAULT 0,
  failures         INTEGER NOT NULL DEFAULT 0,
  cold_starts      INTEGER NOT NULL DEFAULT 0,

  -- Latency aggregates
  latency_sum      REAL NOT NULL DEFAULT 0,
  latency_sq_sum   REAL NOT NULL DEFAULT 0,    -- for stddev
  latency_min      REAL,
  latency_max      REAL,
  latency_p50      REAL,                       -- computed from requests table
  latency_p95      REAL,
  latency_p99      REAL,

  -- TTFT aggregates (streaming only)
  ttft_count       INTEGER NOT NULL DEFAULT 0,
  ttft_sum         REAL NOT NULL DEFAULT 0,
  ttft_p50         REAL,
  ttft_p95         REAL,

  -- Throughput
  tokens_generated INTEGER NOT NULL DEFAULT 0,
  tokens_prompt    INTEGER NOT NULL DEFAULT 0,
  avg_tokens_per_second REAL,

  -- Errors by type
  errors_timeout   INTEGER NOT NULL DEFAULT 0,
  errors_oom       INTEGER NOT NULL DEFAULT 0,
  errors_connection INTEGER NOT NULL DEFAULT 0,
  errors_other     INTEGER NOT NULL DEFAULT 0,

  -- Time dimensions (denormalized from hour_start)
  hour_of_day      INTEGER NOT NULL,           -- 0-23
  day_of_week      INTEGER NOT NULL,           -- 0-6

  PRIMARY KEY (server_id, model, hour_start)
);

CREATE INDEX idx_hourly_ts    ON hourly_rollups (hour_start);
CREATE INDEX idx_hourly_model ON hourly_rollups (model, hour_start);
CREATE INDEX idx_hourly_temporal ON hourly_rollups (server_id, model,
                                                    hour_of_day, day_of_week);
```

**Estimated row size:** ~250 bytes.
**At 5 server:model combos for 90 days:** 5 _ 24 _ 90 = 10,800 rows = ~2.7 MB.

### 4.6 `daily_rollups` -- Pre-Computed Daily Aggregates

```sql
CREATE TABLE daily_rollups (
  server_id        TEXT NOT NULL,
  model            TEXT NOT NULL,
  date_str         TEXT NOT NULL,              -- 'YYYY-MM-DD'

  -- Same aggregate columns as hourly_rollups
  total_requests   INTEGER NOT NULL DEFAULT 0,
  user_requests    INTEGER NOT NULL DEFAULT 0,
  successes        INTEGER NOT NULL DEFAULT 0,
  failures         INTEGER NOT NULL DEFAULT 0,
  cold_starts      INTEGER NOT NULL DEFAULT 0,

  latency_sum      REAL NOT NULL DEFAULT 0,
  latency_sq_sum   REAL NOT NULL DEFAULT 0,
  latency_min      REAL,
  latency_max      REAL,
  latency_p50      REAL,
  latency_p95      REAL,
  latency_p99      REAL,

  ttft_count       INTEGER NOT NULL DEFAULT 0,
  ttft_sum         REAL NOT NULL DEFAULT 0,
  ttft_p50         REAL,
  ttft_p95         REAL,

  tokens_generated INTEGER NOT NULL DEFAULT 0,
  tokens_prompt    INTEGER NOT NULL DEFAULT 0,
  avg_tokens_per_second REAL,

  errors_timeout   INTEGER NOT NULL DEFAULT 0,
  errors_oom       INTEGER NOT NULL DEFAULT 0,
  errors_connection INTEGER NOT NULL DEFAULT 0,
  errors_other     INTEGER NOT NULL DEFAULT 0,

  -- Day dimension
  day_of_week      INTEGER NOT NULL,           -- 0-6

  PRIMARY KEY (server_id, model, date_str)
);

CREATE INDEX idx_daily_model ON daily_rollups (model, date_str);
```

**At 5 combos for 90 days:** 450 rows. Negligible.

### 4.7 `temporal_profiles` -- Performance by Time-of-Day and Day-of-Week

This is the table that enables temporal-aware load balancing. Updated during daily
rollup from the last 14 days of hourly data. Contains three profile types (see §17,
Q2): exact (server+model), model-wide (server_id=NULL), and server-wide (model=NULL).
All time dimensions are stored in UTC (see §17, Q1).

```sql
CREATE TABLE temporal_profiles (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id        TEXT,                        -- NULL = model-wide profile
  model            TEXT,                        -- NULL = server-wide profile
  hour_of_day      INTEGER NOT NULL,            -- 0-23 (UTC)
  day_of_week      INTEGER NOT NULL,            -- 0-6 (0=Sunday, UTC)
  profile_type     TEXT NOT NULL,               -- 'exact' | 'model' | 'server'

  -- Aggregated over trailing 14 days for this (hour, dow) slot
  sample_count     INTEGER NOT NULL DEFAULT 0,  -- total hourly_rollup rows averaged
  total_requests   INTEGER NOT NULL DEFAULT 0,
  avg_latency_ms   REAL,
  avg_latency_stddev REAL,                      -- cross-hour variance
  p95_latency_ms   REAL,                        -- weighted avg of hourly p95s
  success_rate     REAL,                        -- total successes / total requests
  avg_tokens_per_second REAL,
  cold_start_rate  REAL,                        -- cold_starts / total_requests
  avg_ttft_ms      REAL,

  -- Confidence: how reliable is this profile?
  confidence       REAL NOT NULL DEFAULT 0,     -- 0.0 to 1.0

  updated_at       INTEGER NOT NULL             -- epoch ms
);

-- Unique constraint using COALESCE to handle NULLs correctly
CREATE UNIQUE INDEX idx_profiles_lookup ON temporal_profiles (
  COALESCE(server_id, ''),
  COALESCE(model, ''),
  hour_of_day,
  day_of_week
);

-- Fast lookup for model-wide profiles (Level 2 fallback)
CREATE INDEX idx_profiles_model_temporal ON temporal_profiles (
  model, hour_of_day, day_of_week
) WHERE server_id IS NULL;

-- Fast lookup for server-wide profiles (Level 3 fallback)
CREATE INDEX idx_profiles_server_temporal ON temporal_profiles (
  server_id, hour_of_day, day_of_week
) WHERE model IS NULL;
```

**Size:** 3 profile types _ 7 days _ 24 hours * N server:model combos. At 5 combos:
5*168 (exact) + 5*168 (model) + 5*168 (server) = ~2,520 rows. Negligible.

**Confidence calculation:**

```
confidence = min(1.0, sampleWeight * varianceWeight)

where:
  sampleWeight   = min(1.0, sample_count / 4)    -- need ~4 same-slot observations
  varianceWeight = max(0.2, 1.0 - cv)            -- cv = stddev/mean

Level 2 (model-wide) effective confidence  = profile.confidence * 0.6
Level 3 (server-wide) effective confidence = profile.confidence * 0.4
```

A profile needs at least 2 weeks of data at 1+ requests per (hour, day) slot to reach
confidence 1.0. With fewer samples, the temporal scorer blends toward the non-temporal
baseline. New servers automatically benefit from Level 2 (model-wide) profiles from
day one if the model has history on other servers (see §17, Q3).

### 4.8 Unified Error Classification

The current system has two slightly different error classifiers. This design unifies
them into a single enum used everywhere:

```
'timeout'           -- request exceeded deadline
'oom'               -- out of memory on server
'connection'        -- connection refused / network error
'model_not_found'   -- model not available on server
'circuit_breaker'   -- blocked by circuit breaker
'capacity'          -- server at max concurrency
'rate_limited'      -- 429 / rate limit response
'server_error'      -- 5xx from server (not OOM)
'unknown'           -- unclassifiable
```

---

## 5. MetricsStore Module Design

### 5.1 File: `src/storage/metrics-store.ts`

```typescript
interface MetricsStoreConfig {
  dbPath: string; // default: './data/metrics.db'
  requestRetentionDays: number; // default: 30
  decisionRetentionDays: number; // default: 30
  rollupRetentionDays: number; // default: 90
  profileTrailingDays: number; // default: 14
  batchSize: number; // default: 100
  batchFlushIntervalMs: number; // default: 1000
  rollupIntervalMs: number; // default: 3_600_000 (1 hour)
  rollupDeadlineMs: number; // default: 600_000 (10 min grace after hour)
  profileRebuildIntervalMs: number; // default: 86_400_000 (24 hours)
  retentionCheckIntervalMs: number; // default: 3_600_000 (1 hour)
  getInFlightCount: () => number; // callback; defaults to () => 0
}

class MetricsStore {
  // Lifecycle
  constructor(config?: Partial<MetricsStoreConfig>);
  close(): void;

  // Write API (called from orchestrator hot path)
  recordRequest(context: RequestContext): void; // buffers, async insert
  recordDecision(event: DecisionEvent): void; // buffers, async insert
  recordFailover(attempt: FailoverAttempt): void; // buffers, async insert

  // Read API -- Requests
  getRequests(opts: RequestQuery): RequestRow[];
  getRequestById(id: string): RequestRow | null;
  getRequestsByParent(parentId: string): RequestRow[]; // full retry chain
  getRequestStats(serverId?: string, model?: string, since?: number): RequestStats;

  // Read API -- Decisions
  getDecisions(opts: DecisionQuery): DecisionRow[];
  getDecisionWithCandidates(id: number): DecisionDetail;

  // Read API -- Rollups
  getHourlyRollups(opts: RollupQuery): HourlyRollup[];
  getDailyRollups(opts: RollupQuery): DailyRollup[];

  // Read API -- Temporal Profiles
  getTemporalProfile(
    serverId: string,
    model: string,
    hourOfDay: number,
    dayOfWeek: number
  ): TemporalProfile | null;
  getTemporalProfiles(serverId: string, model: string): TemporalProfile[];
  getAllProfiles(): TemporalProfile[];

  // Maintenance (called by internal timers)
  private flushBatch(): void;
  private computeHourlyRollup(hourStart: number): void;
  private computeDailyRollup(dateStr: string): void;
  private rebuildTemporalProfiles(): void;
  private pruneOldData(): void;
}
```

### 5.2 Write Buffer

```
recordRequest(ctx) ──▶ requestBuffer.push(ctx)
                       if buffer.length >= batchSize || timer fires:
                         BEGIN TRANSACTION
                           INSERT INTO requests VALUES (?, ...) -- for each in batch
                         COMMIT
                         buffer = []
```

`better-sqlite3`'s synchronous API makes transactions trivial:

```typescript
private flushBatch(): void {
  if (this.requestBuffer.length === 0 &&
      this.decisionBuffer.length === 0 &&
      this.failoverBuffer.length === 0) return;

  const insertRequest = this.db.prepare(`INSERT OR IGNORE INTO requests (...) VALUES (...)`);
  const insertDecision = this.db.prepare(`INSERT INTO decisions (...) VALUES (...)`);
  const insertCandidate = this.db.prepare(`INSERT INTO decision_candidates (...) VALUES (...)`);
  const insertFailover = this.db.prepare(`INSERT INTO failover_attempts (...) VALUES (...)`);

  this.db.transaction(() => {
    for (const req of this.requestBuffer) insertRequest.run(...);
    for (const dec of this.decisionBuffer) {
      const info = insertDecision.run(...);
      for (const cand of dec.candidates) {
        insertCandidate.run(info.lastInsertRowid, ...);
      }
    }
    for (const fo of this.failoverBuffer) insertFailover.run(...);
  })();

  this.requestBuffer = [];
  this.decisionBuffer = [];
  this.failoverBuffer = [];
}
```

### 5.3 Rollup Computation

Hourly rollup is scheduled to run during a low-traffic window shortly after each
hour boundary (see §17, Q5). The rollup waits for in-flight count to drop to zero
before executing, with a deadline of 10 minutes past the hour. The `MetricsStore`
constructor accepts a `getInFlightCount: () => number` callback for this:

```typescript
// Scheduling: checks every 5s for in-flight=0 or deadline exceeded
private scheduleRollup(targetHourStart: number): void {
  const deadline = targetHourStart + 3_600_000 + this.config.rollupDeadlineMs;
  const check = () => {
    if (this.getInFlightCount() === 0 || Date.now() >= deadline) {
      this.computeHourlyRollup(targetHourStart);
    } else {
      setTimeout(check, 5_000);
    }
  };
  setTimeout(check, 120_000); // start checking 2 min past the hour
}
```

The SQL for rollup computation (run once the low-traffic window is detected):

```sql
-- Compute hourly rollup for a given hour
INSERT OR REPLACE INTO hourly_rollups
  (server_id, model, hour_start,
   total_requests, user_requests, successes, failures, cold_starts,
   latency_sum, latency_sq_sum, latency_min, latency_max,
   tokens_generated, tokens_prompt,
   ttft_count, ttft_sum,
   errors_timeout, errors_oom, errors_connection, errors_other,
   hour_of_day, day_of_week)
SELECT
  server_id, model, :hour_start,
  COUNT(*),
  COUNT(*) FILTER (WHERE is_retry = 0),
  COUNT(*) FILTER (WHERE success = 1),
  COUNT(*) FILTER (WHERE success = 0),
  COUNT(*) FILTER (WHERE is_cold_start = 1),
  COALESCE(SUM(duration_ms), 0),
  COALESCE(SUM(duration_ms * duration_ms), 0),
  MIN(duration_ms),
  MAX(duration_ms),
  COALESCE(SUM(tokens_generated), 0),
  COALESCE(SUM(tokens_prompt), 0),
  COUNT(*) FILTER (WHERE ttft_ms IS NOT NULL),
  COALESCE(SUM(ttft_ms), 0),
  COUNT(*) FILTER (WHERE error_type = 'timeout'),
  COUNT(*) FILTER (WHERE error_type = 'oom'),
  COUNT(*) FILTER (WHERE error_type = 'connection'),
  COUNT(*) FILTER (WHERE error_type NOT IN ('timeout','oom','connection') AND success = 0),
  :hour_of_day,
  :day_of_week
FROM requests
WHERE timestamp >= :hour_start AND timestamp < :hour_end
GROUP BY server_id, model;
```

Percentiles (P50, P95, P99) are computed in a second pass using `ORDER BY duration_ms`
with `NTILE` or offset-based calculation on the request rows for that hour. This is
acceptable because the hour's data is bounded (at most a few thousand rows per
server:model per hour).

### 5.4 Temporal Profile Rebuild

Runs once per day (or on startup if profiles are stale):

```sql
INSERT OR REPLACE INTO temporal_profiles
  (server_id, model, hour_of_day, day_of_week,
   sample_count, total_requests,
   avg_latency_ms, avg_latency_stddev, p95_latency_ms,
   success_rate, avg_tokens_per_second, cold_start_rate, avg_ttft_ms,
   confidence, updated_at)
SELECT
  server_id, model, hour_of_day, day_of_week,
  COUNT(*),                                    -- sample_count (# hourly buckets)
  SUM(total_requests),
  SUM(latency_sum) / NULLIF(SUM(total_requests), 0),
  -- stddev across hourly averages:
  SQRT(
    AVG((latency_sum / NULLIF(total_requests, 0)) *
        (latency_sum / NULLIF(total_requests, 0)))
    - AVG(latency_sum / NULLIF(total_requests, 0))
      * AVG(latency_sum / NULLIF(total_requests, 0))
  ),
  -- weighted average of hourly p95s
  SUM(latency_p95 * total_requests) / NULLIF(SUM(total_requests), 0),
  -- success rate
  CAST(SUM(successes) AS REAL) / NULLIF(SUM(total_requests), 0),
  -- throughput
  SUM(avg_tokens_per_second * total_requests)
    / NULLIF(SUM(total_requests), 0),
  -- cold start rate
  CAST(SUM(cold_starts) AS REAL) / NULLIF(SUM(total_requests), 0),
  -- ttft
  SUM(ttft_sum) / NULLIF(SUM(ttft_count), 0),
  -- confidence (computed in application code, placeholder here)
  0,
  :now
FROM hourly_rollups
WHERE hour_start >= :cutoff_14d
GROUP BY server_id, model, hour_of_day, day_of_week;
```

Confidence is computed in application code after the SQL aggregation, using the
formula from §4.7.

### 5.5 Retention Pruning

Runs hourly:

```sql
DELETE FROM requests         WHERE timestamp < :requests_cutoff;
DELETE FROM decisions        WHERE timestamp < :decisions_cutoff;
DELETE FROM failover_attempts WHERE timestamp < :failover_cutoff;
DELETE FROM decision_candidates
  WHERE decision_id NOT IN (SELECT id FROM decisions);
DELETE FROM hourly_rollups   WHERE hour_start < :rollup_cutoff;
DELETE FROM daily_rollups    WHERE date_str < :daily_cutoff;
-- temporal_profiles are rebuilt, not pruned
```

After pruning, `PRAGMA incremental_vacuum` reclaims freed pages.

---

## 6. Temporal-Aware Load Balancer Enhancement

### 6.1 New Component: `TemporalScorer`

File: `src/load-balancer/temporal-scorer.ts`

```typescript
interface TemporalAdjustment {
  latencyMultiplier: number; // e.g., 1.2 = expect 20% worse latency
  successRateMultiplier: number; // e.g., 0.95 = expect 5% worse success rate
  throughputMultiplier: number; // e.g., 0.8 = expect 20% worse throughput
  confidence: number; // 0-1, from temporal profile
  reason: string; // human-readable explanation
}

class TemporalScorer {
  constructor(private store: MetricsStore) {}

  /**
   * Returns a temporal adjustment for a server:model at the current time.
   * The adjustment represents how this server:model typically performs at
   * this hour/day compared to its overall average.
   */
  getAdjustment(serverId: string, model: string, now?: Date): TemporalAdjustment;

  /**
   * Returns adjustments for all servers for a given model, for comparison.
   */
  getComparativeAdjustments(
    model: string,
    serverIds: string[],
    now?: Date
  ): Map<string, TemporalAdjustment>;
}
```

### 6.2 How the Adjustment Is Calculated

```
1. Look up temporal_profile for (serverId, model, currentHour, currentDayOfWeek)
2. Look up the server:model's overall average (from daily_rollups, last 14 days)
3. Compute ratios:
     latencyMultiplier  = profile.avg_latency_ms / overall.avg_latency_ms
     successRateMultiplier = profile.success_rate / overall.success_rate
     throughputMultiplier  = profile.avg_tokens_per_second / overall.avg_tokens_per_second
4. Blend with confidence:
     effective_multiplier = 1.0 + (raw_multiplier - 1.0) * confidence
     (At confidence=0, multiplier is 1.0 -- no adjustment.
      At confidence=1.0, full adjustment applied.)
```

Example: Server A handles `llama3:8b`. Its overall avg latency is 500ms. At 2 PM on
Wednesdays (based on 14 days of hourly data), its avg latency is 750ms with confidence
0.8. The adjustment would be:

```
raw_multiplier = 750 / 500 = 1.5
effective_multiplier = 1.0 + (1.5 - 1.0) * 0.8 = 1.4
```

The load balancer would treat this server as if its current latency is 40% worse than
measured, proactively routing away from it during its historically bad time slots.

### 6.3 Integration with Load Balancer Algorithms

#### `fastest-response` (default algorithm)

Current formula:

```
adjustedLatency = baseLatency * loadFactor * hotColdFactor * successPenalty * degradationPenalty
```

New formula:

```
adjustedLatency = baseLatency * loadFactor * hotColdFactor * successPenalty
                  * degradationPenalty * temporalLatencyMultiplier
```

Where `temporalLatencyMultiplier` comes from `TemporalScorer.getAdjustment()`.

#### `weighted` algorithm

Add a new sub-score:

```
temporalScore = 100 * (1 / temporalLatencyMultiplier) * temporalSuccessRateMultiplier
```

Clamped to [0, 100]. A server expected to perform well at this time gets a score near
100; one expected to degrade gets a lower score.

Weight redistribution:

| Factor          | Current Weight | New Weight |
| --------------- | -------------- | ---------- |
| Latency         | 0.20           | 0.18       |
| Success Rate    | 0.20           | 0.18       |
| Load            | 0.20           | 0.18       |
| Capacity        | 0.05           | 0.05       |
| Circuit Breaker | 0.15           | 0.13       |
| Timeout         | 0.05           | 0.05       |
| Throughput      | 0.10           | 0.08       |
| VRAM            | 0.05           | 0.05       |
| **Temporal**    | --             | **0.10**   |
| **Total**       | **1.00**       | **1.00**   |

The temporal weight starts at 0.10. It is further scaled by confidence -- at 0
confidence, the temporal score contributes 0 effective weight (redistributed
proportionally to other factors).

#### `streaming-optimized` algorithm

Apply `temporalLatencyMultiplier` to both TTFT and duration estimates. Apply a
temporal TTFT multiplier if TTFT temporal data is available.

#### `least-connections` and `round-robin`

No change. These algorithms are capacity-focused, not performance-focused.

### 6.4 Additional Load Balancer Improvements (Opportunistic)

While integrating the temporal scorer, fix these existing issues identified in the
metrics audit:

| Issue                                               | Fix                                                                     |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| Capacity score can go negative                      | Add `Math.max(0, capacityScore)`                                        |
| Throughput cold-start penalty (score=0 for unknown) | Default to 50 (neutral) instead of 0                                    |
| Success rate cliff at 95%                           | Replace cliff with smooth curve: `score = 100 * successRate^3`          |
| P50 and P99 unused                                  | Include P50 in fastest-response blend; use P99 for tail-latency penalty |
| Model-level CB not in scoring                       | Add model-level failure count as a secondary signal                     |
| `crossModelInference.fallbackWeight` dead code      | Either implement the blending or remove the config                      |

---

## 7. Migration Strategy

### Phase 1: Add SQLite, dual-write (Week 1-2)

1. Add `better-sqlite3` dependency
2. Implement `MetricsStore` with schema creation, write buffer, and basic read APIs
3. Wire `MetricsStore.recordRequest()` into the orchestrator alongside existing
   JSON persistence -- both systems write simultaneously
4. Wire `MetricsStore.recordDecision()` and `recordFailover()` similarly
5. Add rollup timer and retention pruning
6. **No reads from SQLite yet.** JSON files remain the source of truth for all queries.

Validation: Compare SQLite row counts with JSON array lengths. They should match
within the batch flush delay.

### Phase 2: Read migration (Week 2-3)

1. Migrate `AnalyticsEngine` read methods to query SQLite instead of in-memory arrays
2. Migrate `RequestHistory` read methods to query SQLite
3. Migrate `DecisionHistory` read methods to query SQLite
4. Update `selectBestWindow()` for 7d/30d ranges to read from `hourly_rollups`
5. Update the existing `MetricsSummarySnapshot` system to read from `hourly_rollups`
   instead of maintaining its own array
6. **JSON writes continue** as a fallback. Can be disabled via config flag.

Validation: A/B compare API responses between JSON-backed and SQLite-backed queries.

### Phase 3: Temporal scoring (Week 3-4)

1. Implement `TemporalScorer`
2. Implement temporal profile rebuild job
3. Integrate into `fastest-response` algorithm
4. Integrate into `weighted` algorithm
5. Add temporal data to dashboard APIs
6. Apply opportunistic LB fixes from §6.4

Validation: Log temporal adjustments for 1 week without applying them (shadow mode).
Compare predicted vs. actual performance. Then enable with low confidence floor (0.5)
and gradually lower it.

### Phase 4: Cleanup (Week 4-5)

1. Remove in-memory `requestHistory[]` and `errorHistory[]` from AnalyticsEngine
2. Remove in-memory `Map<string, RequestRecord[]>` from RequestHistory
3. Remove `DecisionHistory` in-memory events array
4. Remove redundant JSON persistence for migrated data
5. Keep JSON persistence for: servers, bans, timeouts, circuit-breakers (small,
   stateful data that benefits from simple file storage)
6. Update config schema: add `storage.dbPath`, `storage.retentionDays`, etc.
7. Remove dead config: `metrics.historyWindowMinutes`

---

## 8. Frontend Changes

### 8.1 Dashboard Time Ranges

The 7d and 30d time ranges become real. The API layer returns data from rollup tables:

| Time Range | Data Source                         | Granularity |
| ---------- | ----------------------------------- | ----------- |
| 1h         | In-memory MetricsAggregator windows | Real-time   |
| 6h         | `hourly_rollups` (last 6 hours)     | 1 hour      |
| 24h        | `hourly_rollups` (last 24 hours)    | 1 hour      |
| 7d         | `hourly_rollups` (last 7 days)      | 1 hour      |
| 30d        | `daily_rollups` (last 30 days)      | 1 day       |

### 8.2 New Dashboard Elements

1. **Temporal heatmap.** A 7x24 grid (days x hours) showing request volume or latency
   for a selected server:model. Color intensity = performance relative to average.
   Data source: `temporal_profiles` table.

2. **Request history browser.** Paginated table of individual requests with filtering
   by server, model, success/failure, time range, error type. Replaces the current
   limited request history view. Data source: `requests` table.

3. **Failover chain viewer.** Given a request ID, shows the full retry/failover chain
   with timing for each attempt. Data source: `requests` (via `parent_request_id`)
   - `failover_attempts`.

4. **Decision replay.** For any historical decision, show all candidates with their
   scores and the selection rationale. Data source: `decisions` +
   `decision_candidates`.

5. **Temporal insight badge.** On server cards, show a small indicator when the
   temporal scorer is actively adjusting a server's score (up or down) at the current
   time. Shows the adjustment factor and confidence.

---

## 9. API Changes

### New Endpoints

```
GET /api/analytics/requests
  ?serverId=&model=&success=&startTime=&endTime=&limit=&offset=
  Returns: paginated request rows from SQLite

GET /api/analytics/requests/:id
  Returns: single request with retry chain

GET /api/analytics/requests/:id/failover
  Returns: failover attempts for this request

GET /api/analytics/decisions
  ?model=&serverId=&startTime=&endTime=&limit=&offset=
  Returns: paginated decision rows

GET /api/analytics/decisions/:id
  Returns: decision with full candidate breakdown

GET /api/analytics/rollups/hourly
  ?serverId=&model=&startTime=&endTime=
  Returns: hourly rollup rows

GET /api/analytics/rollups/daily
  ?serverId=&model=&startTime=&endTime=
  Returns: daily rollup rows

GET /api/analytics/temporal-profile
  ?serverId=&model=
  Returns: 7x24 temporal profile grid

GET /api/analytics/temporal-adjustment
  ?model=&serverIds[]=
  Returns: current temporal adjustments for all specified servers
```

### Modified Endpoints

Existing analytics endpoints (`/api/analytics/summary`, `/api/analytics/trends`, etc.)
will be updated to query SQLite for time ranges > 1h, falling back to in-memory
windows for <= 1h queries.

---

## 10. Configuration

### New Config Section

```yaml
storage:
  enabled: true # master toggle (default: true)
  dbPath: './data/metrics.db' # SQLite database file path
  retention:
    requests: 30 # days to keep individual requests
    decisions: 30 # days to keep decision + full candidate rows
    rollups: 90 # days to keep hourly/daily rollups
    profiles: 14 # trailing days for temporal profile calculation
  performance:
    batchSize: 100 # requests buffered before flush
    batchFlushInterval: 1000 # ms between forced flushes
    rollupDeadlineMinutes: 10 # max minutes past hour before forced rollup
    profileRebuildInterval: 86400000 # ms between profile rebuild (24 hours)
    retentionCheckInterval: 3600000 # ms between retention pruning (1 hour)
  temporal:
    enabled: true # enable temporal scoring in LB
    minConfidence: 0.3 # minimum effective confidence to apply adjustment
    maxAdjustment: 2.0 # cap multiplier at 2x (100% worse)
    shadowMode: false # log adjustments without applying them to routing
    # Fallback confidence multipliers (see §17, Q2)
    modelFallbackConfidence: 0.6 # applied to model-wide profile confidence
    serverFallbackConfidence: 0.4 # applied to server-wide profile confidence
```

### Environment Variables

```
ORCHESTRATOR_STORAGE_ENABLED=true
ORCHESTRATOR_STORAGE_DB_PATH=./data/metrics.db
ORCHESTRATOR_STORAGE_RETENTION_REQUESTS=30
ORCHESTRATOR_STORAGE_RETENTION_DECISIONS=30
ORCHESTRATOR_STORAGE_RETENTION_ROLLUPS=90
ORCHESTRATOR_STORAGE_TEMPORAL_ENABLED=true
ORCHESTRATOR_STORAGE_TEMPORAL_MIN_CONFIDENCE=0.3
ORCHESTRATOR_STORAGE_TEMPORAL_SHADOW_MODE=false
ORCHESTRATOR_STORAGE_TEMPORAL_MODEL_FALLBACK_CONFIDENCE=0.6
ORCHESTRATOR_STORAGE_TEMPORAL_SERVER_FALLBACK_CONFIDENCE=0.4
```

---

## 11. Dependency: `better-sqlite3`

### Why `better-sqlite3`

| Factor            | `better-sqlite3`             | `sql.js`            | `sqlite3` (async)  |
| ----------------- | ---------------------------- | ------------------- | ------------------ |
| API               | Synchronous                  | Synchronous         | Async (callbacks)  |
| Performance       | Native, fastest              | WASM, ~2-5x slower  | Native, fast       |
| WAL support       | Yes                          | No (in-memory only) | Yes                |
| Transactions      | Trivial (`db.transaction()`) | Manual              | Callback hell      |
| Node 22 support   | Yes                          | Yes                 | Yes                |
| Binary size       | ~2 MB                        | ~1.5 MB             | ~2 MB              |
| Prebuilt binaries | Yes (prebuildify)            | N/A (WASM)          | Yes (node-pre-gyp) |

`better-sqlite3` is the standard choice for single-process Node.js applications
needing embedded SQL storage. Its synchronous API is ideal because:

- Write buffer flush happens in a `setInterval` callback -- synchronous is fine
- Read queries are on Express request handlers -- synchronous avoids callback overhead
- Transaction semantics are clean and composable

### Installation

```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

---

## 12. Performance Estimates

### Write Path

| Operation                            | Estimated Time | Notes                                    |
| ------------------------------------ | -------------- | ---------------------------------------- |
| Single INSERT (no transaction)       | ~50 μs         | Acceptable but suboptimal                |
| Batch INSERT 100 rows (transaction)  | ~2 ms          | 20 μs/row, well under 1% of request time |
| Batch INSERT 1000 rows (transaction) | ~15 ms         | For burst scenarios                      |

The write buffer ensures inserts never block the request hot path. The buffer push is
O(1) -- just an array append.

### Read Path

| Query                               | Estimated Time | Notes                               |
| ----------------------------------- | -------------- | ----------------------------------- |
| Temporal profile lookup (PK)        | < 0.1 ms       | Primary key lookup, cached          |
| Hourly rollups, 24h, 1 server:model | < 1 ms         | 24 rows, indexed                    |
| Hourly rollups, 7d, all servers     | < 5 ms         | ~840 rows                           |
| Request search, 24h, filtered       | < 10 ms        | Indexed range scan                  |
| Request search, 30d, filtered       | < 50 ms        | Larger range, still indexed         |
| Rollup computation (1 hour)         | < 100 ms       | Aggregate over bounded row set      |
| Temporal profile rebuild            | < 500 ms       | Full scan of 14 days hourly rollups |

### Storage Size

Full 30-day candidate retention (see §17, Q4):

| Table               | 30-day estimate (1K req/day) | 30-day estimate (10K req/day) |
| ------------------- | ---------------------------- | ----------------------------- |
| requests            | ~10 MB                       | ~105 MB                       |
| decisions           | ~5 MB                        | ~50 MB                        |
| decision_candidates | ~45 MB                       | ~450 MB                       |
| failover_attempts   | ~2 MB                        | ~20 MB                        |
| hourly_rollups      | ~0.3 MB                      | ~0.3 MB                       |
| daily_rollups       | ~0.01 MB                     | ~0.01 MB                      |
| temporal_profiles   | ~0.1 MB                      | ~0.1 MB                       |
| **Total**           | **~62 MB**                   | **~625 MB**                   |

At high throughput (10K/day), the database reaches ~625 MB after 30 days. The dominant
cost is `decision_candidates` (full 30-day retention). Operators running at high
throughput should ensure 2 GB of free disk space. The `storage.retention.decisions`
config (default 30 days) can be reduced to constrain disk usage. WAL file adds up to
~10% overhead temporarily.

### Memory

SQLite's default page cache is 2 MB (`PRAGMA cache_size = -2000`). With WAL mode,
the memory overhead is approximately:

- Page cache: 2 MB
- WAL file mapping: proportional to writes between checkpoints (~1-5 MB)
- Write buffer: ~100 \* 350 bytes = 35 KB
- Prepared statement cache: ~50 KB
- **Total: ~5-10 MB**

Well within the G5 goal of < 20 MB.

---

## 13. Observability

### New Prometheus Metrics

```
orchestrator_storage_writes_total{table}          -- counter
orchestrator_storage_write_batch_size              -- histogram
orchestrator_storage_write_latency_ms              -- histogram
orchestrator_storage_read_latency_ms{query_type}   -- histogram
orchestrator_storage_db_size_bytes                  -- gauge
orchestrator_storage_rollup_duration_ms             -- histogram
orchestrator_storage_retention_pruned_total{table}  -- counter
orchestrator_temporal_adjustment{server,model}      -- gauge (current multiplier)
orchestrator_temporal_confidence{server,model}       -- gauge
```

### Logging

- `INFO` on startup: database opened, table counts, WAL status
- `INFO` on rollup completion: rows computed, duration
- `WARN` if write buffer exceeds 2x `batchSize` (writes falling behind)
- `DEBUG` on temporal adjustment applied: server, model, multiplier, confidence
- `ERROR` on SQLite errors with full context

---

## 14. Testing Strategy

### Unit Tests

1. **MetricsStore CRUD:** Insert requests, query by various filters, verify results
2. **Write buffer batching:** Verify batch size and timer-based flushing
3. **Rollup computation:** Insert known requests, compute rollup, verify aggregates
4. **Temporal profile:** Insert hourly rollups with known patterns, rebuild profiles,
   verify confidence calculation
5. **Retention pruning:** Insert old + new data, run prune, verify only old removed
6. **TemporalScorer:** Given known profiles and overall averages, verify adjustment
   calculation and confidence blending

### Integration Tests

1. **End-to-end request flow:** Send requests through orchestrator, verify they appear
   in SQLite with correct fields
2. **Decision recording:** Verify decisions and candidates are recorded with scores
3. **Failover chains:** Trigger failovers, verify `parent_request_id` linkage and
   failover_attempts records
4. **Rollup accuracy:** Run for 2+ hours, verify rollups match raw request aggregates
5. **Temporal LB integration:** Set up servers with known temporal profiles, verify
   the load balancer adjusts scoring at different simulated times

### Load Tests

1. **Sustained write throughput:** 1000 requests/second for 5 minutes -- verify no
   write buffer overflow, measure P99 flush latency
2. **Large database queries:** Seed 30 days of data at 10K/day, benchmark all read
   query patterns

---

## 15. Risks and Mitigations

| Risk                                                         | Impact                          | Mitigation                                                                                                                                                               |
| ------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `better-sqlite3` native compilation fails on target platform | Blocks deployment               | Fall back to `sql.js` (WASM); provide Docker build with pre-compiled binaries                                                                                            |
| SQLite WAL file grows unbounded under sustained write load   | Disk exhaustion                 | Configure `PRAGMA wal_autocheckpoint = 1000` (default); add monitoring                                                                                                   |
| Temporal profiles overfit to anomalous weeks                 | Bad routing decisions           | Confidence scoring penalizes high variance; 14-day trailing window smooths outliers; `maxAdjustment` caps multiplier at 2x                                               |
| Write buffer data loss on crash                              | Up to `batchSize` requests lost | Acceptable tradeoff -- in-memory windows provide real-time metrics; SQLite is for historical analysis. Can reduce `batchFlushIntervalMs` for tighter durability          |
| Schema migrations on upgrade                                 | Database becomes unreadable     | Store schema version in `PRAGMA user_version`; run migration scripts on startup                                                                                          |
| Rollup computation blocks event loop                         | Request latency spike           | `better-sqlite3` runs in the main thread but rollup queries are bounded by hour-of-data size; at 10K req/hour, rollup takes < 100ms. If needed, offload to worker thread |

---

## 16. File Manifest (New and Modified)

### New Files

| File                                   | Purpose                            |
| -------------------------------------- | ---------------------------------- |
| `src/storage/metrics-store.ts`         | Core SQLite storage class          |
| `src/storage/schema.ts`                | SQL DDL statements and migrations  |
| `src/storage/types.ts`                 | Row types, query option interfaces |
| `src/load-balancer/temporal-scorer.ts` | Temporal adjustment calculator     |
| `tests/unit/metrics-store.test.ts`     | Unit tests for storage             |
| `tests/unit/temporal-scorer.test.ts`   | Unit tests for temporal scoring    |

### Modified Files

| File                                           | Changes                                                                                       |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `package.json`                                 | Add `better-sqlite3`, `@types/better-sqlite3`                                                 |
| `src/orchestrator.ts`                          | Wire `MetricsStore.recordRequest/Decision/Failover` calls                                     |
| `src/orchestrator.types.ts`                    | Add unified error type enum; add storage config types                                         |
| `src/load-balancer.ts`                         | Accept `TemporalScorer`; add temporal sub-score; fix capacity/throughput/success-rate scoring |
| `src/analytics/analytics-engine.ts`            | Migrate read methods to query `MetricsStore`; remove in-memory arrays                         |
| `src/request-history.ts`                       | Migrate to query `MetricsStore`; remove in-memory Map                                         |
| `src/decision-history.ts`                      | Migrate to query `MetricsStore`; remove in-memory arrays                                      |
| `src/controllers/analyticsController.ts`       | Add new endpoints for rollups, temporal profiles, request browser                             |
| `src/config/config.ts`                         | Add `storage` config section with Zod schema                                                  |
| `src/config/envMapper.ts`                      | Map `ORCHESTRATOR_STORAGE_*` environment variables                                            |
| `frontend/src/types.ts`                        | Add types for rollups, temporal profiles, request detail                                      |
| `frontend/src/api.ts`                          | Add API calls for new endpoints                                                               |
| `frontend/src/pages/Dashboard.tsx`             | Real 7d/30d time ranges; temporal heatmap                                                     |
| `frontend/src/pages/analytics/OverviewTab.tsx` | Use rollup data for longer time ranges                                                        |
| `frontend/src/pages/analytics/TrendsTab.tsx`   | Use rollup data for multi-week trends                                                         |
| `frontend/src/pages/analytics/RequestsTab.tsx` | Paginated request browser with SQLite backend                                                 |

---

## 17. Resolved Design Decisions

The following questions were resolved before implementation:

### Q1: Timezone — UTC internally, convert in frontend (RESOLVED)

`hour_of_day` and `day_of_week` are stored in UTC in all tables. The frontend is
responsible for converting UTC hour offsets to the operator's local timezone for
display in the temporal heatmap and profile views. The `TemporalScorer` reads the
current UTC hour/day when computing adjustments.

**Rationale:** UTC avoids DST discontinuities that would corrupt year-over-year slot
alignment in `temporal_profiles`. The orchestrator may run in a different timezone
than the operator's browser; the browser already knows the operator's local timezone
via `Intl.DateTimeFormat().resolvedOptions().timeZone` and can apply the offset for
display without any backend involvement.

**Implementation note:** The frontend should expose a timezone selector (defaulting
to the browser's local timezone) in the temporal heatmap view, stored in localStorage.
All UTC-to-local conversions are purely presentational — the DB always stores UTC.

---

### Q2: Three-level profile fallback (RESOLVED)

When computing a temporal adjustment for `(serverId, model, hourOfDay, dayOfWeek)`,
the `TemporalScorer` uses a three-level fallback chain with confidence reduction at
each level:

```
Level 1 (exact):    temporal_profiles WHERE server_id=? AND model=? AND hour_of_day=? AND day_of_week=?
                    confidence = profile.confidence (unmodified)

Level 2 (model):    temporal_profiles WHERE server_id IS NULL AND model=? AND hour_of_day=? AND day_of_week=?
                    confidence = profile.confidence * 0.6

Level 3 (server):   temporal_profiles WHERE server_id=? AND model IS NULL AND hour_of_day=? AND day_of_week=?
                    confidence = profile.confidence * 0.4

No match:           TemporalAdjustment { multipliers: all 1.0, confidence: 0 }
```

The `temporal_profiles` table therefore gains two additional profile types:

- **Model-wide profiles** (`server_id = NULL`, `model = ?`): aggregate across all
  servers serving the same model at the same (hour, dow). Rebuilt during the daily
  profile rebuild job.
- **Server-wide profiles** (`server_id = ?`, `model = NULL`): aggregate across all
  models on a given server at the same (hour, dow). Captures server-level load patterns
  (e.g., a shared server that gets hammered at 9 AM regardless of model). Also rebuilt
  during daily profile rebuild.

**Schema addition** -- `temporal_profiles` primary key changes from
`(server_id, model, hour_of_day, day_of_week)` to allow NULLs:

```sql
CREATE TABLE temporal_profiles (
  server_id        TEXT,                        -- NULL = model-wide profile
  model            TEXT,                        -- NULL = server-wide profile
  hour_of_day      INTEGER NOT NULL,
  day_of_week      INTEGER NOT NULL,
  -- ... same aggregate columns ...
  profile_type     TEXT NOT NULL DEFAULT 'exact',  -- 'exact' | 'model' | 'server'
  confidence       REAL NOT NULL DEFAULT 0,
  updated_at       INTEGER NOT NULL,

  PRIMARY KEY (server_id, model, hour_of_day, day_of_week)
);
```

SQLite allows multiple NULLs in a PRIMARY KEY only with careful handling; in practice
use a generated unique key or a UNIQUE constraint on the non-null combination.
Implementation should use a synthetic primary key (`id INTEGER PRIMARY KEY`) with a
UNIQUE index on `(COALESCE(server_id,''), COALESCE(model,''), hour_of_day, day_of_week)`.

**Confidence reduction rationale:**

- Model-wide profiles may not reflect hardware differences between servers (0.6x).
- Server-wide profiles aggregate across different models with very different latency
  characteristics (0.4x) -- useful for detecting server-level load patterns but less
  precise for per-model routing.

---

### Q3: New servers build profiles naturally (RESOLVED)

New servers start with `confidence = 0` for all temporal slots. The `TemporalScorer`
returns a neutral adjustment (all multipliers = 1.0) for any slot with effective
confidence below `minConfidence` (default 0.3).

However, new servers immediately benefit from **Level 2 (model-wide)** profiles if
the model they serve has been running on other servers. For example, if `llama3:8b`
historically degrades at 2 PM UTC on Tuesdays across all servers, a new server
running `llama3:8b` will get that pattern applied at 60% confidence from day one.

This means the "no bootstrapping" decision is accurate for Level 1 (server-specific
history), but Levels 2 and 3 provide a meaningful head start automatically via the
fallback chain. Full Level 1 confidence for a new server is expected after ~4 weeks
(2 weeks to accumulate data, 2 weeks for the profile confidence to stabilize above
the 0.8 threshold across all 168 hour/day slots).

---

### Q4: Decision candidates retained for full 30 days (RESOLVED)

All candidate score rows are kept for the full 30-day retention period alongside
the decision summary rows. No sampling.

**Revised storage estimates** accounting for 30-day full candidate retention:

| Table               | 30-day estimate (1K req/day) | 30-day estimate (10K req/day) |
| ------------------- | ---------------------------- | ----------------------------- |
| requests            | ~10 MB                       | ~105 MB                       |
| decisions           | ~5 MB                        | ~50 MB                        |
| decision_candidates | ~45 MB                       | ~450 MB                       |
| failover_attempts   | ~2 MB                        | ~20 MB                        |
| hourly_rollups      | ~0.3 MB                      | ~0.3 MB                       |
| daily_rollups       | ~0.01 MB                     | ~0.01 MB                      |
| temporal_profiles   | ~0.1 MB                      | ~0.1 MB                       |
| **Total**           | **~62 MB**                   | **~625 MB**                   |

At 10K req/day the database reaches ~625 MB after 30 days. This is dominated by
`decision_candidates`. Operators running at high throughput should ensure adequate
disk space (recommend 2 GB free for headroom including WAL and vacuum operations).
A `storage.retention.decisions` config value (default 30) allows reducing this if
disk is constrained.

**Value justification:** Full candidate history enables post-incident analysis ("why
did the load balancer keep sending traffic to the degraded server for 20 minutes?"),
algorithm comparison, and future ML/weight optimization work. The cost is justified
by the analytical value.

---

### Q5: Rollups run during low-traffic periods (RESOLVED)

Hourly rollup computation is scheduled to run when the current in-flight request
count drops to or near zero, rather than on a fixed timer. If no low-traffic window
occurs within a configurable deadline (default: 10 minutes past the hour), the
rollup runs regardless.

**Implementation:**

```typescript
private scheduleRollup(targetHourStart: number): void {
  const deadline = targetHourStart + 3_600_000 + this.config.rollupDeadlineMs; // default +10min
  const check = () => {
    const inFlight = this.getInFlightCount();  // callback from orchestrator
    if (inFlight === 0 || Date.now() >= deadline) {
      this.computeHourlyRollup(targetHourStart);
    } else {
      setTimeout(check, 5_000); // re-check every 5 seconds
    }
  };
  // Start checking 2 minutes after the hour (allow buffer for in-flight to drain)
  setTimeout(check, 120_000);
}
```

The `MetricsStore` constructor accepts a `getInFlightCount: () => number` callback
(or defaults to always returning 0 if not provided, which causes the rollup to run
immediately at the deadline). This keeps `MetricsStore` decoupled from the
`InFlightManager`.

**Why not a worker thread:** The rollup is bounded (~50-100ms at 10K req/hour) and
infrequent (once per hour). Worker threads require a separate SQLite connection which
adds connection-management complexity. Running during low-traffic periods achieves
the same goal (no user-visible latency impact) without the complexity. A `WARN` log
is emitted if rollup duration exceeds 500ms, which would prompt revisiting this
decision.
