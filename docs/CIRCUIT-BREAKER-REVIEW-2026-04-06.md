# Circuit Breaker Implementation Review

**Date**: 2026-04-06
**Status**: Complete
**Reviewer**: Sisyphus

---

## Executive Summary

The circuit breaker implementation is a production-grade 3-state machine with adaptive thresholds, error classification, and server-level coordination. However, several issues undermine its reliability and debuggability.

---

## Architecture

### Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/circuit-breaker/circuit-breaker.ts` | 1207 | Core state machine |
| `src/circuit-breaker/circuit-breaker-persistence.ts` | 140 | SQLite persistence |
| `src/utils/error-classifier.ts` | 732 | Error classification |
| `src/utils/recovery-backoff.ts` | 196 | Backoff calculations |
| `src/recovery-test-coordinator.ts` | 1475 | Active test coordination |
| `src/controllers/circuit-breaker-controller.ts` | 108 | REST API |

### State Machine

```
CLOSED ──(failures >= threshold)──► OPEN
   ▲                                │
   │                    ┌───────────┘ (timeout + consecutiveFailedRecoveries < 5)
   │                    ▼
   └──(recoverySuccessThreshold successes)◄── HALF-OPEN
                         │
                         └────────────(any failure)──► OPEN
```

---

## Issues Found

### HIGH Priority

#### 1. Recovery History Not Persisted
**File**: `circuit-breaker-persistence.ts`
**Issue**: `consecutiveFailedRecoveries` is not persisted. On restart, recovery history is lost.
**Impact**: Starvation guard (GAP-CB-5) fails to prevent repeated recovery attempts after restart.
**Recommendation**: Persist `consecutiveFailedRecoveries` and `halfOpenAttempts`.

#### 2. Hardcoded Starvation Guard Threshold
**File**: `circuit-breaker.ts:339`
**Issue**: The `consecutiveFailedRecoveries >= 5` ceiling is not configurable.
**Impact**: Cannot tune recovery behavior for different deployment scenarios.
**Recommendation**: Make threshold configurable via `CircuitBreakerConfig`.

---

### MEDIUM Priority

#### 3. Error Classification Inconsistency
**File**: `error-classifier.ts`
**Issue**: HTTP 500 triggers `shouldCircuitBreak: true` but transient errors (timeouts) get `shouldCircuitBreak: false`.
**Impact**: 500 errors open circuits immediately; timeouts accumulate but don't trigger opening.
**Recommendation**: Align classification — either all 5xx should circuit-break, or define clearer semantics.

#### 4. Backoff Calculation Ignores Failure Reason
**File**: `circuit-breaker.ts:890`
**Issue**: `getBackoffForErrorType` passes `undefined` for `failureReason`:
```typescript
return calculateCircuitBreakerBackoff(
  errorType,
  undefined,  // failureReason not passed!
  this.consecutiveFailedRecoveries,
  retryAfterMs,
  this.config.backoff
);
```
**Impact**: `categorizeError()` in recovery-backoff.ts cannot use reason-based heuristics.
**Recommendation**: Pass `this.lastFailureReason` to backoff calculation.

#### 5. Test vs Production Divergence
**File**: Multiple
**Issue**: Test defaults use permissive settings (`errorRateThreshold: 1.0`, `adaptiveThresholds: false`) while production uses stricter values.
**Impact**: Tests may pass but behavior differs in production.
**Recommendation**: Use production config in integration tests, or clearly document divergence.

---

### LOW Priority

#### 6. Dynamic Import in Hot Path
**File**: `circuit-breaker.ts:964`
**Issue**: `performRecoveryTest()` uses dynamic import:
```typescript
const { getRecoveryTestCoordinator } = await import('../recovery-test-coordinator.js');
```
**Impact**: Minor overhead on every recovery test call.
**Recommendation**: Inject coordinator via constructor or cache reference.

#### 7. Unclear `canAttempt()` vs `canExecute()` Semantics
**File**: `circuit-breaker.ts`
**Issue**: Two methods with overlapping but distinct purposes.
**Recommendation**: Add clear documentation or rename for clarity.

---

## Positive Findings

1. **GAP markers** clearly document known limitations
2. **Promise-chain mutex** prevents race conditions (GAP-CB-4)
3. **Half-open jitter** prevents thundering herd
4. **Model type inference** from names
5. **Learned rate limit backoff** remembers successful strategies
6. **Flapping detection** dynamically adjusts thresholds
7. **Model escalation** to server-level breakers

---

## Recommendations

| Priority | Action | Effort |
|----------|--------|--------|
| High | Persist `consecutiveFailedRecoveries` and `halfOpenAttempts` | Medium |
| High | Make starvation guard threshold configurable | Low |
| Medium | Fix `getBackoffForErrorType` to pass `failureReason` | Low |
| Medium | Align test and production configs | Medium |
| Low | Replace dynamic import with injected dependency | Low |

---

## Test Coverage

| Test Suite | Coverage |
|------------|----------|
| Unit tests | Basic state transitions, registry |
| Enhanced tests | Edge cases, force operations |
| Chaos tests | Concurrent load, rapid transitions |
| Integration tests | REST API |
| Persistence tests | Persistence layer |

