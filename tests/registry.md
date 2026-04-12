# Test Registry

## Summary
- **Unit tests**: 110 files
- **Integration tests**: 10 files
- **E2E tests**: 3 files
- **Chaos tests**: 5 files
- **Performance tests**: 3 files (k6)

**Total**: 131 test files

---

## Unit Tests (110 files)

| File | Category | What It Tests | CI Tier |
|------|----------|---------------|---------|
| `tests/unit/active-test-scheduler.test.ts` | Orchestrator | Active test scheduling for recovery | Tier 1 |
| `tests/unit/adaptive-weight-tuner.test.ts` | Load Balancer | Adaptive weight tuning algorithm | Tier 1 |
| `tests/unit/analytics-controller.test.ts` | Controller | Analytics controller logic | Tier 1 |
| `tests/unit/analytics-engine.test.ts` | Analytics | Analytics computation engine | Tier 1 |
| `tests/unit/analytics-instance.test.ts` | Analytics | Analytics instance tracking | Tier 1 |
| `tests/unit/api-keys.test.ts` | Auth | API key validation and management | Tier 1 |
| `tests/unit/async-helpers.test.ts` | Utils | Async utility helpers | Tier 1 |
| `tests/unit/auth-tests.test.ts` | Auth | Authentication test utilities | Tier 1 |
| `tests/unit/auth.test.ts` | Auth | Authentication logic | Tier 1 |
| `tests/unit/b1-streaming-drain-deadlock.test.ts` | Streaming | Streaming drain deadlock bug | Tier 1 |
| `tests/unit/b3-handoff-stall-threshold.test.ts` | Orchestrator | Handoff stall threshold bug | Tier 1 |
| `tests/unit/b4-b5-original-data-passing.test.ts` | Orchestrator | Data passing bug verification | Tier 1 |
| `tests/unit/b6-inflight-counter-leak.test.ts` | Orchestrator | In-flight counter leak bug | Tier 1 |
| `tests/unit/ban-manager.test.ts` | Orchestrator | Ban manager for server:model | Tier 1 |
| `tests/unit/cache-warming.test.ts` | Model Manager | Cache warming for models | Tier 1 |
| `tests/unit/circuit-breaker-controller.test.ts` | Controller | Circuit breaker controller | Tier 1 |
| `tests/unit/circuit-breaker-enhanced.test.ts` | Circuit Breaker | Enhanced circuit breaker logic | Tier 1 |
| `tests/unit/circuit-breaker-helpers.test.ts` | Circuit Breaker | Circuit breaker helper functions | Tier 1 |
| `tests/unit/circuit-breaker-persistence.test.ts` | Circuit Breaker | Circuit breaker state persistence | Tier 1 |
| `tests/unit/circuit-breaker.test.ts` | Circuit Breaker | Core circuit breaker implementation | Tier 1 |
| `tests/unit/collection-helpers.test.ts` | Utils | Collection utility helpers | Tier 1 |
| `tests/unit/complex-model-operations.test.ts` | Model Manager | Complex model operations | Tier 1 |
| `tests/unit/concurrency-atomicity.test.ts` | Concurrency | Concurrency atomicity guarantees | Tier 1 |
| `tests/unit/concurrent-requests.test.ts` | Orchestrator | Concurrent request handling | Tier 1 |
| `tests/unit/config-controller.test.ts` | Controller | Config controller endpoints | Tier 1 |
| `tests/unit/config.test.ts` | Config | Configuration loading/validation | Tier 1 |
| `tests/unit/configManager.test.ts` | Config | Config manager service | Tier 1 |
| `tests/unit/cross-model-fallback.test.ts` | Load Balancer | Cross-model fallback logic | Tier 1 |
| `tests/unit/debug-info.test.ts` | Debug | Debug info generation | Tier 1 |
| `tests/unit/debug-output.test.ts` | Debug | Debug output formatting | Tier 1 |
| `tests/unit/decision-history-dedupe.test.ts` | Analytics | Decision history deduplication | Tier 1 |
| `tests/unit/decision-history.test.ts` | Analytics | Decision history tracking | Tier 1 |
| `tests/unit/deepMerge.test.ts` | Utils | Deep merge utility | Tier 1 |
| `tests/unit/dual-capability-server.test.ts` | Orchestrator | Dual capability server handling | Tier 1 |
| `tests/unit/envMapper.test.ts` | Config | Environment variable mapping | Tier 1 |
| `tests/unit/error-classification.test.ts` | Error Handling | Error classification logic | Tier 1 |
| `tests/unit/error-event-store.test.ts` | Error Handling | Error event storage | Tier 1 |
| `tests/unit/error-helpers.test.ts` | Error Handling | Error helper utilities | Tier 1 |
| `tests/unit/errorClassifier.test.ts` | Error Handling | Error classifier service | Tier 1 |
| `tests/unit/feature-flags.test.ts` | Config | Feature flag system | Tier 1 |
| `tests/unit/fetchWithTimeout.test.ts` | Utils | Fetch with timeout utility | Tier 1 |
| `tests/unit/health-check-enhanced.test.ts` | Health Check | Enhanced health check logic | Tier 1 |
| `tests/unit/health-check-scheduler.test.ts` | Health Check | Health check scheduling | Tier 1 |
| `tests/unit/in-flight-manager.test.ts` | Orchestrator | In-flight request tracking | Tier 1 |
| `tests/unit/inference-probe-scheduler.test.ts` | Orchestrator | Inference probe scheduling | Tier 1 |
| `tests/unit/integration.test.ts` | Integration | Integration helper tests | Tier 1 |
| `tests/unit/jsonFileHandler.test.ts` | Storage | JSON file handler | Tier 1 |
| `tests/unit/large-cluster.test.ts` | Orchestrator | Large cluster handling | Tier 2 |
| `tests/unit/load-balancer-extra.test.ts` | Load Balancer | Additional load balancer tests | Tier 1 |
| `tests/unit/load-balancer-weights.test.ts` | Load Balancer | Load balancer weight calculation | Tier 1 |
| `tests/unit/load-balancer.test.ts` | Load Balancer | Core load balancer logic | Tier 1 |
| `tests/unit/logger.test.ts` | Utils | Logger utility | Tier 1 |
| `tests/unit/logs-controller.test.ts` | Controller | Logs controller endpoints | Tier 1 |
| `tests/unit/math-helpers.test.ts` | Utils | Math helper utilities | Tier 1 |
| `tests/unit/metrics-aggregator.test.ts` | Metrics | Metrics aggregation | Tier 1 |
| `tests/unit/metrics-controller.test.ts` | Controller | Metrics controller endpoints | Tier 1 |
| `tests/unit/metrics-persistence.test.ts` | Metrics | Metrics persistence | Tier 1 |
| `tests/unit/metrics-store.test.ts` | Metrics | Metrics storage | Tier 1 |
| `tests/unit/model-aggregator.test.ts` | Model Manager | Model aggregation | Tier 1 |
| `tests/unit/model-controller.test.ts` | Controller | Model controller endpoints | Tier 1 |
| `tests/unit/model-manager-enhanced.test.ts` | Model Manager | Enhanced model manager | Tier 1 |
| `tests/unit/model-manager-instance.test.ts` | Model Manager | Model manager instance | Tier 1 |
| `tests/unit/model-manager.test.ts` | Model Manager | Core model manager | Tier 1 |
| `tests/unit/ollama-controller.test.ts` | Controller | Ollama controller endpoints | Tier 1 |
| `tests/unit/ollama-duration-fields.test.ts` | Ollama | Ollama duration field parsing | Tier 1 |
| `tests/unit/ollamaError.test.ts` | Error Handling | Ollama error handling | Tier 1 |
| `tests/unit/openai-controller.test.ts` | Controller | OpenAI-compatible controller | Tier 1 |
| `tests/unit/openai-server-support.test.ts` | OpenAI | OpenAI server support | Tier 1 |
| `tests/unit/operational-store.test.ts` | Storage | Operational store | Tier 1 |
| `tests/unit/orchestrator-failover-concurrency.test.ts` | Orchestrator | Failover concurrency handling | Tier 1 |
| `tests/unit/orchestrator-instance.test.ts` | Orchestrator | Orchestrator instance management | Tier 1 |
| `tests/unit/orchestrator.test.ts` | Orchestrator | Core orchestrator logic | Tier 1 |
| `tests/unit/persistence.test.ts` | Storage | Persistence layer | Tier 1 |
| `tests/unit/phase4-integration.test.ts` | Integration | Phase 4 integration tests | Tier 2 |
| `tests/unit/prometheus-exporter.test.ts` | Metrics | Prometheus metrics export | Tier 1 |
| `tests/unit/prompt-estimator.test.ts` | Utils | Prompt estimation | Tier 1 |
| `tests/unit/rate-limit-backoff.test.ts` | Rate Limiting | Rate limit backoff | Tier 1 |
| `tests/unit/rateLimiter.test.ts` | Rate Limiting | Rate limiter | Tier 1 |
| `tests/unit/recovery-backoff.test.ts` | Recovery | Recovery backoff logic | Tier 1 |
| `tests/unit/recovery-concurrency-guard.test.ts` | Recovery | Recovery concurrency guard | Tier 1 |
| `tests/unit/recovery-failure-controller.test.ts` | Controller | Recovery failure controller | Tier 1 |
| `tests/unit/recovery-failure-tracker.test.ts` | Recovery | Recovery failure tracking | Tier 1 |
| `tests/unit/recovery-test-coordinator.test.ts` | Recovery | Recovery test coordination | Tier 1 |
| `tests/unit/request-context-builder.test.ts` | Utils | Request context building | Tier 1 |
| `tests/unit/request-history-dedupe.test.ts` | Analytics | Request history deduplication | Tier 1 |
| `tests/unit/request-history.test.ts` | Analytics | Request history tracking | Tier 1 |
| `tests/unit/retry-after.test.ts` | Utils | Retry-after handling | Tier 1 |
| `tests/unit/routes.test.ts` | Routes | Route registration | Tier 1 |
| `tests/unit/server-drain.test.ts` | Orchestrator | Server drain functionality | Tier 1 |
| `tests/unit/server-models-controller.test.ts` | Controller | Server models controller | Tier 1 |
| `tests/unit/server-specific-routes.test.ts` | Routes | Server-specific routes | Tier 1 |
| `tests/unit/servers-controller.test.ts` | Controller | Servers controller endpoints | Tier 1 |
| `tests/unit/sse-passthrough.test.ts` | Streaming | SSE passthrough | Tier 1 |
| `tests/unit/stalled-streaming-handler.test.ts` | Streaming | Stall detection in streaming | Tier 1 |
| `tests/unit/statistics.test.ts` | Analytics | Statistics calculations | Tier 1 |
| `tests/unit/stream-handoff.test.ts` | Streaming | Stream handoff | Tier 1 |
| `tests/unit/streaming-many-chunks.test.ts` | Streaming | Many chunks streaming | Tier 1 |
| `tests/unit/streaming-stall-detection.test.ts` | Streaming | Streaming stall detection | Tier 1 |
| `tests/unit/streaming.test.ts` | Streaming | Core streaming logic | Tier 1 |
| `tests/unit/temporal-scorer.test.ts` | Load Balancer | Temporal scoring | Tier 1 |
| `tests/unit/timeout-manager.test.ts` | Utils | Timeout management | Tier 1 |
| `tests/unit/timer.test.ts` | Utils | Timer utility | Tier 1 |
| `tests/unit/token-metrics-extractor.test.ts` | Metrics | Token metrics extraction | Tier 1 |
| `tests/unit/ttft-tracker.test.ts` | Metrics | Time to first token tracking | Tier 1 |
| `tests/unit/urlUtils.test.ts` | Utils | URL utilities | Tier 1 |
| `tests/unit/v1-model-matching.test.ts` | OpenAI | V1 model matching | Tier 1 |
| `tests/unit/validation.test.ts` | Validation | Request validation | Tier 1 |
| `tests/unit/wave1-cb-double-counting.test.ts` | Circuit Breaker | Wave1 CB double counting bug | Tier 1 |
| `tests/unit/wave2-verification.test.ts` | Orchestrator | Wave2 verification tests | Tier 1 |
| `tests/unit/weighted-selection.test.ts` | Load Balancer | Weighted selection algorithm | Tier 1 |

