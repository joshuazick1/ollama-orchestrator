# Comprehensive Test Suite - Ollama Orchestrator

## TL;DR

> **Quick Summary**: Build comprehensive integration and E2E test suite covering API reliability, failover resilience, auth flows, data consistency, frontend UX, and performance testing at maximum coverage.
>
> **Deliverables**:
> - Expanded integration test suite (Vitest) for all API endpoints, failover scenarios, auth, data consistency
> - Comprehensive Playwright E2E tests covering all frontend pages and user flows
> - Enhanced performance/load tests (k6) with multiple scenarios
> - Test data factories and fixtures for reliable test execution
> - CI/CD integration for tiered test execution
>
> **Estimated Effort**: XL (large multi-week effort)
> **Parallel Execution**: YES - 6 waves
> **Critical Path**: Wave 1 (foundation) → Wave 2-5 (parallel domain coverage) → Wave 6 (integration) → Final verification

---

## Context

### Original Request
Review tests and create comprehensive integration test suite with Playwright tests covering all 6 areas at maximum coverage.

### Interview Summary
**User Directive**: Maximum tests on all 6 areas:
1. **API reliability** - All inference endpoints with edge cases
2. **Failover resilience** - Multi-server cascading, circuit breakers, chaos scenarios
3. **Auth flows** - Login UI, JWT, API keys, sessions, RBAC
4. **Data consistency** - DB migrations, concurrent writes, metrics accuracy
5. **Frontend UX** - All pages, navigation, forms, modals, error states
6. **Performance** - Load, stress, soak tests with various patterns

**Scope Decision**: All endpoints and all frontend routes are in scope (user said "maximum")

### Research Findings
- **Test Infrastructure**: Vitest (100+ unit tests, 9 integration), Playwright (4 E2E), k6 (3 load tests)
- **Mock Server Factory**: 10+ behavioral types (healthy, slow, flaky, degraded, chaos, etc.)
- **Application Stack**: Express.js + React + SQLite
- **Existing Patterns**: Test setup with HTTP server bootstrapping, `makeRequest()` helper, fixture factories

---

## Work Objectives

### Core Objective
Create a comprehensive, maintainable test suite achieving maximum coverage across all 6 focus areas with clear QA automation and tiered execution strategy.

### Concrete Deliverables

| Area | Files to Create/Extend | Target Test Count |
|------|------------------------|-------------------|
| **API Reliability** | `tests/integration/api-*.test.ts` | 40+ tests |
| **Failover Resilience** | `tests/integration/failover-*.test.ts`, `tests/chaos/` | 30+ tests |
| **Auth Flows** | `tests/integration/auth-*.test.ts`, `tests/e2e/auth-*.test.ts` | 25+ tests |
| **Data Consistency** | `tests/integration/data-*.test.ts` | 20+ tests |
| **Frontend UX** | `tests/e2e/pages/*.test.ts` (9 routes) | 50+ tests |
| **Performance** | `tests/performance/*.test.ts` (k6 scenarios) | 15+ scenarios |

**Total Target**: 180+ tests/scenarios

### Definition of Done
- [ ] All 6 areas have ≥80% code path coverage
- [ ] All critical user flows have automated verification
- [ ] All tests are idempotent and independently executable
- [ ] Test execution time < 45 minutes for full suite
- [ ] CI/CD pipeline runs tiered tests (smoke → integration → full)

### Must Have
- Complete API endpoint coverage (all routes, all methods)
- Circuit breaker state machine full coverage
- Failover cascade scenarios (2-server, 5-server, partial)
- Auth flow coverage (login, JWT, API key, session, RBAC)
- Frontend page coverage (all 9 routes, all interactions)
- Load test coverage (uniform, spike, soak, stress)
- Test data factories for all entity types
- In-memory test execution (no external dependencies)

### Must NOT Have (Guardrails)
- Third-party API tests (only orchestrator logic)
- Visual screenshot diffs (functional only)
- Tests for deprecated endpoints
- Tests requiring production data
- Hardcoded timestamps or time-dependent assertions
- Sequential test dependencies (all must run independently)

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: TDD approach - tests written before implementation where missing
- **Framework**: Vitest (backend), Playwright (E2E), k6 (performance)
- **Coverage Target**: ≥80% line coverage for backend, ≥70% for frontend

### QA Policy
Every task MUST include agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Backend/Integration**: Use `bash` with curl for API tests, direct module import for unit verification
- **E2E Frontend**: Use Playwright - navigate, interact, assert DOM, screenshot
- **Performance**: Use k6 with `--out json` results, parse for metrics assertions

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation - MUST complete first):
├── Task 1: Test infrastructure audit + registry creation [quick]
├── Task 2: Test data factories + fixtures expansion [quick]
├── Task 3: Mock server factory enhancement (missing types) [quick]
└── Task 4: CI/CD tier strategy + test categorization [quick]

