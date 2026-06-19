# src/utils/

Pure helpers and shared infrastructure: classification, timeouts, in-flight tracking, bans, JWT, fetch wrappers, logging, streaming helpers, formatters, and a number of small utilities.

## Purpose

Provide the building blocks that other modules compose. Most files here are dependency-light and side-effect-free; the side-effecting helpers (logger, in-flight manager) are process-wide singletons.

Files of record (grouped by concern):

**Classification & error**

- [error-classifier.ts](error-classifier.ts) — `ErrorClassifier`, `getErrorClassifier`, `classifyError`, `ErrorCategory`. Single source of truth for error type/category.
- [orchestrator-error-classifier.ts](orchestrator-error-classifier.ts) — Orchestrator-specific error classification.
- [domain-errors.ts](domain-errors.ts) — Domain error classes (`OrchestratorError` and friends) used by controllers/middleware.
- [error-aggregator.ts](error-aggregator.ts) — `ErrorAggregator` (singleton), `ClusterStatus`. Cluster-wide error picture.
- [error-helpers.ts](error-helpers.ts) — Small error helpers.
- [ollama-error.ts](ollama-error.ts) — Ollama-specific error helpers.

**Concurrency & lifecycle**

- [in-flight-manager.ts](in-flight-manager.ts) — `InFlightManager` (singleton via `getInFlightManager`). Per-server, per-server:model, and per-stream tracking. Also tracks streaming progress, handoff candidates, and stall detection.
- [ban-manager.ts](ban-manager.ts) — `BanManager`. Per-server:model permanent and cooldown bans.
- [timeout-manager.ts](timeout-manager.ts) — `TimeoutManager`, `TimeoutConfig`, `TimeoutState`. Adaptive timeouts.
- [timeout-telemetry.ts](timeout-telemetry.ts) — Telemetry counters for timeout events.
- [retry-budget.ts](retry-budget.ts) — `RetryBudget` for request-level retry budget enforcement.
- [rate-limit-backoff.ts](rate-limit-backoff.ts) — Backoff helpers for rate-limit responses.
- [retry-after.ts](retry-after.ts) — Parse and apply `Retry-After` headers.
- [recovery-backoff.ts](recovery-backoff.ts) — `calculateCircuitBreakerBackoff`, `calculateActiveTestTimeout`, `calculateRecoveryBackoff`. Adaptive recovery backoff.
- [backoff/](backoff/) — `calculator.ts`, `from-config.ts`, `types.ts`, and strategies (decorrelated, fixed, etc.). Re-exported via `index.ts`.
- [timer.ts](timer.ts) — `Timer` helper for scheduled jobs (avoids Node timer leaks).
- [probe-coordinator.ts](probe-coordinator.ts) — `probeCoordinator` singleton for inference/health probes.
- [lifecycle.ts](lifecycle.ts) — Lifecycle event emitter for orchestrator startup, shutdown, and health state transitions. Used for debug observability and structured logging of state changes.
- [streaming-cleanup.ts](streaming-cleanup.ts) — Streaming cleanup utilities: abort handler registration, stale stream detection, and resource teardown for mid-stream failures.

**Streaming**

- [streaming-response-handler.ts](streaming-response-handler.ts) — Per-provider response framing for streaming.
- [stream-handoff.ts](stream-handoff.ts) — Mid-stream server handoff for stalled streams.
- [sse-stream-base.ts](sse-stream-base.ts) — SSE parsing/formatting base.
- [formatters/](formatters/) — Per-provider SSE formatters: `anthropic-sse.ts`, `ollama-sse.ts`, `openai-sse.ts`.

**Network**

- [fetch-with-timeout.ts](fetch-with-timeout.ts) — `fetchWithTimeout` with abort + per-request timeout.
- [api-keys.ts](api-keys.ts) — `resolveApiKey` for per-server API key resolution.
- [url-utils.ts](url-utils.ts) — `normalizeServerUrl`, `areUrlsEquivalent`.

**Auth & security**

- [jwt.ts](jwt.ts) — JWT sign/verify, session token helpers.
- [debug-headers.ts](debug-headers.ts) — Debug header injection.

**Logging & serialization**

- [logger.ts](logger.ts) — `logger` singleton (writes JSON lines and an in-memory ring buffer).
- [json-utils.ts](json-utils.ts) — `safeJsonParse`, `safeJsonStringify`.
- [atomic-write.ts](atomic-write.ts) — Atomic file write.

**Statistics & modeling**

