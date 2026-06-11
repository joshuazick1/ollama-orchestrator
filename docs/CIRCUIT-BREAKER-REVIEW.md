# Circuit Breaker Architecture Review

**Date:** April 2026
**Status:** Complete
**Files Analyzed:**

- `src/circuit-breaker/circuit-breaker.ts` (1262 lines)
- `src/utils/error-classifier.ts` (732 lines)
- `src/utils/recovery-backoff.ts` (196 lines)

---

## 1. Architecture Overview

The circuit breaker implements a **three-state machine** (closed → open → half-open → closed) with:

- Adaptive failure thresholds
- Error-type-aware backoff calculation
- Sliding window error rate tracking
- Concurrent recovery test coordination
- Starvation guard to prevent infinite retry cycles

### 1.1 State Machine Diagram

```
                    ┌──────────────────────────────────────────────────┐
                    │                                                  │
                    ▼                                                  │
              ┌──────────┐         failure threshold met         ┌─────┴───┐
   ┌─────────│  CLOSED  │──────────────────────────────────────▶│  OPEN  │
   │         └──────────┘                                        └────┬───┘
   │              ▲                                                    │
   │              │ success ≥ recoverySuccessThreshold                 │
   │              │                                                    │
   │              │                                                    ▼
   │    ┌─────────┴─────────┐                              ┌─────────────────┐
   └────│     HALF-OPEN      │◀─────────────────────────────│ (timeout expired│
        └───────────────────┘   any circuit-breaking          │  or failure)    │
                               failure                        └─────────────────┘
```

### 1.2 Key Components

| Component                          | Purpose                                                  |
| ---------------------------------- | -------------------------------------------------------- |
| `CircuitBreaker`                   | Core state machine and threshold logic                   |
| `CircuitBreakerRegistry`           | Manages multiple breakers by name                        |
| `SlidingWindow`                    | Tracks errors/successes with time-based eviction         |
| `ErrorClassifier`                  | Classifies errors to determine circuit-breaking behavior |
| `RecoveryTestCoordinator`          | Coordinates half-open recovery tests                     |
| `calculateCircuitBreakerBackoff()` | Computes open→half-open delay                            |

---

## 2. Error Classification Integration

### 2.1 Classification Flow

**Location:** `circuit-breaker.ts:479-509`

```
recordFailure() → classifyError() → ErrorClassifier.classify()
                    │
                    └─→ shouldCircuitBreak: true  → count toward threshold
                        shouldCircuitBreak: false → log only, no state change
```

### 2.2 Error Types

**Location:** `error-classifier.ts:11`

```typescript
type ErrorType = 'retryable' | 'non-retryable' | 'transient' | 'permanent' | 'rateLimited';
```

### 2.3 Classification Logic

**Location:** `error-classifier.ts:344-478`

Errors are checked in priority order:

| Priority | Pattern Category | Error Type      | shouldCircuitBreak | Example                                 |
| -------- | ---------------- | --------------- | ------------------ | --------------------------------------- |
| 1        | `ignore`         | `non-retryable` | **false**          | "does not support generate"             |
| 2        | `nonRetryable`   | `non-retryable` | **true**           | "not found", "invalid", "out of memory" |
| 3        | `rateLimit`      | `rateLimited`   | **true**           | "rate limit", "too many requests"       |
| 4        | `transient`      | `transient`     | **false**          | "timeout", "temporarily unavailable"    |
| 5        | `network`        | `transient`     | **false**          | "econnrefused", "connection reset"      |
| 6        | `resource`       | `retryable`     | **false**          | "busy", "overloaded", "capacity"        |
| 7        | HTTP status      | Varies          | Varies             | 4xx → non-retryable, 5xx retryable      |
| 8        | Default          | `retryable`     | **true**           | Unknown errors                          |

### 2.4 Critical Behavior

**Location:** `circuit-breaker.ts:492-508`

> **Key Finding:** Errors where `shouldCircuitBreak = false` are **recorded in the sliding window** for statistics but **do NOT trigger state transitions**.

```typescript
const classification = this.errorClassifier.classify(error);
if (!classification.shouldCircuitBreak) {
  // Log but don't trigger circuit breaker state changes
  logger.debug('Error recorded but not counted toward circuit breaker state', {...});
  this.lastFailureReason = error instanceof Error ? error.message : String(error);
  this.lastErrorType = classifiedType;
  return;  // <-- Early return, no state change
}
```

