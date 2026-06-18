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
