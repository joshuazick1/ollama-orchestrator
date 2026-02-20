# Recovery Testing Consolidation Design Spec

## Overview

This document outlines improvements to the active recovery testing system for circuit breakers, addressing issues found during code review. The main problems are dual testing paths, artificial delays, lack of cancellation, fragmented backoff logic, and insufficient metrics.

---

## Current State Analysis

### Problem 1: Dual Testing Paths

Two independent systems perform recovery testing:

| Path | Trigger | Entry Point | Timeout Logic | Backoff Logic |
|------|---------|-------------|--------------|---------------|
| **Request Path** | Incoming request when half-open | `RecoveryTestCoordinator.performCoordinatedRecoveryTest()` | Fixed 60s (model), 5s (server) | No progressive backoff |
| **Health Check Path** | Periodic (30s interval) | `HealthCheckScheduler.runActiveTests()` → `executeActiveTest()` | Doubles each attempt (60s→120s→...→15min) | Progressive 30s→30min |

**Impact:** Inconsistent behavior, unpredictable recovery times, difficult to debug.

### Problem 2: Artificial 5-Second Delay

Location: `src/recovery-test-coordinator.ts:351`
```typescript
// Add delay to make recovery test visible in frontend (5 seconds)
await new Promise(resolve => setTimeout(resolve, 5000));
```

**Impact:** Adds 5 seconds to every recovery test with no functional benefit.

### Problem 3: No Test Cancellation

When a circuit breaker is reset or transitions out of half-open state, in-flight tests continue and their results still affect circuit state.

**Impact:** Resetting a breaker may not immediately restore functionality if a test is in progress.

### Problem 4: Fragmented Backoff Logic

Three different backoff systems:

| Location | Purpose | Range |
|----------|---------|-------|
| `circuit-breaker.ts:getBackoffForErrorType()` | Initial open→half-open delay | 2min - 48h |
| `health-check-scheduler.ts:calculateBackoffDelay()` | Between active test attempts | 30s - 30min |
| `RecoveryTestCoordinator` | No backoff | N/A |

**Impact:** Hard to predict when recovery will succeed, inconsistent behavior.

### Problem 5: Server-Level Limit Backoff

Location: `orchestrator.ts:3197-3203`

When server-level half-open limit is exceeded, the breaker is forced open with a `'transient'` error type, losing the original error's backoff characteristics.

**Impact:** Permanent errors get short (2min) backoff instead of 24-48h.

### Problem 6: Insufficient Test Metrics

Currently:
- ` trackedactiveTestsInProgress` counter
- `testCount` in health check scheduler

Missing:
- Test start/end timestamps
- Test duration
- Test timeouts
- Test failure reasons per attempt
- Recovery probability estimates

---

## Implementation Plan

### Phase 1: Unify Testing Path

**Objective:** Health check uses `RecoveryTestCoordinator` exclusively.

#### 1.1 Add Active Test Execution to RecoveryTestCoordinator

**File:** `src/recovery-test-coordinator.ts`

Add method to run active tests for multiple models:

```typescript
/**
 * Run active tests for multiple half-open breakers
 * Called by health check scheduler instead of direct executeActiveTest calls
 */
async runActiveTests(
  server: AIServer,
  halfOpenBreakers: Array<{
    breaker: CircuitBreaker;
    model?: string;
  }>,
  options: {
    onTestStart?: (breakerName: string) => void;
    onTestEnd?: (breakerName: string, success: boolean, duration: number) => void;
  }
): Promise<Array<{
  breakerName: string;
  success: boolean;
  duration: number;
  error?: string;
}>> {
  const results: Array<{
    breakerName: string;
    success: boolean;
    duration: number;
    error?: string;
  }> = [];

  for (const { breaker, model } of halfOpenBreakers) {
    const breakerName = (breaker as any).name;
    
    // Check if cancelled
    if (this.isTestCancelled(breakerName)) {
      logger.debug(`Test for ${breakerName} was cancelled, skipping`);
      continue;
    }

    const startTime = Date.now();
    options.onTestStart?.(breakerName);

    try {
      let success: boolean;
      
      if (model) {
        // Model-level test
        success = await this.performModelLevelTest(breaker, this.getServerId(breakerName), model);
      } else {
        // Server-level test
        success = await this.performServerLevelTest(breaker);
      }

      const duration = Date.now() - startTime;
      options.onTestEnd?.(breakerName, success, duration);
      
      results.push({
        breakerName,
        success,
        duration,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);
      options.onTestEnd?.(breakerName, false, duration);
      
      results.push({
        breakerName,
        success: false,
        duration,
        error: errorMsg,
      });
    }

    // Small delay between tests
    await this.sleep(1000);
  }

  return results;
}
```

