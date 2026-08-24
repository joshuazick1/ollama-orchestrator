# Task 6 Evidence — Decision/Request Correlation + Adaptive Tuning

**Date**: 2026-08-24
**Branch**: dedup-refactor
**Objective**: Persist decision/request correlation IDs and use actual outcomes for AdaptiveWeightTuner

## Changes

### Schema (src/storage/schema.ts)
- `CURRENT_SCHEMA_VERSION`: 7 → 9
- `SCHEMA_V8_MIGRATION`: no-op placeholder
- `SCHEMA_V9_MIGRATION`: adds `request_id TEXT` to `decisions` table (+ index `idx_decisions_request_id`) and `decision_id TEXT` to `requests` table (+ index `idx_requests_decision_id`)

### Types (src/storage/types.ts)
- `DecisionRow.request_id: string | null`
- `RequestRow.decision_id: string | null`

### DecisionHistory (src/decision-history.ts)
- `DecisionEvent.id`: added as required `string` (UUID via `crypto.randomUUID()`)
- `recordDecision()` now returns `DecisionEvent` (was `void`)
- `recordDecision()` passes `id` and `requestId` through to `MetricsStore.recordDecision()`
- `rowToEvent()` derives `id: row-${row.id}` for SQLite rows; propagates `row.request_id` as `requestId`

### MetricsStore (src/storage/metrics-store.ts)
- `BufferedDecision.id: string` and `requestId?: string` added
- `insertDecision` SQL includes `request_id`
- `insertRequest` SQL includes `decision_id`
- `flushBatch()` passes `d.requestId ?? null` and `c.decisionId ?? null`
- `getRequestsByDecisionId(decisionId: string, options?: { limit?: number }): RequestRow[]` added with prepared statement `'SELECT * FROM requests WHERE decision_id = ? ORDER BY timestamp ASC LIMIT ?'`

### AdaptiveWeightTuner (src/load-balancer/adaptive-weight-tuner.ts)
- `getMetricsStore: () => MetricsStore` added as 3rd constructor parameter
- `getAdaptiveWeightTuner()` singleton updated to accept 3rd param
- `tune()` Step 4 now uses two-tier correlation:
  1. For decisions with real UUID ids (not `row-*` legacy format), calls `getRequestsByDecisionId(decision.id)` for direct outcome correlation
  2. Falls back to `getRecentFailoverAttempts` proximity heuristic for legacy decisions or when correlation returns empty

## Tests
- `tests/unit/decision-history.test.ts`: 2 new tests for stable `DecisionEvent.id` and unique ids
- `tests/unit/decision-history-requestid.test.ts`: 4 tests verifying requestId persistence
- `tests/unit/operational-store-v9-migration.test.ts`: 15 tests covering fresh V9 schema, legacy upgrade from v7, idempotency, row readability
- `tests/unit/metrics-store.test.ts`: 5 new tests for `recordDecision` requestId persistence, `getRequestsByDecisionId` (ordered, empty, limit), request decisionId persistence
- `tests/unit/adaptive-weight-tuner.test.ts`: 3 new tests for direct correlation path, fallback to failover heuristic, decisionId from DecisionEvent

## Verification
```
npx tsc --noEmit           → 0 errors
npm run lint               → 0 errors in modified files
npx vitest run [targeted]  → 103 passed (5 test files)
npx vitest run tests/unit/ → 4159 passed, 1 failed (pre-existing V5 migration test unrelated to V9)
```

## Full Diff (Task 6 files only)
```
src/storage/schema.ts
src/storage/types.ts
src/storage/metrics-store.ts
src/decision-history.ts
src/load-balancer/adaptive-weight-tuner.ts
tests/unit/decision-history.test.ts
tests/unit/decision-history-requestid.test.ts
tests/unit/operational-store-v9-migration.test.ts
tests/unit/metrics-store.test.ts
tests/unit/adaptive-weight-tuner.test.ts
```
