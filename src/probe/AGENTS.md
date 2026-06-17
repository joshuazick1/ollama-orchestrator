# src/probe/

Health checking, circuit breaker state machine, and recovery orchestration.

## Purpose

Per-server and per-server:model probe subsystem that drives health state transitions, coordinates recovery testing, and persists state via a WAL (write-ahead log). Replaces the prior `src/circuit-breaker/` implementation.

Files of record:

- [probe-orchestrator.ts](probe-orchestrator.ts) — `ProbeOrchestrator`. Owns the state machine for all probe keys, coordinates health checks, and surfaces `canServe` to the load balancer.
- [failure-classifier.ts](failure-classifier.ts) — `FailureClassifier`. Classifies errors as `permanent | transient | retryable`; drives state transition thresholds.
- [failure-classifier-negative.ts](failure-classifier-negative.ts) — `classifyNegativeResult`. Classifies negative HTTP responses (model-not-found, endpoint-absent, mid-stream errors, rate limits) for capability gap detection.
- [recovery-driver.ts](recovery-driver.ts) — `RecoveryDriver`. Manages half-open recovery testing, success counting, and automatic state transitions.
- [endpoint-registry.ts](endpoint-registry.ts) — `EndpointRegistry`. Tracks which endpoints belong to which server:model tuples; supports soft-revoke for capability detection.
- [wal-store.ts](wal-store.ts) — `WalStore` (singleton via `getWalStore`). Append-only WAL for probe state transitions; provides persistence and event replay.
- [types.ts](types.ts) — Shared probe types: `ProbeState`, `ProbeKey`, `WalEvent`, `UiState`, `RecoveryConfig`.

## Negative Probing

The probe subsystem includes a capability detection system that periodically sends intentionally invalid requests (with impossible model names) to detect what endpoints a server truly supports. This is called negative probing because it probes for the absence of capability rather than presence.

### How It Works

Negative probing sends requests with the model name `__neg_probe_definitely_not_a_model_xyz_12345__` to each endpoint and inspects the response body to classify the result:

- **HTTP 404 + JSON error** (`{"error":"model 'X' not found..."}`) — Endpoint is present and correctly rejecting invalid models. Capability is confirmed.
- **HTTP 404 + HTML body** (`"404 page not found"`) — Endpoint is absent entirely (e.g., `/v1/messages` on a standard Ollama server). `softRevoke` is called immediately.
- **HTTP 200 + NDJSON error in body** — Endpoint accepted the request but the model is not loaded. `recordFailure` is called; after N consecutive failures, `softRevoke` is triggered.
- **HTTP 200 + valid response body** — Suspicious. Server may not validate model names properly.
- **HTTP 429** — Rate limited. Scheduler defers this server and respects `Retry-After`.

### Soft-Revoke State

`EndpointRegistry.softRevoke(serverId, endpoint)` marks an endpoint as unconfirmed without deleting the entry. It sets `confirmed: false` and `lastSeen: 0`, preserving the entry for inspection. A subsequent positive probe (using a known-valid model) can call `confirm()` to re-establish the endpoint as active.

Lifecycle: `declare → confirm → (softRevoke | evictCold)`

The `softRevoke` method does not permanently delete the capability; the endpoint remains discoverable if a future positive probe succeeds.

### CapabilityProbeScheduler

[probe-scheduler.ts](probe-scheduler.ts) — `CapabilityProbeScheduler`. Runs negative probes on a configurable interval (default 5 minutes) across all servers and all 11 endpoints (7 inference + 4 admin/listing). Supports rate-limit deferral and per-server stagger offsets to avoid probe storms.

### Configuration Fields

Negative probing is controlled by these `capabilityProbe` config fields in `src/config/schema.ts`:

- `enabled` — Whether the scheduler runs. Default `true`.
- `intervalMs` — Cycle interval in milliseconds. Default `300000` (5 minutes).
- `consecutiveFailureThreshold` — Number of consecutive negative-probe failures before soft-revoke. Default `3`.
- `requestTimeoutMs` — Per-probe timeout in milliseconds. Default `5000`.
- `staggerOffsetMs` — Delay offset between servers to avoid simultaneous probing. Default `30000`.

### Files

- [probe-scheduler.ts](probe-scheduler.ts) — `CapabilityProbeScheduler`. Periodic negative-probe scheduler.
- [failure-classifier-negative.ts](failure-classifier-negative.ts) — `classifyNegativeResult`. Pure function classifier for negative probe responses.

The positive probe executor lives in `src/orchestrator/probe-executor-negative.ts` (probes inference endpoints) alongside the negative classifier integration.

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
- `npx vitest run tests/unit/probe/probe-executor-negative.test.ts` — covers negative probe executor and response classification.
- `npx vitest run tests/unit/probe/failure-classifier-negative.test.ts` — covers negative result classification rules.
- `npx vitest run tests/unit/probe/endpoint-registry-soft-revoke.test.ts` — covers soft-revoke and re-confirm lifecycle.
- `npm run test:integration` — covers probe recovery cycles and WAL replay.
- `npm run test:integration -- --test-name-pattern="capability-detection"` — covers end-to-end negative-probe to soft-revoke to re-confirm lifecycle.