---

## Integration Tests (10 files)

| File | Category | What It Tests | CI Tier |
|------|----------|---------------|---------|
| `tests/integration/anthropic.test.ts` | API | `/v1/messages` endpoint with auth validation | Tier 2 |
| `tests/integration/api.test.ts` | API | Core API endpoints: health, servers, config, metrics, analytics, model management | Tier 2 |
| `tests/integration/circuit-breakers.test.ts` | Circuit Breaker | Circuit breaker admin endpoints: force open/reset | Tier 2 |
| `tests/integration/client-metrics.test.ts` | Metrics | Client metrics endpoints | Tier 2 |
| `tests/integration/error-handling.test.ts` | Error Handling | Error handling integration | Tier 2 |
| `tests/integration/failover.test.ts` | Failover | Failover mechanism | Tier 2 |
| `tests/integration/metrics-endpoints.test.ts` | Metrics | Metrics endpoints | Tier 2 |
| `tests/integration/recovery-cycle.test.ts` | Recovery | Recovery cycle integration | Tier 2 |
| `tests/integration/servers-api.test.ts` | Servers | Server API endpoints | Tier 2 |

---

## E2E Tests (3 files)

| File | Category | What It Tests | CI Tier |
|------|----------|---------------|---------|
| `tests/e2e/api.test.ts` | E2E | Complete request flow, circuit breakers, queue, streaming, analytics, config, multi-server | Tier 2 |
| `tests/e2e/auth-smoke.test.ts` | Auth | Authentication smoke tests | Tier 2 |
| `tests/e2e/exhaustive-evaluation.test.ts` | E2E | Exhaustive evaluation of orchestrator capabilities | Tier 2 |