- [statistics.ts](statistics.ts) — `Statistics` (mean, p50, p95, p99, stddev).
- [tdigest.ts](tdigest.ts) — T-digest data structure for accurate percentile estimation at extreme quantiles (e.g., p99.9). Used by the metrics aggregator for ITL and latency percentile approximations.
- [prompt-estimator.ts](prompt-estimator.ts) — `canHandleContext`, `getDefaultContextSize`. Token/context estimation.
- [model-aggregator.ts](model-aggregator.ts) — Tag aggregation across servers.
- [token-metrics-extractor.ts](token-metrics-extractor.ts) — Token count extraction from upstream responses.
- [deep-merge.ts](deep-merge.ts) — Deep merge for config.
- [math-helpers.ts](math-helpers.ts) — Small math helpers.
- [collection-helpers.ts](collection-helpers.ts) — Collection helpers.
- [circuit-breaker-helpers.ts](circuit-breaker-helpers.ts) — Circuit-breaker helpers.
- [request-context-builder.ts](request-context-builder.ts) — Build `RequestContext` for a request.
- [async-helpers.ts](async-helpers.ts) — `sleep`, async utilities.
- [hash.ts](hash.ts) — Hashing utilities: consistent hash ring construction for prefix-cache-aware routing.

**Metadata**

- [version.ts](version.ts) — Version metadata.

## Ownership

- Most files here are pure or near-pure; they are the leaf layer of the dependency graph and are imported by every other backend folder.
- The few singletons (`InFlightManager`, `BanManager`, `ErrorAggregator`, `TimeoutManager`, `probeCoordinator`, `logger`) are accessed through their getters. Tests must reset them per test.
- Helpers in this folder must not import from [src/orchestrator/](../orchestrator/), [src/controllers/](../controllers/), [src/routes/](../routes/), [src/middleware/](../middleware/), or [src/storage/](../storage/). Acyclic dependency at the leaf layer.

## Local Contracts

- Singletons: `getInFlightManager`, `getErrorClassifier`, `probeCoordinator`. Other classes are typically instantiated by the owning module rather than being global singletons.
- The `ErrorCategory` enum from [error-classifier.ts](error-classifier.ts) is the canonical taxonomy. Ad-hoc string error categories are not allowed.
- `timeoutManager` reads its config from the config manager; do not pass timeout config by import.
- The streaming formatters in [formatters/](formatters/) are the only place that hand-rolls SSE per provider.

## Work Guidance

- New helpers go in the smallest matching subfolder. If the helper is a pure function, place it at the top of [src/utils/](.) before considering a subfolder.
- New SSE providers (e.g. Google Gemini) get a new file in [formatters/](formatters/) and a route in [src/routes/](../routes/) that uses the streaming module's handler.
- Statistics and modeling helpers must produce deterministic outputs given the same input; the percentile helpers in [statistics.ts](statistics.ts) are unit tested and used in many tests — keep them stable.
- Helpers in this folder must be side-effect-free at import time (no `console.log`, no `setInterval`, no I/O). The logger is the only allowed side effect, and only when called, not at import.

## Verification

- `npm test` — every file in this folder has a corresponding unit test in [tests/unit/](../../tests/unit/) (see e.g. `errorClassifier.test.ts`, `error-classification.test.ts`, `error-aggregator.test.ts`, `error-helpers.test.ts`, `domain-errors.test.ts`, `ollamaError.test.ts`, `orchestrator-error-classifier.test.ts`, `in-flight-manager.test.ts`, `in-flight-manager-negative.test.ts`, `ban-manager.test.ts`, `ban-manager-cap.test.ts`, `ban-manager-colon-models.test.ts`, `timeout-manager.test.ts`, `recovery-backoff.test.ts`, `recovery-backoff-config.test.ts`, `retry-after.test.ts`, `retry-budget.test.ts`, `rate-limit-backoff.test.ts`, `timer.test.ts`, `backoff-decorrelated.test.ts`, `backoff-fixed.test.ts`, `fetchWithTimeout.test.ts`, `jwt.test.ts`, `api-keys.test.ts`, `urlUtils.test.ts`, `math-helpers.test.ts`, `collection-helpers.test.ts`, `circuit-breaker-helpers.test.ts`, `request-context-builder.test.ts`, `atomic-write.test.ts`, `jsonFileHandler.test.ts`, `statistics.test.ts`, `prompt-estimator.test.ts`, `model-aggregator.test.ts`, `token-metrics-extractor.test.ts`, `deepMerge.test.ts`, `async-helpers.test.ts`, `stream-handoff.test.ts`, `sse-passthrough.test.ts`, `logger.test.ts`).
- Streaming formatters: integration tests in [tests/integration/](../../tests/integration/) (e.g. `api-ollama.test.ts`, `api-openai.test.ts`, `anthropic.test.ts`).