### 2.5 Ignored Errors (Non-Circuit-Breaking)

**Location:** `error-classifier.ts:166-175`

These errors should NOT open circuits:

- Embedding model errors ("does not support generate", "cannot generate embeddings")
- Wrong model type errors

---

## 3. Failure Threshold Logic

### 3.1 Opening Conditions

**Location:** `circuit-breaker.ts:547-568`

Circuit opens from CLOSED when **either** condition is met:

```typescript
if (
  this.failureCount >= currentThreshold ||          // Condition 1: Failure count
  this.errorRate > this.config.errorRateThreshold   // Condition 2: Error rate
) {
  this.transitionTo('open');
  this.nextRetryAt = now + this.getBackoffForErrorType(...);
}
```

### 3.2 Adaptive Threshold Calculation

**Location:** `circuit-breaker.ts:1061-1097`

```typescript
private getAdaptiveThreshold(): number {
  if (!this.config.adaptiveThresholds) {
    return this.config.baseFailureThreshold;
  }

  const errorCounts = this.window.getErrorTypeCounts();
  const totalErrors = Object.values(errorCounts).reduce((a, b) => a + b, 0);

  // If mostly non-retryable/permanent errors → use MIN threshold (faster opening)
  const nonRetryableRatio = (errorCounts['non-retryable'] + errorCounts['permanent']) / totalErrors;
  if (nonRetryableRatio > this.config.nonRetryableRatioThreshold) {
    return Math.max(this.config.minFailureThreshold,
                    this.config.baseFailureThreshold - this.config.adaptiveThresholdAdjustment);
  }

  // If mostly transient/retryable errors → use MAX threshold (more tolerant)
  const transientRatio = (errorCounts['transient'] + errorCounts['retryable']) / totalErrors;
  if (transientRatio > this.config.transientRatioThreshold) {
    return Math.min(this.config.maxFailureThreshold,
                    this.config.baseFailureThreshold + this.config.adaptiveThresholdAdjustment);
  }

  return this.config.baseFailureThreshold;
}
```

### 3.3 Sliding Window Error Rate

**Location:** `circuit-breaker.ts:176-231`

```typescript
class SlidingWindow {
  add(success: boolean, errorType?: ErrorType): void {
    // Adds entry with timestamp
    // Evicts entries older than windowSize
  }

  getErrorRate(): number {
    // failures / total in window
  }

  getErrorTypeCounts(): Record<ErrorType, number> {
    // Counts by error type
  }
}
```

---

## 4. State Transition Logic

### 4.1 CLOSED → OPEN

**Location:** `circuit-breaker.ts:547-568`

```
Conditions (OR):
- failureCount >= currentThreshold
- errorRate > errorRateThreshold (default 1.0 = 100%)
```

### 4.2 OPEN → HALF-OPEN

**Location:** `circuit-breaker.ts:310-364`

```
Conditions:
- now >= nextRetryAt (backoff expired)
- NOT _transitioning (prevent concurrent transitions)
- consecutiveFailedRecoveries < maxConsecutiveFailedRecoveries (starvation guard)
```

**Starvation Guard (GAP-CB-5):**

```typescript
if (this.consecutiveFailedRecoveries >= 3) {
  let baseTimeout = this.config.openTimeout;
  // Extended backoff for permanent/non-retryable errors
  if (this.lastErrorType === 'permanent' || this.lastErrorType === 'non-retryable') {
    baseTimeout = Math.max(baseTimeout, 3600000); // 1 hour minimum
  }
  // Exponential backoff multiplier grows with consecutive failures
  const backoffMultiplier = Math.min(10, Math.pow(2, this.consecutiveFailedRecoveries - 3));
  const extendedTimeout = baseTimeout * backoffMultiplier;
  this.nextRetryAt = now + extendedTimeout;
}
```

### 4.3 HALF-OPEN → CLOSED

**Location:** `circuit-breaker.ts:427-467`

```
Conditions:
- consecutiveSuccesses >= recoverySuccessThreshold (default: 5)
```

**On success:**

- Resets `failureCount`, `consecutiveSuccesses`, `halfOpenRequestCount`, `activeTestsInProgress`
- Resets `consecutiveFailedRecoveries` to 0
- Learns rate limit backoff if recovered from rate limit

