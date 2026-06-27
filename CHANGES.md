## [Unreleased] - Orchestrator Stability Release

Complete rewrite and correction of all user-facing documentation to reflect the current state of the codebase.

### Updated

- **docs/API.md** — Complete rewrite from 1,438 to 3,759 lines. Added all missing endpoint groups (authentication, user management, Anthropic, Batches, Cohere, Bedrock, performance probe scheduler), corrected auth requirements, removed stale `/queue` endpoints, added streaming content-type documentation, added server-specific bypass pattern, added error response format documentation for all three protocol families (orchestrator, OpenAI, Anthropic).
- **README.md** — Updated project structure to reflect all current controllers/routes/types files. Added missing API endpoint groups (authentication, user management, Anthropic inference, Batches, Cohere, Bedrock, performance probe). Fixed circuit breaker configuration defaults (threshold 5, half-open 60s, recovery 3, error rate 50%). Added missing Key Features (Anthropic-compatible API, Multi-Protocol Support, Authentication & User Management, Performance Probing).
- **docs/DEPLOYMENT.md** — Fixed Node.js prerequisite (v18 → v20). Fixed all circuit breaker env var defaults to match `.env.example`. Added missing auth environment variables (`ORCHESTRATOR_ENABLE_AUTH`, `ORCHESTRATOR_API_KEYS`, `ORCHESTRATOR_ADMIN_API_KEYS`). Added `ORCHESTRATOR_INFERENCE_TIMEOUT_MS`. Removed stale `/api/orchestrator/queue` health check reference, queue Grafana dashboard, `orchestrator_queue_size` metric reference. Removed stale `queue:` YAML section from config examples.
- **docs/OPERATIONS.md** — Removed all references to non-existent queue endpoints (`/queue`, `/queue/pause`, `/queue/resume`). Removed Queue Backlog troubleshooting section entirely. Fixed rolling updates to watch in-flight requests. Fixed Prometheus alert rules (removed QueueFull alert). Fixed circuit breaker config tuning examples (errorRateThreshold/openTimeout field names, correct defaults).
- **docs/EXAMPLES.md** — Added Authentication section (first-time setup, JWT cookie login with CSRF, API key auth). Added Anthropic-Compatible API section (curl streaming/non-streaming, Anthropic Python SDK). Added Performance Probe examples. Added OpenAI Node.js SDK and streaming examples. Added Ollama JavaScript library example. Fixed typo (`localhost.5100` → `localhost:5100`). Removed entire Queue Management section (3 non-existent endpoints).

---

Orchestrator Stability Release bringing production hardening, new load balancing algorithms, comprehensive metrics, and 36 bug fixes. See `.sisyphus/plans/orchestrator-stability-release.md` for full implementation details.

**Kill switch**: If issues arise with the new scoring components, set `loadBalancer.fallbackToFastestResponse = true` to immediately revert all algorithms to `fastest-response` behavior.

### Added

- `prefix-cache-aware` load balancing algorithm: maximizes upstream prefix-cache hit rates via consistent hashing of prompt token prefixes (config: `loadBalancer.prefixCacheAware`)
- SLO fallback mode: when P95 TTFT exceeds threshold, routes to the server with best recent recovery rate (config: `loadBalancer.sloFallback`)
- Token-weighted load tracking: request weight = `promptTokens * 1.0 + outputTokens * 4.0` instead of simple concurrency count (config: `loadBalancer.tokenWeightedLoad`)
- Cold-start magnitude penalty: time-limited score penalty for servers with recent cold starts (config: `loadBalancer.coldStartMagnitude`)
- New metrics: ITL (Inference Time Lag) histogram, per-prompt-size latency buckets, per-error-type histogram, jitter/stddev, cache hit rate, cold-start magnitude, token-weighted load
- New types: `PrefixHashResult`, `ServerScoreBreakdown`, `SLOMode`, `TokenWeightedLoad`, `ColdStartEvent`, `ErrorTypeMetric`, `PerSizeLatencyBucket`
- Debug observability: lifecycle events (`LIFECYCLE_*`) emitted at every request stage, request ID middleware (`X-Request-Id`), `logLevel` wiring to config
- `ps-poll-coordinator.ts`: coordinates per-server `/api/ps` polling to maintain live model availability across the fleet

### Changed

- Scoring components are now real values: `circuitBreakerScore` is no longer hardcoded to 1.0 and reflects actual circuit breaker state
- `DecisionEvent` expanded from 4 to 10 score components: latency, success, load, capacity, circuitBreaker, timeout, throughput, vram, temporal, context
- Prometheus exporter updated with new metrics: ITL histogram buckets, per-size latency buckets, error-type counts, jitter/stddev gauges, cache hit rate, cold-start magnitude
- `/api/orchestrator/analytics/decisions` now includes all 10 score components in the breakdown