#### 1.2 Remove Direct Health Check Scheduler Test Execution

**File:** `src/orchestrator.ts`

Replace `runActiveTestsForServer()` to delegate to `RecoveryTestCoordinator`:

```typescript
private async runActiveTestsForServer(server: AIServer): Promise<void> {
  // Skip if server already undergoing tests
  if (this.serversUndergoingActiveTests.has(server.id)) {
    return;
  }

  // Get all half-open breakers for this server
  const halfOpenBreakers = this.getHalfOpenBreakersForServer(server.id);
  
  if (halfOpenBreakers.length === 0) {
    return;
  }

  // Delegate to RecoveryTestCoordinator
  const coordinator = getRecoveryTestCoordinator();
  
  const results = await coordinator.runActiveTests(
    server,
    halfOpenBreakers,
    {
      onTestStart: (breakerName) => {
        const breaker = this.circuitBreakerRegistry.get(breakerName);
        breaker?.startActiveTest();
      },
      onTestEnd: (breakerName, success, duration) => {
        const breaker = this.circuitBreakerRegistry.get(breakerName);
        if (breaker) {
          breaker.endActiveTest();
          
          if (success) {
            breaker.recordSuccess();
          } else {
            breaker.recordFailure(new Error('Active test failed'), 'transient');
          }
        }
      },
    }
  );

  // Handle results
  for (const result of results) {
    logger.info(`Active test ${result.success ? 'succeeded' : 'failed'} for ${result.breakerName}`, {
      duration: result.duration,
      error: result.error,
    });
  }
}

/**
 * Get all half-open breakers for a server
 */
private getHalfOpenBreakersForServer(serverId: string): Array<{
  breaker: CircuitBreaker;
  model?: string;
}> {
  const result: Array<{ breaker: CircuitBreaker; model?: string }> = [];
  
  // Check server-level breaker
  const serverCb = this.circuitBreakerRegistry.get(serverId);
  if (serverCb?.getState() === 'half-open') {
    result.push({ breaker: serverCb });
  }

  // Check model-level breakers
  for (const [name, stats] of Object.entries(this.circuitBreakerRegistry.getAllStats())) {
    if (name.startsWith(`${serverId}:`) && stats.state === 'half-open') {
      const model = name.slice(serverId.length + 1);
      const breaker = this.circuitBreakerRegistry.get(name);
      if (breaker) {
        result.push({ breaker, model });
      }
    }
  }

  // Sort by halfOpenStartedAt (oldest first)
  result.sort((a, b) => {
    const aStats = a.breaker.getStats();
    const bStats = b.breaker.getStats();
    return (aStats.halfOpenStartedAt || 0) - (bStats.halfOpenStartedAt || 0);
  });

  return result;
}
```

### Phase 2: Remove Artificial Delay

**File:** `src/recovery-test-coordinator.ts`

Remove the 5-second delay:

```typescript
// REMOVE THIS:
// Add delay to make recovery test visible in frontend (5 seconds)
// await new Promise(resolve => setTimeout(resolve, 5000));
```

### Phase 3: AbortController for Test Cancellation

#### 3.1 Add Cancellation Support to RecoveryTestCoordinator

**File:** `src/recovery-test-coordinator.ts`