---

## Chaos Tests (5 files)

| File | Category | What It Tests | CI Tier |
|------|----------|---------------|---------|
| `tests/chaos/additional-chaos.test.ts` | Chaos | Additional chaos scenarios | Tier 3 |
| `tests/chaos/circuit-breaker-chaos.test.ts` | Chaos | Circuit breaker chaos: state transitions, recovery, load, edge cases | Tier 3 |
| `tests/chaos/load-spike.test.ts` | Chaos | Load spike scenarios: sudden increases, queue overflow, bursty traffic, recovery | Tier 3 |
| `tests/chaos/network-partition.test.ts` | Chaos | Network partition scenarios | Tier 3 |
| `tests/chaos/server-failure.test.ts` | Chaos | Server failure scenarios | Tier 3 |

---

## Performance Tests (3 files - k6)

| File | Category | What It Tests | CI Tier |
|------|----------|---------------|---------|
| `tests/performance/load-test.js` | Performance | Basic load testing (10-50 VUs, 14m total) | Tier 3 |
| `tests/performance/soak-test.js` | Performance | Soak testing (extended duration) | Tier 3 |
| `tests/performance/stress-test.js` | Performance | Stress testing (peak load) | Tier 3 |

---

## Gap Analysis

### Untested Endpoints (from routes analysis)