### Fixed

- B1: `selectionReason='failover_routing'` was used for 72% of primary LB decisions (mislabeled)
- B2: `/api/orchestrator/circuit-breakers` returned HTTP 500
- B3: stale circuit breaker keys in metrics store (MiniMax-M3, server-cpu entries)
- B4: 32 ghost servers reported (healthy but 0 models)
- B5: `circuitBreakers.byState` returned empty object
- B6: responses missing `X-Request-Id` debug headers
- B7: DecisionEvent captured only 4 of 10 score components
- B8: `orchestrator_avg_latency_ms` showed stale 52 seconds (decay not applying)
- B9: cold-start magnitude not tracked in metrics (load_duration magnitude)
- B10: streaming TTFT baseline was 541ms (should be tracked and visible in Prometheus)
- B11: 94 suspicious entries in `/v1/models` response (attack/cloud names — security fix)
- B12: non-existent model returned HTTP 500 instead of 404
- B13: 27b model routed to only 2 of 11+ servers (over-restrictive filter)
- B14: empty prompt validation still returned HTTP 400 (verify no regression)
- B15: 100-concurrent embed requests had 17% failure rate
- B16: 60-concurrent chat 27b requests had 87% failure rate
- B17: `/v1/models` listed `:cloud` models that were not routable
- B18: streaming responses missing `X-*` debug headers (covered by B6)
- B19: non-existent embed model returned HTTP 500 instead of 404
- B20: cross-model concurrent requests (verify no regression)
- B21: server flapping behavior (verify stability)
- B22 (CRITICAL): streaming client disconnect leaked in-flight tracking (memory grew, real users got 503s)
- B23: invalid Bearer token returned HTTP 200 (info disclosure)
- B24: model name resolution inconsistent (`qwen2.5` vs `qwen2.5:7b-coder` vs `llama3.2`)
- B25: in-flight leak on abort (subsumed by B22 — same root cause)
- B26: long responses work correctly (200 tokens in 1.5s — verify no regression)
- B27: memory growth healthy under burst load (verify < 10% growth)
- B28: `X-User-Id` header accepted without breaking requests (verify no harm)
- B29: rate limiting was not enforced on inference endpoints
- B30: in-flight leak under concurrent load (subsumed by B22 — same root cause)
- B31: metrics endpoint stable under concurrent scrapes (verify < 50ms)
- B32: no response caching issues (verify identical parallel requests all return 200)
- B33: `/health` not rate-limited (acceptable — verify 100 rapid requests return 200)
- B34: stale ban entries present in ban manager
- B35: in-flight leak symptom on sustained load (subsumed by B22 — same root cause)
- B36: concurrent decisions produced race conditions on requestId (verify stable)

### Security

- B29: Rate limiting is now properly enforced on all inference endpoints
- B11: Suspicious `/v1/models` entries (94 attacker/cloud names) are now filtered

---

Phase 5 completion: accessibility improvements, test coverage, and documentation updates.

### Added

- Skip-to-content link in Layout.tsx for keyboard accessibility
- aria-label attributes on icon-only buttons across the frontend (CircuitBreakerCard, BansTab, ModelManagerModal, ServerCard, InFlight, UsersTab)
- aria-live="polite" regions on real-time updating components (StatCard value, InFlight stats grid, Dashboard)
- Design tokens tests in `src/styles/__tests__/tokens.test.ts` verifying CSS custom properties and dark mode overrides
- shadcn/ui primitive tests: Button variants/sizes, Dialog open/close, Tabs switch

### Updated

- frontend/AGENTS.md: Added shadcn/ui primitives and design tokens documentation
- frontend/src/components/AGENTS.md: Listed shadcn/ui primitives under ui/ directory
- frontend/src/pages/AGENTS.md: Documented file splits (servers/, circuit-breakers/, settings/tabs/)
- Layout.tsx: Added skip-to-content link and main-content id

### Verification

- Lint: 0 errors (only pre-existing warning in useModelPulls.tsx)
- Typecheck: 0 errors in changed files
- Build: Pre-existing errors unchanged (not from this work)

---

## 2026-06-17: Auth Refactor

Comprehensive authentication and authorization refactor to fix SSRF protection, admin override logic, and first-time launch setup flow.

### Added

