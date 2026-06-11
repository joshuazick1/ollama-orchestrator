# src/load-balancer/

Server selection algorithms, weighted scoring, and adaptive tuning.

## Purpose

Implements all routing decisions for inference traffic. Owns the algorithms and weights that determine which server handles a given request, given historical metrics, current in-flight load, circuit breaker state, model availability, and context fit.

Files of record:

- [load-balancer.ts](load-balancer.ts) — `LoadBalancer` class plus the canonical `calculateServerScore`, `ServerScore`, `LoadBalancerConfig`, and `CircuitBreakerHealth` exports consumed by the orchestrator and tests.
- [temporal-scorer.ts](temporal-scorer.ts) — Time-of-day pattern scoring (singleton via `getTemporalScorer`).
- [adaptive-weight-tuner.ts](adaptive-weight-tuner.ts) — Adjusts weights at runtime based on observed error rates and load patterns.

## Ownership

- Owns the algorithm and weight semantics. Configuration lives in [src/config/](../config/), but the math is here.
- Public re-exports: `LoadBalancer`, `calculateServerScore`, `ServerScore`, `LoadBalancerConfig`, `CircuitBreakerHealth` are imported by [src/orchestrator/](../orchestrator/), [src/controllers/](../controllers/), and tests.
- Scoring and weight tuning must not be reimplemented in the orchestrator or controllers.

## Local Contracts

- Default algorithm: `fastest-response` (lowest predicted response time from recent measurements). Other supported: `weighted`, `round-robin`, `least-connections`.
- `calculateServerScore(server, metrics, config, ...)` is the single source of truth for the weighted score; tests assert on its breakdown.
- Weight defaults are documented in the load-balancer test suite and the config schema. Changing them is a config- and behavior-level change and must be reflected in [src/config/schema.ts](../config/schema.ts).
- The temporal scorer is a process-wide singleton; do not instantiate it directly in tests unless the test exercises temporal pattern behavior.

## Work Guidance

- Score-breakdown changes are visible to the frontend analytics page. Update the `ServerScore` shape in [src/orchestrator/orchestrator.types.ts](../orchestrator/orchestrator.types.ts) and the frontend type mirror in lock-step.
- New scoring factors must be added to the `LoadBalancerConfig.weights` and validated by the Zod schema in [src/config/](../config/).
- Adaptive weight tuning reads from the same metrics aggregator the load balancer does; do not introduce a parallel data path.
- Never mutate `LoadBalancerConfig` after the load balancer has read it. Pass updated configs through the config manager and let the load balancer pick them up on the next decision.

## Verification

- `npm test` — covers `load-balancer.test.ts`, `load-balancer-weights.test.ts`, `load-balancer-roundrobin-bounds.test.ts`, `load-balancer-extra.test.ts`, `temporal-scorer.test.ts`, `adaptive-weight-tuner.test.ts`, `weighted-selection.test.ts`.
- `npm run test:integration` — covers the cross-model fallback and adaptive-weight-tuner integration tests.
- For any new scoring factor, add a `load-balancer-weights.test.ts` case that asserts the breakdown and total.