Wave 2 (API Layer - parallel, after Wave 1):
├── Task 5: API reliability - Ollama-compatible endpoints (/api/*) [deep]
├── Task 6: API reliability - OpenAI-compatible endpoints (/v1/*) [deep]
├── Task 7: API reliability - Admin endpoints (/api/orchestrator/*) [deep]
├── Task 8: API reliability - Health/metrics endpoints [quick]
└── Task 9: API reliability - Edge cases (malformed, oversized, timeouts) [deep]

Wave 3 (Failover Layer - parallel, after Wave 1):
├── Task 10: Circuit breaker state machine tests [deep]
├── Task 11: Failover - 2 server cascade [deep]
├── Task 12: Failover - 5 server partial failure [deep]
├── Task 13: Failover - Recovery cycle tests [deep]
├── Task 14: Chaos - Random failure injection [deep]
└── Task 15: Chaos - Network partition simulation [deep]

Wave 4 (Auth Layer - parallel, after Wave 1):
├── Task 16: Auth - JWT token issuance/validation [deep]
├── Task 17: Auth - API key authentication [deep]
├── Task 18: Auth - Login page UI flow [visual-engineering]
├── Task 19: Auth - Session expiration/refresh [deep]
├── Task 20: Auth - RBAC permission enforcement [deep]
└── Task 21: Auth - Invalid credentials edge cases [quick]

Wave 5 (Data + Frontend Layer - parallel, after Wave 1):
├── Task 22: Data - Migration tests [deep]
├── Task 23: Data - Concurrent write consistency [deep]
├── Task 24: Data - Metrics aggregation accuracy [deep]
├── Task 25: Data - Rollup calculation verification [deep]
├── Task 26: Frontend - Page object models for all 9 routes [visual-engineering]
├── Task 27: Frontend - Navigation flow tests [visual-engineering]
├── Task 28: Frontend - Form validation tests [visual-engineering]
├── Task 29: Frontend - Modal/interaction tests [visual-engineering]
└── Task 30: Frontend - Error/loading state tests [visual-engineering]

Wave 6 (Performance + Integration - after Waves 2-5):
├── Task 31: Performance - Load test scenarios (uniform/spike) [deep]
├── Task 32: Performance - Stress test scenarios [deep]
├── Task 33: Performance - Soak test scenarios [deep]
├── Task 34: Integration - Full E2E workflow tests [visual-engineering]
└── Task 35: Integration - Cross-component integration [deep]

Wave FINAL (Verification - after ALL implementation):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay
```

### Dependency Matrix (abbreviated)

- **Wave 1**: Tasks 1-4 can ALL start immediately (parallel)
- **Waves 2-5**: ALL depend on Wave 1 completing (foundation)
- **Wave 6**: All tasks depend on respective Wave 2-5 completing (e.g., Task 31 needs Wave 3 circuit breaker tests)
- **Wave FINAL**: All depend on Wave 6 completing

### Agent Dispatch Summary

- **Wave 1**: **4 tasks** - T1-T4 → `quick`
- **Wave 2**: **5 tasks** - T5-T6 → `deep`, T7 → `deep`, T8 → `quick`, T9 → `deep`
- **Wave 3**: **6 tasks** - T10-T15 → `deep`
- **Wave 4**: **6 tasks** - T16-T17 → `deep`, T18 → `visual-engineering`, T19 → `deep`, T20 → `deep`, T21 → `quick`
- **Wave 5**: **9 tasks** - T22-T25 → `deep`, T26-T30 → `visual-engineering`
- **Wave 6**: **5 tasks** - T31-T33 → `deep`, T34 → `visual-engineering`, T35 → `deep`
- **FINAL**: **4 tasks** - F1 → `oracle`, F2-F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

> Implementation + Test = ONE Task. Never separate.
> Every task MUST have: Recommended Agent Profile + Parallelization info + QA Scenarios.
> **A task WITHOUT QA Scenarios is INCOMPLETE. No exceptions.**

- [x] 1. Test Infrastructure Audit + Registry Creation

  **What to do**:
  - Audit ALL existing tests (unit, integration, e2e, chaos, performance)
  - Create test registry document listing all tests, their categories, and coverage areas
  - Identify gaps: untested endpoints, missing edge cases, coverage blind spots
  - Document which tests run in which CI tier (smoke/integration/full)
  - Create TODO tracker for expanding coverage

  **Must NOT do**:
  - Run tests (only audit/discover)
  - Modify existing tests

  **Recommended Agent Profile**:
  > - **Category**: `quick` - Simple audit/discovery task
  >   Reason: Straightforward file enumeration and categorization
  > - **Skills**: `[]`
  >   - No specific skills needed - file reading and categorization only

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: ALL subsequent waves (2-6) depend on audit findings
  - **Blocked By**: None (can start immediately)

  **References**:
  - `package.json` - Test scripts definitions
  - `tests/unit/*.test.ts` - Unit test files (100+)
  - `tests/integration/*.test.ts` - Integration test files (9)
  - `tests/e2e/*.test.ts` - E2E test files (4)
  - `tests/chaos/*.test.ts` - Chaos test files (5)
  - `tests/performance/*.js` - k6 load test files (3)

  **Acceptance Criteria**:
  - [ ] Test registry document created at `tests/registry.md`
  - [ ] All test files cataloged with category and coverage area
  - [ ] Gap analysis documented with specific endpoints/missing tests
  - [ ] CI tier assignments specified for each test

  **QA Scenarios**:

  ```
  Scenario: Audit discovers existing tests
    Tool: Bash
    Preconditions: Test files exist in expected locations
    Steps:
      1. ls tests/unit/ tests/integration/ tests/e2e/ tests/chaos/ tests/performance/
      2. Count files in each directory
      3. Verify each file has .test.ts or .test.js extension
    Expected Result: File counts match expected (100+ unit, 9 integration, 4 e2e, 5 chaos, 3 performance)
    Evidence: .sisyphus/evidence/task-1-audit-files.{ext}

  Scenario: Gap analysis identifies untested endpoints
    Tool: Bash
    Preconditions: Test registry created
    Steps:
      1. Compare API endpoints from routes/*.ts against tested endpoints
      2. List endpoints with ZERO test coverage
      3. List endpoints with PARTIAL test coverage
    Expected Result: Gap report shows specific untested endpoints
    Evidence: .sisyphus/evidence/task-1-gap-analysis.{ext}
  ```

  **Commit**: NO

---

- [x] 2. Test Data Factories + Fixtures Expansion

  **What to do**:
  - Create factory functions for ALL entity types (Server, Model, User, Request, Decision, etc.)
  - Implement fixture generation with realistic test data
  - Ensure factories support both happy-path and edge-case scenarios
  - Add factory presets for chaos scenarios (slow server, flaky server, etc.)
  - Create factory composition for complex scenarios (multi-server failover)

  **Must NOT do**:
  - Hardcode any specific test values (use factory parameters)

  **Recommended Agent Profile**:
  > - **Category**: `quick` - Standard factory/fixture creation
  >   Reason: Well-defined patterns, no complex logic
  > - **Skills**: `[]`
  >   - No specific skills needed - follows existing fixture patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: All integration and e2e tests (need factories)
  - **Blocked By**: None (can start immediately)

  **References**:
  - `tests/fixtures/index.ts` - Existing fixture patterns
  - `tests/fixtures/real-responses.ts` - Realistic API response structures
  - `src/storage/schema.ts` - Database schema for entity types

  **Acceptance Criteria**:
  - [ ] Factory functions exist for: Server, Model, User, Request, Decision, Metrics, Config
  - [ ] Each factory has sensible defaults and can be customized via parameters
  - [ ] Factory presets exist for chaos scenarios
  - [ ] All factories are used by existing tests (no orphaned factories)

  **QA Scenarios**:

  ```
  Scenario: Factory creates valid server entity
    Tool: Bash
    Preconditions: TypeScript compilation succeeds
    Steps:
      1. Import ServerFactory from test fixtures
      2. Call createServer({ url: 'http://localhost:11434', type: 'ollama' })
      3. Assert required fields: id, url, type, status, maxConcurrency
    Expected Result: Server object with all required fields and valid types
    Evidence: .sisyphus/evidence/task-2-server-factory.{ext}

  Scenario: Factory creates chaos preset
    Tool: Bash
    Preconditions: TypeScript compilation succeeds
    Steps:
      1. Import ChaosPresets from test fixtures
      2. Call createFlakyServer() and createSlowServer()
      3. Verify returned objects have appropriate latency/failureRate fields
    Expected Result: Chaos presets with configured failure modes
    Evidence: .sisyphus/evidence/task-2-chaos-presets.{ext}
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `test(infrastructure): add test registry and data factories`
  - Files: `tests/fixtures/factories.ts`

---

- [x] 3. Mock Server Factory Enhancement

  **What to do**:
  - Identify missing server types in `tests/utils/mock-server-factory.ts`
  - Add types: `partition` (network partition), `oom` (memory pressure), `disk-full`, `clock-skew`
  - Ensure each mock server type properly simulates failure modes
  - Add verification methods to check server is behaving as expected
  - Create compound mock servers (e.g., server that starts healthy then degrades)

  **Must NOT do**:
  - Remove existing server types (only add new ones)
  - Change existing server behavior

  **Recommended Agent Profile**:
  > - **Category**: `quick` - Extension of existing factory
  >   Reason: Adding to existing well-tested factory, straightforward
  > - **Skills**: `[]`
  >   - No specific skills needed - follows existing patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: Chaos tests (Task 14, 15)
  - **Blocked By**: None (can start immediately)

  **References**:
  - `tests/utils/mock-server-factory.ts` - Existing factory implementation
  - `tests/chaos/circuit-breaker-chaos.test.ts` - Example chaos test patterns

  **Acceptance Criteria**:
  - [ ] New server types added: partition, oom, disk-full, clock-skew
  - [ ] Each new type has configurable parameters
  - [ ] Compound server types exist for complex scenarios
  - [ ] All server types have behavioral verification methods

  **QA Scenarios**:

  ```
  Scenario: Network partition server drops all traffic
    Tool: Bash
    Preconditions: mock-server-factory.ts enhanced
    Steps:
      1. Create partition server on port 0
      2. Send HTTP request to server
      3. Assert request times out or connection refused
    Expected Result: Server simulates network partition (connection refused/timeout)
    Evidence: .sisyphus/evidence/task-3-partition-server.{ext}

  Scenario: OOM server starts accepting then fails
    Tool: Bash
    Preconditions: mock-server-factory.ts enhanced
    Steps:
      1. Create oom server on port 0
      2. Send 3 requests - all should succeed initially
      3. Send more requests and observe OOM behavior
    Expected Result: Server accepts requests then starts failing with OOM indicators
    Evidence: .sisyphus/evidence/task-3-oom-server.{ext}
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `test(infrastructure): add mock server types and test factories`
  - Files: `tests/utils/mock-server-factory.ts`, `tests/fixtures/factories.ts`

---

- [x] 4. CI/CD Tier Strategy + Test Categorization

  **What to do**:
  - Define test tiers: Tier 1 (smoke, <2min), Tier 2 (integration, <10min), Tier 3 (full, <45min)
  - Assign all existing and new tests to appropriate tiers
  - Create/update GitHub Actions workflow for tiered execution
  - Add test execution reports and artifact upload
  - Ensure flaky tests are marked and can be skipped in fast feedback

  **Must NOT do**:
  - Remove existing CI configuration
  - Break existing test execution

  **Recommended Agent Profile**:
  > - **Category**: `quick` - Configuration work, no complex logic
  >   Reason: CI configuration update, well-defined patterns
  > - **Skills**: `[]`
  >   - No specific skills needed - follows existing CI patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: CI integration (commit after Wave 6 complete)
  - **Blocked By**: None (can start immediately)

  **References**:
  - `.github/workflows/ci.yml` - Existing CI configuration
  - `tests/integration/setup.ts` - Integration test setup

  **Acceptance Criteria**:
  - [ ] Test tiers defined with time budgets
  - [ ] Each test assigned to a tier
  - [ ] GitHub Actions workflow updated for tiered execution
  - [ ] Test reports generate JSON artifacts

  **QA Scenarios**:

  ```
  Scenario: Tier assignment is documented
    Tool: Bash
    Preconditions: CI workflow updated
    Steps:
      1. cat .github/workflows/ci.yml | grep -A5 "test-tier"
      2. Verify 3 tiers defined with appropriate test globs
    Expected Result: CI workflow has tier1 (smoke), tier2 (integration), tier3 (full) sections
    Evidence: .sisyphus/evidence/task-4-tier-config.{ext}
  ```

  **Commit**: YES (groups with Wave 6 - CI integration)
  - Message: `ci(tests): add tiered test execution in CI/CD`
  - Files: `.github/workflows/ci.yml`

---

- [x] 5. API Reliability - Ollama-Compatible Endpoints (/api/*)

  **What to do**:
  - Create `tests/integration/api-ollama.test.ts`
  - Test ALL Ollama-compatible endpoints with both happy-path and edge cases:
    - `GET /api/tags` - model listing aggregation
    - `POST /api/generate` - text generation with streaming and without
    - `POST /api/chat` - chat completion with streaming and without
    - `POST /api/embeddings` - embedding generation
    - `GET /api/ps` - running models
    - `GET /api/version` - version info
    - `POST /api/show` - model info
  - Cover: valid requests, malformed JSON, missing fields, invalid field types, oversized payloads, timeout scenarios

  **Must NOT do**:
  - Test deprecated endpoints
  - Hardcode specific timestamps

  **Recommended Agent Profile**:
  > - **Category**: `deep` - Complex API testing with multiple scenarios
  >   Reason: Multiple endpoints, edge cases, streaming scenarios
  > - **Skills**: `[]`
  >   - No specific skills needed - API testing follows established patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 7, 8, 9)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1 (Tasks 1-4 must complete first)

  **References**:
  - `src/routes/inference.routes.ts` - Ollama route definitions
  - `src/controllers/ollama-controller.ts` - Ollama handler implementations
  - `tests/integration/api.test.ts` - Existing API test patterns

  **Acceptance Criteria**:
  - [ ] All 7 Ollama-compatible endpoints have tests
  - [ ] Each endpoint has ≥5 test cases (happy path, errors, edge cases)
  - [ ] Streaming variants tested for generate and chat
  - [ ] Timeout scenarios tested
  - [ ] All tests use factory-created mock data

  **QA Scenarios**:

  ```
  Scenario: GET /api/tags returns aggregated models
    Tool: Bash
    Preconditions: Integration test server running, mock servers configured
    Steps:
      1. Start orchestrator with 3 mock Ollama servers (different models)
      2. GET /api/tags
      3. Assert response status 200
      4. Assert response contains models from all servers
      5. Assert response structure matches Ollama API spec
    Expected Result: Aggregated model list from all servers
    Evidence: .sisyphus/evidence/task-5-tags-aggregation.{ext}

  Scenario: POST /api/generate with streaming works correctly
    Tool: Bash
    Preconditions: Integration test server running, streaming enabled
    Steps:
      1. POST /api/generate with stream: true and a prompt
      2. Collect streaming chunks (NDJSON)
      3. Assert total response contains expected content
      4. Assert streaming format is correct (one JSON per line)
    Expected Result: Streaming response with proper NDJSON format
    Evidence: .sisyphus/evidence/task-5-generate-streaming.{ext}

  Scenario: POST /api/chat with invalid JSON returns 400
    Tool: Bash
    Preconditions: Integration test server running
    Steps:
      1. POST /api/chat with malformed JSON body
      2. Assert response status 400 or 422
      3. Assert error message indicates validation failure
    Expected Result: Proper error response for malformed request
    Evidence: .sisyphus/evidence/task-5-chat-invalid-json.{ext}
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `test(api): add Ollama-compatible endpoint tests`
  - Files: `tests/integration/api-ollama.test.ts`

---

- [x] 6. API Reliability - OpenAI-Compatible Endpoints (/v1/*)

  **What to do**:
  - Create `tests/integration/api-openai.test.ts`
  - Test ALL OpenAI-compatible endpoints:
    - `POST /v1/chat/completions` - with and without streaming
    - `POST /v1/completions` - text completion
    - `POST /v1/embeddings` - embedding generation
    - `GET /v1/models` - model listing
  - Cover: request format compatibility, response format matches OpenAI spec, function calling, tools, edge cases

  **Must NOT do**:
  - Test actual OpenAI API (only orchestrator's OpenAI-compatible endpoints)

  **Recommended Agent Profile**:
  > - **Category**: `deep` - Complex API testing with multiple scenarios
  >   Reason: Multiple endpoints, streaming, OpenAI spec compatibility
  > - **Skills**: `[]`
  >   - No specific skills needed - API testing follows established patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 7, 8, 9)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `src/routes/v1.routes.ts` - OpenAI route definitions
  - `src/controllers/openai-controller.ts` - OpenAI handler implementations
  - `tests/integration/anthropic.test.ts` - Existing similar test patterns

  **Acceptance Criteria**:
  - [ ] All 4 OpenAI-compatible endpoints have tests
  - [ ] Chat completions include function calling and tool use tests
  - [ ] Streaming variants tested
  - [ ] Response format verified against OpenAI API spec

  **QA Scenarios**:

  ```
  Scenario: POST /v1/chat/completions with function calling
    Tool: Bash
    Preconditions: Integration test server running with Ollama supporting function calls
    Steps:
      1. POST /v1/chat/completions with messages and tools
      2. Assert response status 200
      3. Assert response has correct OpenAI format
      4. Assert tool_calls present if functions available
    Expected Result: Proper OpenAI-compatible response with function calling support
    Evidence: .sisyphus/evidence/task-6-function-calling.{ext}

  Scenario: POST /v1/embeddings returns correct format
    Tool: Bash
    Preconditions: Integration test server running
    Steps:
      1. POST /v1/embeddings with { input: "test text" }
      2. Assert response has "data" array with "embedding" field
      3. Assert embedding is array of floats
      4. Assert response has "model" and "usage" fields
    Expected Result: OpenAI-compatible embeddings response format
    Evidence: .sisyphus/evidence/task-6-embeddings-format.{ext}
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `test(api): add OpenAI-compatible endpoint tests`
  - Files: `tests/integration/api-openai.test.ts`

---

- [x] 7. API Reliability - Admin Endpoints (/api/orchestrator/*)

  **What to do**:
  - Create `tests/integration/api-admin.test.ts`
  - Test admin management endpoints:
    - Server CRUD: add, remove, update, list servers
    - Model management: warmup, unload, list models, pull model
    - Circuit breaker: get, reset, force state change
    - Configuration: get, update, reload config
    - Analytics: all analytics endpoints
    - Logs: get and clear logs
    - Recovery failures: get stats, reset
    - Bans: get, add, remove bans

  **Must NOT do**:
  - Test endpoints that require production data
  - Test deprecated endpoints

  **Recommended Agent Profile**:
  > - **Category**: `deep` - Complex API testing with many endpoints
  >   Reason: Many admin endpoints, different response types
  > - **Skills**: `[]`
  >   - No specific skills needed - API testing follows established patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 8, 9)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `src/routes/admin.routes.ts` - Admin route definitions
  - `src/controllers/servers-controller.ts` - Server management handlers
  - `src/controllers/circuit-breaker-controller.ts` - Circuit breaker handlers
  - `src/controllers/config-controller.ts` - Config handlers

  **Acceptance Criteria**:
  - [ ] All server CRUD operations tested
  - [ ] All model management operations tested
  - [ ] All circuit breaker operations tested
  - [ ] Config get/update/reload tested
  - [ ] Analytics endpoints return valid data
  - [ ] Logs endpoints work correctly
  - [ ] Ban management tested

  **QA Scenarios**:

  ```
  Scenario: Add and remove server via API
    Tool: Bash
    Preconditions: Integration test server running
    Steps:
      1. POST /api/orchestrator/servers/add with { url, type }
      2. Assert response status 200 with server object
      3. GET /api/orchestrator/servers
      4. Assert new server appears in list
      5. DELETE /api/orchestrator/servers/{id}
      6. Assert server removed
    Expected Result: Server added and removed successfully
    Evidence: .sisyphus/evidence/task-7-server-crud.{ext}

  Scenario: Circuit breaker force state transitions
    Tool: Bash
    Preconditions: Integration test server running with servers
    Steps:
      1. GET /api/orchestrator/circuit-breakers to get baseline
      2. POST /api/orchestrator/circuit-breakers/{serverId}/{model}/open
      3. Assert circuit breaker state is OPEN
      4. POST /api/orchestrator/circuit-breakers/{serverId}/{model}/close
      5. Assert circuit breaker state is CLOSED
    Expected Result: Circuit breaker state transitions work correctly
    Evidence: .sisyphus/evidence/task-7-circuit-state.{ext}
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `test(api): add admin endpoint tests`
  - Files: `tests/integration/api-admin.test.ts`

---

- [x] 8. API Reliability - Health/Metrics Endpoints

  **What to do**:
  - Create `tests/integration/api-health.test.ts`
  - Test health and metrics endpoints:
    - `GET /health` - overall health
    - `GET /health/live` - liveness probe
    - `GET /health/ready` - readiness probe
    - `GET /metrics` - Prometheus metrics
    - `GET /api/orchestrator/metrics/prometheus` - Prometheus metrics from orchestrator

  **Must NOT do**:
  - Test Prometheus scraping configuration (only endpoint responses)

  **Recommended Agent Profile**:
  > - **Category**: `quick` - Simple endpoint testing
  >   Reason: Well-defined simple endpoints, clear responses
  > - **Skills**: `[]`
  >   - No specific skills needed - straightforward API testing

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 7, 9)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `src/index.ts` lines 179-218 - Health and metrics endpoint handlers

  **Acceptance Criteria**:
  - [ ] /health returns proper status structure
  - [ ] /health/live returns 200 when healthy
  - [ ] /health/ready returns 200 when ready, 503 when not ready
  - [ ] /metrics returns Prometheus-formatted metrics
  - [ ] All responses have correct content-type headers

  **QA Scenarios**:

  ```
  Scenario: Health endpoint returns correct structure
    Tool: Bash
    Preconditions: Integration test server running
    Steps:
      1. GET /health
      2. Assert response status 200
      3. Parse JSON response
      4. Assert fields: status, version, uptime, timestamp
    Expected Result: Health response with all expected fields
    Evidence: .sisyphus/evidence/task-8-health-structure.{ext}

  Scenario: Readiness probe with no servers
    Tool: Bash
    Preconditions: Integration test server running with no backend servers
    Steps:
      1. GET /health/ready
      2. Assert response status 503 (not ready - no servers)
      3. Add a server
      4. GET /health/ready
      5. Assert response status 200
    Expected Result: Readiness correctly reflects server availability
    Evidence: .sisyphus/evidence/task-8-readiness.{ext}

  Scenario: Prometheus metrics format validation
    Tool: Bash
    Preconditions: Integration test server running
    Steps:
      1. GET /metrics
      2. Assert response is Prometheus text format
      3. Parse metrics output
      4. Assert required metrics present: orchestrator_requests_total, orchestrator_errors_total
    Expected Result: Valid Prometheus metrics in text format
    Evidence: .sisyphus/evidence/task-8-prometheus-format.{ext}
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `test(api): add health/metrics endpoint tests`
  - Files: `tests/integration/api-health.test.ts`

---

- [ ] 9. API Reliability - Edge Cases (malformed, oversized, timeouts)

  **What to do**:
  - Create `tests/integration/api-edge-cases.test.ts`
  - Test edge cases across all API endpoints:
    - Malformed JSON (invalid syntax, wrong types)
    - Oversized payloads (models, prompts, messages)
    - Missing required fields
    - Invalid field types (string where number expected)
    - Content-Type mismatches
    - Encoding issues (UTF-8, special characters)
    - Request timeout handling
    - Concurrent requests to same endpoint
    - Partial/truncated requests

  **Must NOT do**:
  - Test against production services
  - Use extremely large payloads that could cause OOM in tests

  **Recommended Agent Profile**:
  > - **Category**: `deep` - Edge case testing requires understanding all endpoints
  >   Reason: Comprehensive edge case coverage across many endpoints
  > - **Skills**: `[]`
  >   - No specific skills needed - systematic edge case testing

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 7, 8)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `src/middleware/validation.ts` - Validation middleware
  - `src/controllers/openai-controller.ts` - Request parsing

  **Acceptance Criteria**:
  - [ ] Malformed JSON returns 400 with clear error
  - [ ] Oversized payload returns 413 or 400
  - [ ] Missing required fields returns 400
  - [ ] Invalid field types returns 400
  - [ ] Wrong Content-Type returns 415
  - [ ] Request timeout returns 504 or proper timeout error
  - [ ] Concurrent requests handled correctly (no race conditions)

  **QA Scenarios**:

  ```
  Scenario: Malformed JSON returns 400 with error details
    Tool: Bash
    Preconditions: Integration test server running
    Steps:
      1. POST /api/chat with body "{ invalid json }"
      2. Assert response status 400
      3. Assert error response has message field
      4. Assert error does not expose internal stack trace
    Expected Result: Clean 400 error with safe error message
    Evidence: .sisyphus/evidence/task-9-malformed-json.{ext}

  Scenario: Oversized prompt returns appropriate error
    Tool: Bash
    Preconditions: Integration test server running
    Steps:
      1. POST /api/generate with prompt of 10MB+
      2. Assert response status 413 or 400
      3. Assert error mentions size limit
    Expected Result: Size limit enforced with proper error
    Evidence: .sisyphus/evidence/task-9-oversized-payload.{ext}

  Scenario: Concurrent requests don't cause race conditions
    Tool: Bash
    Preconditions: Integration test server running with mock servers
    Steps:
      1. Send 20 concurrent POST /api/chat requests
      2. Wait for all to complete
      3. Assert all completed without errors
      4. Assert metrics show correct concurrent handling
    Expected Result: All requests handled without race conditions
    Evidence: .sisyphus/evidence/task-9-concurrent-requests.{ext}
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `test(api): add edge case tests for all endpoints`
  - Files: `tests/integration/api-edge-cases.test.ts`

---

- [ ] 10. Circuit Breaker State Machine Tests

  **What to do**:
  - Create `tests/integration/circuit-breaker-state-machine.test.ts`
  - Test all circuit breaker states and transitions:
    - CLOSED → OPEN (on failure threshold)
    - OPEN → HALF-OPEN (after timeout)
    - -OPEN → CLOSED (on recovery success)
    - OPEN → HALF-OPEN → OPEN (on recovery failure)
    - Manual force state transitions
    - Adaptive threshold behavior
    - Error rate calculation and smoothing

  **Must NOT do**:
  - Test circuit breakers for third-party services
  - Rely on timing-dependent assertions (use mock time)

  **Recommended Agent Profile**:
  > - **Category**: `deep` - Complex state machine testing
  >   Reason: State transitions, error classification, adaptive logic
  > - **Skills**: `[]`
  >   - No specific skills needed - state machine testing follows patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 11, 12, 13, 14, 15)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `src/circuit-breaker/circuit-breaker.ts` - Circuit breaker implementation
  - `tests/integration/circuit-breakers.test.ts` - Existing circuit breaker tests
  - `tests/chaos/circuit-breaker-chaos.test.ts` - Chaos test patterns

  **Acceptance Criteria**:
  - [ ] All 5 state transitions tested
  - [ ] Adaptive threshold behavior verified
  - [ ] Error rate calculation verified
  - [ ] Manual force transitions tested
  - [ ] State persistence tested

  **QA Scenarios**:

  ```
  Scenario: CLOSED to OPEN transition on failure threshold
    Tool: Bash
    Preconditions: Integration test with mock server, circuit breaker in CLOSED state
    Steps:
      1. Create mock server that fails 5 consecutive requests
      2. Send 5 requests that will fail
      3. Assert circuit breaker state is now OPEN
      4. Assert subsequent requests are rejected immediately
    Expected Result: Circuit breaker opens after failure threshold
    Evidence: .sisyphus/evidence/task-10-closed-to-open.{ext}

  Scenario: OPEN to HALF-OPEN after timeout
    Tool: Bash
    Preconditions: Circuit breaker in OPEN state
    Steps:
      1. Verify circuit breaker is OPEN
      2. Wait for half-open timeout (or use mock time)
      3. Send test request
      4. Assert circuit breaker is now HALF-OPEN
    Expected Result: Automatic transition to HALF-OPEN after timeout
    Evidence: .sisyphus/evidence/task-10-open-to-half-open.{ext}

  Scenario: Adaptive threshold adjusts based on error pattern
    Tool: Bash
    Preconditions: Circuit breaker with adaptive thresholds enabled
    Steps:
      1. Generate error pattern that should trigger threshold adjustment
      2. Verify threshold adapts (check configuration before/after)
      3. Assert threshold is within adaptive range (2-8 for base 3)
    Expected Result: Adaptive threshold responds to error patterns
    Evidence: .sisyphus/evidence/task-10-adaptive-threshold.{ext}
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `test(failover): add circuit breaker state machine tests`
  - Files: `tests/integration/circuit-breaker-state-machine.test.ts`

---

- [ ] 11. Failover - 2 Server Cascade

  **What to do**:
  - Create `tests/integration/failover-2-server.test.ts`
  - Test failover scenarios with exactly 2 backend servers:
    - Primary fails → failover to secondary
    - Both servers fail sequentially
    - Partial failure (one server slow, one healthy)
    - Recovery of failed server and return to primary
    - Load distribution between 2 servers

  **Must NOT do**:
  - Test with more than 2 servers
  - Test network partition scenarios (that's Task 15)

  **Recommended Agent Profile**:
  > - **Category**: `deep` - Complex failover testing
  >   Reason: Multi-server coordination, state tracking, recovery logic
  > - **Skills**: `[]`
  >   - No specific skills needed - failover testing follows patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 10, 12, 13, 14, 15)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `tests/integration/failover.test.ts` - Existing failover test patterns
  - `src/orchestrator/orchestrator.ts` - Failover logic
  - `src/load-balancer/load-balancer.ts` - Load balancer implementation

  **Acceptance Criteria**:
  - [ ] Failover to secondary works within 5 seconds
  - [ ] Sequential failures handled correctly
  - [ ] Recovery of primary restores original routing
  - [ ] Load distribution verified
  - [ ] No requests lost during failover

  **QA Scenarios**:

  ```
  Scenario: Primary fails, requests route to secondary
    Tool: Bash
    Preconditions: 2 mock servers configured, primary marked as healthy
    Steps:
      1. Send 10 requests - all route to primary
      2. Kill primary server
      3. Send 5 more requests
      4. Assert all 5 route to secondary
      5. Assert no failed requests (failover worked)
    Expected Result: Automatic failover to secondary with no request loss
    Evidence: .sisyphus/evidence/task-11-primary-failover.{ext}

  Scenario: Both servers fail sequentially
    Tool: Bash
    Preconditions: 2 mock servers configured
    Steps:
      1. Kill primary - verify failover to secondary
      2. Kill secondary - verify error response (no more servers)
      3. Restart primary - verify recovery
      4. Send request - verify routing to recovered primary
    Expected Result: Sequential failure handled, recovery works
    Evidence: .sisyphus/evidence/task-11-sequential-fail.{ext}
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `test(failover): add 2-server cascade failover tests`
  - Files: `tests/integration/failover-2-server.test.ts`

---

- [ ] 12. Failover - 5 Server Partial Failure

  **What to do**:
  - Create `tests/integration/failover-5-server.test.ts`
  - Test failover with 5 servers and partial failures:
    - 2 of 5 servers fail → verify routing to healthy 3
    - 3 of 5 servers fail → verify graceful degradation
    - 4 of 5 servers fail → verify last server handles load
    - All 5 fail → verify proper error response
    - Partial recovery (2 of 5 restored) → verify redistribution
    - Weighted load distribution under partial failure

  **Must NOT do**:
  - Test with fewer than 5 servers
  - Test full network partition (that's Task 15)

  **Recommended Agent Profile**:
  > - **Category**: `deep` - Complex multi-server testing
  >   Reason: 5-server coordination, load distribution, graceful degradation
  > - **Skills**: `[]`
  >   - No specific skills needed - follows existing failover patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 10, 11, 13, 14, 15)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `src/orchestrator/orchestrator.ts` - Multi-server failover logic
  - `tests/utils/mock-server-factory.ts` - Fleet creation (createMockServerFleet)

  **Acceptance Criteria**:
  - [ ] 2/5 failure handled with no user-visible impact
  - [ ] 3/5 failure shows graceful degradation
  - [ ] 4/5 failure still serves remaining server
  - [ ] 5/5 failure returns proper error
  - [ ] Partial recovery redistributes load correctly

  **QA Scenarios**:

  ```
  Scenario: 2 of 5 servers fail, requests route to healthy servers
    Tool: Bash
    Preconditions: 5 mock servers configured with healthy status
    Steps:
      1. Send 50 requests - verify distribution across all 5
      2. Kill server 1 and server 2
      3. Send 30 requests
      4. Assert all 30 route to remaining 3 healthy servers
      5. Assert no 503 errors for user requests
    Expected Result: Load redistributes to healthy servers
    Evidence: .sisyphus/evidence/task-12-2-of-5-fail.{ext}

  Scenario: 4 of 5 servers fail, last server handles load
    Tool: Bash
    Preconditions: 5 mock servers configured
    Steps:
      1. Kill servers 1-4, leaving only server 5
      2. Send 20 concurrent requests
      3. Assert all 20 succeed via server 5
      4. Assert server 5 metrics show increased load
    Expected Result: Single server handles all load gracefully
    Evidence: .sisyphus/evidence/task-12-4-of-5-fail.{ext}
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `test(failover): add 5-server partial failure tests`
  - Files: `tests/integration/failover-5-server.test.ts`

---

- [ ] 13. Failover - Recovery Cycle Tests

  **What to do**:
  - Create `tests/integration/failover-recovery.test.ts`
  - Test recovery cycle behavior:
    - Dead server → recovering → healthy state transitions
    - Health check triggers recovery test
    - Gradual restoration of traffic
    - Recovery failure tracking
    - Automatic vs manual recovery verification
    - Recovery test coordinator behavior

  **Must NOT do**:
  - Test network partition (that's Task 15)
  - Test chaos injection (that's Task 14)

  **Recommended Agent Profile**:
  > - **Category**: `deep` - Recovery state machine testing
  >   Reason: Recovery state transitions, health check coordination
  > - **Skills**: `[]`
  >   - No specific skills needed - recovery testing follows patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 10, 11, 12, 14, 15)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `src/health-check-scheduler.ts` - Health check logic
  - `src/recovery-test-coordinator.ts` - Recovery coordination
  - `tests/integration/recovery-cycle.test.ts` - Existing recovery tests

  **Acceptance Criteria**:
  - [ ] Dead → recovering → healthy transitions work
  - [ ] Health checks correctly identify recovery
  - [ ] Traffic gradually restores to recovered server
  - [ ] Recovery failure tracking works
  - [ ] Auto vs manual recovery behaves correctly

  **QA Scenarios**:

  ```
  Scenario: Server recovers and gradually receives traffic
    Tool: Bash
    Preconditions: Server marked as down, recovery enabled
    Steps:
      1. Verify server is DOWN in orchestrator
      2. Start mock server (recovery simulation)
      3. Wait for health check to pass
      4. Verify server transitions to RECOVERING
      5. Wait for recovery test to complete
      6. Verify server is HEALTHY
      7. Send requests and verify they route to recovered server
    Expected Result: Full recovery cycle with traffic restoration
    Evidence: .sisyphus/evidence/task-13-recovery-cycle.{ext}

  Scenario: Recovery fails and server stays down
    Tool: Bash
    Preconditions: Server marked as down
    Steps:
      1. Start mock server that fails health checks
      2. Verify recovery test fails multiple times
      3. Verify server stays DOWN
      4. Verify recovery failure stats are recorded
    Expected Result: Failed recovery correctly tracked
    Evidence: .sisyphus/evidence/task-13-recovery-failure.{ext}
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `test(failover): add recovery cycle tests`
  - Files: `tests/integration/failover-recovery.test.ts`

---

- [ ] 14. Chaos - Random Failure Injection

  **What to do**:
  - Create `tests/chaos/chaos-random-failure.test.ts`
  - Test with random failure injection:
    - Random server kills during request processing
    - Random latency spikes
    - Random connection drops
    - Random 5xx errors
    - Verify system handles chaos gracefully
    - Verify failover happens correctly under chaos
    - Verify no requests are lost

  **Must NOT do**:
  - Target production services
  - Run chaos tests continuously (they're for verification)

  **Recommended Agent Profile**:
  > - **Category**: `deep` - Chaos engineering testing
  >   Reason: Random failure scenarios, system resilience verification
  > - **Skills**: `[]`
  >   - No specific skills needed - chaos testing follows patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 10, 11, 12, 13, 15)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `tests/utils/mock-server-factory.ts` - chaos server type
  - `tests/chaos/circuit-breaker-chaos.test.ts` - Existing chaos patterns
  - `src/orchestrator/orchestrator.ts` - Chaos handling

  **Acceptance Criteria**:
  - [ ] Random server kill handled with failover
  - [ ] Random latency spikes don't cause errors
  - [ ] Random connection drops recovered
  - [ ] Random 5xx errors handled with retry
  - [ ] No request loss under chaos
  - [ ] System stabilizes after chaos stops

  **QA Scenarios**:

  ```
  Scenario: Random server kill during request processing
    Tool: Bash
    Preconditions: 3 mock servers, chaos server active
    Steps:
      1. Send 20 requests with chaos enabled
      2. Chaos server randomly kills backend servers
      3. Verify requests complete (failover works)
      4. Verify final request count matches sent
      5. Verify no 5xx errors exposed to users
    Expected Result: Chaos handled, requests completed via failover
    Evidence: .sisyphus/evidence/task-14-chaos-failure.{ext}

  Scenario: Chaos stops, system stabilizes
    Tool: Bash
    Preconditions: Chaos test ran, system in degraded state
    Steps:
      1. Disable chaos
      2. Wait for recovery
      3. Send 10 requests
      4. Assert all succeed
      5. Assert metrics show stable operation
    Expected Result: System returns to stable operation after chaos
    Evidence: .sisyphus/evidence/task-14-chaos-stabilize.{ext}
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `test(chaos): add random failure injection tests`
  - Files: `tests/chaos/chaos-random-failure.test.ts`

---

- [ ] 15. Chaos - Network Partition Simulation

  **What to do**:
  - Create `tests/chaos/chaos-network-partition.test.ts`
  - Test network partition scenarios:
    - Server becomes unreachable (connection refused)
    - Server timeout (network latency spike to infinity)
    - Partial partition (server can receive but not respond)
    - Partition recovery and reconnection
    - Split-brain prevention
    - Clock skew simulation

  **Must NOT do**:
  - Test actual network infrastructure
  - Simulate partitions for extended periods (causes test timeouts)

  **Recommended Agent Profile**:
  > - **Category**: `deep` - Network failure simulation
  >   Reason: Complex network failure modes, partition detection
  > - **Skills**: `[]`
  >   - No specific skills needed - network chaos follows patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 10, 11, 12, 13, 14)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `tests/utils/mock-server-factory.ts` - partition server type (Task 3)
  - `src/orchestrator/orchestrator.ts` - Partition detection logic

  **Acceptance Criteria**:
  - [ ] Unreachable server detected quickly
  - [ ] Timeout partition detected within timeout window
  - [ ] Partial partition handled gracefully
  - [ ] Partition recovery works correctly
  - [ ] No split-brain behavior observed

  **QA Scenarios**:

  ```
  Scenario: Server becomes unreachable
    Tool: Bash
    Preconditions: Mock server running, partition server ready
    Steps:
      1. Send 5 requests - verify success
      2. Activate partition (connection refused)
      3. Send 5 more requests - verify failover to other servers
      4. Assert no requests hang (partition detected quickly)
    Expected Result: Partition detected, failover happens
    Evidence: .sisyphus/evidence/task-15-unreachable.{ext}

  Scenario: Partition recovery reconnects server
    Tool: Bash
    Preconditions: Server in partition state
    Steps:
      1. Verify server is unreachable
      2. Deactivate partition (restore connection)
      3. Verify health check passes
      4. Verify server returns to healthy state
      5. Verify requests route to recovered server
    Expected Result: Server recovers from partition
    Evidence: .sisyphus/evidence/task-15-recovery.{ext}
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `test(chaos): add network partition simulation tests`
  - Files: `tests/chaos/chaos-network-partition.test.ts`

---

- [ ] 16. Auth - JWT Token Issuance/Validation

  **What to do**:
  - Create `tests/integration/auth-jwt.test.ts`
  - Test JWT token flow:
    - Login with valid credentials returns JWT
    - JWT contains correct claims (userId, roles, exp)
    - Protected endpoints accept valid JWT
    - Expired JWT is rejected
    - Malformed JWT is rejected
    - JWT signature validation (tampering detection)
    - Token refresh mechanism

  **Must NOT do**:
  - Test against production auth services
  - Use hardcoded tokens (use factory-created tokens)

  **Recommended Agent Profile**:
  > - **Category**: `deep` - Auth security testing
  >   Reason: JWT security, token validation edge cases
  > - **Skills**: `[]`
  >   - No specific skills needed - auth testing follows patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 17, 18, 19, 20, 21)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `src/middleware/auth.ts` - JWT middleware (lines 99-178)
  - `src/routes/auth.routes.ts` - Auth routes
  - `tests/integration/api.test.ts` - Existing auth test patterns

  **Acceptance Criteria**:
  - [ ] Valid login returns JWT with correct claims
  - [ ] Protected routes reject missing JWT
  - [ ] Expired JWT returns 401
  - [ ] Tampered JWT returns 401
  - [ ] Token refresh works correctly

  **QA Scenarios**:

  ```
  Scenario: Valid login returns JWT with correct claims
    Tool: Bash
    Preconditions: Integration test server running, test user exists
    Steps:
      1. POST /login with valid credentials { username, password }
      2. Assert response status 200
      3. Assert response has "token" field (JWT)
      4. Decode JWT payload
      5. Assert claims include userId, roles, exp (future expiry)
    Expected Result: JWT with correct claims returned
    Evidence: .sisyphus/evidence/task-16-valid-login.{ext}

  Scenario: Expired JWT is rejected
    Tool: Bash
    Preconditions: Integration test server running
    Steps:
      1. Create JWT with past expiry (exp: Date.now() - 3600000)
      2. POST /api/chat with Authorization: Bearer <expired-token>
      3. Assert response status 401
      4. Assert error message indicates token expired
    Expected Result: Expired token rejected with 401
    Evidence: .sisyphus/evidence/task-16-expired-jwt.{ext}

  Scenario: Tampered JWT is rejected
    Tool: Bash
    Preconditions: Integration test server running
    Steps:
      1. Get valid JWT
      2. Modify payload (change userId)
      3. Send request with modified JWT
      4. Assert response status 401
      5. Assert error indicates signature invalid
    Expected Result: Tampered token rejected
    Evidence: .sisyphus/evidence/task-16-tampered-jwt.{ext}
  ```

  **Commit**: YES (groups with Wave 4)
  - Message: `test(auth): add JWT token issuance/validation tests`
  - Files: `tests/integration/auth-jwt.test.ts`

---

- [ ] 17. Auth - API Key Authentication

  **What to do**:
  - Create `tests/integration/auth-api-key.test.ts`
  - Test API key authentication:
    - Valid API key in header works
    - Valid API key in Authorization Bearer works
    - Invalid API key is rejected
    - Missing API key for protected endpoints
    - Admin API key vs regular API key permissions
    - API key rotation without downtime
    - Multiple API keys support

  **Must NOT do**:
  - Test against real third-party services
  - Use production API keys

  **Recommended Agent Profile**:
  > - **Category**: `deep` - Auth security testing
  >   Reason: API key security, permission boundaries
  > - **Skills**: `[]`
  >   - No specific skills needed - follows existing patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 16, 18, 19, 20, 21)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `src/middleware/auth.ts` - API key handling (lines 33-46, 99-178)
  - `src/config/config.ts` - API key configuration

  **Acceptance Criteria**:
  - [ ] Valid API key grants access
  - [ ] Invalid API key returns 401
  - [ ] Admin key accesses admin endpoints
  - [ ] Regular key cannot access admin endpoints
  - [ ] Missing key returns 401

  **QA Scenarios**:

  ```
  Scenario: Valid API key grants access
    Tool: Bash
    Preconditions: Integration test server running with API key configured
    Steps:
      1. POST /api/chat with X-API-Key: <valid-key>
      2. Assert response status 200 (or valid error, not 401)
      3. Assert request succeeded
    Expected Result: API key authentication successful
    Evidence: .sisyphus/evidence/task-17-valid-key.{ext}

  Scenario: Admin key accesses admin endpoint
    Tool: Bash
    Preconditions: Integration test server with admin API key
    Steps:
      1. POST /api/orchestrator/servers/add with admin API key
      2. Assert response status 200
      3. POST /api/orchestrator/servers/add with regular API key
      4. Assert response status 403 (forbidden)
    Expected Result: Admin key has admin permissions, regular key does not
    Evidence: .sisyphus/evidence/task-17-admin-key.{ext}
  ```

  **Commit**: YES (groups with Wave 4)
  - Message: `test(auth): add API key authentication tests`
  - Files: `tests/integration/auth-api-key.test.ts`

---

- [ ] 18. Auth - Login Page UI Flow

  **What to do**:
  - Create `tests/e2e/auth-login-flow.test.ts`
  - Use Playwright to test login page:
    - Login page renders correctly
    - Form validation (required fields, email format)
    - Login with valid credentials succeeds
    - Login with invalid credentials shows error
    - Redirect after successful login
    - Remember me functionality
    - Logout clears session
    - Protected pages redirect to login when unauthenticated

  **Must NOT do**:
  - Take screenshots (functional assertions only)
  - Test visual regression

  **Recommended Agent Profile**:
  > - **Category**: `visual-engineering` - UI testing with Playwright
  >   Reason: Browser-based UI flow testing
  > - **Skills**: [`playwright`]
  >   - `playwright`: Required for browser automation

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 16, 17, 19, 20, 21)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `frontend/src/pages/Login.tsx` - Login page component
  - `tests/e2e/auth-smoke.test.ts` - Existing auth smoke test patterns

  **Acceptance Criteria**:
  - [ ] Login page loads at /login
  - [ ] Form validation works on empty submit
  - [ ] Valid login redirects to dashboard
  - [ ] Invalid login shows error message
  - [ ] Unauthenticated access redirects to /login

  **QA Scenarios**:

  ```
  Scenario: Login page renders and accepts input
    Tool: Playwright
    Preconditions: Frontend server running, browser available
    Steps:
      1. Navigate to http://localhost:5173/login
      2. Assert page title or heading contains "login" (case-insensitive)
      3. Fill username field with "testuser"
      4. Fill password field with "testpass"
      5. Assert fields have correct values
    Expected Result: Login form renders and accepts input
    Evidence: .sisyphus/evidence/task-18-login-render.{ext}

  Scenario: Valid login redirects to dashboard
    Tool: Playwright
    Preconditions: Frontend server running, test user exists
    Steps:
      1. Navigate to http://localhost:5173/login
      2. Fill valid credentials
      3. Click login button
      4. Wait for navigation
      5. Assert current URL is "/" (dashboard) not "/login"
    Expected Result: Successful login redirects to dashboard
    Evidence: .sisyphus/evidence/task-18-valid-login.{ext}

  Scenario: Invalid login shows error
    Tool: Playwright
    Preconditions: Frontend server running
    Steps:
      1. Navigate to http://localhost:5173/login
      2. Fill invalid credentials (wrong password)
      3. Click login button
      4. Wait for error display
      5. Assert error message visible on page
      6. Assert URL still at /login (no redirect)
    Expected Result: Invalid login shows error, stays on login page
    Evidence: .sisyphus/evidence/task-18-invalid-login.{ext}
  ```

  **Commit**: YES (groups with Wave 4)
  - Message: `test(auth): add login page UI flow tests`
  - Files: `tests/e2e/auth-login-flow.test.ts`

---

- [ ] 19. Auth - Session Expiration/Refresh

  **What to do**:
  - Create `tests/integration/auth-session.test.ts`
  - Test session lifecycle:
    - Session created on login
    - Session expires after configured timeout
    - Expired session redirects to login
    - Session refresh (token refresh) works
    - Multiple concurrent sessions handled
    - Logout invalidates session immediately

  **Must NOT do**:
  - Use production session storage
  - Test actual timing (use mock time or short timeouts)

  **Recommended Agent Profile**:
  > - **Category**: `deep` - Session lifecycle testing
  >   Reason: Session state management, expiration logic
  > - **Skills**: `[]`
  >   - No specific skills needed - session testing follows patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 16, 17, 18, 20, 21)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `src/middleware/auth.ts` - Session handling
  - `src/orchestrator/orchestrator.types.ts` - Session types

  **Acceptance Criteria**:
  - [ ] Session created on login
  - [ ] Expired session returns 401
  - [ ] Session refresh extends session
  - [ ] Logout invalidates session

  **QA Scenarios**:

  ```
  Scenario: Session expires and returns 401
    Tool: Bash
    Preconditions: Integration test server running
    Steps:
      1. Login to get session
      2. Advance time past session expiry (mock time)
      3. Send request with session token
      4. Assert response status 401
    Expected Result: Expired session rejected
    Evidence: .sisyphus/evidence/task-19-session-expiry.{ext}

  Scenario: Logout invalidates session
    Tool: Bash
    Preconditions: Integration test server running, valid session
    Steps:
      1. Login to get session token
      2. POST /logout with session token
      3. Assert logout succeeds
      4. Send request with same session token
      5. Assert response status 401 (session invalidated)
    Expected Result: Logout immediately invalidates session
    Evidence: .sisyphus/evidence/task-19-logout.{ext}
  ```

  **Commit**: YES (groups with Wave 4)
  - Message: `test(auth): add session expiration/refresh tests`
  - Files: `tests/integration/auth-session.test.ts`

---

- [ ] 20. Auth - RBAC Permission Enforcement

  **What to do**:
  - Create `tests/integration/auth-rbac.test.ts`
  - Test role-based access control:
    - Admin role can access admin endpoints
    - User role cannot access admin endpoints
    - Viewer role has read-only access
    - Cross-role operations blocked correctly
    - Role hierarchy enforced
    - New role assignments take effect

  **Must NOT do**:
  - Test against production LDAP/SSO
  - Use hardcoded role names (use factory-created roles)

  **Recommended Agent Profile**:
  > - **Category**: `deep` - RBAC security testing
  >   Reason: Permission boundaries, role enforcement
  > - **Skills**: `[]`
  >   - No specific skills needed - RBAC testing follows patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 16, 17, 18, 19, 21)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `src/middleware/auth.ts` - requireAdmin function (lines 184-219)
  - `src/storage/user-store.ts` - User role storage

  **Acceptance Criteria**:
  - [ ] Admin role accesses admin endpoints
  - [ ] User role denied on admin endpoints (403)
  - [ ] Viewer role has read-only access
  - [ ] Unauthenticated request returns 401

  **QA Scenarios**:

  ```
  Scenario: Admin role accesses admin endpoint
    Tool: Bash
    Preconditions: Integration test server running, admin user created
    Steps:
      1. Login as admin user
      2. GET /api/orchestrator/servers (admin endpoint)
      3. Assert response status 200
    Expected Result: Admin user can access admin endpoints
    Evidence: .sisyphus/evidence/task-20-admin-access.{ext}

  Scenario: User role denied on admin endpoint
    Tool: Bash
    Preconditions: Integration test server running, regular user created
    Steps:
      1. Login as regular user
      2. POST /api/orchestrator/servers/add (admin endpoint)
      3. Assert response status 403 (forbidden)
    Expected Result: Regular user cannot access admin endpoints
    Evidence: .sisyphus/evidence/task-20-user-denied.{ext}
  ```

  **Commit**: YES (groups with Wave 4)
  - Message: `test(auth): add RBAC permission enforcement tests`
  - Files: `tests/integration/auth-rbac.test.ts`

---

- [ ] 21. Auth - Invalid Credentials Edge Cases

  **What to do**:
  - Create `tests/integration/auth-edge-cases.test.ts`
  - Test edge cases for auth:
    - Empty username/password
    - SQL injection attempts in credentials
    - XSS attempts in credentials
    - Very long credentials (buffer overflow prevention)
    - Unicode/special characters in credentials
    - Case sensitivity in usernames
    - Account lockout after failed attempts
    - Timing attack prevention (constant-time comparison)

  **Must NOT do**:
  - Actually exploit vulnerabilities (just verify proper handling)

  **Recommended Agent Profile**:
  > - **Category**: `quick` - Edge case testing with clear outcomes
  >   Reason: Well-defined edge cases, no complex logic
  > - **Skills**: `[]`
  >   - No specific skills needed - edge case testing

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 16, 17, 18, 19, 20)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `src/middleware/auth.ts` - Auth validation
  - `src/storage/user-store.ts` - User validation

  **Acceptance Criteria**:
  - [ ] Empty credentials return 400
  - [ ] SQL injection attempts handled safely (no SQL error exposure)
  - [ ] XSS attempts sanitized (not reflected in response)
  - [ ] Long credentials handled gracefully
  - [ ] Case-sensitive usernames work

  **QA Scenarios**:

  ```
  Scenario: SQL injection in username field
    Tool: Bash
    Preconditions: Integration test server running
    Steps:
      1. POST /login with username: "admin' OR '1'='1"
      2. Assert response status 400 or 401 (not 500)
      3. Assert response does not contain SQL error message
    Expected Result: SQL injection attempted but not executed
    Evidence: .sisyphus/evidence/task-21-sql-injection.{ext}

  Scenario: Empty credentials return 400
    Tool: Bash
    Preconditions: Integration test server running
    Steps:
      1. POST /login with body { username: "", password: "" }
      2. Assert response status 400
      3. Assert error message indicates validation failure
    Expected Result: Empty credentials rejected with validation error
    Evidence: .sisyphus/evidence/task-21-empty-creds.{ext}
  ```

  **Commit**: YES (groups with Wave 4)
  - Message: `test(auth): add invalid credentials edge case tests`
  - Files: `tests/integration/auth-edge-cases.test.ts`

---

- [ ] 22. Data - Migration Tests

  **What to do**:
  - Create `tests/integration/data-migration.test.ts`
  - Test database migrations:
    - Fresh migration from empty database
    - Migration from previous schema version
    - Migration preserves existing data
    - Migration rollback on failure
    - Concurrent migration prevention
    - Migration idempotency (running twice doesn't break)

  **Must NOT do**:
  - Test against production database
  - Use real data in migrations

  **Recommended Agent Profile**:
  > - **Category**: `deep` - Database migration testing
  >   Reason: Schema evolution, data preservation
  > - **Skills**: `[]`
  >   - No specific skills needed - migration testing follows patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with Tasks 23, 24, 25, 26, 27, 28, 29, 30)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `src/storage/schema.ts` - Database schema and migrations (522 lines)
  - `src/storage/operational-store.ts` - Storage initialization

  **Acceptance Criteria**:
  - [ ] Fresh database migration succeeds
  - [ ] Existing data preserved during migration
  - [ ] Migration handles schema changes correctly
  - [ ] Failed migration doesn't corrupt database

  **QA Scenarios**:

  ```
  Scenario: Fresh database migration creates all tables
    Tool: Bash
    Preconditions: Empty test database, migration scripts available
    Steps:
      1. Run migration on empty database
      2. Query sqlite_master for table names
      3. Assert all expected tables exist (requests, decisions, users, etc.)
    Expected Result: All tables created correctly
    Evidence: .sisyphus/evidence/task-22-fresh-migration.{ext}

  Scenario: Migration preserves existing data
    Tool: Bash
    Preconditions: Database with existing data (old schema)
    Steps:
      1. Create database with some data in old schema
      2. Run migration
      3. Verify data still exists
      4. Verify data is accessible in new schema format
    Expected Result: Existing data preserved and accessible
    Evidence: .sisyphus/evidence/task-22-data-preserved.{ext}
  ```

  **Commit**: YES (groups with Wave 5)
  - Message: `test(data): add database migration tests`
  - Files: `tests/integration/data-migration.test.ts`

---

- [ ] 23. Data - Concurrent Write Consistency

  **What to do**:
  - Create `tests/integration/data-concurrent-writes.test.ts`
  - Test concurrent write scenarios:
    - Multiple simultaneous requests write metrics
    - Concurrent server registration
    - Concurrent decision logging
    - Concurrent user operations
    - Write conflicts resolution
    - Database lock handling (SQLite limitations)
    - Connection pool behavior under load

  **Must NOT do**:
  - Test against PostgreSQL (SQLite only for this project)
  - Use production data

  **Recommended Agent Profile**:
  > - **Category**: `deep` - Concurrency testing
  >   Reason: Race conditions, database locking, consistency
  > - **Skills**: `[]`
  >   - No specific skills needed - concurrent testing follows patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with Tasks 22, 24, 25, 26, 27, 28, 29, 30)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `src/storage/metrics-store.ts` - Metrics persistence
  - `src/storage/operational-store.ts` - Operational data storage
  - `src/request-history.ts` - Request logging

  **Acceptance Criteria**:
  - [ ] 50 concurrent writes complete without data loss
  - [ ] No write conflicts cause errors
  - [ ] Database locks handled correctly
  - [ ] Final state is consistent

  **QA Scenarios**:

  ```
  Scenario: 50 concurrent metric writes
    Tool: Bash
    Preconditions: Integration test with database initialized
    Steps:
      1. Launch 50 parallel requests that each write metrics
      2. Wait for all to complete
      3. Query metrics count
      4. Assert count equals 50
    Expected Result: All writes completed, no data loss
    Evidence: .sisyphus/evidence/task-23-concurrent-writes.{ext}

  Scenario: Concurrent decision logging is consistent
    Tool: Bash
    Preconditions: Integration test with database initialized
    Steps:
      1. Send 20 parallel requests (triggering decision logging)
      2. Query decision table
      3. Assert 20 decisions recorded
      4. Verify decision integrity (all required fields)
    Expected Result: All decisions recorded correctly
    Evidence: .sisyphus/evidence/task-23-decision-consistency.{ext}
  ```

  **Commit**: YES (groups with Wave 5)
  - Message: `test(data): add concurrent write consistency tests`
  - Files: `tests/integration/data-concurrent-writes.test.ts`

---

- [ ] 24. Data - Metrics Aggregation Accuracy

  **What to do**:
  - Create `tests/integration/data-metrics-accuracy.test.ts`
  - Test metrics aggregation correctness:
    - Request count aggregation
    - Error rate calculation
    - Latency percentiles (P50, P95, P99)
    - TTFT (Time to First Token) tracking
    - Throughput calculation
    - Metrics decay over time
    - Aggregation across multiple servers

  **Must NOT do**:
  - Compare against external metrics systems
  - Use time-based assertions (use mock time)

  **Recommended Agent Profile**:
  > - **Category**: `deep` - Metrics calculation testing
  >   Reason: Complex aggregation logic, statistical accuracy
  > - **Skills**: `[]`
  >   - No specific skills needed - metrics testing follows patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with Tasks 22, 23, 25, 26, 27, 28, 29, 30)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `src/metrics/metrics-aggregator.ts` - Metrics aggregation logic
  - `src/metrics/prometheus-exporter.ts` - Prometheus export

  **Acceptance Criteria**:
  - [ ] Request count accurate after aggregation
  - [ ] Error rate calculation matches expected
  - [ ] Latency percentiles calculated correctly
  - [ ] TTFT tracking accurate
  - [ ] Decay function works correctly

  **QA Scenarios**:

  ```
  Scenario: Error rate calculation accuracy
    Tool: Bash
    Preconditions: Integration test with mock server
    Steps:
      1. Send 10 requests, 3 of which fail
      2. Query error rate metric
      3. Assert error rate is 30% (3/10)
    Expected Result: Error rate calculated correctly
    Evidence: .sisyphus/evidence/task-24-error-rate.{ext}

  Scenario: Latency percentile calculation
    Tool: Bash
    Preconditions: Integration test with mock server
    Steps:
      1. Send requests with known latencies [100, 200, 300, 400, 500]ms
      2. Query P95 latency
      3. Assert P95 is approximately 500ms (within 10% tolerance)
    Expected Result: P95 calculated correctly
    Evidence: .sisyphus/evidence/task-24-p95-latency.{ext}
  ```

  **Commit**: YES (groups with Wave 5)
  - Message: `test(data): add metrics aggregation accuracy tests`
  - Files: `tests/integration/data-metrics-accuracy.test.ts`

---

- [ ] 25. Data - Rollup Calculation Verification

  **What to do**:
  - Create `tests/integration/data-rollup.test.ts`
  - Test hourly and daily rollup calculations:
    - Hourly rollup aggregation is correct
    - Daily rollup aggregation is correct
    - Rollup handles partial hours correctly
    - Rollup handles timezone correctly (UTC)
    - Rollup with missing data points handled
    - Rollup recalculation on data backfill

  **Must NOT do**:
  - Use real-time assertions (rollups happen over time)
  - Test actual cron scheduling

  **Recommended Agent Profile**:
  > - **Category**: `deep` - Time-series data testing
  >   Reason: Time-based aggregation, rollup calculations
  > - **Skills**: `[]`
  >   - No specific skills needed - rollup testing follows patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with Tasks 22, 23, 24, 26, 27, 28, 29, 30)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `src/storage/schema.ts` - Rollup table definitions
  - `src/analytics/analytics-engine.ts` - Rollup generation

  **Acceptance Criteria**:
  - [ ] Hourly rollup matches raw data sum
  - [ ] Daily rollup matches hourly rollup sum
  - [ ] Partial hour rollup is proportional
  - [ ] Missing data doesn't break rollup

  **QA Scenarios**:

  ```
  Scenario: Hourly rollup matches raw data
    Tool: Bash
    Preconditions: Database with raw metrics data
    Steps:
      1. Insert 60 minutes of raw metric data (known values)
      2. Calculate expected hourly sum
      3. Query hourly_rollups table for that hour
      4. Assert rollup value equals expected sum
    Expected Result: Hourly rollup is accurate
    Evidence: .sisyphus/evidence/task-25-hourly-rollup.{ext}

  Scenario: Daily rollup aggregates hourly rollups
    Tool: Bash
    Preconditions: Database with hourly rollups
    Steps:
      1. Insert 24 hourly rollups with known values
      2. Calculate expected daily sum
      3. Query daily_rollups table
      4. Assert daily value equals expected sum
    Expected Result: Daily rollup correctly aggregates hours
    Evidence: .sisyphus/evidence/task-25-daily-rollup.{ext}
  ```

  **Commit**: YES (groups with Wave 5)
  - Message: `test(data): add rollup calculation verification tests`
  - Files: `tests/integration/data-rollup.test.ts`

---

- [ ] 26. Frontend - Page Object Models for All 9 Routes

  **What to do**:
  - Create `tests/e2e/pages/page-objects.ts`
  - Create page object models for all frontend routes:
    - LoginPage
    - DashboardPage
    - ServersPage
    - ModelsPage
    - AnalyticsPage (with all tabs)
    - CircuitBreakersPage
    - LogsPage
    - SettingsPage (with all tabs)
    - InFlightPage
  - Each page object should have selectors and helper methods for common actions

  **Must NOT do**:
  - Create visual tests (page objects are for action abstraction)
  - Add screenshots

  **Recommended Agent Profile**:
  > - **Category**: `visual-engineering` - Page object pattern for Playwright
  >   Reason: UI automation structure, page interaction patterns
  > - **Skills**: [`playwright`]
  >   - `playwright`: Required for page object implementation

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with Tasks 22, 23, 24, 25, 27, 28, 29, 30)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `frontend/src/pages/*.tsx` - All page components
  - `frontend/src/App.tsx` - Route definitions (lines 46-66)

  **Acceptance Criteria**:
  - [ ] Page objects exist for all 9 routes
  - [ ] Each page object has selectors for key elements
  - [ ] Each page object has helper methods (navigate, waitForLoad)
  - [ ] Page objects are used by other frontend tests

  **QA Scenarios**:

  ```
  Scenario: Page objects correctly identify page elements
    Tool: Playwright
    Preconditions: Frontend running, page objects created
    Steps:
      1. Import DashboardPage from page objects
      2. Navigate to /
      3. Use DashboardPage.getServerCountSelector()
      4. Assert selector finds element
    Expected Result: Page object selectors work correctly
    Evidence: .sisyphus/evidence/task-26-page-objects.{ext}
  ```

  **Commit**: YES (groups with Wave 5)
  - Message: `test(frontend): add page object models for all routes`
  - Files: `tests/e2e/pages/page-objects.ts`

---

- [ ] 27. Frontend - Navigation Flow Tests

  **What to do**:
  - Create `tests/e2e/navigation-flows.test.ts`
  - Test navigation between pages:
    - Sidebar navigation to all pages
    - Breadcrumb navigation
    - Browser back/forward buttons
    - Deep linking to specific pages
    - Protected page access (redirect to login)
    - Tab navigation within multi-tab pages (Analytics, Settings)

  **Must NOT do**:
  - Test visual rendering (test navigation, not appearance)

  **Recommended Agent Profile**:
  > - **Category**: `visual-engineering` - Navigation testing with Playwright
  >   Reason: Browser navigation, route handling
  > - **Skills**: [`playwright`]
  >   - `playwright`: Required for browser navigation testing

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with Tasks 22, 23, 24, 25, 26, 28, 29, 30)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `frontend/src/components/Layout.tsx` - Main layout with sidebar
  - `frontend/src/App.tsx` - Route configuration

  **Acceptance Criteria**:
  - [ ] Sidebar links navigate to correct pages
  - [ ] Browser back/forward work correctly
  - [ ] Deep links work (e.g., /servers directly)
  - [ ] Protected pages redirect to login when unauthenticated
  - [ ] Tab navigation within multi-tab pages works

  **QA Scenarios**:

  ```
  Scenario: Sidebar navigation to Servers page
    Tool: Playwright
    Preconditions: Logged in, on Dashboard
    Steps:
      1. Click sidebar Servers link
      2. Wait for URL to be /servers
      3. Assert Servers page content is visible
    Expected Result: Navigation to Servers page works
    Evidence: .sisyphus/evidence/task-27-sidebar-nav.{ext}

  Scenario: Browser back button returns to previous page
    Tool: Playwright
    Preconditions: Logged in, navigated to /servers
    Steps:
      1. Navigate to /servers
      2. Click link to /models
      3. Click browser back button
      4. Assert URL is /servers
      5. Assert page content is correct
    Expected Result: Back button navigates correctly
    Evidence: .sisyphus/evidence/task-27-back-button.{ext}

  Scenario: Deep link to protected page redirects to login
    Tool: Playwright
    Preconditions: Not logged in
    Steps:
      1. Navigate directly to /servers
      2. Assert URL is /login (redirected)
      3. Assert login page is visible
    Expected Result: Protected page redirects to login
    Evidence: .sisyphus/evidence/task-27-deep-link.{ext}
  ```

  **Commit**: YES (groups with Wave 5)
  - Message: `test(frontend): add navigation flow tests`
  - Files: `tests/e2e/navigation-flows.test.ts`

---

- [ ] 28. Frontend - Form Validation Tests

  **What to do**:
  - Create `tests/e2e/forms-validation.test.ts`
  - Test form submissions and validation:
    - Add server form (url, type, maxConcurrency)
    - Model warmup form (model selection, server selection)
    - Config update forms
    - Search/filter forms
    - Form validation (required fields, format validation)
    - Error states for invalid input
    - Success states for valid submission

  **Must NOT do**:
  - Test actual backend operations (mock the API responses)

  **Recommended Agent Profile**:
  > - **Category**: `visual-engineering` - Form testing with Playwright
  >   Reason: Form interactions, validation UI
  > - **Skills**: [`playwright`]
  >   - `playwright`: Required for form testing

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with Tasks 22, 23, 24, 25, 26, 27, 29, 30)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `frontend/src/pages/Servers.tsx` - Server management page with forms
  - `frontend/src/pages/Models.tsx` - Model management forms

  **Acceptance Criteria**:
  - [ ] Add server form validates URL format
  - [ ] Required fields show error when empty
  - [ ] Valid form submission succeeds
  - [ ] API error shows user-friendly message
  - [ ] Loading state during submission

  **QA Scenarios**:

  ```
  Scenario: Add server form validates URL format
    Tool: Playwright
    Preconditions: Logged in, on Servers page
    Steps:
      1. Click "Add Server" button
      2. Fill URL with invalid value "not-a-url"
      3. Submit form
      4. Assert validation error appears
    Expected Result: Invalid URL rejected with validation message
    Evidence: .sisyphus/evidence/task-28-url-validation.{ext}

  Scenario: Empty required field shows error
    Tool: Playwright
    Preconditions: Logged in, on Servers page
    Steps:
      1. Click "Add Server" button
      2. Leave URL field empty
      3. Submit form
      4. Assert error message indicates URL is required
    Expected Result: Empty field shows required validation error
    Evidence: .sisyphus/evidence/task-28-empty-field.{ext}

  Scenario: Valid form submission succeeds
    Tool: Playwright
    Preconditions: Logged in, on Servers page, mock API configured
    Steps:
      1. Click "Add Server" button
      2. Fill valid URL and type
      3. Submit form
      4. Wait for success
      5. Assert server appears in list
    Expected Result: Valid form submission adds server
    Evidence: .sisyphus/evidence/task-28-valid-submit.{ext}
  ```

  **Commit**: YES (groups with Wave 5)
  - Message: `test(frontend): add form validation tests`
  - Files: `tests/e2e/forms-validation.test.ts`

---

- [ ] 29. Frontend - Modal/Interaction Tests

  **What to do**:
  - Create `tests/e2e/modals-interactions.test.ts`
  - Test modal dialogs and interactions:
    - Confirmation dialogs (delete server, clear logs)
    - Modal overlays (model manager, server details)
    - Toast notifications (success, error, warning)
    - Dropdown menus
    - Keyboard navigation (Tab, Enter, Escape)
    - Loading spinners and progress indicators

  **Must NOT do**:
  - Test visual appearance (test functionality only)

  **Recommended Agent Profile**:
  > - **Category**: `visual-engineering` - Modal/interaction testing with Playwright
  >   Reason: UI interaction patterns, modal dialogs
  > - **Skills**: [`playwright`]
  >   - `playwright`: Required for modal interaction testing

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with Tasks 22, 23, 24, 25, 26, 27, 28, 30)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `frontend/src/components/Modal.tsx` - Modal component
  - `frontend/src/components/Toaster.tsx` - Toast notification component

  **Acceptance Criteria**:
  - [ ] Delete confirmation modal appears
  - [ ] Escape key closes modal
  - [ ] Toast notifications appear for actions
  - [ ] Loading spinner shows during async operations
  - [ ] Keyboard navigation works

  **QA Scenarios**:

  ```
  Scenario: Delete server shows confirmation modal
    Tool: Playwright
    Preconditions: Logged in, on Servers page with servers
    Steps:
      1. Click delete button on a server row
      2. Assert confirmation modal appears
      3. Assert modal has Cancel and Confirm buttons
    Expected Result: Confirmation modal appears
    Evidence: .sisyphus/evidence/task-29-delete-modal.{ext}

  Scenario: Escape key closes modal
    Tool: Playwright
    Preconditions: Modal is open
    Steps:
      1. Press Escape key
      2. Assert modal is closed
      3. Assert previous page state unchanged
    Expected Result: Escape closes modal
    Evidence: .sisyphus/evidence/task-29-escape-key.{ext}

  Scenario: Toast appears after action
    Tool: Playwright
    Preconditions: Logged in, action available
    Steps:
      1. Perform action that should show toast (e.g., delete)
      2. Assert toast appears with success message
      3. Wait and assert toast disappears
    Expected Result: Toast notification appears and auto-dismisses
    Evidence: .sisyphus/evidence/task-29-toast.{ext}
  ```

  **Commit**: YES (groups with Wave 5)
  - Message: `test(frontend): add modal and interaction tests`
  - Files: `tests/e2e/modals-interactions.test.ts`

---

- [ ] 30. Frontend - Error/Loading State Tests

  **What to do**:
  - Create `tests/e2e/error-loading-states.test.ts`
  - Test error and loading states:
    - Loading spinners on page load
    - Empty states (no servers, no models)
    - Error states (failed to load data)
    - Network error handling
    - Timeout handling in UI
    - Retry mechanisms (manual retry button)
    - 404 page (invalid route)

  **Must NOT do**:
  - Test actual API timeouts (mock them)

  **Recommended Agent Profile**:
  > - **Category**: `visual-engineering` - Error state testing with Playwright
  >   Reason: UI error handling, state management
  > - **Skills**: [`playwright`]
  >   - `playwright`: Required for state testing

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with Tasks 22, 23, 24, 25, 26, 27, 28, 29)
  - **Blocks**: None (Wave 1 complete)
  - **Blocked By**: Wave 1

  **References**:
  - `frontend/src/components/ErrorBoundary.tsx` - Error boundary component
  - `frontend/src/pages/Servers.tsx` - Loading/error state handling

  **Acceptance Criteria**:
  - [ ] Loading spinner shows during data fetch
  - [ ] Empty state shows helpful message
  - [ ] Error state shows retry option
  - [ ] Network error handled gracefully
  - [ ] Invalid route shows 404 page

  **QA Scenarios**:

  ```
  Scenario: Loading state shows spinner
    Tool: Playwright
    Preconditions: Logged in, page with async data load
    Steps:
      1. Navigate to page with loading state
      2. Assert loading spinner is visible immediately
      3. Wait for data to load
      4. Assert spinner disappears
    Expected Result: Loading spinner shows during fetch
    Evidence: .sisyphus/evidence/task-30-loading-spinner.{ext}

  Scenario: Empty state shows helpful message
    Tool: Playwright
    Preconditions: Mock API returns empty list
    Steps:
      1. Navigate to Servers page
      2. Mock API to return empty list
      3. Reload page
      4. Assert "No servers" message appears
      5. Assert "Add Server" call-to-action is visible
    Expected Result: Empty state with helpful message
    Evidence: .sisyphus/evidence/task-30-empty-state.{ext}

  Scenario: Error state with retry button
    Tool: Playwright
    Preconditions: Mock API to fail
    Steps:
      1. Navigate to Servers page
      2. Mock API to return 500 error
      3. Assert error message visible
      4. Assert retry button present
      5. Click retry
      6. Assert page reloads (attempt new fetch)
    Expected Result: Error state with retry option
    Evidence: .sisyphus/evidence/task-30-error-retry.{ext}
  ```

  **Commit**: YES (groups with Wave 5)
  - Message: `test(frontend): add error and loading state tests`
  - Files: `tests/e2e/error-loading-states.test.ts`

---

- [ ] 31. Performance - Load Test Scenarios (uniform/spike)

  **What to do**:
  - Create/extend `tests/performance/load-uniform-spike.test.ts`
  - Implement k6 load test scenarios:
    - Uniform load: constant user load over time
    - Spike load: sudden increase in users
    - Ramps: gradual increase/decrease in load
    - Test with different concurrency levels (10, 50, 100 concurrent)
    - Measure P50, P95, P99 response times
    - Verify no errors under load

  **Must NOT do**:
  - Run against production
  - Use real user data

  **Recommended Agent Profile**:
  > - **Category**: `deep` - Performance testing
  >   Reason: Load simulation, metrics analysis
  > - **Skills**: `[]`
  >   - No specific skills needed - k6 load testing follows patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 6 (with Tasks 32, 33, 34, 35)
  - **Blocks**: Performance tests depend on API reliability (Wave 2)
  - **Blocked By**: Wave 2 and Wave 3

  **References**:
  - `tests/performance/load-test.js` - Existing k6 load test
  - `scripts/unified-load-test.ts` - Unified load testing script

  **Acceptance Criteria**:
  - [ ] Uniform load test completes without errors
  - [ ] Spike load test handles sudden increase
  - [ ] P95 response time < 500ms under normal load
  - [ ] P99 response time < 1s under normal load

  **QA Scenarios**:

  ```
  Scenario: Uniform load test (50 concurrent users)
    Tool: Bash (k6)
    Preconditions: k6 installed, orchestrator running
    Steps:
      1. k6 run tests/performance/load-uniform.js --vus 50 --duration 60s
      2. Parse JSON summary output
      3. Assert P95 < 500ms
      4. Assert error rate < 1%
    Expected Result: Uniform load handled successfully
    Evidence: .sisyphus/evidence/task-31-uniform-load.{ext}

  Scenario: Spike load test
    Tool: Bash (k6)
    Preconditions: k6 installed, orchestrator running
    Steps:
      1. k6 run tests/performance/load-spike.js
      2. Observe ramp-up phase
      3. Assert requests complete during spike
      4. Verify system recovers after spike
    Expected Result: Spike load handled, system recovers
    Evidence: .sisyphus/evidence/task-31-spike-load.{ext}
  ```

  **Commit**: YES (groups with Wave 6)
  - Message: `test(performance): add uniform and spike load scenarios`
  - Files: `tests/performance/load-uniform-spike.test.ts`

---

- [ ] 32. Performance - Stress Test Scenarios

  **What to do**:
  - Create/extend `tests/performance/stress.test.ts`
  - Implement stress test scenarios:
    - Find breaking point (max concurrent users)
    - Test with sustained high load (5+ minutes)
    - Test connection pool exhaustion
    - Test file descriptor limits
    - Test memory behavior under stress
    - Verify graceful degradation at limits

  **Must NOT do**:
  - Actually crash the system (stop before actual damage)

  **Recommended Agent Profile**:
  > - **Category**: `deep` - Performance testing
  >   Reason: Stress testing, boundary analysis
  > - **Skills**: `[]`
  >   - No specific skills needed - stress testing follows patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 6 (with Tasks 31, 33, 34, 35)
  - **Blocks**: None (depends on Wave 2)
  - **Blocked By**: Wave 2

  **References**:
  - `tests/performance/stress-test.js` - Existing stress test pattern
  - `scripts/unified-load-test.ts` - Load testing utilities

  **Acceptance Criteria**:
  - [ ] Breaking point identified (concurrent users that causes errors)
  - [ ] System fails gracefully at limit (no crash, proper errors)
  - [ ] Recovery after stress test
  - [ ] Memory remains stable (no leak)

  **QA Scenarios**:

  ```
  Scenario: Find breaking point
    Tool: Bash (k6)
    Preconditions: k6 installed, orchestrator running
    Steps:
      1. Start stress test at 10 concurrent users
      2. Increment by 10 every minute
      3. Observe error rate
      4. When error rate > 5%, record that as breaking point
      5. Verify system still responds (just with errors)
    Expected Result: Breaking point identified, system graceful
    Evidence: .sisyphus/evidence/task-32-breaking-point.{ext}

  Scenario: Memory leak detection during stress
    Tool: Bash (k6)
    Preconditions: k6 installed, orchestrator running, memory monitoring
    Steps:
      1. Run sustained stress test for 5 minutes
      2. Monitor memory usage before/during/after
      3. Assert memory doesn't grow unbounded
    Expected Result: No memory leak during sustained load
    Evidence: .sisyphus/evidence/task-32-memory-leak.{ext}
  ```

  **Commit**: YES (groups with Wave 6)
  - Message: `test(performance): add stress test scenarios`
  - Files: `tests/performance/stress.test.ts`

---

- [ ] 33. Performance - Soak Test Scenarios

  **What to do**:
  - Create/extend `tests/performance/soak.test.ts`
  - Implement soak test scenarios:
    - Sustained normal load for 30+ minutes
    - Test for memory leaks over time
    - Test for connection leaks
    - Test for file descriptor leaks
    - Verify metrics accuracy after extended run
    - Verify log rotation works

  **Must NOT do**:
  - Run soak tests on every CI run (they're long)
  - Test during production hours

  **Recommended Agent Profile**:
  > - **Category**: `deep` - Long-duration testing
  >   Reason: Extended test duration, stability verification
  > - **Skills**: `[]`
  >   - No specific skills needed - soak testing follows patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 6 (with Tasks 31, 32, 34, 35)
  - **Blocks**: None (depends on Wave 2)
  - **Blocked By**: Wave 2

  **References**:
  - `tests/performance/soak-test.js` - Existing soak test pattern

  **Acceptance Criteria**:
  - [ ] 30-minute soak test completes
  - [ ] No memory growth > 10% during soak
  - [ ] No connection leaks
  - [ ] System stable at end of soak

  **QA Scenarios**:

  ```
  Scenario: 30-minute soak test
    Tool: Bash (k6)
    Preconditions: k6 installed, orchestrator running
    Steps:
      1. Start soak test with normal load (20 concurrent users)
      2. Run for 30 minutes
      3. Monitor memory every 5 minutes
      4. Assert memory growth < 10%
      5. Assert no connection errors
      6. Verify system responds normally at end
    Expected Result: Soak test passes, no leaks detected
    Evidence: .sisyphus/evidence/task-33-soak-test.{ext}
  ```

  **Commit**: YES (groups with Wave 6)
  - Message: `test(performance): add soak test scenarios`
  - Files: `tests/performance/soak.test.ts`

---

- [ ] 34. Integration - Full E2E Workflow Tests

  **What to do**:
  - Create `tests/e2e/workflow-full.test.ts`
  - Test complete user workflows:
    - Add server → warmup model → send inference request → verify response
    - Server failure → automatic failover → verify continuity
    - Circuit breaker open → recovery → verify traffic resumes
    - Login → add server → configure model → send request → logout
  - These are multi-step scenarios that span frontend and backend

  **Must NOT do**:
  - Test against production data
  - Use actual Ollama servers (use mocks)

  **Recommended Agent Profile**:
  > - **Category**: `visual-engineering` - E2E workflow testing
  >   Reason: Multi-step workflows across UI and API
  > - **Skills**: [`playwright`]
  >   - `playwright`: Required for E2E testing

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 6 (with Tasks 31, 32, 33, 35)
  - **Blocks**: Depends on Wave 4 (auth) and Wave 2 (API)
  - **Blocked By**: Wave 4, Wave 2

  **References**:
  - `tests/e2e/exhaustive-evaluation.test.ts` - Existing E2E test patterns
  - `tests/e2e/api.test.ts` - E2E API testing patterns

  **Acceptance Criteria**:
  - [ ] Add server workflow works end-to-end
  - [ ] Failover workflow works automatically
  - [ ] Circuit breaker recovery works
  - [ ] Complete user session works (login to logout)

  **QA Scenarios**:

  ```
  Scenario: Add server → warmup → inference workflow
    Tool: Playwright
    Preconditions: Logged in, orchestrator running with mock servers
    Steps:
      1. Navigate to /servers
      2. Click Add Server
      3. Fill server URL and type
      4. Submit and verify server added
      5. Navigate to /models
      6. Select server and model, click warmup
      7. Wait for warmup complete
      8. Send inference request via API
      9. Assert response received successfully
    Expected Result: Complete workflow from add to inference
    Evidence: .sisyphus/evidence/task-34-full-workflow.{ext}

  Scenario: Server failure triggers automatic failover
    Tool: Playwright + API
    Preconditions: Two servers configured, primary healthy
    Steps:
      1. Send 10 inference requests (verify all go to primary)
      2. Kill primary server (simulate via chaos)
      3. Send 5 more inference requests
      4. Verify requests went to secondary (failover worked)
      5. Assert no user-visible errors
    Expected Result: Automatic failover without user interruption
    Evidence: .sisyphus/evidence/task-34-failover-workflow.{ext}
  ```

  **Commit**: YES (groups with Wave 6)
  - Message: `test(integration): add full E2E workflow tests`
  - Files: `tests/e2e/workflow-full.test.ts`

---

- [ ] 35. Integration - Cross-Component Integration

  **What to do**:
  - Create `tests/integration/integration-cross-component.test.ts`
  - Test interactions between components:
    - Load balancer + circuit breaker interaction
    - Health check scheduler + recovery coordinator interaction
    - Metrics aggregator + persistence + analytics engine
    - Request history + decision history + analytics
    - Model manager + server models controller interaction

  **Must NOT do**:
  - Test individual component behavior (that's Wave 2-5)
  - Test third-party integrations

  **Recommended Agent Profile**:
  > - **Category**: `deep` - Component integration testing
  >   Reason: Cross-component interactions, state coordination
  > - **Skills**: `[]`
  >   - No specific skills needed - integration testing follows patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 6 (with Tasks 31, 32, 33, 34)
  - **Blocks**: None (depends on Wave 2, 3)
  - **Blocked By**: Wave 2, Wave 3

  **References**:
  - `src/orchestrator/orchestrator.ts` - Component orchestration
  - `src/load-balancer/load-balancer.ts` - Load balancer
  - `src/circuit-breaker/circuit-breaker.ts` - Circuit breaker

  **Acceptance Criteria**:
  - [ ] Load balancer respects circuit breaker state
  - [ ] Health checks trigger recovery correctly
  - [ ] Metrics flow from collection through aggregation to persistence
  - [ ] Analytics shows accurate data from multiple sources

  **QA Scenarios**:

  ```
  Scenario: Load balancer respects circuit breaker open state
    Tool: Bash
    Preconditions: Circuit breaker in OPEN state for server
    Steps:
      1. Verify circuit breaker is OPEN for server A
      2. Send inference request
      3. Verify request does NOT go to server A (circuit open)
      4. Verify request goes to healthy server B
    Expected Result: Load balancer excludes circuit-open servers
    Evidence: .sisyphus/evidence/task-35-lb-cb-interaction.{ext}

  Scenario: Health check triggers recovery test
    Tool: Bash
    Preconditions: Server in DOWN state, health check due
    Steps:
      1. Verify server is DOWN
      2. Start mock server (recovery candidate)
      3. Trigger health check manually
      4. Verify recovery test starts
      5. Verify server transitions to RECOVERING
    Expected Result: Health check triggers recovery coordination
    Evidence: .sisyphus/evidence/task-35-health-recovery.{ext}
  ```

  **Commit**: YES (groups with Wave 6)
  - Message: `test(integration): add cross-component integration tests`
  - Files: `tests/integration/integration-cross-component.test.ts`

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
>
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback → fix → re-run → present again → wait for okay.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search for forbidden patterns. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + linter + tests. Review all test files for: proper assertions, no flaky sleeps, proper cleanup, realistic mock data. Check AI slop: excessive comments, over-abstraction.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps. Verify coverage. Save evidence to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Coverage [N%] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built, nothing beyond spec. Check "Must NOT do" compliance. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `test(infrastructure): add test registry and data factories`
- **Wave 2**: `test(api): add API reliability tests for all endpoints`
- **Wave 3**: `test(failover): add failover and chaos resilience tests`
- **Wave 4**: `test(auth): add authentication flow tests`
- **Wave 5**: `test(data): add data consistency tests` + `test(frontend): add Playwright page tests`
- **Wave 6**: `test(performance): add load/stress/soak scenarios` + `test(integration): add E2E workflow tests`
- **CI**: `ci(tests): add tiered test execution in CI/CD`

---

## Success Criteria

### Verification Commands
```bash
npm run test:unit        # Should pass all unit tests
npm run test:integration # Should pass all integration tests
npm run test:e2e         # Should pass all Playwright tests
npm run test:load        # Should pass all k6 scenarios
npm run test:chaos       # Should pass all chaos tests (with expected failures logged)
```

### Final Checklist
- [ ] All 6 areas covered with ≥80% code path coverage
- [ ] 180+ tests/scenarios implemented
- [ ] All tests idempotent and independently executable
- [ ] Test execution time < 45 minutes full suite
- [ ] CI/CD tiered execution configured
- [ ] No hardcoded timestamps or time-dependent assertions
- [ ] All test data uses factory pattern
- [ ] Evidence files captured for all QA scenarios