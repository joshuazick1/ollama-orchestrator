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
- [orchestrator.types.ts](orchestrator.types.ts) — Domain types: `AIServer`, `ServerModelMetrics`, `GlobalMetrics`, `RequestContext`, `StreamingMetrics`, `LatencyPercentiles`, `TimeWindow`, `MetricsWindow`, `MetricsExport`, plus orchestrator-stability-release types: `PrefixHashResult`, `ServerScoreBreakdown`, `SLOMode`, `TokenWeightedLoad`, `ColdStartEvent`, `ErrorTypeMetric`, `PerSizeLatencyBucket`. iter63 Wave 1 deleted the duplicate `VLLMModelMeta` interface that previously lived here; the canonical definition is now in [vllm-models.ts](vllm-models.ts) (a single source of truth shared with the Zod schema that drives vLLM metadata validation), and `orchestrator.types.ts` re-imports it via `import type { VLLMModelMeta } from './vllm-models.js'`.
- [orchestrator-persistence.ts](orchestrator-persistence.ts) and [persistence.ts](persistence.ts) — Fleet state persistence (server list, model map).
- [probe-executor-negative.ts](probe-executor-negative.ts) — `probeExecutorNegative`. Negative probe executor for capability detection: sends intentionally invalid model names and inspects response bodies to detect capability gaps.

## Ownership

- Owns the public domain types re-exported by [src/shared-types.ts](../shared-types.ts) for the frontend type mirror.
- Coordinates every other backend subsystem; new subsystem integration points must land here.
- Persistence of the server fleet belongs here, not in [src/storage/](../storage/).

## Local Contracts

- Singleton access: `getOrchestratorInstance()` from [orchestrator-instance.ts](orchestrator-instance.ts) returns the process-wide instance.
- Server registration is async and must be awaited before routing decisions are made for that server.
- Public type re-exports go through `src/shared-types.ts` — never import `orchestrator.types` directly from the frontend.
- The `CapabilityProbeScheduler` singleton (`getCapabilityProbeScheduler()` from `src/probe/probe-scheduler-instance.ts`) is started during orchestrator initialization and uses `orchestrator.getServer(id)` to resolve server descriptors for negative probing.
- Manual capability probe is available via `POST /api/orchestrator/servers/:id/capability-probe` (admin routes, requires admin auth). The controller handler `capabilityProbe` in [servers-controller.ts](../controllers/servers-controller.ts) delegates to `capabilityProbeScheduler.runOnce(id)`.
- The `ps-poll-coordinator` polling subsystem (in `src/probe/`) coordinates model availability polling across the server fleet.

### Fleet hygiene

- **`removeServer(serverId)`** evicts every probe tuple for the server via `probeOrchestrator.evictAllForServer()` (bulk), drops bans/cooldowns, clears the negative-model-cache entries, and persists the smaller server list. The previous per-model `evictTuple` loop leaked breakers for SUSPECT entries that aged out, which is what produced the 8263-vs-236 imbalance before this fix.
- **`cleanupOrphanedBreakers()`** runs every 30 minutes (orchestrator init) and removes probe tuples for `serverId`s no longer in the fleet, plus tuples for `(serverId, model)` pairs the server no longer advertises via `/api/tags` or `/v1/models`. Also clears matching negative-cache entries so a returning server with a fresh model isn't blocked. Use `POST /api/orchestrator/servers/reap-orphan-breakers` to invoke manually.
- **Ghost cleanup** (`cleanupGhostServers()`, every 30 minutes) flags servers that have been unhealthy for ≥ `loadBalancer.ghostServers.staleThresholdMs` (default 7 days) OR are healthy but report zero models for ≥ `staleThresholdMs` via PS poll. The default `removeOnCleanup` is `false` to avoid fleet erosion on transient outages; set `ORCHESTRATOR_GHOST_REMOVE_ON_CLEANUP=true` for fully-managed fleets where aggressive cleanup is desired. Override `staleThresholdMs` with `ORCHESTRATOR_GHOST_STALE_THRESHOLD_MS` (in ms).

## Work Guidance

- This file is large (4k+ lines) and intentionally the integration point. Prefer adding routing rules to [routing.ts](routing.ts) when the change is request-scoped; reserve edits to [orchestrator.ts](orchestrator.ts) for fleet lifecycle, persistence, and orchestration policy.
- New request-flow stages (e.g. telemetry, handoff) belong in [routing.ts](routing.ts).
- Algorithm changes (scoring weights, probe state) must not be made in this folder — they live in [src/load-balancer/](../load-balancer/) and [src/probe/](../probe/).
- Persistence must round-trip through the JSON file stores in [orchestrator-persistence.ts](orchestrator-persistence.ts); do not write to `data/servers.json` directly from controllers.
- When adding a new public type, add it to [orchestrator.types.ts](orchestrator.types.ts) and re-export from [src/shared-types.ts](../shared-types.ts).

## Verification

- `npm run typecheck` — must pass.
- `npm test` — covers `orchestrator.test.ts`, `orchestrator-instance.test.ts`, `orchestrator-failover-concurrency.test.ts`, and several integration tests under [tests/integration/](../../tests/integration/).
- `npm run test:chaos` — covers failover, partition, and server-failure scenarios.
- Run the load test (`npm run test:load:quick`) after any non-trivial routing change to confirm no regression in failover behaviour.

## Child DOX Index

This folder has no further child docs. Nested files ([routing.ts](routing.ts), [models.ts](models.ts), [persistence.ts](persistence.ts), [orchestrator-persistence.ts](orchestrator-persistence.ts), [orchestrator-instance.ts](orchestrator-instance.ts), [orchestrator.types.ts](orchestrator.types.ts)) are siblings under this doc.
