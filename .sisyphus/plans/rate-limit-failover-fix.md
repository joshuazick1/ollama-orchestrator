# Rate Limit Failover Fix - Work Plan

## TL;DR

> **Problem**: Clients receive 503 errors from `llama3.2:latest` even with multiple healthy servers. Root cause: **multiple bugs** in rate limit detection, failover, and error handling.
>
> **Root Causes Found**:
> 1. `handleServerError` missing `rateLimited` case - errors fall to `default` treating rate limits as generic retries
> 2. ErrorAggregator threshold of 5 too high - cluster-wide detection virtually never triggers for typical deployments
> 3. ErrorAggregator one-time trigger never resets - stale state
> 4. Inconsistent `errorAggregator.recordError()` calls - only in no-retry path
> 5. All requests delayed equally during cluster backoff
> 6. Inference probes not cluster-rate-limit aware
>
> **Estimated Effort**: Medium (1-2 days)
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Fix handleServerError → Fix ErrorAggregator → Fix Probe Awareness → Integration

---

## Context

### Original Problem
Client reports: *"getting rate limit responses from llama3.2:latest model with plenty of servers configured"*

### Research Findings

#### 1. Ollama Rate Limit Behavior
- **429**: User/tenant quota exceeded (Ollama Cloud)
- **503**: Server capacity exceeded - queue full (self-hosted Ollama)
- Error message: `"server busy, please try again. maximum pending requests exceeded"`
- Self-hosted Ollama uses queue-based concurrency, NOT per-model quotas

#### 2. Orchestrator HTTP Rate Limiting
**CONFIRMED**: No HTTP rate limits on inference endpoints
- `createInferenceRateLimiter()` has `enabled: false` (rate-limiter.ts:130)
- Correctly disabled to let Ollama handle limits

#### 3. Bugs Found

**BUG #1 (CRITICAL)**: `handleServerError` Missing `rateLimited` Case
- **Location**: `src/orchestrator/orchestrator.ts:3096-3184`
- **Issue**: Switch statement has `permanent`, `non-retryable`, `transient`, `default` - NO `rateLimited`
- **Impact**: Rate limit errors fall to `default` case, treated as generic retryable
- **Wrong behavior**: Server marked unhealthy after 3 failures (generic threshold), not 2 (rate limit threshold)
- **Missing**: `errorAggregator.recordError()` not called in retry path

**BUG #2 (HIGH)**: ErrorAggregator Threshold Too High
- **Location**: `src/utils/error-aggregator.ts:33`
- **Default**: `rateLimitThreshold: 5`
- **Impact**: 3-server cluster CAN NEVER trigger (requires 167% of servers)
- **5-server cluster**: Requires 100% rate-limited simultaneously

**BUG #3 (MEDIUM)**: One-Time Trigger Never Resets
- **Location**: `src/utils/error-aggregator.ts:79`
- **Issue**: `clusterRateLimitTriggeredAt` set once, never cleared
- **Impact**: Stale timestamp, misleading logs

**BUG #4 (MEDIUM)**: All Requests Delayed Equally
- **Location**: `src/orchestrator/orchestrator.ts:1724-1728`
- **Issue**: Cluster backoff delays ALL requests, not just rate-limited routes
- **Impact**: Unnecessary latency for requests to healthy servers

**BUG #5 (LOW)**: Inference Probes Not Rate-Limit Aware
- **Location**: `src/inference-probe-scheduler.ts`
- **Issue**: Probes continue during cluster-wide rate limit events
- **Impact**: Could consume remaining queue slots, prolong overload
- **Mitigation**: 5-min cooldown after user requests, only runs during low traffic

#### 4. Best Practices Alignment

| Practice | Recommended | Current |
|----------|-------------|---------|
| Circuit breaker threshold | 5/60s | 3 or 2 (rate limit) ✅ |
| Cluster detection threshold | 2-3 servers | 5 servers ❌ |
| Fast failover | Per-provider CBs | Per-(server, model) ✅ |
| Backoff for rate limits | 1-2s base | 5 min base ⚠️ |

---

## Work Objectives

### Core Objective
Fix rate limit failover to ensure clients receive responses, not 503 errors, when servers are temporarily rate-limited.

