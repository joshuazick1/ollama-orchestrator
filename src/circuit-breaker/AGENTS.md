# src/circuit-breaker/

Per-server and per-server:model circuit breaker state machine with persistence.

## Purpose

Implements the adaptive circuit breaker that protects each server and each `server:model` pair from cascading failures. Coordinates with the orchestrator, recovery test coordinator, and active test scheduler.

Files of record:

- [circuit-breaker.ts](circuit-breaker.ts) — `CircuitBreaker` and `CircuitBreakerRegistry` classes, the `CircuitState` (`closed` | `open` | `half-open`) enum, `CircuitBreakerConfig`, `CircuitBreakerStats`, and `CircuitBreakerError` exports.
- [circuit-breaker-persistence.ts](circuit-breaker-persistence.ts) — `CircuitBreakerPersistence` (SQLite-backed via [src/storage/operational-store.ts](../storage/operational-store.ts)) and `CircuitBreakerData` types.

## Ownership

- Owns breaker state semantics: thresholds, error rate, half-open recovery, adaptive backoff, and starvation guards.
- Co-owns recovery-test orchestration with [src/orchestrator/](../orchestrator/) (the recovery-test-coordinator lives at [src/recovery-test-coordinator.ts](../recovery-test-coordinator.ts) and is not a child of this folder).
- Public re-exports (`CircuitState`, `ErrorType`, `CircuitBreakerConfig`) are imported by the orchestrator, load balancer, controllers, and tests.

## Local Contracts

- Adaptive threshold range: `minFailureThreshold` ↔ `maxFailureThreshold`, anchored by `baseFailureThreshold`. Configured via [src/config/schema.ts](../config/schema.ts).
- `halfOpenMaxRequests` and `recoverySuccessThreshold` together govern the half-open → closed transition; changing them affects both behavior and the recovery-test coordinator's expectations.
- The `ErrorType` enum is re-exported here for backwards compatibility but defined in [src/utils/error-classifier.ts](../utils/error-classifier.ts). Classify every error before recording it on a breaker.
- Persisted state is keyed by `serverId` and `serverId:model`; `CircuitBreakerRegistry` exposes both views. The persistence layer is opaque — never read the SQLite row format directly from controllers or tests.

## Work Guidance

- Adaptive thresholds and adaptive backoff are first-class. Hard-coded failure counts are not allowed; the breaker must use the configured `baseFailureThreshold` and adapt via `consecutiveFailedRecoveries` and the recovery-backoff module.
- New breaker events must be persisted via `CircuitBreakerPersistence.save*` so the state survives restarts.
- The `consecutiveFailedRecoveries` starvation guard (GAP-CB-5) is required. Do not remove it.
- Recovery-test scheduling is owned by [src/recovery-test-coordinator.ts](../recovery-test-coordinator.ts) and [src/active-test-scheduler.ts](../active-test-scheduler.ts). Breaker code calls into them, not the other way around.
- Tests must exercise the `closed → open → half-open → closed/open` cycle end-to-end. Use the unit suite under [tests/unit/](../../tests/unit/) (`circuit-breaker.test.ts`, `circuit-breaker-enhanced.test.ts`, `circuit-breaker-persistence.test.ts`, `circuit-breaker-state-machine.test.ts`, `circuit-breaker-restore-validation.test.ts`, `wave1-cb-double-counting.test.ts`).

## Verification

- `npm test` — covers breaker unit tests, persistence round-trips, restore validation, double-counting regressions, and forced state transitions.
- `npm run test:integration` — covers `circuit-breakers.test.ts`, `circuit-breaker-state-machine.test.ts`, `circuit-breaker-forceclose.test.ts`, `circuit-breaker-concurrent-canexecute.test.ts`.
- `npm run test:chaos` — covers `circuit-breaker-chaos.test.ts`.
- `npm run test:circuit-breaker` — runs the dedicated load test in [scripts/circuit-breaker-load-test.ts](../../scripts/circuit-breaker-load-test.ts).
