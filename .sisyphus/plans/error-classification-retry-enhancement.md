# Error Classification & Retry Logic Enhancement Plan

## TL;DR

> **Quick Summary**: Fix the critical 429 classification bug that causes permanent bans instead of retries, then enhance the error handling system with provider-aware rate limit handling, jittered backoff, budget-based retry limiting, and faster circuit breaker response to rate limits.

> **Deliverables**:
- Fix 429 error classification to use `rateLimited` instead of `non-retryable`
- Add Retry-After header support for Ollama provider
- Implement jittered exponential backoff to prevent thundering herd
- Add retry budget tracking to prevent overwhelming the system
- Implement fast-circuit-open for rate limit errors
- Add error aggregation and pattern detection across servers

> **Estimated Effort**: Medium (1-2 days)
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Fix 429 bug → Rate limit handling → Circuit breaker enhancement → Testing

---

## Context

### Original Problem
Client reports receiving "Too Many Requests" (429) errors from Ollama endpoints. With 83 servers configured and 79 healthy, the failover should route to another server when one hits rate limits, but requests are failing instead.

### Root Cause Analysis

**Bug #1: 429 HTTP Status Misclassified**
- `error-classifier.ts:651-664` - "Other 4xx errors" treated as `non-retryable` → permanent ban
- 429 should be `rateLimited` with retry behavior, not permanent ban
- When first 429 hits, server gets PERMANENTLY BANNED for that model
- No failover occurs because banned servers are filtered out

**Bug #2: Rate Limit Pattern Detection Fails**
- `error-classifier.ts:440-442` looks for: `'rate limit', 'too many requests', 'throttled', '429'`
- If error message is just "Too Many Requests" without standalone "429", pattern may not match
- Falls through to generic `non-retryable` at line 651

**Bug #3: Ollama Ignores Retry-After Header**
- `rate-limit-backoff.ts:32-35` - Ollama always uses exponential backoff
- But Ollama API might return Retry-After header which should be honored

### Additional Enhancements Identified

1. **No Jitter** - Deterministic backoff causes thundering herd
2. **No Retry Budget** - Unlimited retries could overwhelm system
3. **Slow Circuit Open for Rate Limits** - Should open in 1-2 failures, not 3-5
4. **No Error Correlation** - Can't detect systematic issues across servers
5. **Streaming Disconnected from CB** - Stall handler doesn't update CB state

---

## Work Objectives

### Core Objective
Fix the 429 classification bug and enhance error handling to properly detect, classify, and handle rate limits with intelligent retry and circuit breaker behavior.

### Concrete Deliverables

1. **Error Classifier Fix**
   - Add 429 to explicit rate limit handling (not just pattern matching)
   - Ensure HTTP status code 429 → `rateLimited` type, not `non-retryable`

2. **Enhanced Rate Limit Handling**
   - Honor Retry-After header for Ollama (currently ignored)
   - Track per-model rate limit state separately from generic errors

3. **Retry Logic Enhancements**
   - Add jitter to exponential backoff
   - Implement retry budget tracking (max total retries across all servers)
   - Add request-level timeout that accounts for retry delays

4. **Circuit Breaker Fast-Open for Rate Limits**
   - Rate limit errors should open circuit in 1-2 failures (not 3-5)
   - Implement rate-limit-specific backoff that scales faster

5. **Error Aggregation & Correlation**
   - Detect when multiple servers fail with same error (systematic issue)
   - Trigger backpressure when cluster-wide rate limit detected

6. **Comprehensive Test Coverage**
   - Test 429 classification in isolation
   - Test retry with jitter
   - Test circuit breaker fast-open for rate limits

### Definition of Done

- [ ] `classifyError("HTTP 429: Too Many Requests").type === 'rateLimited'`
- [ ] `classifyError("rate limit exceeded").type === 'rateLimited'`
- [ ] Ollama Retry-After header is parsed and honored
- [ ] Retry backoff includes random jitter (±25% variance)
- [ ] Circuit breaker opens after 2 rate limit failures (not 5)
- [ ] Retry budget prevents more than 10 total attempts per request