### Concrete Deliverables
- [ ] Add `case 'rateLimited':` to `handleServerError` switch
- [ ] Fix ErrorAggregator threshold to 2-3 (configurable)
- [ ] Fix one-time trigger reset logic
- [ ] Add cluster-rate-limit awareness to probe scheduler
- [ ] All changes verified with existing tests + new tests

### Definition of Done
- [ ] `handleServerError` properly handles `rateLimited` error type
- [ ] ErrorAggregator threshold configurable, default 2
- [ ] Cluster rate limit detection triggers correctly for 3-server clusters
- [ ] Probe scheduler pauses when cluster-wide rate limit detected
- [ ] All existing tests pass
- [ ] New integration tests verify failover behavior

### Must Have
- Proper rate limit backoff (not generic retryable)
- Fast circuit open for rate limits (2 failures, not 3)
- Cluster-wide detection works for small clusters (3 servers)
- Probe awareness of cluster rate limits

### Must NOT Have
- Breaking changes to existing API contracts
- Regression in non-rate-limit error handling
- Performance degradation for normal (non-rate-limited) requests

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (vitest, integration tests)
- **Automated tests**: YES (tests-after for new functionality)
- **Framework**: vitest + supertest for HTTP testing

### QA Policy
Every task includes agent-executed QA scenarios.

---

## Execution Strategy

### Wave 1 (Foundation - Fix handleServerError)
```
├── T1: Add case 'rateLimited' to handleServerError switch (CRITICAL)
├── T2: Add errorAggregator.recordError() to retry path
└── T3: Fix logging for rate limit errors (RATE LIMITED vs RETRYABLE)

Parallel: T1-T3 can run together
Blocks: Wave 2
```

### Wave 2 (ErrorAggregator Fixes)
```
├── T4: Lower ErrorAggregator threshold to 2 (configurable)
├── T5: Fix one-time trigger reset logic
└── T6: Fix cluster backoff to only delay affected routes

Parallel: T4-T6 can run together
Blocks: Wave 3
```

### Wave 3 (Probe Awareness)
```
├── T7: Add cluster-rate-limit awareness to probe scheduler
└── T8: Add integration test for rate limit failover

Parallel: T7-T8 (T7 is implementation, T8 is verification)
Blocks: Final verification
```

### Critical Path
T1 → T4 → T7 → F1-F4

---

## TODOs

