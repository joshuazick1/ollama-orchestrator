# Resilience Implementation Plan

**Date:** 2026-03-02
**Status:** Ready for Execution
**Design Reference:** [`docs/DESIGN-resilience-timeout-circuitbreaker.md`](./DESIGN-resilience-timeout-circuitbreaker.md)
**Covers:** 74 recommendations (REC-1 through REC-74) across 9 implementation waves

---

## Table of Contents

1. [Overview](#1-overview)
2. [Branch & PR Strategy](#2-branch--pr-strategy)
3. [Testing Strategy](#3-testing-strategy)
4. [CI/CD Pipeline Enhancements](#4-cicd-pipeline-enhancements)
5. [Wave 0: Dead Code Removal](#5-wave-0-dead-code-removal)
6. [Wave 1: Double-Counting & CB Correctness](#6-wave-1-double-counting--cb-correctness)
7. [Wave 2: Timeout & Error Handling](#7-wave-2-timeout--error-handling)
8. [Wave 3: Failover & Routing Correctness](#8-wave-3-failover--routing-correctness)
9. [Wave 4: Streaming & OpenAI Compatibility](#9-wave-4-streaming--openai-compatibility)
10. [Wave 5: Recovery Test Consolidation](#10-wave-5-recovery-test-consolidation)
11. [Wave 6: Metrics & Load Balancer Scoring](#11-wave-6-metrics--load-balancer-scoring)
12. [Wave 7: Debug & Observability](#12-wave-7-debug--observability)
13. [Wave 8: Configuration & Hardening](#13-wave-8-configuration--hardening)
14. [Execution Timeline](#14-execution-timeline)
15. [Risk Register](#15-risk-register)

---

## 1. Overview

This document is the actionable execution plan derived from the analysis in the [DESIGN document](./DESIGN-resilience-timeout-circuitbreaker.md). Each checklist item links back to the specific DESIGN section, recommendation number, and source file/line where the change must be made.

### Dependency Graph

```
         Wave 0 (dead code)  ──────────────────────────────┐
               │                                            │  Can be done
               │                                            │  anytime
         ┌─────┴──────┐                                     │
         ▼            ▼                                     │
    Wave 1          Wave 2  ◄───────────────────────────────┘
   (CB bugs)      (timeouts)
         │            │
         ▼            │
    Wave 3 ◄──────────┘          Wave 4
  (failover)                   (streaming)
         │                         │
         ├─────────────────────────┤
         ▼                         ▼
    Wave 5                    Wave 6
  (recovery)                (metrics)
         │                     │
         ├─────────────────────┤
         ▼                     ▼
    Wave 7                  Wave 8
   (debug)              (hardening)
```

**Parallel tracks:** Waves 0+1+3 (correctness) and Waves 2+4 (timeouts/streaming) can proceed concurrently.

---

## 2. Branch & PR Strategy

### 2.1 Branch Naming Convention

```
resilience/wave-<N>-<short-description>
```

Examples:

- `resilience/wave-0-dead-code-removal`
- `resilience/wave-1-cb-double-counting`
- `resilience/wave-2-timeout-fixes`

### 2.2 PR Workflow Per Wave

Each wave is a single PR to `main`. The workflow for each:

```
1. Create branch from latest main
   $ git checkout main && git pull origin main
   $ git checkout -b resilience/wave-<N>-<description>

2. Implement changes (following the checklist below)

3. Run local validation before push
   $ npm run lint:fix
   $ npm run typecheck
   $ npm run test:unit -- --coverage
   $ npm run test:integration

4. Commit with conventional commits (enforced by commitlint)
   Types: fix, refactor, test, chore, perf
   Scope: Use the subsystem name
   Examples:
     fix(circuit-breaker): remove double model CB recording in requestToServer
     refactor(orchestrator): remove dead queue system
     test(circuit-breaker): add tests for canAttempt vs canExecute

5. Push and open PR
   $ git push -u origin resilience/wave-<N>-<description>
   $ gh pr create --title "fix(resilience): wave N - <description>" \
       --body "## Summary\n<wave description>\n\n## Design Reference\nSee DESIGN doc Sections X-Y, REC-A through REC-B"

6. CI runs automatically (lint, typecheck, unit tests, integration tests)

7. After merge, tag if completing a milestone wave
   $ git tag -a v<version> -m "resilience: wave N complete"
```

### 2.3 Commit Conventions

All commits follow [Conventional Commits](https://www.conventionalcommits.org/) enforced by `.commitlintrc.js`:

| Change Type               | Commit Prefix      | Example                                                 |
| ------------------------- | ------------------ | ------------------------------------------------------- |
| Bug fix (production code) | `fix(scope):`      | `fix(circuit-breaker): remove double failure recording` |
| Dead code removal         | `refactor(scope):` | `refactor(queue): remove unused RequestQueue system`    |
| New test                  | `test(scope):`     | `test(failover): add v1Models matching test`            |
| CI/CD change              | `ci(scope):`       | `ci(workflow): add regression test job`                 |
| Config change             | `chore(scope):`    | `chore(config): add body-read timeout default`          |
| Performance               | `perf(scope):`     | `perf(timeout): use EMA for adaptive timeout decay`     |

### 2.4 Tagging Strategy

| Tag           | When                                        | Trigger                                              |
| ------------- | ------------------------------------------- | ---------------------------------------------------- |
| `v*.*.*-rc.1` | After Wave 1+2+3 merge (critical path)      | Manual. Triggers release workflow for staging deploy |
| `v*.*.*-rc.2` | After Wave 4+5 merge (streaming + recovery) | Manual                                               |
| `v*.*.*`      | After Wave 6+7+8 merge (full release)       | Manual. Triggers full release workflow               |

---

## 3. Testing Strategy

### 3.1 Test Pyramid

```
                    ┌───────────┐
                    │   E2E     │  2 existing + 1 new streaming E2E
                    │ (Playwright│  Slow. Run on PR merge only.
                    │  + k6)    │
                    ├───────────┤
                   │ Integration │  6 existing + 3 new files
                  │   (supertest  │  Real HTTP, mock Ollama servers.
                  │   + Express)  │  Run on every PR.
                  ├───────────────┤
                 │   Unit Tests    │  89 existing + ~15 new files
                │    (vitest)       │  Isolated, fast, mocked deps.
                │    Run on every    │  Coverage thresholds enforced.
                │    commit (local). │
                └────────────────────┘
```

### 3.2 Test File Naming Convention

New test files follow the existing pattern:

| Wave | Test File                            | Type        | Location             |
| ---- | ------------------------------------ | ----------- | -------------------- |
| 1    | `cb-double-counting.test.ts`         | Unit        | `tests/unit/`        |
| 1    | `can-attempt-vs-execute.test.ts`     | Unit        | `tests/unit/`        |
| 2    | `body-read-timeout.test.ts`          | Unit        | `tests/unit/`        |
| 2    | `openai-error-parsing.test.ts`       | Unit        | `tests/unit/`        |
| 3    | `v1-model-matching.test.ts`          | Unit        | `tests/unit/`        |
| 3    | `concurrency-atomicity.test.ts`      | Unit        | `tests/unit/`        |
| 3    | `failover-routing.test.ts`           | Integration | `tests/integration/` |
| 4    | `sse-passthrough.test.ts`            | Unit        | `tests/unit/`        |
| 4    | `openai-streaming.test.ts`           | Integration | `tests/integration/` |
| 5    | `recovery-concurrency-guard.test.ts` | Unit        | `tests/unit/`        |
| 6    | `ollama-duration-fields.test.ts`     | Unit        | `tests/unit/`        |
| 7    | `debug-output.test.ts`               | Unit        | `tests/unit/`        |

### 3.3 Test Categories & What They Validate

#### Unit Tests (per wave)

Each wave must include unit tests that validate:

1. **The bug exists before the fix** (regression anchor) — write a test that demonstrates the broken behavior, then fix the code so the test passes with correct behavior. This prevents reintroduction.
2. **Edge cases** — boundary values, empty inputs, concurrent access patterns
3. **No side-effect leakage** — mocks are properly isolated via `vi.mock()` and `vi.resetModules()`

#### Integration Tests (Waves 3, 4, 9)

Integration tests spin up a real Express server (per `tests/integration/setup.ts`) and validate end-to-end behavior:

1. **Failover integration** (`tests/integration/failover.test.ts` — extend existing) — Add cases for OpenAI model matching, cooldown re-filtering, client disconnect
2. **Streaming integration** (new `tests/integration/openai-streaming.test.ts`) — Mock Ollama server that emits NDJSON and SSE, verify client receives correct SSE format
3. **Routing integration** (new `tests/integration/failover-routing.test.ts`) — Multi-server scenarios with mixed capabilities

#### Chaos Tests (Waves 1, 3)

Extend existing chaos tests (`tests/chaos/`) with:

1. **Double-counting regression** — Rapid fire failures, verify CB opens at exact threshold (not half)
2. **Concurrent concurrency** — Blast N requests at a server with maxConcurrency=M, verify never exceeds M

#### Performance Tests (Wave 4)

Extend k6 load tests for streaming:

1. **SSE passthrough throughput** — Measure latency overhead of passthrough vs current translation
2. **Backpressure behavior** — Slow client with fast upstream, verify memory stays bounded

### 3.4 Coverage Requirements

Current thresholds (from `vitest.config.ts`):

| Metric     | Current Threshold | Target After All Waves |
| ---------- | ----------------- | ---------------------- |
| Lines      | 55%               | 60%                    |
| Functions  | 60%               | 65%                    |
| Branches   | 45%               | 50%                    |
| Statements | 55%               | 60%                    |

**Rule:** Each wave PR must not decrease coverage. Dead code removal (Wave 0) should increase coverage since removed code is excluded from the denominator.

### 3.5 Test Fixtures

Extend `tests/fixtures/index.ts` with:

```typescript
// New fixtures needed for resilience testing
export const mockOpenAIServer = {
  id: 'openai-server-1',
  url: 'http://localhost:11440',
  type: 'ollama' as const,
  healthy: true,
  lastResponseTime: 50,
  models: [] as string[],
  v1Models: ['gpt-4', 'gpt-3.5-turbo'],
  supportsOllama: false,
  supportsV1: true,
  maxConcurrency: 4,
};

export const mockDualCapServer = {
  id: 'dual-server-1',
  url: 'http://localhost:11441',
  type: 'ollama' as const,
  healthy: true,
  lastResponseTime: 50,
  models: ['llama3:latest'],
  v1Models: ['llama3:latest'],
  supportsOllama: true,
  supportsV1: true,
  maxConcurrency: 4,
};

export const openAIErrorResponses = {
  rateLimited: {
    status: 429,
    body: {
      error: { message: 'Rate limit exceeded', type: 'tokens', code: 'rate_limit_exceeded' },
    },
    headers: { 'retry-after': '5' },
  },
  serverError: {
    status: 500,
    body: { error: { message: 'Internal server error', type: 'server_error', code: null } },
  },
};
```

### 3.6 Mock Server Factory

Extend `tests/utils/mock-server-factory.ts` with:

1. **Mock OpenAI SSE server** — Returns `data: {...}\n\n` format with configurable chunks, tool_calls, finish_reason
2. **Mock slow body server** — Returns headers immediately, delays body indefinitely (for body-read timeout testing)
3. **Mock rate-limiting server** — Returns 429 with `Retry-After` header

---

## 4. CI/CD Pipeline Enhancements

### 4.1 Enhanced CI Workflow

Add a regression test job to `.github/workflows/ci.yml` that runs after Wave 1:

```yaml
# Add to .github/workflows/ci.yml after existing jobs
regression-tests:
  runs-on: ubuntu-latest
  needs: build-and-test
  if: github.event_name == 'pull_request'
  steps:
    - name: Checkout code
      uses: actions/checkout@v4

    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'

    - name: Install dependencies
      run: npm ci

    - name: Run chaos tests
      run: npm run test:chaos

    - name: Run circuit breaker load test (short)
      run: npx tsx scripts/circuit-breaker-load-test.ts --duration 30 --concurrency 10
      timeout-minutes: 2
```

### 4.2 Coverage Reporting on PRs

Add coverage diff reporting to PRs:

```yaml
# Add step to build-and-test job after unit tests
- name: Upload coverage report
  if: github.event_name == 'pull_request'
  uses: actions/upload-artifact@v4
  with:
    name: coverage-report-${{ matrix.node-version }}
    path: coverage/
    retention-days: 7
```

### 4.3 Streaming E2E Smoke Test

Add to the Docker build workflow after Wave 4:

```yaml
# Add to .github/workflows/docker-build.yml
- name: Test streaming endpoint
  run: |
    docker run -d --name stream-test -p 5100:5100 ollama-orchestrator:test
    sleep 10
    # Verify /v1/models returns JSON (not HTML)
    curl -sf http://localhost:5100/v1/models | jq .data > /dev/null || exit 1
    # Verify /v1/nonexistent returns OpenAI error format
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5100/v1/nonexistent)
    [ "$STATUS" = "404" ] || [ "$STATUS" = "500" ] || exit 1
    docker stop stream-test && docker rm stream-test
```

### 4.4 Git Actions Per Wave

| Wave  | Before PR                                | CI Must Pass                                    | After Merge                      |
| ----- | ---------------------------------------- | ----------------------------------------------- | -------------------------------- |
| **0** | `npm run typecheck && npm run test:unit` | lint, typecheck, unit tests, build              | Verify coverage increased        |
| **1** | `npm run test:unit -- --coverage`        | lint, typecheck, unit tests, build, integration | Tag `wave-1-complete`            |
| **2** | Same as Wave 1                           | Same + chaos tests                              | None                             |
| **3** | Same + manual `test:integration`         | Same + regression tests                         | Tag `v*-rc.1`, deploy to staging |
| **4** | Same + manual streaming test with curl   | Same + Docker smoke test                        | Tag `wave-4-complete`            |
| **5** | Same                                     | Same                                            | None                             |
| **6** | Same                                     | Same                                            | None                             |
| **7** | Same                                     | Same                                            | Tag `v*-rc.2`, deploy to staging |
| **8** | Same                                     | Same                                            | Tag `v*.*.*`, full release       |

---

## 5. Wave 0: Dead Code Removal

> **Design Reference:** [DESIGN Section 45 (line 3725)](./DESIGN-resilience-timeout-circuitbreaker.md#45-wave-0-dead-code-removal)
> **Branch:** `resilience/wave-0-dead-code-removal`
> **Estimated Effort:** 1-2 hours
> **Risk:** None
> **Depends On:** Nothing
> **Parallel With:** Any wave

### Checklist

- [ ] **0.1 — REC-69: Remove dead `RequestQueue` system**
  - **Design:** [DESIGN REC-69 (line 3456)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-69-remove-dead-queue-system), [Section 37.2 (line 3112)](./DESIGN-resilience-timeout-circuitbreaker.md#372-queue-system-is-dead-code)
  - **Files:**
    - `src/queue/request-queue.ts` — Delete entire file
    - `src/queue/index.ts` — Delete entire file (barrel export)
    - `src/controllers/queueController.ts` — Delete entire file
    - `src/routes/orchestrator.ts` — Remove queue route registrations
    - `src/orchestrator.ts:123` — Remove `RequestQueue` instantiation
  - **Test:** `npm run typecheck` — no compilation errors referencing queue
  - **Commit:** `refactor(queue): remove unused RequestQueue system`

- [ ] **0.2 — REC-70: Remove dead `BackgroundRequestTracker`**
  - **Design:** [DESIGN REC-70 (line 3464)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-70-remove-dead-background-request-tracker), [Section 38.7 (line 3260)](./DESIGN-resilience-timeout-circuitbreaker.md#387-background-request-tracker-is-unused)
  - **Files:**
    - `src/background-request-tracker.ts` — Delete entire file
  - **Test:** `npm run typecheck` — no import errors
  - **Commit:** `refactor(tracking): remove unused BackgroundRequestTracker`

- [ ] **0.3 — REC-15: Remove dead code in `HealthCheckScheduler`**
  - **Design:** [DESIGN REC-15 (line 839)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-15-remove-dead-code-in-healthcheckscheduler)
  - **Files:**
    - `src/health-check-scheduler.ts` — Remove unreachable/dead branches identified in Phase 2
  - **Test:** Existing `tests/unit/health-check-scheduler.test.ts` passes
  - **Commit:** `refactor(health-check): remove dead code branches`

- [ ] **0.4 — REC-18: Remove/tag `IntelligentRecoveryManager`**
  - **Design:** [DESIGN REC-18 (line 882)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-18-integrate-intelligentrecoverymanager), [Section 8.3 (line 643)](./DESIGN-resilience-timeout-circuitbreaker.md#83-intelligentrecoverymanager-unused-potential)
  - **Files:**
    - `src/intelligent-recovery-manager.ts` — Delete entire file (~495 lines)
    - `tests/unit/intelligent-recovery-manager.test.ts` — Delete test file
  - **Test:** `npm run typecheck` — no import errors
  - **Commit:** `refactor(recovery): remove unused IntelligentRecoveryManager`

- [ ] **0.5 — REC-34: Remove unused `tokensPrompt` field**
  - **Design:** [DESIGN REC-34 (line 1635)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-34-remove-or-use-tokensprompt)
  - **Files:**
    - `src/metrics/metrics-aggregator.ts` — Remove `tokensPrompt` from types and storage
  - **Test:** Existing `tests/unit/metrics-aggregator.test.ts` passes
  - **Commit:** `refactor(metrics): remove unused tokensPrompt field`

### Wave 0 Verification

```bash
npm run lint
npm run typecheck
npm run test:unit -- --coverage    # Coverage should INCREASE (less code, same tests)
npm run build
```

### Wave 0 Git Actions

```bash
git checkout main && git pull origin main
git checkout -b resilience/wave-0-dead-code-removal
# ... make changes ...
git add -A && git commit -m "refactor: remove dead code (queue, tracker, recovery manager, tokensPrompt)"
git push -u origin resilience/wave-0-dead-code-removal
gh pr create --title "refactor(resilience): wave 0 - remove dead code" \
  --body "$(cat <<'EOF'
## Summary
Remove 4 dead code systems identified during resilience analysis:
- `RequestQueue` (instantiated but never used)
- `BackgroundRequestTracker` (never imported)
- `IntelligentRecoveryManager` (495 lines, never called)
- Dead `HealthCheckScheduler` branches
- Unused `tokensPrompt` metric field

## Design Reference
See [DESIGN doc Sections 37.2, 38.7, 8.3](docs/DESIGN-resilience-timeout-circuitbreaker.md), REC-15, REC-18, REC-34, REC-69, REC-70

## Impact
~800 lines removed. Zero behavior change. Coverage should increase.
EOF
)"
```

---

## 6. Wave 1: Double-Counting & CB Correctness

> **Design Reference:** [DESIGN Section 46 (line 3744)](./DESIGN-resilience-timeout-circuitbreaker.md#46-wave-1-double-counting--circuit-breaker-correctness)
> **Branch:** `resilience/wave-1-cb-double-counting`
> **Estimated Effort:** 2-3 hours
> **Risk:** Low
> **Depends On:** Nothing
> **Must Complete Before:** Wave 3

### Checklist

- [ ] **1.1 — REC-59: Fix double model CB recording in `requestToServer()`**
  - **Design:** [DESIGN REC-59 (line 3318)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-59-fix-double-model-cb-recording-in-requesttoserver), [Section 35.1 (line 2967)](./DESIGN-resilience-timeout-circuitbreaker.md#351-double-failure-recording-in-requesttoserver)
  - **File:** `src/orchestrator.ts:1790`
  - **Change:** Delete the direct `modelCb.recordFailure()` call. The `this.recordFailure()` on line 1791 already records on both server and model CBs.
  - **Test:** New `tests/unit/cb-double-counting.test.ts`:
    - Verify that after N failures, `failureCount` on the model CB equals N (not 2N)
    - Verify CB opens after exactly `baseFailureThreshold` failures
  - **Commit:** `fix(circuit-breaker): remove duplicate model CB recording in requestToServer`

- [ ] **1.2 — REC-60: Fix double BanManager recording in `handleServerError()`**
  - **Design:** [DESIGN REC-60 (line 3331)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-60-fix-double-banmanager-recording-in-handleservererror), [Section 35.2 (line 2985)](./DESIGN-resilience-timeout-circuitbreaker.md#352-double-failure-recording-in-handleservererror)
  - **File:** `src/orchestrator.ts:2333,2362`
  - **Change:** Remove `this.markFailure()` calls in the `transient` and `default` cases. `this.recordFailure()` already calls `banManager.recordFailure()`.
  - **Test:** Same test file (`cb-double-counting.test.ts`):
    - Verify BanManager failure count equals actual failure count (not 2x)
    - Verify server hits ban threshold at intended count
  - **Commit:** `fix(ban-manager): remove duplicate failure recording in handleServerError`

- [ ] **1.3 — REC-61: Fix rate-limited error backoff classification**
  - **Design:** [DESIGN REC-61 (line 3342)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-61-fix-rate-limited-error-backoff-classification), [Section 35.3 (line 2997)](./DESIGN-resilience-timeout-circuitbreaker.md#353-error-re-classification-divergence)
  - **File:** `src/orchestrator.ts:2506-2526`
  - **Change:** Before the category-based mapping, check if `classification.type === 'rateLimited'` and preserve it as `'rateLimited'` instead of mapping through `ErrorCategory.NETWORK -> 'transient'`.
  - **Test:** Extend `tests/unit/error-classification.test.ts` or new file:
    - Verify "rate limit exceeded" error produces `legacyErrorType = 'rateLimited'`
    - Verify resulting backoff is 5-minute exponential, not 2-minute transient
  - **Commit:** `fix(orchestrator): preserve rate-limited classification in recordFailure`

- [ ] **1.4 — REC-22: Fix `weighted` algorithm CB health passthrough**
  - **Design:** [DESIGN REC-22 (line 1430)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-22-fix-weighted-algorithm-cb-health-passthrough), [Section 15.2 (line 1269)](./DESIGN-resilience-timeout-circuitbreaker.md#152-bug-1521-weighted-algorithm-ignores-circuit-breaker-health)
  - **File:** `src/load-balancer.ts:468`
  - **Change:** Pass actual CB health value instead of `undefined` to the scoring function.
  - **Test:** Extend `tests/unit/load-balancer.test.ts`:
    - Verify `weighted` algorithm receives CB health in scoring
    - Verify server with open CB gets lower score than server with closed CB
  - **Commit:** `fix(load-balancer): pass CB health to weighted algorithm scoring`

- [ ] **1.5 — REC-62: Fix `canExecute()` candidate/execution mismatch**
  - **Design:** [DESIGN REC-62 (line 3359)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-62-fix-canexecute-candidateexecution-mismatch), [Section 36.1 (line 3053)](./DESIGN-resilience-timeout-circuitbreaker.md#361-canexecute-side-effect-causes-candidateexecution-mismatch)
  - **Files:**
    - `src/circuit-breaker.ts:245-310` — Add new `canAttempt()` method: read-only state check that does NOT trigger `open -> half-open` transition
    - `src/orchestrator.ts:3322` — Change `shouldSkipServerModel()` to use `canAttempt()` instead of `canExecute()`
  - **Test:** New `tests/unit/can-attempt-vs-execute.test.ts`:
    - Verify `canAttempt()` returns `true` when open timeout expired but does NOT change state
    - Verify `canExecute()` DOES transition to half-open (existing behavior preserved)
    - Verify a server passes candidate filtering AND execution when open timeout expired
  - **Commit:** `fix(circuit-breaker): add read-only canAttempt to prevent side-effect in filtering`

### Wave 1 Tests — Detailed Specifications

#### `tests/unit/cb-double-counting.test.ts`

```typescript
// Test structure outline
describe('Circuit Breaker Double-Counting Prevention', () => {
  describe('REC-59: Model CB recording', () => {
    it('should record exactly N failures after N requestToServer errors', () => {
      // Setup: Create orchestrator with server, mock fetch to fail
      // Act: Call requestToServer N times
      // Assert: modelCb.getStats().failureCount === N (not 2*N)
    });

    it('should open CB after exactly baseFailureThreshold failures', () => {
      // With threshold=3, verify CB opens after 3 failures, not 2
    });
  });

  describe('REC-60: BanManager recording', () => {
    it('should record single failure in BanManager per handleServerError call', () => {
      // Verify banManager internal count matches actual failure count
    });
  });

  describe('REC-61: Rate-limited classification', () => {
    it('should preserve rateLimited type through recordFailure', () => {
      // Error: "rate limit exceeded"
      // Assert: legacyErrorType === 'rateLimited', not 'transient'
    });
  });
});
```

#### `tests/unit/can-attempt-vs-execute.test.ts`

```typescript
describe('canAttempt vs canExecute', () => {
  it('canAttempt should not transition open -> half-open', () => {
    // Setup: CB in open state, openTimeout expired
    // Act: Call canAttempt()
    // Assert: Returns true, state is still 'open'
  });

  it('canExecute should transition open -> half-open', () => {
    // Setup: CB in open state, openTimeout expired
    // Act: Call canExecute()
    // Assert: Returns true, state is now 'half-open'
  });

  it('server should be reachable when open timeout expires during failover', () => {
    // Setup: Server with expired open timeout
    // Act: Run through candidate filtering + execution
    // Assert: Server is attempted (not filtered-then-rejected)
  });
});
```

### Wave 1 Verification

```bash
npm run lint
npm run typecheck
npm run test:unit -- --run tests/unit/cb-double-counting.test.ts
npm run test:unit -- --run tests/unit/can-attempt-vs-execute.test.ts
npm run test:unit -- --coverage    # Must not decrease
npm run test:integration
```

### Wave 1 Git Actions

```bash
git checkout main && git pull origin main
git checkout -b resilience/wave-1-cb-double-counting
# ... implement items 1.1 through 1.5 with individual commits ...
git push -u origin resilience/wave-1-cb-double-counting
gh pr create --title "fix(resilience): wave 1 - fix CB and ban double-counting" \
  --body "$(cat <<'EOF'
## Summary
- Fix double model CB recording in `requestToServer()` (REC-59)
- Fix double BanManager recording in `handleServerError()` (REC-60)
- Fix rate-limited error re-classification to transient (REC-61)
- Fix `weighted` algorithm receiving `undefined` CB health (REC-22)
- Add read-only `canAttempt()` to prevent side-effect in candidate filtering (REC-62)

## Design Reference
See [DESIGN doc Sections 35-36](docs/DESIGN-resilience-timeout-circuitbreaker.md), REC-22, REC-59-62

## Testing
- New: `tests/unit/cb-double-counting.test.ts`
- New: `tests/unit/can-attempt-vs-execute.test.ts`
- Extended: `tests/unit/load-balancer.test.ts`
- Extended: `tests/unit/error-classification.test.ts`

## Impact
Circuits now open at the intended threshold (3 failures, not 2). Ban thresholds fire at correct counts. Rate-limited servers get proper 5-minute backoff instead of 2-minute retry.
EOF
)"
```

---

## 7. Wave 2: Timeout & Error Handling

> **Design Reference:** [DESIGN Section 47 (line 3773)](./DESIGN-resilience-timeout-circuitbreaker.md#47-wave-2-timeout--error-handling-fixes)
> **Branch:** `resilience/wave-2-timeout-fixes`
> **Estimated Effort:** 3-4 hours
> **Risk:** Low
> **Depends On:** Nothing (parallel with Wave 1)

### Checklist

- [ ] **2.1 — REC-66/3: Add body-read timeout for non-streaming**
  - **Design:** [DESIGN REC-66 (line 3415)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-66-add-body-read-timeout-for-non-streaming), [DESIGN REC-3 (line 322)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-3-add-response-body-read-timeout), [Section 37.3 (line 3119)](./DESIGN-resilience-timeout-circuitbreaker.md#373-no-body-read-timeout-for-non-streaming)
  - **Files:**
    - `src/controllers/ollamaController.ts` — Wrap `response.json()` calls with `Promise.race()` + timeout (~6 call sites)
    - `src/controllers/openaiController.ts` — Same treatment (~4 call sites)
  - **Test:** New `tests/unit/body-read-timeout.test.ts`:
    - Mock `response.json()` that never resolves
    - Verify timeout fires and rejects with "Body read timeout"
    - Verify normal responses still work within timeout
  - **Commit:** `fix(timeout): add body-read timeout to prevent indefinite blocking`

- [ ] **2.2 — REC-67: Fix timeout monotonicity (Math.max -> EMA)**
  - **Design:** [DESIGN REC-67 (line 3430)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-67-fix-timeout-monotonicity), [Section 37.5 (line 3143)](./DESIGN-resilience-timeout-circuitbreaker.md#375-timeout-monotonicity-bug)
  - **File:** `src/utils/timeout-manager.ts:110`
  - **Change:** Replace `Math.max(baseTimeout, newTimeout)` with EMA: `alpha * newTimeout + (1 - alpha) * currentTimeout`
  - **Test:** Extend `tests/unit/timeout-manager.test.ts`:
    - Verify timeout decreases after a series of fast responses
    - Verify timeout increases after slow responses
    - Verify timeout never drops below `minTimeout`
  - **Commit:** `perf(timeout): use EMA to allow adaptive timeouts to decrease`

- [ ] **2.3 — REC-1/68: Use adaptive timeouts consistently across controllers**
  - **Design:** [DESIGN REC-1 (line 295)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-1-unify-timeout-strategy-across-controllers), [DESIGN REC-68 (line 3444)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-68-use-adaptive-timeouts-consistently), [Section 2.2.1 (line 81)](./DESIGN-resilience-timeout-circuitbreaker.md#issue-221-openai-endpoints-ignore-adaptive-timeouts)
  - **Files:**
    - `src/controllers/ollamaController.ts:924` — Replace hardcoded 30s with `orchestrator.getTimeout(server.id, model)`
    - `src/controllers/openaiController.ts:609` — Replace hardcoded 120s
    - `src/controllers/openaiController.ts:741` — Replace hardcoded 180s
    - `src/controllers/openaiController.ts:1076` — Replace hardcoded 180s
    - `src/controllers/openaiController.ts:1196` — Replace hardcoded 180s
  - **Test:** Extend `tests/unit/openai-controller.test.ts`:
    - Verify OpenAI non-streaming requests use `orchestrator.getTimeout()`
    - Verify embedding requests use `orchestrator.getTimeout()`
  - **Commit:** `fix(timeout): replace hardcoded timeouts with adaptive getTimeout()`

- [ ] **2.4 — REC-2: Add Express server timeouts**
  - **Design:** [DESIGN REC-2 (line 307)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-2-add-express-server-timeouts), [Section 2.2.2 (line 96)](./DESIGN-resilience-timeout-circuitbreaker.md#issue-222-missing-express-server-timeouts)
  - **File:** `src/index.ts` — After `app.listen()` call
  - **Change:** Add `server.keepAliveTimeout = 65000`, `server.headersTimeout = 66000`, `server.requestTimeout = 600000`
  - **Test:** Verify in integration test that server object has correct timeout values
  - **Commit:** `fix(server): add Express keepAlive, headers, and request timeouts`

- [ ] **2.5 — REC-44: Parse OpenAI nested error format**
  - **Design:** [DESIGN REC-44 (line 2629)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-44-parse-openai-error-format), [Section 27.1 (line 2301)](./DESIGN-resilience-timeout-circuitbreaker.md#271-openai-error-format-not-parsed)
  - **File:** `src/utils/ollamaError.ts`
  - **Change:** In `parseOllamaError()` and `parseOllamaErrorGlobal()`, handle `{ error: { message, type, code } }` format
  - **Test:** New `tests/unit/openai-error-parsing.test.ts` (or extend `tests/unit/ollamaError.test.ts`):
    - Input: `'{"error":{"message":"Rate limit exceeded","type":"tokens","code":"rate_limit_exceeded"}}'`
    - Expected: `"HTTP 429: Rate limit exceeded (type=tokens, code=rate_limit_exceeded)"`
    - Verify existing Ollama error format `{ error: "string" }` still works
  - **Commit:** `fix(errors): parse OpenAI nested error format in parseOllamaError`

- [ ] **2.6 — REC-46: Reclassify HTTP 500 for OpenAI backends**
  - **Design:** [DESIGN REC-46 (line 2659)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-46-reclassify-http-500-for-openai-backends), [Section 27.3 (line 2343)](./DESIGN-resilience-timeout-circuitbreaker.md#273-http-500-over-classified-for-openai-backends)
  - **File:** `src/utils/errorClassifier.ts`
  - **Change:** Reclassify HTTP 500 as `transient` (retryable with short backoff) instead of `non-retryable` (48h backoff)
  - **Test:** Extend `tests/unit/errorClassifier.test.ts`:
    - Verify HTTP 500 classified as transient with moderate backoff
    - Verify HTTP 400/401/403 still classified as non-retryable
  - **Commit:** `fix(errors): reclassify HTTP 500 as transient instead of non-retryable`

- [ ] **2.7 — REC-73: Fix OpenAI stall detection vs activity timeout conflict**
  - **Design:** [DESIGN REC-73 (line 3503)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-73-fix-openai-stall-detection-vs-activity-timeout-conflict), [Section 37.4 (line 3128)](./DESIGN-resilience-timeout-circuitbreaker.md#374-stall-threshold-inconsistency)
  - **File:** `src/controllers/openaiController.ts`
  - **Change:** Align stall threshold to be less than activity timeout, or remove redundant OpenAI stall detection
  - **Test:** Extend `tests/unit/openai-controller.test.ts`:
    - Verify stall threshold < activity timeout for OpenAI streaming
  - **Commit:** `fix(streaming): align OpenAI stall detection with activity timeout`

### Wave 2 Verification

```bash
npm run lint
npm run typecheck
npm run test:unit -- --run tests/unit/body-read-timeout.test.ts
npm run test:unit -- --run tests/unit/openai-error-parsing.test.ts
npm run test:unit -- --run tests/unit/timeout-manager.test.ts
npm run test:unit -- --coverage
npm run test:integration
npm run build
```

### Wave 2 Git Actions

```bash
git checkout main && git pull origin main
git checkout -b resilience/wave-2-timeout-fixes
# ... implement items 2.1 through 2.7 with individual commits ...
git push -u origin resilience/wave-2-timeout-fixes
gh pr create --title "fix(resilience): wave 2 - timeout and error handling fixes" \
  --body "$(cat <<'EOF'
## Summary
- Add body-read timeout to all non-streaming response.json() calls (REC-66/3)
- Fix timeout monotonicity: use EMA so timeouts can decrease (REC-67)
- Replace all hardcoded timeouts with adaptive getTimeout() (REC-1/68)
- Add Express server-level timeouts (REC-2)
- Parse OpenAI nested error format { error: { message, type, code } } (REC-44)
- Reclassify HTTP 500 as transient (REC-46)
- Fix stall vs activity timeout conflict for OpenAI (REC-73)

## Design Reference
See [DESIGN doc Sections 2, 27, 37](docs/DESIGN-resilience-timeout-circuitbreaker.md), REC-1-3, REC-44, REC-46, REC-66-68, REC-73
EOF
)"
```

---

## 8. Wave 3: Failover & Routing Correctness

> **Design Reference:** [DESIGN Section 48 (line 3802)](./DESIGN-resilience-timeout-circuitbreaker.md#48-wave-3-failover--routing-correctness)
> **Branch:** `resilience/wave-3-failover-routing`
> **Estimated Effort:** 4-5 hours
> **Risk:** Medium (hot path changes)
> **Depends On:** Wave 1 (correct CB/ban counts)

### Checklist

- [ ] **3.1 — REC-47: Fix model matching for OpenAI servers**
  - **Design:** [DESIGN REC-47 (line 2667)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-47-fix-model-matching-to-use-correct-model-list), [Section 28.1 (line 2361)](./DESIGN-resilience-timeout-circuitbreaker.md#281-tryrequestwithfailover-always-checks-ollama-model-list)
  - **File:** `src/orchestrator.ts:1507`
  - **Change:** `const modelList = requiredCapability === 'openai' ? (s.v1Models ?? []) : s.models;` then use `modelList.includes(model)`
  - **Test:** New `tests/unit/v1-model-matching.test.ts`:
    - Server with `v1Models = ['gpt-4']` and `models = []` selected for OpenAI requests
    - Server with `models = ['llama3']` and `v1Models = []` NOT selected for OpenAI requests
    - Dual-capability server selected for both request types
  - **Commit:** `fix(routing): check v1Models for OpenAI capability in failover`

- [ ] **3.2 — REC-48: Apply `resolveModelName()` in failover path**
  - **Design:** [DESIGN REC-48 (line 2684)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-48-apply-resolvemodelname-in-failover-path), [Section 28.2 (line 2383)](./DESIGN-resilience-timeout-circuitbreaker.md#282-no-latest-resolution-in-failover-path)
  - **File:** `src/orchestrator.ts` (before line 1507)
  - **Change:** Call `resolveModelName()` before model matching, same as `getBestServerForModel()` does
  - **Test:** Extend `tests/unit/v1-model-matching.test.ts`:
    - `model='llama3'` matches server with `models=['llama3:latest']`
  - **Commit:** `fix(routing): resolve model name before failover matching`

- [ ] **3.3 — REC-64: Fix TOCTOU race in concurrency check**
  - **Design:** [DESIGN REC-64 (line 3383)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-64-fix-toctou-race-in-concurrency-check), [Section 38.1 (line 3174)](./DESIGN-resilience-timeout-circuitbreaker.md#381-toctou-race-in-concurrency-check)
  - **Files:**
    - `src/utils/in-flight-manager.ts` or `src/orchestrator.ts` — Add `tryIncrementInFlight(serverId, model, maxConcurrency): boolean` that atomically checks AND increments
    - `src/orchestrator.ts:1596-1604,1898` — Replace check-then-increment with `tryIncrementInFlight()`
  - **Test:** New `tests/unit/concurrency-atomicity.test.ts`:
    - Simulate rapid concurrent `tryIncrementInFlight()` calls
    - Verify in-flight never exceeds maxConcurrency
  - **Commit:** `fix(concurrency): replace TOCTOU check with atomic tryIncrementInFlight`

- [ ] **3.4 — REC-72: Re-filter candidates between Phase 1 and Phase 2**
  - **Design:** [DESIGN REC-72 (line 3488)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-72-re-filter-candidates-between-phases), [Section 34.2 (line 2927)](./DESIGN-resilience-timeout-circuitbreaker.md#342-phase-2-stale-candidate-list)
  - **File:** `src/orchestrator.ts:1631`
  - **Change:** Before Phase 2 loop, re-apply cooldown and ban filters to candidates
  - **Test:** Extend `tests/integration/failover.test.ts`:
    - Server that enters cooldown in Phase 1 is skipped in Phase 2
  - **Commit:** `fix(failover): re-filter candidates between failover phases`

- [ ] **3.5 — REC-71: Differentiate "No servers" error conditions**
  - **Design:** [DESIGN REC-71 (line 3470)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-71-differentiate-no-servers-error-conditions), [Section 38.5 (line 3236)](./DESIGN-resilience-timeout-circuitbreaker.md#385-ambiguous-error-messages)
  - **File:** `src/orchestrator.ts:1571`
  - **Change:** When `candidates.length === 0`, inspect why: model not found, all unhealthy, all circuits open, all banned, or all in cooldown. Return specific error message.
  - **Test:** Extend `tests/unit/orchestrator.test.ts`:
    - Verify each failure condition produces a distinct error message
  - **Commit:** `fix(errors): differentiate no-servers error conditions`

- [ ] **3.6 — REC-52: Populate RoutingContext on error paths**
  - **Design:** [DESIGN REC-52 (line 2726)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-52-populate-routingcontext-on-error-paths), [Section 30.4 (line 2550)](./DESIGN-resilience-timeout-circuitbreaker.md#304-routingcontext-lifecycle)
  - **File:** `src/orchestrator.ts` (`tryRequestWithFailover()`)
  - **Change:** Add `finally` block to populate `routingContext` (serversTried, retryCount, selectedServerId) even on failure
  - **Test:** Extend `tests/unit/debug-info.test.ts`:
    - Verify `routingContext` is populated when request fails
  - **Commit:** `fix(debug): populate RoutingContext on error paths`

- [ ] **3.7 — REC-63: Add client disconnect detection to failover**
  - **Design:** [DESIGN REC-63 (line 3368)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-63-add-client-disconnect-detection-to-failover), [Section 38.6 (line 3252)](./DESIGN-resilience-timeout-circuitbreaker.md#386-no-client-disconnect-detection-in-failover)
  - **File:** `src/orchestrator.ts` (`tryRequestWithFailover()`)
  - **Change:** Add `signal?: AbortSignal` parameter. Check `signal.aborted` between phases and before each server attempt.
  - **Test:** Extend `tests/unit/orchestrator-failover-concurrency.test.ts`:
    - Pass an AbortSignal, abort mid-failover, verify remaining attempts are skipped
  - **Commit:** `fix(failover): add client disconnect detection via AbortSignal`

- [ ] **3.8 — REC-65: Fix `_streamingRequestId` shared mutable state**
  - **Design:** [DESIGN REC-65 (line 3402)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-65-fix-_streamingrequestid-shared-mutable-state), [Section 38.2 (line 3194)](./DESIGN-resilience-timeout-circuitbreaker.md#382-_streamingrequestid-shared-mutable-state)
  - **File:** `src/orchestrator.ts:1904-1905`
  - **Change:** Use a per-request context object or WeakMap instead of mutating the shared server object
  - **Test:** Extend `tests/unit/concurrent-requests.test.ts`:
    - Two concurrent streaming requests to same server have independent request IDs
  - **Commit:** `fix(streaming): use per-request context for streaming request ID`

### Wave 3 Verification

```bash
npm run lint
npm run typecheck
npm run test:unit -- --run tests/unit/v1-model-matching.test.ts
npm run test:unit -- --run tests/unit/concurrency-atomicity.test.ts
npm run test:unit -- --coverage
npm run test:integration
npm run test:chaos   # Especially concurrent scenarios
npm run build
```

### Wave 3 Git Actions

```bash
git checkout main && git pull origin main
git checkout -b resilience/wave-3-failover-routing
# ... implement items 3.1 through 3.8 ...
git push -u origin resilience/wave-3-failover-routing
gh pr create --title "fix(resilience): wave 3 - failover and routing correctness" \
  --body "$(cat <<'EOF'
## Summary
- Fix model matching to check v1Models for OpenAI servers (REC-47)
- Apply resolveModelName() in failover path (REC-48)
- Fix TOCTOU race in concurrency check with atomic tryIncrementInFlight (REC-64)
- Re-filter candidates between failover phases (REC-72)
- Differentiate "no servers" error conditions (REC-71)
- Populate RoutingContext on error paths (REC-52)
- Add client disconnect detection via AbortSignal (REC-63)
- Fix _streamingRequestId shared mutable state (REC-65)

## Design Reference
See [DESIGN doc Sections 28, 34-38](docs/DESIGN-resilience-timeout-circuitbreaker.md), REC-47-48, REC-52, REC-63-65, REC-71-72

## Testing
- New: `tests/unit/v1-model-matching.test.ts`
- New: `tests/unit/concurrency-atomicity.test.ts`
- Extended: `tests/integration/failover.test.ts`
- Extended: `tests/unit/orchestrator-failover-concurrency.test.ts`

## Impact
OpenAI-only servers become selectable. Concurrency limits enforced atomically. Stale candidates filtered between phases. Client disconnects stop wasting GPU compute.
EOF
)"
# After merge:
git checkout main && git pull
git tag -a v1.x.x-rc.1 -m "resilience: waves 0-3 complete (critical path)"
git push origin v1.x.x-rc.1   # Triggers release workflow -> staging deploy
```

---

## 9. Wave 4: Streaming & OpenAI Compatibility

> **Design Reference:** [DESIGN Section 49 (line 3833)](./DESIGN-resilience-timeout-circuitbreaker.md#49-wave-4-streaming--openai-compatibility)
> **Branch:** `resilience/wave-4-streaming-openai`
> **Estimated Effort:** 8-12 hours (largest wave)
> **Risk:** Medium-High (data path changes)
> **Depends On:** None (can develop in parallel with Waves 1-3, test after Wave 3)

### Checklist

- [ ] **4.1 — REC-42: Add backpressure to SSE streaming**
  - **Design:** [DESIGN REC-42 (line 2160)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-42-add-backpressure-to-openai-sse-streaming), [Section 21.6 (line 1902)](./DESIGN-resilience-timeout-circuitbreaker.md#issue-216-no-backpressure-handling-in-sse-streaming)
  - **File:** `src/controllers/openaiController.ts` (`streamOpenAIResponse()`)
  - **Change:** After each `res.write()`, check return value. If `false`, `await new Promise(r => res.once('drain', r))`
  - **Test:** New `tests/unit/sse-passthrough.test.ts`:
    - Mock writable stream that triggers backpressure
    - Verify upstream pauses and resumes correctly
  - **Commit:** `fix(streaming): add backpressure handling to SSE streaming`

- [ ] **4.2 — REC-40: Fix global error handler for `/v1` routes**
  - **Design:** [DESIGN REC-40 (line 2126)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-40-fix-global-error-handler-for-v1-routes), [Section 22.3 (line 1942)](./DESIGN-resilience-timeout-circuitbreaker.md#issue-223-global-error-handler-non-openai-format)
  - **File:** `src/index.ts`
  - **Change:** Detect `/v1` path prefix, return `{ error: { message, type, code } }` format
  - **Test:** Extend integration tests:
    - `POST /v1/chat/completions` with invalid body → OpenAI error format
    - `POST /api/generate` with invalid body → Ollama error format (unchanged)
  - **Commit:** `fix(errors): return OpenAI error format for /v1 routes`

- [ ] **4.3 — REC-41: Exclude `/v1` from SPA fallback**
  - **Design:** [DESIGN REC-41 (line 2147)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-41-exclude-v1-from-spa-fallback), [Section 22.4 (line 1957)](./DESIGN-resilience-timeout-circuitbreaker.md#issue-224-spa-fallback-serves-html-for-unknown-v1-paths)
  - **File:** `src/index.ts`
  - **Change:** Add `/v1` to the path prefix exclusion list (1 line)
  - **Test:** Verify `GET /v1/nonexistent` returns JSON error, not HTML
  - **Commit:** `fix(routing): exclude /v1 paths from SPA fallback`

- [ ] **4.4 — REC-39: Fix `/v1/models` `created` timestamp**
  - **Design:** [DESIGN REC-39 (line 2118)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-39-fix-v1models-created-timestamp), [Section 22.1 (line 1921)](./DESIGN-resilience-timeout-circuitbreaker.md#issue-221-v1models-created-field-uses-milliseconds)
  - **File:** `src/orchestrator.ts:1226`
  - **Change:** `Math.floor(Date.now() / 1000)` — Unix seconds, not milliseconds
  - **Test:** Extend `tests/unit/openai-server-support.test.ts`:
    - Verify `created` field is 10 digits (seconds), not 13 (milliseconds)
  - **Commit:** `fix(openai): use Unix seconds for /v1/models created field`

- [ ] **4.5 — REC-36: Passthrough SSE for `/v1`-capable servers**
  - **Design:** [DESIGN REC-36 (line 2042)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-36-passthrough-sse-for-servers-with-v1-support), [Section 20.3 (line 1786)](./DESIGN-resilience-timeout-circuitbreaker.md#203-proposed-architecture)
  - **Files:**
    - `src/controllers/openaiController.ts` — New `passthroughSSEStream()` function
    - `src/controllers/openaiController.ts` — Branch in `handleChatCompletions`: if `server.supportsV1`, use passthrough; else use NDJSON translation
  - **Implementation details:**
    - Set SSE headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`)
    - Pipe upstream SSE `data:` lines directly to client response
    - Parse each `data:` line for metrics (TTFT, token counts, finish_reason) without modifying bytes
    - Handle `data: [DONE]` sentinel
    - Implement backpressure (per 4.1)
    - Handle upstream close, error, client disconnect
  - **Test:** New `tests/unit/sse-passthrough.test.ts` (extend from 4.1):
    - Mock upstream SSE stream → verify client receives identical bytes
    - Verify metrics extracted from parsed SSE events
    - Verify `data: [DONE]` forwarded as-is
    - Verify stall detection timer resets on each chunk
  - **Test:** New `tests/integration/openai-streaming.test.ts`:
    - Mock Ollama server with `/v1` support → verify end-to-end SSE passthrough
  - **Commit:** `feat(streaming): add SSE passthrough for v1-capable servers`

- [ ] **4.6 — REC-37: Fix NDJSON-to-SSE translation for Ollama-only servers**
  - **Design:** [DESIGN REC-37 (line 2082)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-37-fix-ndjson-to-sse-translation-for-ollama-only-servers), [Section 21.1 (line 1827)](./DESIGN-resilience-timeout-circuitbreaker.md#issue-211-tool-calls-completely-broken-in-streaming)
  - **File:** `src/controllers/openaiController.ts` (`streamOpenAIResponse()`)
  - **Changes:**
    - Extend `OllamaStreamChunk` interface to include `message.tool_calls`
    - Handle `tool_calls` chunks: emit `delta.tool_calls` with `index`, `id`, `type`, incremental `function.arguments`
    - Dynamic `finish_reason`: `'tool_calls'` when tool_calls present, `'stop'` otherwise, `'length'` when truncated
    - Fix `if (content)` guard to also emit when `tool_calls` present but `content` empty
    - Emit role-only first chunk before content begins
  - **Test:** Extend `tests/unit/sse-passthrough.test.ts`:
    - NDJSON with tool_calls → SSE with `delta.tool_calls`
    - finish_reason matches tool_calls/stop/length
    - Empty content with tool_calls still emits chunks
  - **Commit:** `fix(streaming): fix NDJSON-to-SSE translation for tool_calls and finish_reason`

- [ ] **4.7 — REC-38: Fix `/v1/completions` streaming format**
  - **Design:** [DESIGN REC-38 (line 2108)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-38-fix-v1completions-streaming-format), [Section 21.2 (line 1865)](./DESIGN-resilience-timeout-circuitbreaker.md#issue-212-v1completions-streaming-sends-raw-ndjson)
  - **File:** `src/controllers/openaiController.ts`
  - **Change:** Apply passthrough-vs-translate branching to completions (same as chat)
  - **Test:** Extend `tests/integration/openai-streaming.test.ts`:
    - `/v1/completions` streaming returns SSE, not raw NDJSON
  - **Commit:** `fix(streaming): fix /v1/completions to use SSE format`

### Wave 4 Verification

```bash
npm run lint
npm run typecheck
npm run test:unit -- --run tests/unit/sse-passthrough.test.ts
npm run test:unit -- --coverage
npm run test:integration
npm run build

# Manual smoke test with curl:
# curl -N http://localhost:5100/v1/chat/completions \
#   -H "Content-Type: application/json" \
#   -d '{"model":"llama3","messages":[{"role":"user","content":"hi"}],"stream":true}'
# Should see: data: {"id":"...","choices":[...]}\n\ndata: [DONE]\n\n
```

### Wave 4 Git Actions

```bash
git checkout main && git pull origin main
git checkout -b resilience/wave-4-streaming-openai
# ... implement items 4.1 through 4.7 ...
git push -u origin resilience/wave-4-streaming-openai
gh pr create --title "fix(resilience): wave 4 - streaming and OpenAI compatibility" \
  --body "$(cat <<'EOF'
## Summary
- Add backpressure handling to SSE streaming (REC-42)
- Fix global error handler for /v1 routes (REC-40)
- Exclude /v1 from SPA fallback (REC-41)
- Fix /v1/models created timestamp (REC-39)
- Add SSE passthrough for v1-capable servers (REC-36)
- Fix NDJSON-to-SSE translation: tool_calls, finish_reason, role (REC-37)
- Fix /v1/completions streaming format (REC-38)

## Design Reference
See [DESIGN doc Sections 20-24](docs/DESIGN-resilience-timeout-circuitbreaker.md), REC-36-42

## Testing
- New: `tests/unit/sse-passthrough.test.ts`
- New: `tests/integration/openai-streaming.test.ts`
- Extended: `tests/unit/openai-server-support.test.ts`

## Impact
Tool calls work in streaming. SSE format is correct. Slow clients don't cause OOM. Unknown /v1 paths return JSON errors.
EOF
)"
```

---

## 10. Wave 5: Recovery Test Consolidation

> **Design Reference:** [DESIGN Section 50 (line 3877)](./DESIGN-resilience-timeout-circuitbreaker.md#50-wave-5-recovery-test-consolidation)
> **Branch:** `resilience/wave-5-recovery-consolidation`
> **Estimated Effort:** 6-8 hours
> **Risk:** Medium
> **Depends On:** Best done after Waves 1-3

### Checklist

- [ ] **5.1 — REC-13: Add cross-path concurrency guard**
  - **Design:** [DESIGN REC-13 (line 793)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-13-add-cross-path-concurrency-guard), [Section 8.2.1 (line 581)](./DESIGN-resilience-timeout-circuitbreaker.md#conflict-821-two-testing-methods-no-shared-state)
  - **File:** `src/recovery-test-coordinator.ts`
  - **Change:** Single lock/guard that both `performCoordinatedRecoveryTest()` and `runActiveTests()` check before running tests
  - **Test:** New `tests/unit/recovery-concurrency-guard.test.ts`:
    - Two concurrent recovery test attempts for same server — only one runs
    - Second attempt waits or returns early
  - **Commit:** `fix(recovery): add cross-path concurrency guard for recovery tests`

- [ ] **5.2 — REC-16: Extract embedding detection utility**
  - **Design:** [DESIGN REC-16 (line 855)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-16-extract-embedding-detection-utility), [Section 8.5 (line 669)](./DESIGN-resilience-timeout-circuitbreaker.md#85-embedding-model-detection-duplication)
  - **File:** `src/recovery-test-coordinator.ts`
  - **Change:** Extract triplicated inline embedding detection into `isEmbeddingModel(modelName: string): boolean`
  - **Test:** Extend `tests/unit/recovery-test-coordinator.test.ts`:
    - Verify `isEmbeddingModel('nomic-embed-text')` → true
    - Verify `isEmbeddingModel('llama3')` → false
  - **Commit:** `refactor(recovery): extract embedding detection utility`

- [ ] **5.3 — REC-17: Remove 5-second artificial embedding delay**
  - **Design:** [DESIGN REC-17 (line 875)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-17-remove-5-second-embedding-delay), [Section 8.6 (line 682)](./DESIGN-resilience-timeout-circuitbreaker.md#86-the-5-second-embedding-delay-problem)
  - **File:** `src/recovery-test-coordinator.ts:620`
  - **Change:** Delete the artificial 5-second delay
  - **Commit:** `fix(recovery): remove unnecessary 5-second embedding test delay`

- [ ] **5.4 — REC-21: Add test metrics to request-path recovery**
  - **Design:** [DESIGN REC-21 (line 934)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-21-add-test-metrics-to-request-path-recovery)
  - **File:** `src/recovery-test-coordinator.ts` (`performCoordinatedRecoveryTest()`)
  - **Change:** Call `recordTestMetrics()` on completion, matching the active test path
  - **Commit:** `fix(recovery): record test metrics in request-path recovery`

- [ ] **5.5 — REC-19: Add half-open timeout to request path**
  - **Design:** [DESIGN REC-19 (line 904)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-19-add-half-open-timeout-to-request-path)
  - **File:** `src/orchestrator.ts` (`tryRequestOnServerNoRetry()`)
  - **Change:** Add timeout check for stale half-open breakers, matching the active test path logic
  - **Commit:** `fix(recovery): add half-open timeout check to request path`

- [ ] **5.6 — REC-14: Trigger model tests on server recovery**
  - **Design:** [DESIGN REC-14 (line 821)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-14-trigger-model-tests-on-server-recovery)
  - **File:** `src/orchestrator.ts` or `src/health-check-scheduler.ts`
  - **Change:** When recovery check succeeds for unhealthy server, queue model-level active tests
  - **Commit:** `feat(recovery): trigger model tests on server recovery`

- [ ] **5.7 — REC-20: Clear BanManager cooldown on recovery success**
  - **Design:** [DESIGN REC-20 (line 922)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-20-clear-banmanager-cooldown-on-recovery-success)
  - **File:** `src/orchestrator.ts` (recovery success path)
  - **Change:** Call `banManager.clearCooldown()` on successful recovery test
  - **Test:** Extend `tests/unit/ban-manager.test.ts`:
    - Server in cooldown → recovery succeeds → cooldown cleared
  - **Commit:** `fix(recovery): clear BanManager cooldown on successful recovery`

- [ ] **5.8 — REC-11: Unified recovery test entry point (if time permits)**
  - **Design:** [DESIGN REC-11 (line 733)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-11-single-recovery-test-entry-point)
  - **Note:** This is the full refactor. Item 5.1 (cross-path guard) addresses the immediate risk. This item merges `performCoordinatedRecoveryTest()` and `runActiveTests()` into a single method. Can be deferred.
  - **Commit:** `refactor(recovery): unify recovery test entry point`

### Wave 5 Verification

```bash
npm run lint
npm run typecheck
npm run test:unit -- --run tests/unit/recovery-concurrency-guard.test.ts
npm run test:unit -- --run tests/unit/recovery-test-coordinator.test.ts
npm run test:unit -- --coverage
npm run test:integration
```

---

## 11. Wave 6: Metrics & Load Balancer Scoring

> **Design Reference:** [DESIGN Section 51 (line 3906)](./DESIGN-resilience-timeout-circuitbreaker.md#51-wave-6-metrics--load-balancer-scoring)
> **Branch:** `resilience/wave-6-metrics-scoring`
> **Estimated Effort:** 4-5 hours
> **Risk:** Low
> **Depends On:** Wave 1 item 1.4 (REC-22 CB health fix)

### Checklist

- [ ] **6.1 — REC-25: Capture all 6 Ollama duration fields**
  - **Design:** [DESIGN REC-25 (line 1472)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-25-extend-ollamastreamchunk-to-capture-duration-fields), [Section 14.1 (line 1154)](./DESIGN-resilience-timeout-circuitbreaker.md#141-available-vs-captured-fields)
  - **Files:**
    - `src/streaming.ts` — Extend `OllamaStreamChunk` interface with `load_duration`, `prompt_eval_duration`, `prompt_eval_count`, `eval_count`
    - `src/metrics/metrics-aggregator.ts` — Store new fields
  - **Test:** New `tests/unit/ollama-duration-fields.test.ts`:
    - Parse chunk with all 6 fields → verify all captured
  - **Commit:** `feat(metrics): capture all 6 Ollama duration fields`

- [ ] **6.2 — REC-26: Compute and store token throughput (tokens/sec)**
  - **Design:** [DESIGN REC-26 (line 1501)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-26-compute-and-store-token-throughput-tokenssec)
  - **File:** `src/metrics/metrics-aggregator.ts`
  - **Change:** Calculate `eval_count / eval_duration` on each response completion
  - **Test:** Extend `tests/unit/ollama-duration-fields.test.ts`:
    - Verify tokens/sec calculation with known values
  - **Commit:** `feat(metrics): compute token throughput from Ollama duration fields`

- [ ] **6.3 — REC-23: Fix `getLoad` vs `getTotalLoad` parameter**
  - **Design:** [DESIGN REC-23 (line 1445)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-23-fix-getload-vs-gettotalload-parameter), [Section 15.3 (line 1301)](./DESIGN-resilience-timeout-circuitbreaker.md#153-bug-1531-getload-and-gettotalload-receive-identical-functions)
  - **File:** `src/orchestrator.ts`
  - **Change:** Pass correct function to load balancer
  - **Commit:** `fix(load-balancer): pass correct getLoad vs getTotalLoad function`

- [ ] **6.4 — REC-24: Fix `streaming-optimized` sort direction**
  - **Design:** [DESIGN REC-24 (line 1458)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-24-fix-streaming-optimized-sort-direction), [Section 15.4 (line 1322)](./DESIGN-resilience-timeout-circuitbreaker.md#154-bug-1541-streaming-optimized-sort-direction-appears-inverted)
  - **File:** `src/load-balancer.ts:877-878`
  - **Change:** Reverse sort comparison to rank fastest servers first
  - **Test:** Extend `tests/unit/load-balancer.test.ts`:
    - Verify `streaming-optimized` returns fastest server first
  - **Commit:** `fix(load-balancer): fix streaming-optimized sort direction`

- [ ] **6.5 — REC-30: Use `getMetricsWithFallback()` in selection path**
  - **Design:** [DESIGN REC-30 (line 1562)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-30-use-getmetricswithfallback-in-selection-path)
  - **File:** `src/orchestrator.ts`
  - **Change:** Replace `getMetrics()` with `getMetricsWithFallback()` in server selection
  - **Commit:** `fix(metrics): use getMetricsWithFallback in server selection`

- [ ] **6.6 — REC-27: Detect cold starts via `load_duration`**
  - **Design:** [DESIGN REC-27 (line 1519)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-27-detect-and-annotate-cold-starts-via-load_duration)
  - **File:** `src/metrics/metrics-aggregator.ts`
  - **Change:** Flag responses where `load_duration > threshold` as cold starts
  - **Depends On:** Item 6.1 (duration fields)
  - **Commit:** `feat(metrics): detect cold starts via load_duration threshold`

- [ ] **6.7 — REC-28: Use token throughput in `weighted` algorithm**
  - **Design:** [DESIGN REC-28 (line 1531)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-28-use-token-throughput-in-weighted-algorithm)
  - **File:** `src/load-balancer.ts`
  - **Change:** Add throughput factor to weighted server scoring
  - **Depends On:** Item 6.2 (throughput calculation)
  - **Test:** Extend `tests/unit/weighted-selection.test.ts`:
    - Server with higher tokens/sec ranked higher in weighted scoring
  - **Commit:** `feat(load-balancer): include token throughput in weighted scoring`

### Wave 6 Verification

```bash
npm run lint
npm run typecheck
npm run test:unit -- --run tests/unit/ollama-duration-fields.test.ts
npm run test:unit -- --run tests/unit/load-balancer.test.ts
npm run test:unit -- --run tests/unit/weighted-selection.test.ts
npm run test:unit -- --coverage
```

---

## 12. Wave 7: Debug & Observability

> **Design Reference:** [DESIGN Section 52 (line 3934)](./DESIGN-resilience-timeout-circuitbreaker.md#52-wave-7-debug--observability)
> **Branch:** `resilience/wave-7-debug-observability`
> **Estimated Effort:** 3-4 hours
> **Risk:** Low
> **Depends On:** Wave 3 item 3.6 (REC-52 — RoutingContext on error paths)

### Checklist

- [ ] **7.1 — REC-58: Remove `addDebugHeaders()` and `x-include-debug-info` mechanism**
  - **Design:** [DESIGN REC-58 (line 2773)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-58-remove-adddebugheaders-and-x-include-debug-info-mechanism), [Section 30.2 (line 2525)](./DESIGN-resilience-timeout-circuitbreaker.md#302-debug-headers-adddebugheaders--to-be-removed)
  - **Files:**
    - `src/utils/debug-headers.ts` — Delete `addDebugHeaders()` function
    - `src/controllers/ollamaController.ts` — Remove all `addDebugHeaders()` call sites
    - `src/controllers/openaiController.ts` — Remove all `addDebugHeaders()` call sites
  - **Test:** Extend `tests/unit/debug-info.test.ts`:
    - Verify `x-include-debug-info` header has no effect
    - Verify `?debug=true` still works
  - **Commit:** `refactor(debug): remove x-include-debug-info header mechanism`

- [ ] **7.2 — REC-57: Remove dead `ExtendedRoutingContext`**
  - **Design:** [DESIGN REC-57 (line 2767)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-57-remove-dead-extendedroutingcontext)
  - **File:** `src/utils/debug-headers.ts`
  - **Change:** Delete `ExtendedRoutingContext` interface
  - **Commit:** `refactor(debug): remove unused ExtendedRoutingContext`

- [ ] **7.3 — REC-55: Expand debug output with routing reasoning**
  - **Design:** [DESIGN REC-55 (line 2746)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-55-expand-debug-output-with-routing-reasoning), [Section 30.5 (line 2580)](./DESIGN-resilience-timeout-circuitbreaker.md#305-endpoint-debug-coverage-debugtrue-only)
  - **Files:**
    - `src/utils/debug-headers.ts` (`getDebugInfo()`) — Expand output
    - `src/orchestrator.ts` — Capture scoring breakdown, excluded servers, algorithm, protocol
  - **Test:** New `tests/unit/debug-output.test.ts`:
    - Verify `?debug=true` output includes server scores, excluded servers with reasons, timeout values
  - **Commit:** `feat(debug): expand debug output with routing reasoning`

- [ ] **7.4 — REC-53: Add debug support to `/v1/embeddings`**
  - **Design:** [DESIGN REC-53 (line 2734)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-53-add-debug-support-to-v1embeddings)
  - **File:** `src/controllers/openaiController.ts`
  - **Change:** Create `routingContext` in embeddings handler
  - **Commit:** `feat(debug): add ?debug=true support to /v1/embeddings`

- [ ] **7.5 — REC-54: Add debug support to `requestToServer()`**
  - **Design:** [DESIGN REC-54 (line 2740)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-54-add-debug-support-to-requesttoserver-via-debugtrue)
  - **File:** `src/orchestrator.ts`
  - **Change:** Add optional `routingContext` parameter to `requestToServer()`
  - **Commit:** `feat(debug): add debug support to requestToServer`

- [ ] **7.6 — REC-56: Pass streaming metrics to `getDebugInfo()`**
  - **Design:** [DESIGN REC-56 (line 2761)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-56-pass-streaming-metrics-to-getdebuginfo)
  - **Files:** `src/controllers/ollamaController.ts`, `src/controllers/openaiController.ts`
  - **Change:** Pass computed streaming metrics (TTFT, duration, tokens) to `getDebugInfo()` options
  - **Commit:** `feat(debug): pass streaming metrics to debug output`

- [ ] **7.7 — REC-74: Record full failover chain in decision history**
  - **Design:** [DESIGN REC-74 (line 3512)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-74-record-full-failover-chain-in-decision-history), [Section 40.1 (line 3296)](./DESIGN-resilience-timeout-circuitbreaker.md#401-decision-history-records-only-first-selection)
  - **Files:** `src/orchestrator.ts`, `src/decision-history.ts`
  - **Change:** Record all server selection events during failover (phase, server, result, error, latency)
  - **Test:** Extend `tests/unit/decision-history.test.ts`:
    - Failover across 3 servers → decision history shows all 3 attempts
  - **Commit:** `feat(observability): record full failover chain in decision history`

### Wave 7 Verification

```bash
npm run lint
npm run typecheck
npm run test:unit -- --run tests/unit/debug-output.test.ts
npm run test:unit -- --run tests/unit/debug-info.test.ts
npm run test:unit -- --coverage
npm run test:integration
```

### Wave 7 Git Actions (After Merge)

```bash
git checkout main && git pull
git tag -a v1.x.x-rc.2 -m "resilience: waves 0-7 complete"
git push origin v1.x.x-rc.2   # Triggers release workflow -> staging deploy
```

---

## 13. Wave 8: Configuration & Hardening

> **Design Reference:** [DESIGN Section 53 (line 3960)](./DESIGN-resilience-timeout-circuitbreaker.md#53-wave-8-configuration-hardening--enhancements)
> **Branch:** `resilience/wave-8-config-hardening`
> **Estimated Effort:** 8-12 hours (many independent items)
> **Risk:** Low
> **Depends On:** Waves 1-4 should be complete

### Checklist

- [ ] **8.1 — REC-45: Honor `Retry-After` header**
  - **Design:** [DESIGN REC-45 (line 2646)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-45-honor-retry-after-header), [Section 27.2 (line 2332)](./DESIGN-resilience-timeout-circuitbreaker.md#272-retry-after-header-completely-absent)
  - **Depends On:** REC-44 (Wave 2)
  - **Commit:** `feat(backoff): honor Retry-After header from 429 responses`

- [ ] **8.2 — REC-43: Expand server `type` config (`ollama`/`openai`/`auto`)**
  - **Design:** [DESIGN REC-43 (line 2172)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-43-expand-server-type-config-to-support-openai-native-backends), [Section 23.3 (line 2010)](./DESIGN-resilience-timeout-circuitbreaker.md#233-server-config-limitations)
  - **Depends On:** REC-47 (Wave 3)
  - **Commit:** `feat(config): support ollama/openai/auto server type`

- [ ] **8.3 — REC-49: Protocol-aware handoff server selection**
  - **Design:** [DESIGN REC-49 (line 2690)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-49-protocol-aware-handoff-server-selection), [Section 29.3 (line 2445)](./DESIGN-resilience-timeout-circuitbreaker.md#293-handoff-server-selection-ignores-capabilities)
  - **Depends On:** REC-47, REC-36 (Waves 3-4)
  - **Commit:** `fix(handoff): use protocol-aware server selection for stream handoff`

- [ ] **8.4 — REC-8: Add readiness probe (`/health/ready`)**
  - **Design:** [DESIGN REC-8 (line 414)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-8-add-readiness-probe), [Section 4.3.1 (line 275)](./DESIGN-resilience-timeout-circuitbreaker.md#issue-431-health-check-endpoint-always-returns-ok)
  - **Commit:** `feat(health): add /health/ready readiness probe`

- [ ] **8.5 — REC-4: Make recovery test timeouts configurable**
  - **Design:** [DESIGN REC-4 (line 340)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-4-make-recovery-test-timeouts-configurable)
  - **Commit:** `feat(config): make recovery test timeouts configurable`

- [ ] **8.6 — REC-5: Make backoff delays configurable**
  - **Design:** [DESIGN REC-5 (line 353)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-5-make-backoff-delays-configurable)
  - **Commit:** `feat(config): make backoff delays configurable`

- [ ] **8.7 — REC-6: Flapping-aware CB behavior**
  - **Design:** [DESIGN REC-6 (line 370)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-6-implement-flapping-aware-circuit-breaker)
  - **Depends On:** REC-32 (below)
  - **Commit:** `feat(circuit-breaker): add flapping-aware behavior`

- [ ] **8.8 — REC-7: Timeout escalation on repeated failures**
  - **Design:** [DESIGN REC-7 (line 389)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-7-add-timeout-escalation-on-repeated-failures)
  - **Depends On:** REC-67 (Wave 2)
  - **Commit:** `feat(timeout): escalate timeout on repeated timeout failures`

- [ ] **8.9 — REC-9: Unify configuration defaults**
  - **Design:** [DESIGN REC-9 (line 444)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-9-unify-configuration-defaults)
  - **Commit:** `chore(config): unify circuit-breaker.ts and config.ts defaults`

- [ ] **8.10 — REC-10: Client timeout header support**
  - **Design:** [DESIGN REC-10 (line 450)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-10-add-per-request-timeout-header-support)
  - **Commit:** `feat(timeout): add x-request-timeout header support`

- [ ] **8.11 — REC-32: Time-based pruning for RecoveryFailureTracker**
  - **Design:** [DESIGN REC-32 (line 1592)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-32-add-time-based-pruning-to-recoveryfailuretracker)
  - **Commit:** `fix(analytics): add time-based pruning to RecoveryFailureTracker`

- [ ] **8.12 — REC-29: VRAM utilization in scoring**
  - **Design:** [DESIGN REC-29 (line 1548)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-29-add-vram-utilization-to-scoring)
  - **Depends On:** REC-25 (Wave 6)
  - **Commit:** `feat(load-balancer): add VRAM utilization to server scoring`

- [ ] **8.13 — REC-31: Persist AnalyticsEngine data**
  - **Design:** [DESIGN REC-31 (line 1578)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-31-add-persistence-to-analyticsengine)
  - **Commit:** `feat(analytics): add persistence to AnalyticsEngine`

- [ ] **8.14 — REC-33: Summary persistence for long-term trends**
  - **Design:** [DESIGN REC-33 (line 1606)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-33-add-summary-persistence-for-long-term-trends)
  - **Depends On:** REC-31 (above)
  - **Commit:** `feat(analytics): add summary persistence for long-term trends`

- [ ] **8.15 — REC-35: Network overhead metric from `total_duration`**
  - **Design:** [DESIGN REC-35 (line 1644)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-35-compute-network-overhead-from-total_duration)
  - **Depends On:** REC-25 (Wave 6)
  - **Commit:** `feat(metrics): compute network overhead from total_duration`

- [ ] **8.16 — REC-50: Enable OpenAI stream handoff**
  - **Design:** [DESIGN REC-50 (line 2704)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-50-enable-openai-stream-handoff-with-protocol-translation)
  - **Depends On:** REC-36 (Wave 4)
  - **Commit:** `feat(streaming): enable OpenAI stream handoff with protocol translation`

- [ ] **8.17 — REC-51: Preserve lost continuation parameters**
  - **Design:** [DESIGN REC-51 (line 2717)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-51-preserve-lost-continuation-parameters)
  - **Commit:** `fix(handoff): preserve tools, format, stop in continuation builders`

- [ ] **8.18 — REC-12: Decouple active tests from health check cycle**
  - **Design:** [DESIGN REC-12 (line 766)](./DESIGN-resilience-timeout-circuitbreaker.md#rec-12-decouple-active-tests-from-health-check-cycle)
  - **Depends On:** REC-11 (Wave 5)
  - **Commit:** `refactor(recovery): decouple active tests from health check scheduling`

### Wave 8 Git Actions (After Merge)

```bash
git checkout main && git pull
git tag -a v1.x.x -m "resilience: all waves complete"
git push origin v1.x.x   # Triggers full release workflow
```

---

## 14. Execution Timeline

### Optimistic (2 developers, parallel tracks)

```
Week 1:  Wave 0 (1-2h) + Wave 1 (2-3h) + Wave 2 (3-4h)
           ├── Dev A: Wave 0 → Wave 1
           └── Dev B: Wave 2
         Milestone: Critical path RC (tag v*-rc.1)

Week 2:  Wave 3 (4-5h) + Wave 4 start (8-12h)
           ├── Dev A: Wave 3
           └── Dev B: Wave 4 (continues to Week 3)
         Milestone: Failover correctness complete

Week 3:  Wave 4 finish + Wave 5 (6-8h)
           ├── Dev A: Wave 5
           └── Dev B: Wave 4 finish + verification
         Milestone: Streaming + recovery complete (tag v*-rc.2)

Week 4:  Wave 6 (4-5h) + Wave 7 (3-4h) + Wave 8 start
           ├── Dev A: Wave 6 → Wave 7
           └── Dev B: Wave 8 start
         Milestone: Metrics + debug complete

Week 5:  Wave 8 finish (remaining items)
         Milestone: Full release (tag v*.*.*)
```

### Conservative (1 developer, sequential)

```
Week 1:  Wave 0 + Wave 1 + Wave 2
Week 2:  Wave 3
Week 3:  Wave 4
Week 4:  Wave 5 + Wave 6
Week 5:  Wave 7 + Wave 8 (partial)
Week 6:  Wave 8 (finish)
```

### Minimum Viable Fix (1 day, 1 developer)

If only one day is available, implement the **Critical Path** items:

| Rec    | What                                        | Lines Changed |
| ------ | ------------------------------------------- | ------------- |
| REC-59 | Delete duplicate `modelCb.recordFailure()`  | 1 line        |
| REC-60 | Delete duplicate `this.markFailure()` calls | 2 lines       |
| REC-22 | Pass CB health to weighted algorithm        | 3 lines       |
| REC-47 | Check `v1Models` for OpenAI capability      | 3 lines       |
| REC-62 | Add `canAttempt()`, use in filtering        | ~20 lines     |
| REC-66 | Wrap `response.json()` with timeout         | ~30 lines     |
| REC-44 | Parse OpenAI nested error format            | ~10 lines     |

**Total: ~70 lines. One PR. One commit per fix.**

---

## 15. Risk Register

| Risk                                                             | Severity | Mitigation                                                                                             |
| ---------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| Wave 1 CB threshold change exposes previously-hidden failures    | Medium   | Monitor CB open/close rates in staging for 24h before promoting to production                          |
| Wave 2 body-read timeout too aggressive                          | Low      | Use generous default (30s). Make configurable.                                                         |
| Wave 3 `tryIncrementInFlight` changes failover behavior          | Medium   | Load test with k6 before and after. Compare request distribution.                                      |
| Wave 4 SSE passthrough breaks with non-compliant Ollama versions | Medium   | Feature-flag passthrough. Fall back to translation if passthrough errors.                              |
| Wave 4 tool_calls format incompatible with some OpenAI SDKs      | Medium   | Test with official Python and Node.js OpenAI SDKs                                                      |
| Wave 5 cross-path guard causes deadlock                          | Low      | Use timeout on guard acquisition. Log and skip if timeout.                                             |
| Wave 6 EMA-based scoring oscillates                              | Low      | Use conservative alpha (0.3). Monitor score distributions.                                             |
| Coverage threshold regressions                                   | Low      | CI enforces thresholds. Dead code removal in Wave 0 provides headroom.                                 |
| Merge conflicts between parallel waves                           | Medium   | Waves 1+2 touch different files. Waves 3+4 may conflict in `orchestrator.ts` — coordinate merge order. |

---

## Appendix A: Recommendation-to-Wave Cross Reference

| REC    | Wave | Checklist Item           | Design Line                                                                                                              |
| ------ | ---- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| REC-1  | 2    | 2.3                      | [295](./DESIGN-resilience-timeout-circuitbreaker.md#rec-1-unify-timeout-strategy-across-controllers)                     |
| REC-2  | 2    | 2.4                      | [307](./DESIGN-resilience-timeout-circuitbreaker.md#rec-2-add-express-server-timeouts)                                   |
| REC-3  | 2    | 2.1 (merged with REC-66) | [322](./DESIGN-resilience-timeout-circuitbreaker.md#rec-3-add-response-body-read-timeout)                                |
| REC-4  | 8    | 8.5                      | [340](./DESIGN-resilience-timeout-circuitbreaker.md#rec-4-make-recovery-test-timeouts-configurable)                      |
| REC-5  | 8    | 8.6                      | [353](./DESIGN-resilience-timeout-circuitbreaker.md#rec-5-make-backoff-delays-configurable)                              |
| REC-6  | 8    | 8.7                      | [370](./DESIGN-resilience-timeout-circuitbreaker.md#rec-6-implement-flapping-aware-circuit-breaker)                      |
| REC-7  | 8    | 8.8                      | [389](./DESIGN-resilience-timeout-circuitbreaker.md#rec-7-add-timeout-escalation-on-repeated-failures)                   |
| REC-8  | 8    | 8.4                      | [414](./DESIGN-resilience-timeout-circuitbreaker.md#rec-8-add-readiness-probe)                                           |
| REC-9  | 8    | 8.9                      | [444](./DESIGN-resilience-timeout-circuitbreaker.md#rec-9-unify-configuration-defaults)                                  |
| REC-10 | 8    | 8.10                     | [450](./DESIGN-resilience-timeout-circuitbreaker.md#rec-10-add-per-request-timeout-header-support)                       |
| REC-11 | 5    | 5.8                      | [733](./DESIGN-resilience-timeout-circuitbreaker.md#rec-11-single-recovery-test-entry-point)                             |
| REC-12 | 8    | 8.18                     | [766](./DESIGN-resilience-timeout-circuitbreaker.md#rec-12-decouple-active-tests-from-health-check-cycle)                |
| REC-13 | 5    | 5.1                      | [793](./DESIGN-resilience-timeout-circuitbreaker.md#rec-13-add-cross-path-concurrency-guard)                             |
| REC-14 | 5    | 5.6                      | [821](./DESIGN-resilience-timeout-circuitbreaker.md#rec-14-trigger-model-tests-on-server-recovery)                       |
| REC-15 | 0    | 0.3                      | [839](./DESIGN-resilience-timeout-circuitbreaker.md#rec-15-remove-dead-code-in-healthcheckscheduler)                     |
| REC-16 | 5    | 5.2                      | [855](./DESIGN-resilience-timeout-circuitbreaker.md#rec-16-extract-embedding-detection-utility)                          |
| REC-17 | 5    | 5.3                      | [875](./DESIGN-resilience-timeout-circuitbreaker.md#rec-17-remove-5-second-embedding-delay)                              |
| REC-18 | 0    | 0.4                      | [882](./DESIGN-resilience-timeout-circuitbreaker.md#rec-18-integrate-intelligentrecoverymanager)                         |
| REC-19 | 5    | 5.5                      | [904](./DESIGN-resilience-timeout-circuitbreaker.md#rec-19-add-half-open-timeout-to-request-path)                        |
| REC-20 | 5    | 5.7                      | [922](./DESIGN-resilience-timeout-circuitbreaker.md#rec-20-clear-banmanager-cooldown-on-recovery-success)                |
| REC-21 | 5    | 5.4                      | [934](./DESIGN-resilience-timeout-circuitbreaker.md#rec-21-add-test-metrics-to-request-path-recovery)                    |
| REC-22 | 1    | 1.4                      | [1430](./DESIGN-resilience-timeout-circuitbreaker.md#rec-22-fix-weighted-algorithm-cb-health-passthrough)                |
| REC-23 | 6    | 6.3                      | [1445](./DESIGN-resilience-timeout-circuitbreaker.md#rec-23-fix-getload-vs-gettotalload-parameter)                       |
| REC-24 | 6    | 6.4                      | [1458](./DESIGN-resilience-timeout-circuitbreaker.md#rec-24-fix-streaming-optimized-sort-direction)                      |
| REC-25 | 6    | 6.1                      | [1472](./DESIGN-resilience-timeout-circuitbreaker.md#rec-25-extend-ollamastreamchunk-to-capture-duration-fields)         |
| REC-26 | 6    | 6.2                      | [1501](./DESIGN-resilience-timeout-circuitbreaker.md#rec-26-compute-and-store-token-throughput-tokenssec)                |
| REC-27 | 6    | 6.6                      | [1519](./DESIGN-resilience-timeout-circuitbreaker.md#rec-27-detect-and-annotate-cold-starts-via-load_duration)           |
| REC-28 | 6    | 6.7                      | [1531](./DESIGN-resilience-timeout-circuitbreaker.md#rec-28-use-token-throughput-in-weighted-algorithm)                  |
| REC-29 | 8    | 8.12                     | [1548](./DESIGN-resilience-timeout-circuitbreaker.md#rec-29-add-vram-utilization-to-scoring)                             |
| REC-30 | 6    | 6.5                      | [1562](./DESIGN-resilience-timeout-circuitbreaker.md#rec-30-use-getmetricswithfallback-in-selection-path)                |
| REC-31 | 8    | 8.13                     | [1578](./DESIGN-resilience-timeout-circuitbreaker.md#rec-31-add-persistence-to-analyticsengine)                          |
| REC-32 | 8    | 8.11                     | [1592](./DESIGN-resilience-timeout-circuitbreaker.md#rec-32-add-time-based-pruning-to-recoveryfailuretracker)            |
| REC-33 | 8    | 8.14                     | [1606](./DESIGN-resilience-timeout-circuitbreaker.md#rec-33-add-summary-persistence-for-long-term-trends)                |
| REC-34 | 0    | 0.5                      | [1635](./DESIGN-resilience-timeout-circuitbreaker.md#rec-34-remove-or-use-tokensprompt)                                  |
| REC-35 | 8    | 8.15                     | [1644](./DESIGN-resilience-timeout-circuitbreaker.md#rec-35-compute-network-overhead-from-total_duration)                |
| REC-36 | 4    | 4.5                      | [2042](./DESIGN-resilience-timeout-circuitbreaker.md#rec-36-passthrough-sse-for-servers-with-v1-support)                 |
| REC-37 | 4    | 4.6                      | [2082](./DESIGN-resilience-timeout-circuitbreaker.md#rec-37-fix-ndjson-to-sse-translation-for-ollama-only-servers)       |
| REC-38 | 4    | 4.7                      | [2108](./DESIGN-resilience-timeout-circuitbreaker.md#rec-38-fix-v1completions-streaming-format)                          |
| REC-39 | 4    | 4.4                      | [2118](./DESIGN-resilience-timeout-circuitbreaker.md#rec-39-fix-v1models-created-timestamp)                              |
| REC-40 | 4    | 4.2                      | [2126](./DESIGN-resilience-timeout-circuitbreaker.md#rec-40-fix-global-error-handler-for-v1-routes)                      |
| REC-41 | 4    | 4.3                      | [2147](./DESIGN-resilience-timeout-circuitbreaker.md#rec-41-exclude-v1-from-spa-fallback)                                |
| REC-42 | 4    | 4.1                      | [2160](./DESIGN-resilience-timeout-circuitbreaker.md#rec-42-add-backpressure-to-openai-sse-streaming)                    |
| REC-43 | 8    | 8.2                      | [2172](./DESIGN-resilience-timeout-circuitbreaker.md#rec-43-expand-server-type-config-to-support-openai-native-backends) |
| REC-44 | 2    | 2.5                      | [2629](./DESIGN-resilience-timeout-circuitbreaker.md#rec-44-parse-openai-error-format)                                   |
| REC-45 | 8    | 8.1                      | [2646](./DESIGN-resilience-timeout-circuitbreaker.md#rec-45-honor-retry-after-header)                                    |
| REC-46 | 2    | 2.6                      | [2659](./DESIGN-resilience-timeout-circuitbreaker.md#rec-46-reclassify-http-500-for-openai-backends)                     |
| REC-47 | 3    | 3.1                      | [2667](./DESIGN-resilience-timeout-circuitbreaker.md#rec-47-fix-model-matching-to-use-correct-model-list)                |
| REC-48 | 3    | 3.2                      | [2684](./DESIGN-resilience-timeout-circuitbreaker.md#rec-48-apply-resolvemodelname-in-failover-path)                     |
| REC-49 | 8    | 8.3                      | [2690](./DESIGN-resilience-timeout-circuitbreaker.md#rec-49-protocol-aware-handoff-server-selection)                     |
| REC-50 | 8    | 8.16                     | [2704](./DESIGN-resilience-timeout-circuitbreaker.md#rec-50-enable-openai-stream-handoff-with-protocol-translation)      |
| REC-51 | 8    | 8.17                     | [2717](./DESIGN-resilience-timeout-circuitbreaker.md#rec-51-preserve-lost-continuation-parameters)                       |
| REC-52 | 3    | 3.6                      | [2726](./DESIGN-resilience-timeout-circuitbreaker.md#rec-52-populate-routingcontext-on-error-paths)                      |
| REC-53 | 7    | 7.4                      | [2734](./DESIGN-resilience-timeout-circuitbreaker.md#rec-53-add-debug-support-to-v1embeddings)                           |
| REC-54 | 7    | 7.5                      | [2740](./DESIGN-resilience-timeout-circuitbreaker.md#rec-54-add-debug-support-to-requesttoserver-via-debugtrue)          |
| REC-55 | 7    | 7.3                      | [2746](./DESIGN-resilience-timeout-circuitbreaker.md#rec-55-expand-debug-output-with-routing-reasoning)                  |
| REC-56 | 7    | 7.6                      | [2761](./DESIGN-resilience-timeout-circuitbreaker.md#rec-56-pass-streaming-metrics-to-getdebuginfo)                      |
| REC-57 | 7    | 7.2                      | [2767](./DESIGN-resilience-timeout-circuitbreaker.md#rec-57-remove-dead-extendedroutingcontext)                          |
| REC-58 | 7    | 7.1                      | [2773](./DESIGN-resilience-timeout-circuitbreaker.md#rec-58-remove-adddebugheaders-and-x-include-debug-info-mechanism)   |
| REC-59 | 1    | 1.1                      | [3318](./DESIGN-resilience-timeout-circuitbreaker.md#rec-59-fix-double-model-cb-recording-in-requesttoserver)            |
| REC-60 | 1    | 1.2                      | [3331](./DESIGN-resilience-timeout-circuitbreaker.md#rec-60-fix-double-banmanager-recording-in-handleservererror)        |
| REC-61 | 1    | 1.3                      | [3342](./DESIGN-resilience-timeout-circuitbreaker.md#rec-61-fix-rate-limited-error-backoff-classification)               |
| REC-62 | 1    | 1.5                      | [3359](./DESIGN-resilience-timeout-circuitbreaker.md#rec-62-fix-canexecute-candidateexecution-mismatch)                  |
| REC-63 | 3    | 3.7                      | [3368](./DESIGN-resilience-timeout-circuitbreaker.md#rec-63-add-client-disconnect-detection-to-failover)                 |
| REC-64 | 3    | 3.3                      | [3383](./DESIGN-resilience-timeout-circuitbreaker.md#rec-64-fix-toctou-race-in-concurrency-check)                        |
| REC-65 | 3    | 3.8                      | [3402](./DESIGN-resilience-timeout-circuitbreaker.md#rec-65-fix-_streamingrequestid-shared-mutable-state)                |
| REC-66 | 2    | 2.1                      | [3415](./DESIGN-resilience-timeout-circuitbreaker.md#rec-66-add-body-read-timeout-for-non-streaming)                     |
| REC-67 | 2    | 2.2                      | [3430](./DESIGN-resilience-timeout-circuitbreaker.md#rec-67-fix-timeout-monotonicity)                                    |
| REC-68 | 2    | 2.3 (merged with REC-1)  | [3444](./DESIGN-resilience-timeout-circuitbreaker.md#rec-68-use-adaptive-timeouts-consistently)                          |
| REC-69 | 0    | 0.1                      | [3456](./DESIGN-resilience-timeout-circuitbreaker.md#rec-69-remove-dead-queue-system)                                    |
| REC-70 | 0    | 0.2                      | [3464](./DESIGN-resilience-timeout-circuitbreaker.md#rec-70-remove-dead-background-request-tracker)                      |
| REC-71 | 3    | 3.5                      | [3470](./DESIGN-resilience-timeout-circuitbreaker.md#rec-71-differentiate-no-servers-error-conditions)                   |
| REC-72 | 3    | 3.4                      | [3488](./DESIGN-resilience-timeout-circuitbreaker.md#rec-72-re-filter-candidates-between-phases)                         |
| REC-73 | 2    | 2.7                      | [3503](./DESIGN-resilience-timeout-circuitbreaker.md#rec-73-fix-openai-stall-detection-vs-activity-timeout-conflict)     |
| REC-74 | 7    | 7.7                      | [3512](./DESIGN-resilience-timeout-circuitbreaker.md#rec-74-record-full-failover-chain-in-decision-history)              |