### Must Have

- 429 correctly classified as `rateLimited`, not `non-retryable`
- Retry with jitter prevents thundering herd
- Circuit breaker responds faster to rate limit errors

### Must NOT Have

- Permanent bans for rate limit errors (only cooldown + circuit open)
- Deterministic backoff that synchronized clients could abuse
- Generic "unknown" errors slipping through classification

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (bun test, jest patterns in codebase)
- **Automated tests**: YES (tests-after for new functionality)
- **Framework**: bun test + existing test patterns

### QA Policy
Every task includes agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/`.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation - 4 tasks, can run in parallel):
├── Task 1: Fix 429 error classification [quick]
├── Task 2: Add HTTP status code explicit handling for 429 [quick]
├── Task 3: Add Retry-After header support for Ollama [quick]
└── Task 4: Update error-classifier tests [quick]

Wave 2 (Retry Logic - 3 tasks, after Wave 1):
├── Task 5: Add jitter to exponential backoff [deep]
├── Task 6: Implement retry budget tracking [unspecified-high]
└── Task 7: Add retry budget to orchestrator failover [unspecified-high]

Wave 3 (Circuit Breaker - 3 tasks, after Wave 1):
├── Task 8: Fast-circuit-open for rate limit errors [deep]
├── Task 9: Add rate limit backoff scaling to circuit breaker [deep]
└── Task 10: Update circuit breaker tests [quick]

Wave 4 (Integration & Polish - 3 tasks, after Wave 2 & 3):
├── Task 11: Error correlation detection (cluster-wide rate limit) [unspecified-high]
├── Task 12: Integration test - full failover with rate limits [deep]
└── Task 13: Update config schema with new retry options [quick]

Wave FINAL (Verification - 4 tasks, after all implementation):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
```

### Dependency Matrix

- **1, 2, 3, 4**: - - 5, 6, 8, 9, 10, 2
- **5, 6, 7**: 1, 2, 3, 4 - 11, 12, 2
- **8, 9, 10**: 1, 2, 3, 4 - 11, 12, 2
- **11, 12, 13**: 5, 6, 7, 8, 9, 10 - F1-F4, 3
- **F1-F4**: 11, 12, 13 - - 

---

## TODOs

- [x] 1. **Fix 429 Error Classification**
  
  **What to do**:
  - In `src/utils/error-classifier.ts`, modify `classifyHttpStatus()` method
  - Add explicit check for status code 429 BEFORE the "Other 4xx errors" check
  - 429 should return `rateLimited` type, not `non-retryable`
  - Ensure pattern matching for "429" in text still works as fallback
  
  **Test cases**:
  - `classifyError("HTTP 429: Too Many Requests").type === 'rateLimited'`
  - `classifyError("429 rate limit exceeded").type === 'rateLimited'`
  - `classifyError("HTTP 400: Bad Request").type === 'non-retryable'` (unchanged)
  - `classifyError("HTTP 503: Service Unavailable").type === 'transient'` (unchanged)

  **Must NOT do**:
  - Don't change 400/401/403 classification - those are correctly non-retryable
  - Don't remove the pattern matching fallback for text-based "429" detection

  **Recommended Agent Profile**:
  - **Category**: `quick` - Small targeted fix with clear requirements
  - **Skills**: None required - straightforward error classifier modification

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Tasks 5, 6, 7, 8, 9, 10 (retry and circuit breaker work)
  - **Blocked By**: None (can start immediately)

  **References**:
  - `src/utils/error-classifier.ts:581-667` - `classifyHttpStatus()` method to modify
  - `src/utils/error-classifier.ts:439-463` - Existing rate limit pattern matching for reference
  - `src/utils/error-classifier.ts:280-281` - HTTP_STATUS_PATTERNS definitions

  **Acceptance Criteria**:
  - [ ] Test: `classifyError("HTTP 429: Too Many Requests")` returns `{ type: 'rateLimited', isRetryable: true }`
  - [ ] Test: `classifyError("429")` returns `{ type: 'rateLimited', isRetryable: true }`
  - [ ] Test: `classifyError("HTTP 400: Bad Request")` still returns `{ type: 'non-retryable' }`
  - [ ] `bun test src/utils/error-classifier.test.ts` passes

  **QA Scenarios**:
  ```
  Scenario: 429 status code classified as rateLimited
    Tool: Bash
    Preconditions: None
    Steps:
      1. cd /root/ollama-orchestrator
      2. bun run test:unit error-classifier 2>/dev/null || echo "Run manually: bun test src/utils/error-classifier.test.ts"
    Expected Result: All error classifier tests pass, including 429 classification
    Evidence: .sisyphus/evidence/task-1-classify-429-pass.txt

  Scenario: 429 pattern in text still detected
    Tool: Bash
    Preconditions: None
    Steps:
      1. node -e "const { ErrorClassifier } = require('./dist/utils/error-classifier.js'); const c = new ErrorClassifier(); console.log(JSON.stringify(c.classify('429 rate limit exceeded')))"
    Expected Result: {"type":"rateLimited","isRetryable":true,...}
    Evidence: .sisyphus/evidence/task-1-pattern-429-pass.txt
  ```

  **Commit**: YES (groups with 2, 3, 4)
  - Message: `fix(error-classifier): correctly classify HTTP 429 as rateLimited not non-retryable`
  - Files: `src/utils/error-classifier.ts`, `src/utils/error-classifier.test.ts`