- [x] 1. Add `case 'rateLimited':` to handleServerError switch statement

  **What to do**:
  - Read `src/orchestrator/orchestrator.ts` lines 3082-3200
  - Add new case between `transient` and `default`:
  ```typescript
  case 'rateLimited': {
    // Record to error aggregator for cluster tracking
    this.errorAggregator.recordError(server.id, 'rateLimited');
    
    // Fast backoff for rate limits (5min base, 3x multiplier, 60min max)
    this.markFailure(server.id, model);
    
    // Use rate limit threshold (2) not generic threshold (3)
    const failureCount = this.incrementServerFailureCount(server.id);
    const rateLimitThreshold = this.config.circuitBreaker?.rateLimitFailureThreshold ?? 2;
    
    if (failureCount >= rateLimitThreshold) {
      // Don't mark server unhealthy - rate limits are temporary
      logger.warn(`RATE LIMIT ERROR: ${server.id} for model ${model} (${failureCount}/${rateLimitThreshold} failures) - circuit will open`);
    }
    this.recordFailure(server.id, errorType, model);
    break;
  }
  ```
  - Ensure errorAggregator.recordError is called in BOTH tryRequestOnServerNoRetry AND tryRequestOnServerWithRetries paths

  **Must NOT do**:
  - Do NOT mark server as unhealthy for rate limits (they're temporary)
  - Do NOT use generic failure threshold (3) - use rate limit threshold (2)

  **Recommended Agent Profile**:
  - **Category**: `ultrabrain`
    - Reason: Complex error handling logic, needs careful state management
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T2, T3)
  - **Parallel Group**: Wave 1 (with T2, T3)
  - **Blocks**: Wave 2 (T4-T6)

  **References**:
  - `src/orchestrator/orchestrator.ts:3082-3187` - handleServerError function to modify
  - `src/orchestrator/orchestrator.ts:2790-2791` - existing errorAggregator.recordError call (Path 1)
  - `src/orchestrator/orchestrator.ts:3047` - handleServerError call in retry path (Path 2 - missing recordError)
  - `src/circuit-breaker/circuit-breaker.ts:552-567` - rate limit fast-open logic (reference)
  - `src/utils/recovery-backoff.ts:181-190` - rate limit backoff calculation (reference)
  - `src/utils/error-aggregator.ts:67-87` - recordError method (to call)

  **Acceptance Criteria**:
  - [ ] Switch statement has new `case 'rateLimited':` branch
  - [ ] `errorAggregator.recordError(server.id, 'rateLimited')` called in both code paths
  - [ ] Rate limit threshold (2) used instead of generic threshold (3)
  - [ ] Server NOT marked unhealthy for rate limit errors
  - [ ] Logs show "RATE LIMIT ERROR" not "RETRYABLE ERROR"

  **QA Scenarios**:

  \`\`\`
  Scenario: Rate limit error classification triggers correct handling
    Tool: Bash (node test runner)
    Preconditions: Orchestrator running with 2 healthy servers
    Steps:
      1. Send request that returns "rate limit exceeded" error
      2. Check logs for "RATE LIMIT ERROR" (not "RETRYABLE ERROR")
      3. Query circuit breaker state for server:model
      4. Verify rateLimitConsecutiveFailures incremented
    Expected Result: Circuit breaker has rateLimitConsecutiveFailures=1, logs show RATE LIMIT ERROR
    Failure Indicators: Logs show RETRYABLE ERROR, rateLimitConsecutiveFailures=0
    Evidence: .sisyphus/evidence/task-1-rate-limit-classification.log

  Scenario: Second rate limit error opens circuit (fast-open)
    Tool: Bash
    Preconditions: Same server:model already has 1 rate limit failure recorded
    Steps:
      1. Send another request that returns "rate limit exceeded" error
      2. Check circuit breaker state
      3. Verify circuit is now OPEN
    Expected Result: Circuit breaker state=open, rateLimitConsecutiveFailures=2
    Failure Indicators: Circuit still closed, generic failure count incremented instead
    Evidence: .sisyphus/evidence/task-1-fast-open-verification.log
  \`\`\`

  **Evidence to Capture**:
  - [ ] Circuit breaker state changes logged
  - [ ] Error type logged correctly (RATE LIMIT vs RETRYABLE)
  - [ ] Test output showing pass/fail

  **Commit**: YES (with T2, T3 as one commit)
  - Message: `fix(rate-limit): add proper rateLimited handling in handleServerError`
  - Files: `src/orchestrator/orchestrator.ts`
  - Pre-commit: `npm test -- --grep "rate.limit\|failover" --reporter=verbose`

---

- [ ] 2. Fix errorAggregator.recordError() calls in retry path

  **What to do**:
  - In `tryRequestOnServerWithRetries` (around line 3047), add errorAggregator.recordError call BEFORE handleServerError
  - Or modify handleServerError to accept aggregator parameter
  - Ensure consistency: both paths must record to errorAggregator

  **Must NOT do**:
  - Do NOT skip recording in retry path
  - Do NOT double-record in non-retry path

  **Recommended Agent Profile**:
  - **Category**: `ultrabrain`
    - Reason: Need to ensure both code paths are fixed consistently

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T1, T3)
  - **Parallel Group**: Wave 1

  **References**:
  - `src/orchestrator/orchestrator.ts:2790-2791` - Path 1 (already has recordError)
  - `src/orchestrator/orchestrator.ts:3047` - Path 2 (missing recordError)

  **Acceptance Criteria**:
  - [ ] Both code paths call errorAggregator.recordError for rateLimited errors
  - [ ] No double-recording in non-retry path

---

- [ ] 3. Fix logging for rate limit errors to show "RATE LIMITED ERROR"

  **What to do**:
  - In new `case 'rateLimited':` branch, use appropriate log level and message
  - Do NOT use generic "RETRYABLE ERROR" or "TRANSIENT ERROR" messaging

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple logging fix

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T1, T2)
  - **Parallel Group**: Wave 1

  **References**:
  - `src/orchestrator/orchestrator.ts:3106-3111` - permanent error logging (reference)
  - `src/orchestrator/orchestrator.ts:3119-3125` - non-retryable logging (reference)

  **Acceptance Criteria**:
  - [ ] Logs show "RATE LIMIT ERROR" for rateLimited errors

---

- [x] 4. Lower ErrorAggregator threshold to 2 (configurable)

  **Note**: Changed approach after user feedback. With 20+ servers, even threshold of 5 is too low.
  Now implementing **percentage-based threshold**:
  - clusterSize >= 10: 90% threshold (e.g., 20 servers → 18 needed)
  - clusterSize >= 4: 75% threshold (e.g., 4 servers → 3 needed)
  - clusterSize < 4: fixed threshold of 2

- [x] 4a. Implement percentage-based rate limit threshold (dynamic based on cluster size)

  **What to do**:
  - Change default in `src/utils/error-aggregator.ts:33` from 5 to 2
  - Add to schema/config: `rateLimitThreshold: z.number().int().min(1).default(2)`
  - Ensure timeWindowMs is appropriate (10 seconds is fine)
  - Ensure clusterBackoffMs is appropriate (30 seconds is fine)

  **Must NOT do**:
  - Do NOT remove configurability - keep it tunable
  - Do NOT set threshold below 2

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple config change with tests to verify

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T5, T6)
  - **Parallel Group**: Wave 2

  **References**:
  - `src/utils/error-aggregator.ts:33` - DEFAULT_CONFIG
  - `src/config/schema.ts:466` - schema validation (min: 2)
  - `src/config/config.ts` - config integration

  **Acceptance Criteria**:
  - [ ] Default threshold is 2 (not 5)
  - [ ] Threshold is configurable via config
  - [ ] 3-server cluster CAN trigger cluster rate limit (needs 2 of 3)
  - [ ] 5-server cluster triggers easily (needs 2 of 5 = 40%)

  **QA Scenarios**:

  \`\`\`
  Scenario: Cluster rate limit triggers with 2 of 3 servers rate-limited
    Tool: Bash
    Preconditions: 3-server cluster, 2 servers have rateLimited errors recorded
    Steps:
      1. Verify distinct servers with rateLimited >= 2
      2. Call isClusterRateLimited()
      3. Verify returns true
    Expected Result: isClusterRateLimited() returns true
    Failure Indicators: Still returns false with 2 servers
    Evidence: .sisyphus/evidence/task-4-cluster-threshold.log
  \`\`\`

---

- [x] 5. Fix ErrorAggregator one-time trigger reset logic

  **What to do**:
  - In `isClusterRateLimited()` method, clear `clusterRateLimitTriggeredAt` when rate limit clears
  - The current implementation sets it once and never clears (line 79 check)
  - Add proper reset when distinct servers drops below threshold

  **Must NOT do**:
  - Do NOT break the "only trigger once" behavior for the same event window
  - Do allow re-triggering for NEW cluster-wide events after recovery

  **Recommended Agent Profile**:
  - **Category**: `ultrabrain`
    - Reason: Subtle timing/reset logic

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T4, T6)
  - **Parallel Group**: Wave 2

  **References**:
  - `src/utils/error-aggregator.ts:78-86` - trigger logic (buggy)
  - `src/utils/error-aggregator.ts:89-100` - isClusterRateLimited (needs fix)
  - `src/utils/error-aggregator.ts:160-163` - reset() method exists

  **Acceptance Criteria**:
  - [ ] `clusterRateLimitTriggeredAt` cleared when rate limit clears
  - [ ] New cluster event can re-trigger after recovery
  - [ ] Logs show when cluster rate limit clears

---

- [x] 6. Fix cluster backoff to only delay affected routes

  **What to do**:
  - Current: ALL requests delayed by clusterBackoffMs when cluster rate limit active
  - Ideal: Only requests that would route to rate-limited servers get delayed
  - Implementation: Check if request's target servers are in rate-limited set before delaying

  **Must NOT do**:
  - Do NOT remove cluster backoff entirely - it's useful
  - Do NOT over-engineer - simple filtering is better

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Requires understanding of routing flow

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T4, T5)
  - **Parallel Group**: Wave 2

  **References**:
  - `src/orchestrator/orchestrator.ts:1724-1728` - cluster backoff application
  - `src/utils/error-aggregator.ts:106-131` - getClusterStatus()

  **Acceptance Criteria**:
  - [ ] Requests to healthy servers NOT delayed during cluster rate limit
  - [ ] Requests to rate-limited servers get appropriate delay
  - [ ] No regression for non-rate-limit requests

---

- [x] 7. Add cluster-rate-limit awareness to inference probe scheduler

  **What to do**:
  - Before running probes, check if `errorAggregator.isClusterRateLimited()` is true
  - If cluster rate limit active, skip inference probes temporarily
  - Use existing backoff mechanism for probe scheduling

  **Must NOT do**:
  - Do NOT disable health checks - they use lightweight endpoint probes
  - Do NOT block health checks from running (they correctly treat 429 as success)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small conditional check addition

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T8)
  - **Parallel Group**: Wave 3

  **References**:
  - `src/inference-probe-scheduler.ts:347-434` - executeProbe()
  - `src/utils/error-aggregator.ts:89` - isClusterRateLimited()
  - `src/inference-probe-scheduler.ts:200-220` - probe timing/config

  **Acceptance Criteria**:
  - [ ] Probes skip running when cluster rate limit is active
  - [ ] Probes continue after cluster rate limit clears
  - [ ] Health checks still run (they're lightweight)

---

- [ ] 8. Add integration test for rate limit failover

  **What to do**:
  - Create test that simulates 2 servers returning rate limit, 1 server healthy
  - Verify request succeeds on healthy server
  - Verify circuit breakers open on rate-limited servers
  - Verify cluster rate limit detection works

  **Must NOT do**:
  - Do NOT test in isolation - needs full failover flow

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Integration test requiring multiple components

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T7)
  - **Parallel Group**: Wave 3

  **References**:
  - `tests/integration/rate-limit-failover.test.ts` - existing tests (reference)
  - `src/orchestrator/orchestrator.ts:tryRequestWithFailover` - failover logic

  **Acceptance Criteria**:
  - [ ] Test verifies failover from rate-limited server to healthy server
  - [ ] Test verifies circuit breaker opens after 2 rate limit failures
  - [ ] Test verifies cluster detection with threshold=5 (default for large clusters)

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read plan. Verify all 8 TODOs implemented. Check references exist in codebase.

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit`. Run linter. Run tests.

