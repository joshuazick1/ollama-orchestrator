# src/orchestrator/

Core routing engine for the Ollama Orchestrator. Owns the server fleet, request routing decisions, persistence of fleet state, and the canonical domain types.

## Purpose

Implements the main `Orchestrator` class — the central coordinator that:

- Tracks registered `AIServer` instances and their health.
- Routes inference requests through the load balancer with retries and failover.
- Coordinates circuit breakers, ban manager, retry budget, and in-flight tracking.
- Exposes the public model registry, model warmup, and per-server model control.
- Persists fleet state and serves analytics views.

Files of record:

- [orchestrator.ts](orchestrator.ts) — Main `Orchestrator` class (`getOrchestratorInstance` is a singleton accessor in [orchestrator-instance.ts](orchestrator-instance.ts)).
- [routing.ts](routing.ts) — Request routing pipeline (server selection, retries, failover).
- [models.ts](models.ts) — Model registry, fleet model stats, server model control.
- [orchestrator.types.ts](orchestrator.types.ts) — Domain types: `AIServer`, `ServerModelMetrics`, `GlobalMetrics`, `RequestContext`, `StreamingMetrics`, `LatencyPercentiles`, `TimeWindow`, `MetricsWindow`, `MetricsExport`.
- [orchestrator-persistence.ts](orchestrator-persistence.ts) and [persistence.ts](persistence.ts) — Fleet state persistence (server list, model map).

## Ownership

- Owns the public domain types re-exported by [src/shared-types.ts](../shared-types.ts) for the frontend type mirror.
- Coordinates every other backend subsystem; new subsystem integration points must land here.
- Persistence of the server fleet belongs here, not in [src/storage/](../storage/).

## Local Contracts

- Singleton access: `getOrchestratorInstance()` from [orchestrator-instance.ts](orchestrator-instance.ts) returns the process-wide instance.
- Server registration is async and must be awaited before routing decisions are made for that server.
- Public type re-exports go through `src/shared-types.ts` — never import `orchestrator.types` directly from the frontend.

## Work Guidance

- This file is large (4k+ lines) and intentionally the integration point. Prefer adding routing rules to [routing.ts](routing.ts) when the change is request-scoped; reserve edits to [orchestrator.ts](orchestrator.ts) for fleet lifecycle, persistence, and orchestration policy.
- New request-flow stages (e.g. telemetry, handoff) belong in [routing.ts](routing.ts).
- Algorithm changes (scoring weights, circuit state) must not be made in this folder — they live in [src/load-balancer/](../load-balancer/) and [src/circuit-breaker/](../circuit-breaker/).
- Persistence must round-trip through the JSON file stores in [orchestrator-persistence.ts](orchestrator-persistence.ts); do not write to `data/servers.json` directly from controllers.
- When adding a new public type, add it to [orchestrator.types.ts](orchestrator.types.ts) and re-export from [src/shared-types.ts](../shared-types.ts).

## Verification

- `npm run typecheck` — must pass.
- `npm test` — covers `orchestrator.test.ts`, `orchestrator-instance.test.ts`, `orchestrator-failover-concurrency.test.ts`, and several integration tests under [tests/integration/](../../tests/integration/).
- `npm run test:chaos` — covers failover, partition, and server-failure scenarios.
- Run the load test (`npm run test:load:quick`) after any non-trivial routing change to confirm no regression in failover behaviour.

## Child DOX Index

This folder has no further child docs. Nested files ([routing.ts](routing.ts), [models.ts](models.ts), [persistence.ts](persistence.ts), [orchestrator-persistence.ts](orchestrator-persistence.ts), [orchestrator-instance.ts](orchestrator-instance.ts), [orchestrator.types.ts](orchestrator.types.ts)) are siblings under this doc.
