# src/metrics/

In-memory metrics aggregator with sliding windows, Prometheus exporter, and TTFT tracking.

## Purpose

Captures per-server and per-server:model metrics (latency, success/error counts, in-flight, TTFT, streaming duration) over multiple time windows and exposes them to the load balancer, analytics engine, and Prometheus exporter.

Files of record:

- [metrics-aggregator.ts](metrics-aggregator.ts) — `MetricsAggregator` class. Owns the sliding-window data (`'1m' | '5m' | '15m' | '1h' | '24h'`), the cross-model inference index, exponential decay, and the JSON persistence path.
- [metrics-persistence.ts](metrics-persistence.ts) — `MetricsPersistence` for the JSON file fallback. SQLite is the long-term store (see [src/storage/metrics-store.ts](../storage/metrics-store.ts)).
- [prometheus-exporter.ts](prometheus-exporter.ts) — `getPrometheusMetrics` and the Prometheus exposition formatter used by [src/controllers/metrics-controller.ts](../controllers/metrics-controller.ts). Emits `probe_state` metrics from the probe subsystem alongside standard request metrics.
- [ttft-tracker.ts](ttft-tracker.ts) — `TTFTTracker` and `TTFTOptions` — time-to-first-token tracking for streaming requests.
- [index.ts](index.ts) — Barrel re-export.

## Ownership

- Owns the in-process metrics state. Long-term persistence is owned by [src/storage/](../storage/); the JSON file fallback here is in-process only.
- The Prometheus exporter is the only place that knows the Prometheus exposition format. Controllers do not format Prometheus output themselves.

## Local Contracts

- Sliding-window sizes are hard-coded: 1m, 5m, 15m, 1h, 24h. Adding a new window changes the public `ServerModelMetrics` shape and the analytics API surface.
- Decay config is read from the config manager (`MetricsDecayConfig`); default half-life is 5 minutes, minimum factor 0.1, stale threshold 2 minutes.
- The metrics aggregator is not a singleton. The orchestrator instantiates it. Tests must construct a fresh instance per test.
- TTFT tracker options (`TTFTOptions`) and the streaming telemetry meta from [src/streaming.ts](../streaming.ts) must agree on the streaming metric shape.

## Work Guidance

- New metrics must be added to the `ServerModelMetrics` type in [src/orchestrator/orchestrator.types.ts](../orchestrator/orchestrator.types.ts) and the Prometheus exporter must emit them.
- Decay semantics (exponential half-life) are part of the contract — do not change them silently.
- Percentile calculations are kept bounded (`maxRecentLatencies = 1000`, `maxRecentTTFTs = 500`, `maxRecentStreamingDurations = 500`); do not raise these limits without reviewing memory.
- Cold-start classification uses a 100ms threshold (`COLD_START_THRESHOLD_NS`); changing it is a behavior-level change that must be reflected in the metrics tests.

## Verification

- `npm test` — covers `metrics-aggregator.test.ts`, `metrics-persistence.test.ts`, `prometheus-exporter.test.ts`, `ttft-tracker.test.ts`, `client-metrics.test.ts` in [tests/unit/](../../tests/unit/).
- `npm run test:integration` — covers `metrics-endpoints.test.ts`.
- Manual: hit `/metrics` and `/api/orchestrator/metrics/prometheus` after a run of `npm run test:load:quick` and confirm counters move.