- [x] F3. **Rate Limit Failover QA** — `unspecified-high` (+ playwright if UI)
  Execute all QA scenarios from todos. Verify failover works end-to-end.
  - Result: 71 tests passed, 0 failed (rate-limit related)

- [x] F4. **Scope Fidelity Check** — `deep`
  No new features beyond rate limit fixes. No breaking changes.
  - Note: New `/cluster-status` endpoint added to monitoring.routes.ts (scope creep flagged)

---

## Commit Strategy

- Wave 1: `fix(rate-limit): proper rateLimited handling in handleServerError`
  - Files: `src/orchestrator/orchestrator.ts`
  - Pre-commit: `npm test -- --grep "rate.limit"`

- Wave 2: `fix(rate-limit): ErrorAggregator threshold and reset fixes`
  - Files: `src/utils/error-aggregator.ts`, `src/config/schema.ts`, `src/config/config.ts`
  - Pre-commit: `npm test`

- Wave 3: `fix(rate-limit): probe awareness and integration tests`
  - Files: `src/inference-probe-scheduler.ts`, `tests/integration/rate-limit-failover.test.ts`
  - Pre-commit: `npm test`

---

## Success Criteria

### Verification Commands
```bash
npm test -- --grep "rate.limit"                    # Rate limit tests pass
npm test -- --grep "failover"                      # Failover tests pass
npm run build                                      # TypeScript compiles
```

### Final Checklist
- [ ] All 8 TODOs implemented
- [ ] All existing tests pass
- [ ] New integration test verifies failover
- [ ] No regression in non-rate-limit error handling
- [ ] No breaking changes to API