### 4.4 HALF-OPEN → OPEN (Failure)

**Location:** `circuit-breaker.ts:516-546`

```
Condition:
- Any error where shouldCircuitBreak = true
```

**Behavior:**

- Increments `consecutiveFailedRecoveries`
- Applies error-type-specific backoff (48h for non-retryable, 24h for permanent, etc.)
- Resets half-open tracking

### 4.5 Half-Open Timeout

**Location:** `circuit-breaker.ts:794-824`

```
Condition:
- timeInHalfOpen > halfOpenTimeout (default: 300000ms = 5 minutes)
- activeTestsInProgress = 0
```

**Behavior:**

- Calls `recordFailure()` to increment `consecutiveFailedRecoveries`
- Transitions to OPEN

### 4.6 State Transition Summary Table

| From      | To        | Trigger                                                      | Location |
| --------- | --------- | ------------------------------------------------------------ | -------- |
| CLOSED    | OPEN      | `failureCount >= threshold` OR `errorRate > threshold`       | :547-568 |
| OPEN      | HALF-OPEN | `now >= nextRetryAt` AND `consecutiveFailedRecoveries < max` | :310-364 |
| HALF-OPEN | CLOSED    | `consecutiveSuccesses >= recoverySuccessThreshold`           | :427-467 |
| HALF-OPEN | OPEN      | Circuit-breaking failure                                     | :516-546 |
| HALF-OPEN | OPEN      | `halfOpenTimeout` expired                                    | :794-824 |

---

## 5. Backoff Calculation

### 5.1 Circuit Breaker Backoff (OPEN → HALF-OPEN)

**Location:** `recovery-backoff.ts:163-196`

```typescript
export function calculateCircuitBreakerBackoff(
  errorType: ErrorType,
  failureReason?: string,
  consecutiveFailures: number = 0,
  retryAfterMs?: number,
  backoffConfig?: CircuitBreakerBackoffConfig
): number {
  switch (errorType) {
    case 'permanent':
      return 24 * 60 * 60 * 1000; // 24 hours
    case 'non-retryable':
      return 48 * 60 * 60 * 1000; // 48 hours
    case 'retryable':
      return 12 * 60 * 60 * 1000; // 12 hours
    case 'rateLimited':
      return retryAfterMs ?? Math.min(300000 * Math.pow(3, consecutiveFailures), 3600000);
    case 'transient':
    default:
      return 2 * 60 * 1000; // 2 minutes
  }
}
```

### 5.2 Rate Limit Backoff Details

**Location:** `circuit-breaker.ts:958-976`

```typescript
private getRateLimitBackoff(): number {
  const baseBackoff = this.config.backoff?.rateLimitBaseMs ?? 300000;      // 5 min
  const maxBackoff = this.config.backoff?.rateLimitMaxMs ?? 3600000;        // 60 min
  const multiplier = this.config.backoff?.rateLimitMultiplier ?? 3;

  // Uses learned backoff if available and no consecutive failures
  if (this.learnedRateLimitBackoff && this.rateLimitConsecutiveFailures === 0) {
    return this.learnedRateLimitBackoff;
  }

  // Exponential: 5min → 15min → 45min → 60min (capped)
  return Math.min(baseBackoff * Math.pow(multiplier, this.rateLimitConsecutiveFailures), maxBackoff);
}
```

### 5.3 Hardcoded Backoff Arrays

**Location:** `circuit-breaker.ts:167-173` (DEFAULT_CIRCUIT_BREAKER_CONFIG.backoff)

```typescript
backoff: {
  standardDelaysMs: [30000, 60000, 120000, 240000, 480000, 900000, 1800000, 1800000],
  permanentDelaysMs: [300000, 600000, 1200000, 2400000, 3600000],
  rateLimitBaseMs: 300000,        // 5 minutes
  rateLimitMultiplier: 3,
  rateLimitMaxMs: 3600000,       // 60 minutes
}
```

### 5.4 Active Test Timeout

**Location:** `recovery-backoff.ts:118-146`

```typescript
export function calculateActiveTestTimeout(attempt, baseTimeout = 120000, ...): number {
  // Model capability errors: 5 seconds (fail fast)
  if (reason.includes('does not support generate') || ...) {
    return 5000;
  }

  // Permanent/non-retryable: 15 seconds
  if (errorType === 'non-retryable' || errorType === 'permanent') {
    return 15000;
  }

  // Others: gentle 1x → 3x multiplier, max 5 minutes
  const multiplier = Math.min(1 + 0.5 * attempt, 3);
  return Math.min(baseTimeout * multiplier, 300000);
}
```