---

- [x] 2. **Add HTTP Status Code Explicit Handling for Rate Limits**
  
  **What to do**:
  - Add 429 to `HTTP_STATUS_PATTERNS.rateLimitCodes` array
  - Create separate handling for rate limit status codes in `classifyHttpStatus()`
  - Ensure rate limit HTTP codes return proper `rateLimited` classification with appropriate retry strategy (5min base backoff)

  **Must NOT do**:
  - Don't remove existing pattern matching - it still catches text-based rate limits
  - Don't treat other 4xx codes the same as 429

  **Recommended Agent Profile**:
  - **Category**: `quick` - Small modification to error patterns
  
  **References**:
  - `src/utils/error-classifier.ts:275-282` - HTTP_STATUS_PATTERNS definition
  - `src/utils/error-classifier.ts:588-603` - How retryableServerErrors are handled

  **Acceptance Criteria**:
  - [ ] `HTTP_STATUS_PATTERNS.rateLimitCodes` includes 429
  - [ ] 429 triggers rateLimited with retryStrategy.initialDelay === 300000 (5 min)

---

- [x] 3. **Add Retry-After Header Support for Ollama**
  
  **What to do**:
  - In `src/utils/rate-limit-backoff.ts`, modify Ollama handling to check for Retry-After header
  - The current code assumes Ollama doesn't support Retry-After, but we should verify and honor it if present
  - Use `parseRetryAfter()` to extract delay from header

  **Must NOT do**:
  - Don't break existing OpenAI/Anthropic Retry-After handling
  - Don't remove exponential backoff fallback if header is missing/invalid

  **Recommended Agent Profile**:
  - **Category**: `quick` - Small utility modification
  
  **References**:
  - `src/utils/rate-limit-backoff.ts:26-50` - `calculateRateLimitBackoff()` function
  - `src/utils/retry-after.ts:68-111` - `parseRetryAfter()` function
  - `src/config/config.ts:415-419` - RateLimitConfig interface

  **Acceptance Criteria**:
  - [ ] Ollama provider checks Retry-After header before falling back to exponential
  - [ ] Invalid/missing Retry-After still uses exponential backoff
  - [ ] Parsed delay capped at `config.maxRetryAfterMs`

---

- [x] 4. **Update Error-Classifier Tests**
  
  **What to do**:
  - Add test cases for 429 classification specifically
  - Add test for "Too Many Requests" text matching
  - Ensure all existing tests still pass

  **Recommended Agent Profile**:
  - **Category**: `quick` - Test file modification
  
  **References**:
  - `src/utils/error-classifier.test.ts` - Existing test file structure

---