```typescript
export class RecoveryTestCoordinator {
  private abortControllers: Map<string, AbortController> = new Map();
  private cancelledTests: Set<string> = new Set();

  /**
   * Cancel a specific test
   */
  cancelTest(breakerName: string): void {
    const controller = this.abortControllers.get(breakerName);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(breakerName);
    }
    this.cancelledTests.add(breakerName);
    logger.info(`Cancelled test for ${breakerName}`);
  }

  /**
   * Check if a test was cancelled
   */
  isTestCancelled(breakerName: string): boolean {
    return this.cancelledTests.has(breakerName);
  }

  /**
   * Clear cancelled status (allows test to run again)
   */
  clearCancelled(breakerName: string): void {
    this.cancelledTests.delete(breakerName);
  }

  /**
   * Create an abortable fetch with timeout
   */
  private async fetchWithAbort(
    url: string,
    options: RequestInit & { timeout?: number }
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 30000);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request aborted');
      }
      throw error;
    }
  }

  /**
   * Perform server-level test with cancellation support
   */
  private async performServerLevelTest(breaker: CircuitBreaker): Promise<boolean> {
    const breakerName = (breaker as any).name || 'unknown';
    const serverId = this.getServerId(breakerName);
    
    // Create abort controller for this test
    const controller = new AbortController();
    this.abortControllers.set(breakerName, controller);

    try {
      // Check for cancellation before starting
      if (controller.signal.aborted || this.cancelledTests.has(breakerName)) {
        return false;
      }

      const serverUrl = this.getServerUrl(serverId);
      if (!serverUrl) {
        return false;
      }

      const response = await this.fetchWithAbort(`${serverUrl}/api/tags`, {
        timeout: 5000,
        signal: controller.signal,
      });

      return response.ok;
    } catch (error) {
      if (error instanceof Error && error.message === 'Request aborted') {
        logger.debug(`Server-level test aborted for ${breakerName}`);
        return false;
      }
      logger.error(`Server-level test failed for ${breakerName}`, { error });
      return false;
    } finally {
      this.abortControllers.delete(breakerName);
    }
  }

  /**
   * Perform model-level test with cancellation support
   */
  private async performModelLevelTest(
    breaker: CircuitBreaker,
    serverId: string,
    modelName: string
  ): Promise<boolean> {
    const breakerName = (breaker as any).name || 'unknown';
    
    const controller = new AbortController();
    this.abortControllers.set(breakerName, controller);

    try {
      if (controller.signal.aborted || this.cancelledTests.has(breakerName)) {
        return false;
      }

      // Model test logic with abort signal passed through
      const result = await this.executeModelTest(serverId, modelName, {
        timeout: this.getTimeoutForModel(modelName),
        signal: controller.signal,
      });

      return result.success;
    } finally {
      this.abortControllers.delete(breakerName);
    }
  }
}
```

#### 3.2 Cancel Tests on Circuit Breaker Reset

**File:** `src/circuit-breaker.ts`

```typescript
/**
 * Force close the circuit breaker
 * Also cancels any in-progress recovery tests
 */
forceClose(): void {
  const breakerName = this.name;
  
  // Import coordinator and cancel any active test
  import('./recovery-test-coordinator.js').then(({ getRecoveryTestCoordinator }) => {
    const coordinator = getRecoveryTestCoordinator();
    coordinator.cancelTest(breakerName);
    coordinator.clearCancelled(breakerName);
  });
  
  this.state = 'closed';
  this.resetCounters();
  this.nextRetryAt = 0;
  
  logger.info(`Circuit breaker ${breakerName} force-closed`);
}
```

### Phase 4: Consolidate Backoff Logic

#### 4.1 Create Unified Backoff Calculator

**File:** `src/utils/recovery-backoff.ts`