**Gap**: No test for starvation guard under realistic recovery failure scenarios.

---

## Deep Integration Analysis

### Request Flow

```
Request → shouldSkipServerModel() [pre-filter, uses canAttempt()]
                    ↓
              Load Balancer Score Calculation [uses canAttempt(), not canExecute()]
                    ↓
              canExecute() [actually uses breaker, may transition state]
                    ↓
              Request executes → recordSuccess() or recordFailure()
```

### Key Integration Points

1. **Pre-filtering** (`orchestrator.ts:4322`): `shouldSkipServerModel()` uses `canAttempt()` (read-only) to filter out OPEN/HALF-OPEN breakers before scoring.

2. **Load Balancer Scoring** (`load-balancer.ts:264-281`):
   - OPEN breaker = score 5
   - HALF-OPEN = score 20
   - CLOSED = 100 - (failureCount * 5)
   - Note: OPEN/HALF-OPEN are pre-filtered, so this mainly affects debug UI

3. **Recovery Test Execution** (`orchestrator.ts:2694-2730`):
   - Calls `coordinator.performCoordinatedRecoveryTest()`
   - On failure: calls `failedBreaker.recordFailure(new Error(errorMsg), 'transient')`
   - **Issue**: Error type hardcoded to `'transient'`, losing original error classification

4. **State Transitions on Timeout** (`orchestrator.ts:3913-3917`):
   - Half-open timeout triggers `breaker.forceOpen()` directly
   - Does NOT record a failure, just forces open state
   - This bypasses normal failure recording and consecutiveFailedRecoveries tracking

### Issues Found in Integration

#### Integration Issue 1: Half-Open Timeout Uses forceOpen() Instead of recordFailure()
**File**: `orchestrator.ts:3913-3917`
```typescript
logger.warn(
  `Half-open breaker ${breakerName} timed out after ${timeInHalfOpen}ms...`
);
breaker.forceOpen();  // Direct state change, no failure recorded
```
**Impact**: `consecutiveFailedRecoveries` is NOT incremented when half-open times out. The starvation guard never triggers for timeout-based reopenings.

#### Integration Issue 2: Recovery Test Failure Uses Hardcoded 'transient' Error Type
**File**: `orchestrator.ts:2718`
```typescript
failedBreaker.recordFailure(new Error(errorMsg), 'transient');
```
**Impact**: Original error classification is lost. A 401 auth error during recovery test gets treated as transient, getting 2-minute backoff instead of 48-hour backoff.

#### Integration Issue 3: Passive Timeout Check Before Active tests Check
**File**: `orchestrator.ts:3905`
```typescript
if (timeInHalfOpen > config.halfOpenTimeout) {
  if (stats.activeTestsInProgress && stats.activeTestsInProgress > 0) {
    // Skip timeout if tests in progress
    continue;
  }
  breaker.forceOpen();
}
```
**Good**: Active tests prevent timeout-triggered reopen.
**But**: The timeout check happens every 30s (orchestrator polling interval), not continuously.

---

## Additional Findings

### Error Classification Complexity
The `ErrorClassifier` (732 lines) has grown beyond a simple utility:

| Category | Patterns | Should Circuit Break |
|----------|----------|---------------------|
| retryable | unknown errors | true |
| non-retryable | 401, 404, OOM | true |
| transient | timeouts, rate limits | **false** (line 418, 436) |
| permanent | runner terminated | true |
| rateLimited | 429, rate limit | true |

**Inconsistency**: `transient` errors (timeouts) don't trigger circuit breaking, but they're recorded in the sliding window for error rate calculation. This means a server timing out 100 times will have 0% circuit break triggered but 100% error rate.

### Sliding Window Memory Leak Potential
**File**: `circuit-breaker.ts:221-223`
```typescript
private cleanup(now: number): void {
  const cutoff = now - this.windowSize;
  this.window = this.window.filter(e => e.timestamp > cutoff);
}
```
The sliding window stores ALL events. Under high load with many successes, this could grow unbounded between cleanup calls.

---

## Improvement Recommendations (Updated)

| Priority | Issue | Location | Fix |
|----------|-------|----------|-----|
| High | Half-open timeout doesn't record failure | orchestrator.ts:3916 | Call `recordFailure()` instead of `forceOpen()`, or increment `consecutiveFailedRecoveries` manually |
| High | Recovery test loses error classification | orchestrator.ts:2718 | Pass actual error type instead of hardcoded `'transient'` |
| High | Recovery history not persisted | circuit-breaker-persistence.ts | Add `consecutiveFailedRecoveries`, `halfOpenAttempts` to persistence |
| Medium | Hardcoded starvation threshold | circuit-breaker.ts:339 | Make configurable via `CircuitBreakerConfig` |
| Medium | `getBackoffForErrorType` ignores failureReason | circuit-breaker.ts:890 | Pass `this.lastFailureReason` to backoff calculation |
| Low | Dynamic import in hot path | circuit-breaker.ts:964 | Cache coordinator reference in constructor |
| Low | `canAttempt()` semantics unclear | circuit-breaker.ts:377 | Rename to `isAvailable()` or document better |