---

## 6. Recovery Testing Logic

### 6.1 Recovery Test Flow

**Location:** `circuit-breaker.ts:1011-1035`

```
performRecoveryTest()
  │
  ├─→ Import RecoveryTestCoordinator
  │
  └─→ coordinator.performCoordinatedRecoveryTest(this)
        │
        ├─→ Server-level breaker: lightweight /api/tags test
        │
        ├─→ Model-level breaker: full inference test with server coordination
        │
        ├─→ Server cooldown periods between tests
        │
        ├─→ In-flight request checking
        │
        └─→ One model test per server at a time
```

### 6.2 Half-Open Request Handling

**Location:** `circuit-breaker.ts:366-371`

> **Important:** In HALF-OPEN state, `canExecute()` returns `false` for regular requests. Recovery tests must use `performRecoveryTest()` explicitly.

```typescript
case 'half-open': {
  // In half-open state, do not allow direct requests
  // Recovery testing should be handled separately by calling performRecoveryTest()
  this.blockedRequestCount++;
  return false;
}
```

### 6.3 Half-Open Timeout Check

**Location:** `circuit-breaker.ts:794-824`

```typescript
checkHalfOpenTimeout(): boolean {
  if (this.state !== 'half-open') {
    return false;
  }

  const timeInHalfOpen = now - this.halfOpenStartedAt;

  if (timeInHalfOpen > this.config.halfOpenTimeout) {
    // Record failure to increment consecutiveFailedRecoveries
    this.recordFailure(new Error(`Half-open timeout after ${timeInHalfOpen}ms`), 'transient');
    return true;
  }

  return false;
}
```

### 6.4 Active Test Tracking

**Location:** `circuit-breaker.ts:700-714`

```typescript
startActiveTest(): void {
  this.activeTestsInProgress++;
}

endActiveTest(): void {
  if (this.activeTestsInProgress > 0) {
    this.activeTestsInProgress--;
  }
}
```

### 6.5 Random Jitter on Half-Open Transition

**Location:** `circuit-breaker.ts:1133-1142`

```typescript
if (newState === 'half-open') {
  // Add random jitter (0-30s) to prevent stampede
  const jitter = process.env.NODE_ENV === 'test' ? 0 : Math.floor(Math.random() * 30000);
  this.halfOpenStartedAt = Date.now() + jitter;
}
```

---

## 7. Hardcoded Thresholds & Configuration

### 7.1 Hardcoded Values

| Value                            | Location               | Hardcoded | Configurable | Default                   |
| -------------------------------- | ---------------------- | --------- | ------------ | ------------------------- |
| `baseFailureThreshold`           | circuit-breaker.ts:114 | Yes       | Yes          | 3 (test), 5 (prod)        |
| `maxFailureThreshold`            | circuit-breaker.ts:115 | Yes       | Yes          | 8 (test), 10 (prod)       |
| `minFailureThreshold`            | circuit-breaker.ts:116 | Yes       | Yes          | 2 (test), 3 (prod)        |
| `openTimeout`                    | circuit-breaker.ts:117 | Yes       | Yes          | 120000ms (2 min)          |
| `halfOpenTimeout`                | circuit-breaker.ts:118 | Yes       | Yes          | 300000ms (5 min)          |
| `halfOpenMaxRequests`            | circuit-breaker.ts:119 | Yes       | Yes          | 3                         |
| `recoverySuccessThreshold`       | circuit-breaker.ts:120 | Yes       | Yes          | 5                         |
| `activeTestTimeout`              | circuit-breaker.ts:121 | Yes       | Yes          | 300000ms (5 min)          |
| `maxHalfOpenPerServer`           | circuit-breaker.ts:122 | Yes       | Yes          | 3                         |
| `maxConsecutiveFailedRecoveries` | circuit-breaker.ts:123 | Yes       | Yes          | 5                         |
| `errorRateWindow`                | circuit-breaker.ts:124 | Yes       | Yes          | 60000ms (1 min)           |
| `errorRateThreshold`             | circuit-breaker.ts:127 | Yes       | Yes          | 1.0 (test), 0.3 (prod)    |
| `adaptiveThresholds`             | circuit-breaker.ts:131 | Yes       | Yes          | false (test), true (prod) |
| `errorRateSmoothing`             | circuit-breaker.ts:132 | Yes       | Yes          | 0.3                       |
| `adaptiveThresholdAdjustment`    | circuit-breaker.ts:158 | Yes       | Yes          | 2                         |
| `nonRetryableRatioThreshold`     | circuit-breaker.ts:159 | Yes       | Yes          | 0.5                       |
| `transientRatioThreshold`        | circuit-breaker.ts:160 | Yes       | Yes          | 0.7                       |