```typescript
/**
 * Unified backoff calculation for recovery testing
 * Consolidates logic from circuit-breaker.ts and health-check-scheduler.ts
 */

export interface BackoffOptions {
  /** Current attempt number (0-indexed) */
  attempt: number;
  /** Error type for determining backoff strategy */
  errorType?: 'retryable' | 'non-retryable' | 'transient' | 'permanent' | 'rateLimited';
  /** Failure reason for */
  failureReason?: string;
  specific handling /** Base delay in ms (default: 30000) */
  baseDelay?: number;
  /** Maximum delay in ms (default: 1800000 = 30min) */
  maxDelay?: number;
}

export interface BackoffResult {
  /** Delay in ms before next attempt */
  delayMs: number;
  /** Whether to stop testing entirely */
  shouldStop: boolean;
  /** Reason for stopping (if shouldStop is true) */
  stopReason?: string;
}

/**
 * Determine error category for backoff calculation
 */
function categorizeError(options: BackoffOptions): {
  category: 'permanent' | 'model_file' | 'model_capability' | 'standard';
  priority: number;
} {
  const reason = options.failureReason?.toLowerCase() || '';
  const errorType = options.errorType;

  // Model capability errors - will never succeed
  if (
    reason.includes('does not support generate') ||
    reason.includes('does not support chat') ||
    reason.includes('unsupported operation')
  ) {
    return { category: 'model_capability', priority: 1 };
  }

  // Model file errors - need manual intervention
  if (
    reason.includes('unable to load model') ||
    reason.includes('invalid file magic') ||
    reason.includes('unsupported model format') ||
    reason.includes('model file not found') ||
    (reason.includes('blob') && reason.includes('sha256'))
  ) {
    return { category: 'model_file', priority: 2 };
  }

  // Permanent errors
  if (errorType === 'non-retryable' || errorType === 'permanent') {
    return { category: 'permanent', priority: 3 };
  }

  return { category: 'standard', priority: 4 };
}

/**
 * Calculate unified backoff delay
 */
export function calculateRecoveryBackoff(options: BackoffOptions): BackoffResult {
  const {
    attempt,
    errorType,
    failureReason,
    baseDelay = 30000,
    maxDelay = 1800000,
  } = options;

  const category = categorizeError({ ...options });

  // Define delays per category
  const delays: Record<string, number[]> = {
    model_capability: [30000, 30000], // 2 attempts, then stop
    model_file: [60000, 300000, 600000], // 3 attempts
    permanent: [300000, 600000, 1200000, 2400000, 3600000], // 5 attempts, up to 1h
    standard: [
      30000, // 30s
      60000, // 1m
      120000, // 2m
      240000, // 4m
      480000, // 8m
      900000, // 15m
      1800000, // 30m
      1800000, // 30m (max)
    ],
  };

  const categoryDelays = delays[category.category] || delays.standard;

  // Check if we should stop
  const maxAttempts = categoryDelays.length;
  if (attempt >= maxAttempts) {
    return {
      delayMs: 0,
      shouldStop: true,
      stopReason: `Max attempts (${maxAttempts}) reached for ${category.category} errors`,
    };
  }

  const delayMs = Math.min(categoryDelays[attempt] || categoryDelays[categoryDelays.length - 1], maxDelay);

  return {
    delayMs,
    shouldStop: false,
  };
}

/**
 * Get timeout for active test based on attempt and error
 */
export function calculateActiveTestTimeout(
  attempt: number,
  baseTimeout: number = 60000,
  failureReason?: string,
  errorType?: string
): number {
  const reason = (failureReason || '').toLowerCase();

  // Quick timeouts for errors that fail immediately
  if (
    reason.includes('does not support generate') ||
    reason.includes('does not support chat') ||
    reason.includes('unsupported operation')
  ) {
    return 5000;
  }

  if (
    reason.includes('unable to load model') ||
    reason.includes('invalid file magic') ||
    reason.includes('unsupported model format')
  ) {
    return 10000;
  }

  if (errorType === 'non-retryable' || errorType === 'permanent') {
    return 15000;
  }

  if (reason.includes('memory') || reason.includes('oom')) {
    return 10000;
  }

  // Progressive timeout doubling
  const multiplier = Math.pow(2, Math.min(attempt, 10));
  const maxTimeout = 15 * 60 * 1000; // 15 minutes
  return Math.min(baseTimeout * multiplier, maxTimeout);
}
```

#### 4.2 Update Components to Use Unified Backoff

**File:** `src/health-check-scheduler.ts`

Replace `calculateBackoffDelay` and `calculateActiveTestTimeout` with imports:

```typescript
import { calculateRecoveryBackoff, calculateActiveTestTimeout } from '../utils/recovery-backoff.js';
```

**File:** `src/circuit-breaker.ts`

Replace `getBackoffForErrorType` with import:

```typescript
import { calculateRecoveryBackoff } from '../utils/recovery-backoff.js';
```

### Phase 5: Fix Server-Level Limit Backoff

**File:** `src/orchestrator.ts`

Preserve original error when enforcing half-open limits:

```typescript
// In getCircuitBreaker and getModelCircuitBreaker:
if (halfOpenCount >= maxHalfOpenPerServer) {
  logger.warn(
    `Server ${serverId} already has ${halfOpenCount} half-open circuits (max ${maxHalfOpenPerServer}). Preventing transition to half-open.`
  );
  
  const breaker = this.circuitBreakerRegistry.get(breakerName);
  if (breaker) {
    breaker.forceOpen();
    
    // Preserve original error characteristics by reading current stats
    const stats = breaker.getStats();
    const originalErrorType = this.determineErrorType(stats.lastFailureReason);
    
    // Use unified backoff with original error type
    const backoffResult = calculateRecoveryBackoff({
      attempt: stats.consecutiveFailedRecoveries || 0,
      errorType: originalErrorType,
      failureReason: stats.lastFailureReason,
    });
    
    // Set next retry based on backoff result
    if (backoffResult.shouldStop) {
      // Mark as permanently failed
      breaker.recordFailure(new Error('Max recovery attempts exceeded'), 'permanent');
    } else {
      // Extend timeout without recording as failure
      breaker.extendNextRetry(backoffResult.delayMs);
    }
  }
  return;
}
```

