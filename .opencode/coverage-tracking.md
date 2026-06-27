# Test Coverage Tracking

## Current Status (as of 2026-02-19)

- **Tests passing**: 1484
- **Coverage**: 71.63% lines, 61.88% branches, 74.54% functions, 71.89% statements
- **Function coverage**: 74.54% ✓ (HIT 70% TARGET)
- **Branch coverage**: 61.88% (need ~8.12% more to hit 70%)

## Key Improvements Made

- streaming.ts: Added tests for drain handling, progress logging, token extraction
- rateLimiter.ts: Added tests for skip logic, custom key generator
- analytics-engine.test.ts: Added capacity analysis, error analysis, decision events, stats tests
- unified-recorder.test.ts: Added error handling, async recorder tests
- request-history.test.ts: Added full test suite (14 tests)

---

## Progress Made

### Completed

- [x] load-balancer.ts - Added 15 tests for circuit breaker, timeout, random, sticky sessions
- [x] errorClassifier.ts - Created 36 comprehensive tests

### In Progress

- [ ] model-manager.ts (~62%)
- [ ] circuit-breaker.ts (~69%)
- [ ] fetchWithTimeout.ts
- [ ] request-context-builder.ts (~60%)

### Utils Needing Tests

- [ ] withTimeout.ts (~72%)
- [ ] math-helpers.ts (~90%)
- [ ] statistics.ts (~97%)
- [ ] rateLimiter.ts (~79%)
- [ ] auth.ts (~96%)

---

## Priority 1: Core Files (Target: 100%)

### 1. load-balancer.ts (800 lines) - DONE

**Current Coverage**: ~70% lines

### 2. model-manager.ts (1269 lines)

**Current Coverage**: ~62% lines

### 3. circuit-breaker.ts (1060 lines)

**Current Coverage**: ~69% lines

### 4. health-check-scheduler.ts (860 lines)

**Status**: Tests exist, needs verification

---

## Priority 2: Utils (Target: 100%)

### Completed

- [x] errorClassifier.ts - 36 tests added

### Needs Work

- [ ] fetchWithTimeout.ts - no tests
- [ ] withTimeout.ts - no tests
- [ ] request-context-builder.ts (~60%)
- [ ] math-helpers.ts (~90%)
- [ ] statistics.ts (~97%)
- [ ] rateLimiter.ts (~79%)
- [ ] auth.ts (~96%)

- [ ] `reset` - full reset

### 3. circuit-breaker.ts (1060 lines)

**Current Coverage**: ~69% lines
**Uncovered Lines**: 563, 584, 598-612

**Functions to test**:

- [ ] `execute` - more error cases
- [ ] `recordSuccess` - half-open transitions
- [ ] `recordFailure` - state transitions
- [ ] Error classification - more error types
- [ ] Adaptive threshold logic
- [ ] CircuitBreakerRegistry - bulk operations

### 4. health-check-scheduler.ts (860 lines)

**Current Coverage**: Need to verify

**Functions to test**:

- [ ] `start` - all scheduler modes
- [ ] `stop` - cleanup
- [ ] `checkServerHealth` - all response types
- [ ] `runHealthChecks` - concurrency handling
- [ ] `runRecoveryChecks` - recovery logic
- [ ] `updateConfig` - runtime updates

---

## Priority 2: Utils (Target: 100%)

### Already high coverage:

- deepMerge.ts: 100%
- timer.ts: 100%
- urlUtils.ts: 100%
- ollamaError.ts: 100%

### Needs work:

- [ ] errorClassifier.ts (~69%) - many error patterns not tested
- [ ] withTimeout.ts (~72%) - timeout branches
- [ ] request-context-builder.ts (~60%) - context building
- [ ] fetchWithTimeout.ts - need to check
- [ ] math-helpers.ts (90%) - median calculation
- [ ] statistics.ts (~97%) - percentile calculations
- [ ] error-helpers.ts (93%) - error formatting
- [ ] rateLimiter.ts (~79%) - rate limit branches
- [ ] auth.ts (~96%) - auth edge cases

---

## Priority 3: Controllers (IGNORE - Another agent working on these)

Controllers to ignore for now:

- openaiController.ts (~45%)
- ollamaController.ts (~35%)
- modelController.ts (~0%)
- queueController.ts (~0%)
- metricsController.ts (~10%)
- serversController.ts (~0%)
- configController.ts (~0%)
- analyticsController.ts (~0%)

---

## Priority 4: Other Files

### High coverage already:

- configManager.ts: 100%
- config.ts: 82%
- streaming.ts: 82%
- request-queue.ts: 93%
- orchestrator (routes): 99%

### Needs work:

- [ ] decision-history.ts
- [ ] request-history.ts
- [ ] metrics-aggregator.ts (~77%)
- [ ] metrics-persistence.ts (~78%)
- [ ] ttft-tracker.ts (~82%)
- [ ] unified-recorder.ts
- [ ] recovery-failure-tracker.ts
- [ ] intelligent-recovery-manager.ts
- [ ] recovery-test-coordinator.ts
- [ ] circuit-breaker-persistence.ts

---

## Test Files to Create

1. `tests/unit/load-balancer-round-robin.test.ts` - Round-robin algorithm
2. `tests/unit/load-balancer-least-connections.test.ts` - Least-connections algorithm
3. `tests/unit/load-balancer-weighted.test.ts` - Weighted algorithm
4. `tests/unit/load-balancer-streaming.test.ts` - Streaming selection
5. `tests/unit/errorClassifier.test.ts` - Error classification
6. `tests/unit/withTimeout.test.ts` - Timeout handling
7. `tests/unit/fetchWithTimeout.test.ts` - Fetch with timeout
8. `tests/unit/request-context-builder.test.ts` - Already exists, needs more tests
9. `tests/unit/math-helpers.test.ts` - Already exists, needs more tests
10. `tests/unit/statistics.test.ts` - Already exists, needs more tests

---

## Notes

- Feature flags tests added (feature-flags.test.ts)
- Chaos tests moved to Docker-only (vitest.chaos.config.ts)
- Many uncovered lines are error handling branches
- Some functions may be deprecated or rarely used
