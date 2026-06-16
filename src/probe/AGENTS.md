# src/probe/

Health checking, circuit breaker state machine, and recovery orchestration.

## Purpose

Per-server and per-server:model probe subsystem that drives health state transitions, coordinates recovery testing, and persists state via a WAL (write-ahead log). Replaces the prior `src/circuit-breaker/` implementation.

Files of record:

- [probe-orchestrator.ts](probe-orchestrator.ts) — `ProbeOrchestrator`. Owns the state machine for all probe keys, coordinates health checks, and surfaces `canServe` to the load balancer.
- [failure-classifier.ts](failure-classifier.ts) — `FailureClassifier`. Classifies errors as `permanent | transient | retryable`; drives state transition thresholds.
- [recovery-driver.ts](recovery-driver.ts) — `RecoveryDriver`. Manages half-open recovery testing, success counting, and automatic state transitions.
- [endpoint-registry.ts](endpoint-registry.ts) — `EndpointRegistry`. Tracks which endpoints belong to which server:model tuples.
- [wal-store.ts](wal-store.ts) — `WalStore` (singleton via `getWalStore`). Append-only WAL for probe state transitions; provides persistence and event replay.
- [types.ts](types.ts) — Shared probe types: `ProbeState`, `ProbeKey`, `WalEvent`, `UiState`, `RecoveryConfig`.

## Ownership

- Owns all health state and recovery semantics. The load balancer reads `canServe` but never mutates probe state.
- WAL persistence lives here; long-term rollup to SQLite is owned by [src/storage/](../storage/).
- The probe subsystem is the only place that writes to the `probe_state_wal` table.

## Local Contracts

- Probe key format: `"serverId:model:endpoint"` (tuple key).
- Internal states: `HEALTHY | SUSPECT | UNHEALTHY | RECOVERING`.
- UI states: `closed | open | half-open` (mapped from internal states for API responses).
- WAL event types: `STATE_TRANSITION | RECOVERY_TEST_STARTED | RECOVERY_TEST_COMPLETED | PROBE_CREATED | PROBE_DELETED`.
- State transitions are atomic; `canServe` is read-only.

## Work Guidance

- Never mutate probe state inside `canServe` — it is read-only. All mutations go through the state machine.
- All state transitions must append a WAL event before applying the new state.
- New scoring factors that affect `canServe` must not bypass the probe orchestrator.
- Recovery config (`openTimeout`, `halfOpenTimeout`, `recoverySuccessThreshold`) is read from the config manager; do not hardcode thresholds.

## Verification

- `npx vitest run tests/unit/probe/` — covers probe-orchestrator, failure-classifier, recovery-driver, endpoint-registry, wal-store.
- `npm run test:integration` — covers probe recovery cycles and WAL replay.