### 7.2 Hardcoded Error Backoffs (Non-Configurable)

**Location:** `recovery-backoff.ts:175-195`

```typescript
// These are hardcoded in calculateCircuitBreakerBackoff():
case 'permanent':    return 24 * 60 * 60 * 1000;  // 24 hours
case 'non-retryable': return 48 * 60 * 60 * 1000; // 48 hours
case 'retryable':    return 12 * 60 * 60 * 1000;  // 12 hours
case 'transient':    return 2 * 60 * 1000;        // 2 minutes
case 'rateLimited':  // Uses config: base=5min, mult=3, max=60min
```

### 7.3 Hardcoded Active Test Timeouts

**Location:** `recovery-backoff.ts:127-145`

```typescript
// Model capability errors: 5000ms (hardcoded)
if (reason.includes('does not support generate') || ...) {
  return 5000;
}
// Permanent/non-retryable: 15000ms (hardcoded)
if (errorType === 'non-retryable' || errorType === 'permanent') {
  return 15000;
}
// Others: baseTimeout * multiplier (max 5 min)
```

### 7.4 Config Points Summary

**Configurable via `CircuitBreakerConfig`:**

- ✅ All threshold values (baseFailureThreshold, minFailureThreshold, maxFailureThreshold)
- ✅ All timeout values (openTimeout, halfOpenTimeout, activeTestTimeout)
- ✅ All ratio thresholds (nonRetryableRatioThreshold, transientRatioThreshold)
- ✅ Error patterns (nonRetryable, transient arrays)
- ✅ Backoff delays (standardDelaysMs, permanentDelaysMs, rateLimitBaseMs, etc.)
- ✅ Adaptive threshold settings (adaptiveThresholds, adaptiveThresholdAdjustment, errorRateSmoothing)
- ✅ Model escalation settings (modelEscalation object)

**NOT Configurable (Hardcoded):**

- ❌ Error-type-specific backoff durations (permanent=24h, non-retryable=48h, etc.)
- ❌ Active test timeouts (model capability=5s, permanent=15s)
- ❌ Jitter range (0-30s hardcoded)
- ❌ `halfOpenMaxRequests` is defined but never used in current implementation
- ❌ Flapping detection multipliers (2x timeout, +2 threshold)

---

## 8. Gaps and Issues

### 8.1 GAP-CB-5: Starvation Guard Threshold

**Location:** `circuit-breaker.ts:318-349`

The starvation guard uses hardcoded `3` as the threshold to start extending backoff:

```typescript
if (this.consecutiveFailedRecoveries >= 3) {
  // Start extending backoff
}
```

However, `maxConsecutiveFailedRecoveries` (default 5) is the cap. This is **configurable** but the logic starting point (3) is **hardcoded**.

### 8.2 Unused Config: halfOpenMaxRequests

**Location:** `circuit-breaker.ts:119, 54`

`halfOpenMaxRequests` is defined in config but **never used** in the current implementation. The half-open state uses `recoverySuccessThreshold` (consecutive successes) instead.

### 8.3 Flapping Detection Hardcoded Values

**Location:** `circuit-breaker.ts:990-1001`

```typescript
handleFlappingDetected(): void {
  this.config.openTimeout = Math.min(this.config.openTimeout * 2, 3600000);
  this.config.recoverySuccessThreshold = Math.min(this.config.recoverySuccessThreshold + 2, 10);
}
```

- Multiplier: 2x (hardcoded)
- Threshold increase: +2 (hardcoded)
- Cap: 1 hour / 10 successes (hardcoded)

### 8.4 Error-Type Backoff Not Configurable

**Location:** `recovery-backoff.ts:175-195`