- [x] 5. **Add Jitter to Exponential Backoff**
  
  **What to do**:
  - Modify `calculateExponentialBackoff()` in `rate-limit-backoff.ts` to add random jitter
  - Jitter should be ±25% of the calculated delay (uniform distribution)
  - Add configurable jitter factor via config (default 0.25)
  - This prevents thundering herd when multiple clients retry simultaneously

  **Must NOT do**:
  - Don't remove the base exponential calculation - jitter should multiply, not replace
  - Don't make jitter so large it causes unnecessary delays

  **Recommended Agent Profile**:
  - **Category**: `deep` - Requires understanding of backoff math and avoiding regressions
  
  **References**:
  - `src/utils/rate-limit-backoff.ts:60-67` - `calculateExponentialBackoff()` function
  - `src/config/config.ts` - RateLimitConfig for jitter configuration

  **Acceptance Criteria**:
  - [ ] `calculateExponentialBackoff(0, 1000, 5000)` returns value between 750-1250ms (±25%)
  - [ ] Multiple consecutive calls return different values (jitter working)
  - [ ] Config option `jitterFactor: 0.2` reduces jitter to ±20%

---

- [x] 6. **Implement Retry Budget Tracking**
  
  **What to do**:
  - Create new `RetryBudget` class to track total retry attempts per request
  - Budget tracks: attempts used, max attempts, server distribution
  - Budget exhausted → fail immediately with clear error (don't keep retrying)
  - Prevent system from being overwhelmed by runaway retry loops

  **Must NOT do**:
  - Don't confuse retry budget with per-server maxRetries (they work together)
  - Don't make budget so small legitimate retries fail

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` - New class with state management
  
  **References**:
  - `src/orchestrator/orchestrator.ts:2746-2994` - `tryRequestOnServerWithRetries()` uses budget concept
  - `src/config/config.ts:402-408` - RetryConfig for budget configuration

  **Acceptance Criteria**:
  - [ ] RetryBudget class tracks attempts per request
  - [ ] Budget defaults to 10 max attempts across all servers
  - [ ] When budget exhausted, failover loop exits with error

---

- [x] 7. **Add Retry Budget to Orchestrator Failover**
  
  **What to do**:
  - Integrate RetryBudget into `tryRequestWithFailover()` method
  - Pass budget through Phase 1, 2, 3 failover
  - When budget exhausted at any phase, stop retrying immediately
  - Add budget info to routing context for debugging

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` - Integration work in orchestrator
  
  **References**:
  - `src/orchestrator/orchestrator.ts:1680-2323` - `tryRequestWithFailover()` method

---

- [x] 8. **Fast-Circuit-Open for Rate Limit Errors**
  
  **What to do**:
  - In circuit breaker, when error type is `rateLimited`, open after only 2 failures (not 3-5)
  - Add `rateLimitFailureThreshold` config option (default: 2)
  - Track `rateLimitConsecutiveFailures` separately and trigger fast open

  **Must NOT do**:
  - Don't open on first failure - allow at least 2 attempts before hard open
  - Don't change regular failure threshold behavior (still uses adaptive threshold)

  **Recommended Agent Profile**:
  - **Category**: `deep` - Circuit breaker state machine modification
  
  **References**:
  - `src/circuit-breaker/circuit-breaker.ts:479-570` - `recordFailure()` method
  - `src/circuit-breaker/circuit-breaker.ts:547-569` - Closed state failure handling

  **Acceptance Criteria**:
  - [ ] 2 consecutive `rateLimited` failures opens circuit (vs 3+ for generic errors)
  - [ ] Config option `rateLimitFailureThreshold: 1` enables single-failure open
  - [ ] Non-rate-limit errors still use adaptive threshold (3-5)

---

- [x] 9. **Add Rate Limit Backoff Scaling to Circuit Breaker**
  
  **What to do**:
  - In circuit breaker `getBackoffForErrorType()`, rate limit backoff should scale faster
  - Current: `rateLimitBaseMs * rateLimitMultiplier ^ failures` (5min, 15min, 45min)
  - Make this configurable: base, multiplier, max should all be adjustable
  - Add separate `rateLimitBackoffMultiplier` that overrides general multiplier for rate limits

  **Recommended Agent Profile**:
  - **Category**: `deep` - Backoff calculation modification
  
  **References**:
  - `src/utils/recovery-backoff.ts:181-190` - Rate limit backoff calculation
  - `src/circuit-breaker/circuit-breaker.ts:941-953` - `getBackoffForErrorType()` method

---

- [x] 10. **Update Circuit Breaker Tests**
  
  **What to do**:
  - Add test for fast-circuit-open on rate limit
  - Add test for rate limit backoff scaling
  - Ensure existing CB tests still pass

---

- [x] 11. **Error Correlation Detection (Cluster-Wide Rate Limit)**
  
  **What to do**:
  - Create `ErrorAggregator` class that tracks errors across all servers
  - Detect when N servers fail with the same error within T time window
  - If cluster-wide rate limit detected: trigger backpressure, slow down client
  - Add API endpoint to expose cluster error summary

  **Must NOT do**:
  - Don't block requests - just add delay and signal to clients
  - Don't trigger on unrelated errors (only rate limits)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` - New class with complex state
  
  **References**:
  - `src/utils/ban-manager.ts` - Similar pattern for tracking failures
  - `src/orchestrator/orchestrator.ts` - Where to integrate aggregation

  **Acceptance Criteria**:
  - [ ] ErrorAggregator tracks errors by type across servers
  - [ ] 5+ servers with rate limit errors in 10 seconds → cluster rate limit detected
  - [ ] Cluster rate limit adds 30s backoff to all new requests

---

- [x] 12. **Integration Test - Full Failover with Rate Limits**
  
  **What to do**:
  - Create integration test that:
    1. Has 3 servers, all with model available
    2. Server 1 returns 429
    3. Verify failover to Server 2 succeeds
    4. Server 2 returns 429
    5. Verify failover to Server 3 succeeds
    6. Server 3 returns 429
    7. Verify all servers correctly marked and request fails with clear error

  **Recommended Agent Profile**:
  - **Category**: `deep` - Complex integration test
  
  **References**:
  - `tests/integration/` - Existing integration test patterns

---

- [x] 13. **Update Config Schema with New Retry Options**
  
  **What to do**:
  - Add new config options:
    - `retry.jitterFactor: 0.25` - Jitter variance
    - `retry.maxBudget: 10` - Max total attempts
    - `circuitBreaker.rateLimitFailureThreshold: 2`
    - `rateLimit.jitterFactor` - Per-provider jitter override

  **Recommended Agent Profile**:
  - **Category**: `quick` - Config schema update
  
  **References**:
  - `src/config/schema.ts` - Config schema definition
  - `src/config/config.ts` - Where defaults are defined

---

## Final Verification Wave

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns. Check evidence files.

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + linter + tests. Review changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code.

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute every QA scenario from every task. Test with actual 429 responses if possible.

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: verify 1:1 — everything in spec was built, nothing beyond spec was built.

---

## Success Criteria

### Verification Commands
```bash
# 429 Classification
node -e "const { ErrorClassifier } = require('./dist/utils/error-classifier.js'); const c = new ErrorClassifier(); console.log(c.classify('HTTP 429: Too Many Requests').type)" 
# Expected: rateLimited

# Retry with jitter (should show variance)
for i in {1..5}; do node -e "const {calculateExponentialBackoff} = require('./dist/utils/rate-limit-backoff.js'); console.log(calculateExponentialBackoff(0, 1000, 5000))"; done
# Expected: 5 different values between 750-1250

# Circuit breaker fast-open
curl http://localhost:5100/api/orchestrator/circuit-breakers/{server}/{model}/stats | jq '.failureCount'
# After 2 rate limits, should show state: 'open'
```

### Final Checklist
- [ ] All 429 error messages classified as `rateLimited`
- [ ] Retry-After header honored for Ollama
- [ ] Jitter prevents thundering herd
- [ ] Retry budget prevents runaway retries
- [ ] Circuit breaker opens faster for rate limits (2 failures not 5)
- [ ] Error aggregation detects cluster-wide issues