### Phase 6: Enhanced Test Metrics

#### 6.1 Add Test Metrics to RecoveryTestCoordinator

**File:** `src/recovery-test-coordinator.ts`

```typescript
export interface TestMetrics {
  breakerName: string;
  testId: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  success?: boolean;
  error?: string;
  timeout: boolean;
  cancelled: boolean;
}

export class RecoveryTestCoordinator {
  private testMetrics: TestMetrics[] = [];
  private readonly MAX_METRICS_PER_BREAKER = 100;

  /**
   * Record test metrics
   */
  recordTestMetrics(metrics: TestMetrics): void {
    this.testMetrics.push(metrics);
    
    // Prune old metrics
    if (this.testMetrics.length > this.MAX_METRICS_PER_BREAKER * 10) {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000; // Keep 24 hours
      this.testMetrics = this.testMetrics.filter(m => m.startTime > cutoff);
    }
  }

  /**
   * Get metrics for a specific breaker
   */
  getMetricsForBreaker(breakerName: string): TestMetrics[] {
    return this.testMetrics
      .filter(m => m.breakerName === breakerName)
      .sort((a, b) => b.startTime - a.startTime);
  }

  /**
   * Get recovery probability estimate
   */
  getRecoveryProbability(breakerName: string, windowHours: number = 24): number {
    const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
    const recentTests = this.testMetrics.filter(
      m => m.breakerName === breakerName && m.startTime > cutoff
    );

    if (recentTests.length === 0) {
      return -1; // Unknown
    }

    const successes = recentTests.filter(m => m.success === true).length;
    return successes / recentTests.length;
  }

  /**
   * Get aggregate test statistics
   */
  getTestStats(): {
    totalTests: number;
    successes: number;
    failures: number;
    timeouts: number;
    cancellations: number;
    averageDuration: number;
  } {
    const tests = this.testMetrics;
    const completed = tests.filter(t => t.endTime !== undefined);
    
    return {
      totalTests: tests.length,
      successes: tests.filter(t => t.success === true).length,
      failures: tests.filter(t => t.success === false).length,
      timeouts: tests.filter(t => t.timeout).length,
      cancellations: tests.filter(t => t.cancelled).length,
      averageDuration: completed.length > 0
        ? completed.reduce((sum, t) => sum + (t.duration || 0), 0) / completed.length
        : 0,
    };
  }
}
```

#### 6.2 Additional Metrics to Track

| Metric | Description | Use Case |
|--------|-------------|----------|
| `testId` | Unique identifier for each test attempt | Correlation |
| `queueWaitTime` | Time spent waiting in test queue | Identify bottlenecks |
| `firstByteTime` | Time to first response byte | Network issues |
| `modelLoadTime` | Time spent loading model (embedded in test) | Cold start issues |
| `errorCategory` | Classified error type | Pattern detection |
| `serverHealthAtTest` | Server load/concurrent requests during test | Context for failures |

---

## Testing Strategy

### Unit Tests

```typescript
// src/__tests__/recovery-backoff.test.ts
import { describe, it, expect } from 'vitest';
import { calculateRecoveryBackoff, calculateActiveTestTimeout } from '../utils/recovery-backoff.js';

describe('Recovery Backoff', () => {
  describe('calculateRecoveryBackoff', () => {
    it('should use short delays for model capability errors', () => {
      const result = calculateRecoveryBackoff({
        attempt: 0,
        failureReason: 'model does not support generate',
      });
      expect(result.delayMs).toBe(30000);
      expect(result.shouldStop).toBe(false);
      
      const result2 = calculateRecoveryBackoff({
        attempt: 2,
        failureReason: 'model does not support generate',
      });
      expect(result2.shouldStop).toBe(true);
    });

    it('should use progressive delays for standard errors', () => {
      const delays = [0, 1, 2, 3].map(attempt => 
        calculateRecoveryBackoff({ attempt }).delayMs
      );
      expect(delays).toEqual([30000, 60000, 120000, 240000]);
    });

    it('should cap at max delay', () => {
      const result = calculateRecoveryBackoff({
        attempt: 10,
        baseDelay: 30000,
        maxDelay: 60000,
      });
      expect(result.delayMs).toBe(60000);
    });
  });

  describe('calculateActiveTestTimeout', () => {
    it('should use short timeouts for capability errors', () => {
      const timeout = calculateActiveTestTimeout(
        0, 60000, 'model does not support generate'
      );
      expect(timeout).toBe(5000);
    });

    it('should double timeout for each attempt', () => {
      expect(calculateActiveTestTimeout(0, 60000)).toBe(120000);
      expect(calculateActiveTestTimeout(1, 60000)).toBe(240000);
      expect(calculateActiveTestTimeout(2, 60000)).toBe(480000);
    });

    it('should cap at max timeout', () => {
      const timeout = calculateActiveTestTimeout(10, 60000);
      expect(timeout).toBe(15 * 60 * 1000); // 15 minutes
    });
  });
});
```

