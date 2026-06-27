# src/analytics/

Analytics engine, recovery-failure tracker, and aggregated views over historical data.

## Purpose

Aggregates metrics, request history, and decision history into time-windowed views for the dashboard and the analytics controller.

Files of record:

- [analytics-engine.ts](analytics-engine.ts) — `AnalyticsEngine` and `getAnalyticsEngine` singleton. Provides top models, server performance, error analysis, capacity, trends, and the analytics summary. Reads from [src/metrics/](../metrics/), [src/storage/metrics-store.ts](../storage/metrics-store.ts), [src/storage/operational-store.ts](../storage/operational-store.ts), and the request/decision history modules.
- [recovery-failure-tracker.ts](recovery-failure-tracker.ts) — `RecoveryFailureTracker` and `getRecoveryFailureTracker` singleton. Records and analyses recovery failures, with `RecoveryFailureRecord` and per-server stats/analysis exports.
- [index.ts](index.ts) — Barrel re-export.

## Ownership

- Owns the read paths for analytics. The orchestrator and controllers do not compute trends or top-model aggregations themselves.
- Recovery-failure analysis lives here, not in [src/circuit-breaker/](../circuit-breaker/). The breaker owns state; analytics owns the interpretation.

## Local Contracts

- Time windows: `'1m' | '5m' | '15m' | '1h' | '6h' | '24h' | '7d'`. `'7d'` (and longer) reads are served from SQLite rollup tables; see [src/storage/AGENTS.md](../storage/AGENTS.md).
- `getAnalyticsEngine()` and `getRecoveryFailureTracker()` are process-wide singletons. Tests must reset them in `beforeEach`.
- The recovery-failure tracker reads the circuit-breaker registry via the orchestrator — it does not import from [src/circuit-breaker/](../circuit-breaker/) directly to avoid coupling.

## Work Guidance

- New analytics endpoints belong in the engine (for aggregations) or the recovery-failure tracker (for per-server failure views), then exposed through [src/controllers/analytics-controller.ts](../controllers/analytics-controller.ts).
- New aggregations must declare their time window(s) up front. The frontend analytics page consumes these windows as-is.
- Avoid reading from in-process metrics in tests that need deterministic outputs; use the storage fixtures in [tests/fixtures/](../../tests/fixtures/).

## Verification

- `npm test` — covers `analytics-engine.test.ts`, `recovery-failure-tracker.test.ts`, `analytics-instance.test.ts`, `recovery-failure-controller.test.ts` in [tests/unit/](../../tests/unit/).
- `npm run test:integration` — covers the analytics endpoints and the recovery-failure integration paths.