The circuit breaker uses hardcoded 24h/48h/12h backoffs for permanent/non-retryable/retryable errors. These cannot be overridden via config.

### 8.5 State Lock Implementation

**Location:** `circuit-breaker.ts:261-280`

The microtask-chain lock (`_lockTail`) serializes state-modifying methods. This is an internal implementation detail but worth noting:

- `canExecute()` is sync-only and uses `_transitioning` guard
- `recordSuccess()` and `recordFailure()` use `withStateLock()`
- `restoreState()` uses `_restoring` flag with `setImmediate()` deferral

### 8.6 Potential Issue: `halfOpenStartedAt` Jitter

**Location:** `circuit-breaker.ts:1139`

The jitter is **not persisted** in `restoreState()`. On restart, if a breaker was in half-open, the `halfOpenStartedAt` is either:

- Kept as persisted value (if valid)
- Set to `Date.now()` (if invalid/0)

This means after restart, jitter is not reapplied, potentially causing different timeout behavior than expected.

---

## 9. Configuration Recommendations

Based on this analysis, the following could be made configurable:

### 9.1 Currently Hardcoded, Should Be Configurable

| Item                             | Current           | Suggested Config Key        |
| -------------------------------- | ----------------- | --------------------------- |
| Starvation guard trigger         | `>= 3` hardcoded  | `starvationGuardThreshold`  |
| Flapping timeout multiplier      | `2` hardcoded     | `flappingTimeoutMultiplier` |
| Flapping threshold increase      | `+2` hardcoded    | `flappingThresholdIncrease` |
| Active test timeout (capability) | `5000` hardcoded  | `capabilityTestTimeoutMs`   |
| Active test timeout (permanent)  | `15000` hardcoded | `permanentTestTimeoutMs`    |
| Jitter max                       | `30000` hardcoded | `halfOpenJitterMaxMs`       |

### 9.2 Error-Type Backoffs (Currently Hardcoded in recovery-backoff.ts)

| Error Type    | Current   | Suggested Config Key     |
| ------------- | --------- | ------------------------ |
| permanent     | 24 hours  | `backoff.permanentMs`    |
| non-retryable | 48 hours  | `backoff.nonRetryableMs` |
| retryable     | 12 hours  | `backoff.retryableMs`    |
| transient     | 2 minutes | `backoff.transientMs`    |

---

## 10. File Locations Quick Reference

| Component                        | File                | Lines     |
| -------------------------------- | ------------------- | --------- |
| CircuitBreaker class             | circuit-breaker.ts  | 233-1156  |
| CircuitBreakerRegistry           | circuit-breaker.ts  | 1161-1262 |
| SlidingWindow                    | circuit-breaker.ts  | 176-231   |
| canExecute()                     | circuit-breaker.ts  | 302-377   |
| recordFailure()                  | circuit-breaker.ts  | 479-570   |
| recordSuccess()                  | circuit-breaker.ts  | 418-474   |
| getBackoffForErrorType()         | circuit-breaker.ts  | 940-952   |
| calculateCircuitBreakerBackoff() | recovery-backoff.ts | 163-196   |
| ErrorClassifier.classify()       | error-classifier.ts | 344-478   |
| DEFAULT_CIRCUIT_BREAKER_CONFIG   | circuit-breaker.ts  | 113-174   |

---

## 11. Summary

### Strengths

- Clean three-state machine with well-defined transitions
- Error classification integration properly gates circuit-breaking decisions
- Adaptive threshold logic is configurable and opt-in
- Sliding window provides accurate error rate tracking
- Starvation guard prevents infinite retry cycles
- Recovery test coordination via dedicated coordinator

### Areas for Improvement

1. **Hardcoded magic numbers** scattered throughout (3, 10, 5000, 15000, etc.)
2. **Unused config** (`halfOpenMaxRequests`) indicates design drift
3. **Error-type backoffs hardcoded** in `calculateCircuitBreakerBackoff()`
4. **Flapping detection values hardcoded** in `handleFlappingDetected()`
5. **No jitter persistence** could cause post-restart behavior differences

### Configurability Status

- **Most thresholds ARE configurable** via `CircuitBreakerConfig`
- **Backoff delays ARE configurable** via `backoff` object
- **Error-type backoffs are NOT configurable** (hardcoded in recovery-backoff.ts)
- **Active test timeouts are NOT configurable** (hardcoded in recovery-backoff.ts)