### Integration Tests

```typescript
// src/__tests__/recovery-coordinator-integration.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { RecoveryTestCoordinator } from '../recovery-test-coordinator.js';
import { CircuitBreaker } from '../circuit-breaker.js';

describe('Recovery Test Coordinator Integration', () => {
  let coordinator: RecoveryTestCoordinator;
  
  beforeEach(() => {
    coordinator = new RecoveryTestCoordinator();
  });

  it('should cancel in-flight tests on cancelTest call', async () => {
    const breaker = new CircuitBreaker('test-breaker');
    
    // Start a long-running test
    const testPromise = coordinator.performCoordinatedRecoveryTest(breaker);
    
    // Cancel immediately
    coordinator.cancelTest('test-breaker');
    
    const result = await testPromise;
    expect(result).toBe(false);
  });

  it('should track test metrics', async () => {
    const breaker = new CircuitBreaker('test-breaker');
    
    await coordinator.performCoordinatedRecoveryTest(breaker);
    
    const metrics = coordinator.getMetricsForBreaker('test-breaker');
    expect(metrics.length).toBeGreaterThan(0);
    expect(metrics[0]).toHaveProperty('duration');
    expect(metrics[0]).toHaveProperty('success');
  });

  it('should calculate recovery probability', async () => {
    // Run multiple tests
    const breaker = new CircuitBreaker('test-breaker');
    for (let i = 0; i < 5; i++) {
      await coordinator.performCoordinatedRecoveryTest(breaker);
    }
    
    const probability = coordinator.getRecoveryProbability('test-breaker');
    expect(probability).toBeGreaterThanOrEqual(0);
    expect(probability).toBeLessThanOrEqual(1);
  });
});
```

---

## Migration Checklist

### Pre-Migration
- [x] Create backup of current implementation
- [x] Document current behavior for comparison
- [x] Run full test suite to establish baseline

### Phase 1: Unify Testing Path
- [x] Add `runActiveTests()` method to RecoveryTestCoordinator
- [x] Update `runActiveTestsForServer()` to delegate to coordinator
- [x] Remove direct `executeActiveTest()` calls from health check path
- [x] Verify both paths produce same behavior

### Phase 2: Remove Delay
- [x] Remove 5-second delay from `performModelLevelTest()`
- [x] Verify frontend still shows test progress (should use metrics instead)

### Phase 3: Add Cancellation
- [x] Add AbortController support to coordinator
- [x] Add `cancelTest()` and `isTestCancelled()` methods
- [x] Update circuit breaker reset to cancel tests
- [x] Test cancellation during active test

### Phase 4: Consolidate Backoff
- [x] Create `src/utils/recovery-backoff.ts`
- [ ] Update health-check-scheduler.ts to use unified backoff
- [ ] Update circuit-breaker.ts to use unified backoff
- [ ] Verify consistent behavior

### Phase 5: Fix Server-Level Limits
- [x] Update half-open limit enforcement to preserve error type
- [x] Test with various error types

### Phase 6: Enhanced Metrics
- [x] Add test metrics tracking to coordinator
- [x] Add recovery probability calculation
- [x] Add aggregate stats method
- [ ] Expose metrics via API endpoint

### Post-Migration
- [ ] Monitor recovery behavior for 48 hours
- [ ] Compare pre/post recovery success rates
- [ ] Verify no performance regression
- [ ] Update documentation

---

## Success Criteria

1. **Consistency**: Both request and health check paths behave identically
2. **Performance**: Recovery tests complete in <1 second (no artificial delay)
3. **Cancellability**: Resetting a breaker immediately prevents new tests
4. **Predictability**: Single source of truth for all backoff calculations
5. **Observability**: Comprehensive test metrics available for debugging
6. **No Regression**: Recovery success rate maintained or improved

---

## Rollback Plan

If issues are detected:

1. **Immediate**: Revert to previous commit
2. **Selective**: Feature flags can disable each phase independently
3. **Data Recovery**: Metrics are additive, no data loss risk