#### Admin Routes (`admin.routes.ts`)
| Endpoint | Status | Notes |
|----------|--------|-------|
| `POST /servers/add` | ⚠️ Indirect | Only tested via integration |
| `DELETE /servers/:id` | ⚠️ Indirect | Only tested via integration |
| `PATCH /servers/:id` | ❌ Missing | No direct test |
| `GET /servers/:id/models` | ⚠️ Indirect | Only tested via integration |
| `POST /servers/:id/models/pull` | ❌ Missing | No direct test |
| `DELETE /servers/:id/models/:model` | ❌ Missing | No direct test |
| `POST /servers/:id/models/copy` | ❌ Missing | No direct test |
| `POST /models/:model/warmup` | ⚠️ E2E | Only in e2e/api.test.ts |
| `POST /models/:model/unload` | ❌ Missing | No direct test |
| `POST /models/:model/cancel` | ❌ Missing | No direct test |
| `GET /config/export` | ❌ Missing | No test |
| `POST /config` | ⚠️ E2E | Only in e2e/api.test.ts |
| `PATCH /config/:section` | ⚠️ E2E | Only in e2e/api.test.ts |
| `POST /config/reload` | ❌ Missing | No direct test |
| `POST /config/save` | ❌ Missing | No direct test |
| `POST /config/import` | ❌ Missing | No test |
| `GET /bans` | ❌ Missing | No direct test |
| `DELETE /bans` | ❌ Missing | No direct test |
| `DELETE /bans/server/:serverId` | ❌ Missing | No direct test |
| `DELETE /bans/model/:model` | ❌ Missing | No direct test |
| `DELETE /bans/:serverId/:model` | ❌ Missing | No direct test |
| `POST /circuit-breakers/:serverId/:model/open` | ⚠️ Integration | circuit-breakers.test.ts |
| `POST /circuit-breakers/:serverId/:model/close` | ❌ Missing | No direct test |
| `POST /circuit-breakers/:serverId/:model/half-open` | ❌ Missing | No direct test |
| `POST /circuit-breakers/:serverId/reset` | ❌ Missing | No direct test |
| `POST /servers/:serverId/models/:model/recovery-test` | ❌ Missing | No direct test |
| `GET /recovery-failures` | ❌ Missing | No direct test |
| `GET /recovery-failures/stats/all` | ❌ Missing | No direct test |
| `GET /recovery-failures/recent` | ❌ Missing | No direct test |
| `GET /recovery-failures/:serverId` | ❌ Missing | No direct test |
| `GET /recovery-failures/:serverId/history` | ❌ Missing | No direct test |
| `GET /recovery-failures/:serverId/analysis` | ❌ Missing | No direct test |
| `GET /recovery-failures/:serverId/circuit-breaker-impact` | ❌ Missing | No direct test |
| `GET /recovery-failures/:serverId/circuit-breaker-transitions` | ❌ Missing | No direct test |
| `POST /recovery-failures/:serverId/reset` | ❌ Missing | No direct test |
| `POST /logs/client-error` | ❌ Missing | No test |