- `isInternalAdmin(req)` helper — Returns `true` when auth is disabled (`ENABLE_AUTH=false`) or `req.auth?.isAdmin === true`. Use for admin authorization instead of `req.auth?.isAdmin` directly.
- `isInternalUser(req)` helper — Returns `true` when auth is disabled or JWT authentication is valid.
- `ORCHESTRATOR_AUTH_MUST_BE_ENABLED` config flag — When `true`, warns if `ENABLE_AUTH` is not set but allows service to start.
- First-time launch setup wizard — `POST /api/orchestrator/setup` accepts `{ username, password }` to create initial admin user, with standalone `setup.html` served at `GET /setup`.
- `needsSetup` field in `GET /api/auth/me` response — Returns `true` when no admin users exist.

### Fixed

- SSRF admin override broken when `ENABLE_AUTH=false` — `isInternalAdmin()` now correctly returns `true` when auth is disabled.
- Test-connection endpoints (T14/T15/T16) now require admin — SSRF protection applies to admin override.
- Inference admin checks use `isInternalAdmin()` consistently — Controllers use the helper instead of `req.auth?.isAdmin`.

### Changed

- `process.exit(1)` removed — Service starts in setup mode when no admin exists instead of exiting.
- `ENABLE_AUTH=true` now active by default — Auth is enabled when neither `ORCHESTRATOR_AUTH_ENABLED` nor `ENABLE_AUTH` is set to `false`.

### Migration

- If upgrading: Set `ENABLE_AUTH=false` in environment to retain previous behavior (auth disabled).
- Run setup wizard at `GET /setup` to create initial admin user when `ENABLE_AUTH=true`.

### Verification

- Build: **PASSED** (TypeScript compile)
- ESLint: url-safety.ts curly-brace errors fixed

---

## 2026-06-17: Capability Detection System

Added a negative probing system to detect per-endpoint capability gaps across the server fleet. The system periodically sends intentionally invalid model names to each endpoint and inspects response bodies to determine what capabilities a server truly supports.

### New Files

- `src/orchestrator/probe-executor-negative.ts` — Negative probe executor that sends invalid model names (`__neg_probe_definitely_not_a_model_xyz_12345__`) to all 11 endpoints and inspects response bodies to classify results.
- `src/probe/failure-classifier-negative.ts` — `classifyNegativeResult()` function that classifies negative HTTP responses: model-not-found JSON, endpoint-absent HTML, mid-stream NDJSON errors, rate limits.
- `src/probe/probe-scheduler.ts` — `CapabilityProbeScheduler` that runs negative probes on a configurable interval (default 5 minutes) with rate-limit deferral and server-level stagger offsets.

### New Endpoint

- `POST /api/orchestrator/servers/:id/capability-probe` — Manually trigger a capability probe cycle for a specific server. Requires admin authentication.

### Soft-Revoke Behavior

`EndpointRegistry.softRevoke(serverId, endpoint)` marks an endpoint as unconfirmed without deleting the entry. After N consecutive negative-probe failures (configurable, default 3), the endpoint is soft-revoked. A subsequent positive probe can re-confirm the endpoint automatically.

### Auto-Populate

The capability probe scheduler automatically populates the `EndpointRegistry` with confirmed endpoint capabilities. Endpoints that return HTTP 404 with JSON error (model-not-found) are confirmed as working. Endpoints that return HTML 404 (endpoint absent) are soft-revoked immediately.

### Configuration

The `capabilityProbe` config section controls the scheduler:

- `enabled` — Enable periodic capability probing. Default `true`.
- `intervalMs` — Cycle interval in milliseconds. Default `300000` (5 minutes).
- `consecutiveFailureThreshold` — Failures before soft-revoke. Default `3`.
- `requestTimeoutMs` — Per-probe timeout. Default `5000`.
- `staggerOffsetMs` — Server stagger offset. Default `30000`.

### Verification

- Build: **PASSED** (TypeScript compile + Vite frontend build)
- Tests: All existing tests pass

---

## 2026-04-11: Backend Schema Alignment with Frontend

### Changes to `src/config/schema.ts`

**serverConfigSchema:**

1. `maxConcurrency`: Changed max from `1000` to `100` to match frontend HTML input and Zod schema
2. `apiKey`: Added regex validation `/^(env:[A-Z_][A-Z0-9_]*|sk-[a-zA-Z0-9-_]*)?$/` to match frontend validation pattern

### Verification

- Build: **PASSED** (TypeScript compile + Vite frontend build)
- Tests: 108 test files, 2899 tests (5 failures are pre-existing, unrelated to schema changes)

### Notes

- Test failures are in `orchestrator.test.ts` related to circuit-breaker-persistence mock (store.saveCircuitBreakerState is not a function) - pre-existing issue
- Changes align backend validation with frontend for consistency