#### Monitoring Routes (`monitoring.routes.ts`)
| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /servers` | ⚠️ Integration | api.test.ts |
| `GET /model-map` | ⚠️ E2E | Only in exhaustive-evaluation |
| `GET /models` | ⚠️ E2E | Only in exhaustive-evaluation |
| `POST /health-check` | ❌ Missing | No direct test |
| `GET /stats` | ⚠️ Integration | api.test.ts |
| `GET /events` | ❌ Missing | No direct test |
| `GET /metrics` | ⚠️ Integration | api.test.ts |
| `GET /metrics/prometheus` | ⚠️ Integration | api.test.ts |
| `GET /metrics/:serverId/*` | ❌ Missing | No direct test |
| `GET /metrics/:serverId/:model` | ❌ Missing | No direct test |
| `GET /in-flight` | ❌ Missing | No direct test |
| `GET /metrics/recovery-tests` | ❌ Missing | No direct test |
| `GET /metrics/recovery-tests/:breakerName` | ❌ Missing | No direct test |
| `GET /models/status` | ⚠️ Integration | api.test.ts |
| `GET /models/recommendations` | ⚠️ Integration | api.test.ts |
| `GET /models/idle` | ⚠️ Integration | api.test.ts |
| `GET /models/:model/status` | ❌ Missing | No direct test |
| `GET /models/fleet-stats` | ❌ Missing | No direct test |
| `GET /analytics/top-models` | ⚠️ Integration | api.test.ts |
| `GET /analytics/server-performance` | ⚠️ E2E | e2e/api.test.ts |
| `GET /analytics/errors` | ⚠️ Integration | api.test.ts |
| `GET /analytics/capacity` | ⚠️ E2E | e2e/api.test.ts |
| `GET /analytics/trends/:metric` | ❌ Missing | No direct test |
| `GET /analytics/decisions` | ❌ Missing | No direct test |
| `GET /analytics/decisions/trends/:serverId/:model` | ❌ Missing | No direct test |
| `GET /analytics/selection-stats` | ❌ Missing | No direct test |
| `GET /analytics/algorithms` | ❌ Missing | No direct test |
| `GET /analytics/score-timeline` | ❌ Missing | No direct test |
| `GET /analytics/metrics-impact` | ❌ Missing | No direct test |
| `GET /analytics/servers-with-history` | ❌ Missing | No direct test |
| `GET /analytics/requests/search` | ❌ Missing | No direct test |
| `GET /analytics/rollups/hourly` | ❌ Missing | No direct test |
| `GET /analytics/rollups/daily` | ❌ Missing | No direct test |
| `GET /analytics/temporal-profile` | ❌ Missing | No direct test |
| `GET /analytics/temporal-adjustment` | ❌ Missing | No direct test |
| `GET /servers/:serverId/models/:model/circuit-breaker` | ⚠️ Integration | circuit-breakers.test.ts |
| `GET /errors` | ❌ Missing | No direct test |
| `GET /errors/:serverId` | ❌ Missing | No direct test |
| `GET /errors/:serverId/:circuitId` | ❌ Missing | No direct test |

#### Inference Routes (`inference.routes.ts`)
| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /tags` | ⚠️ E2E | e2e/api.test.ts |
| `POST /generate` | ⚠️ E2E | e2e/api.test.ts |
| `POST /chat` | ⚠️ E2E | Only in exhaustive-evaluation |
| `POST /embeddings` | ⚠️ E2E | Only in exhaustive-evaluation |
| `GET /ps` | ❌ Missing | No direct test |
| `GET /version` | ⚠️ Integration | api.test.ts |
| `POST /show` | ❌ Missing | No direct test |
| `POST /embed` | ❌ Missing | No direct test |
| `POST /generate--:serverId` | ❌ Missing | No direct test |
| `POST /chat--:serverId` | ❌ Missing | No direct test |
| `POST /embeddings--:serverId` | ❌ Missing | No direct test |

#### V1 Routes (`v1.routes.ts`)
| Endpoint | Status | Notes |
|----------|--------|-------|
| `POST /chat/completions` | ⚠️ E2E | e2e/api.test.ts |
| `POST /completions` | ❌ Missing | No direct test |
| `POST /embeddings` | ❌ Missing | No direct test |
| `GET /models` | ❌ Missing | No direct test |
| `GET /models/:model` | ❌ Missing | No direct test |
| `POST /chat/completions--:serverId` | ❌ Missing | No direct test |
| `POST /completions--:serverId` | ❌ Missing | No direct test |
| `POST /embeddings--:serverId` | ❌ Missing | No direct test |

#### Auth Routes (`auth.routes.ts`)
| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /csrf-token` | ❌ Missing | No direct test |
| `POST /login` | ⚠️ E2E | auth-smoke.test.ts |
| `POST /logout` | ⚠️ E2E | auth-smoke.test.ts |
| `POST /refresh` | ⚠️ E2E | auth-smoke.test.ts |
| `GET /me` | ⚠️ E2E | auth-smoke.test.ts |

#### User Routes (`user.routes.ts`)
| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /users` | ❌ Missing | No direct test |
| `POST /users` | ❌ Missing | No direct test |
| `GET /users/:id` | ❌ Missing | No direct test |
| `PUT /users/:id` | ❌ Missing | No direct test |
| `DELETE /users/:id` | ❌ Missing | No direct test |
| `POST /users/:id/access/server` | ❌ Missing | No direct test |
| `DELETE /users/:id/access/server/:serverId` | ❌ Missing | No direct test |
| `POST /users/:id/access/model` | ❌ Missing | No direct test |
| `DELETE /users/:id/access/model/:serverId/:model` | ❌ Missing | No direct test |
| `GET /users/:id/access` | ❌ Missing | No direct test |
| `POST /users/:id/rotate-api-key` | ❌ Missing | No direct test |

### Missing Edge Cases/Coverage Gaps

1. **Auth/Security**
   - No unit tests for JWT token expiration edge cases
   - No tests for CSRF token validation
   - No tests for rate limiting under load

2. **Streaming**
   - No tests for malformed NDJSON in streaming responses
   - No tests for streaming timeout scenarios
   - No tests for concurrent streaming limit enforcement

3. **Circuit Breaker**
   - No integration tests for half-open state transitions
   - No tests for adaptive threshold recalculation

4. **Load Balancer**
   - No tests for `round-robin` algorithm
   - No tests for `least-connections` algorithm
   - No tests for temporal scoring edge cases

5. **Model Management**
   - No tests for model pull failure scenarios
   - No tests for concurrent warmup/unload conflicts
   - No tests for idle threshold calculations

6. **Persistence**
   - No tests for hot reload during active requests
   - No tests for corruption recovery

---

## CI Tier Assignments

### Tier 1 - Smoke (runs on every commit, <2min total)

**All 110 unit tests** - Fast unit tests covering individual components

Tier 1 files (~110):
```
tests/unit/*.test.ts (all files)
```

### Tier 2 - Integration (runs on PR, <10min total)

**9 integration tests** + **3 E2E tests** = ~12 files

Tier 2 files:
```
tests/integration/anthropic.test.ts
tests/integration/api.test.ts
tests/integration/circuit-breakers.test.ts
tests/integration/client-metrics.test.ts
tests/integration/error-handling.test.ts
tests/integration/failover.test.ts
tests/integration/metrics-endpoints.test.ts
tests/integration/recovery-cycle.test.ts
tests/integration/servers-api.test.ts
tests/e2e/api.test.ts
tests/e2e/auth-smoke.test.ts
tests/e2e/exhaustive-evaluation.test.ts
```

### Tier 3 - Full (runs on release/nightly, <45min total)

**5 chaos tests** + **3 performance tests** = 8 files

Tier 3 files:
```
tests/chaos/additional-chaos.test.ts
tests/chaos/circuit-breaker-chaos.test.ts
tests/chaos/load-spike.test.ts
tests/chaos/network-partition.test.ts
tests/chaos/server-failure.test.ts
tests/performance/load-test.js
tests/performance/soak-test.js
tests/performance/stress-test.js
```

---

## Test Infrastructure

### Setup Files
- `tests/setup.ts` - Main integration test setup with HTTP server bootstrapping
- `tests/integration/setup.ts` - Integration test utilities (makeRequest, setup/teardown)
- `tests/utils/mock-server-factory.ts` - Mock server factory with 10+ behavioral types
- `tests/utils/test-helpers.ts` - Common test helpers (delay, etc.)
- `tests/e2e/mock-ollama-server.ts` - Mock Ollama server for E2E tests

### Key Testing Libraries
- **Vitest** - Unit and integration testing
- **Playwright** - E2E testing
- **k6** - Performance/load testing

### Test Configuration
- Vitest config at project root
- Playwright config for E2E tests
- k6 scripts use `k6/http` for HTTP requests
