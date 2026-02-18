# Pre-Migration Baseline

**Date:** 2026-02-17
**Backup Location:** backup/pre-migration-20260217/

## Current State Summary

### Metrics Collection Issues
1. **TTFT Calculation:** 3 different implementations
   - streaming.ts: Uses first chunk received
   - ollamaController.ts: Uses callback timing
   - orchestrator.ts: Receives from result object

2. **Timing Logic:** 205+ Date.now() calls across 15+ files
   - No centralized timer utility
   - Inconsistent duration calculations

3. **Request Context:** Created in 6+ locations with variations
   - Different ID generation schemes
   - Missing fields in some contexts

4. **Metrics Recording:** Dual recording pattern
   - metricsAggregator.recordRequest()
   - requestHistory.recordRequest()
   - No atomicity guarantees

### Code Duplication Counts
- Error message extraction: 73 locations
- Sleep/delay patterns: 15+ locations
- Percentile calculations: 3 implementations
- Prune/cleanup: 8 implementations
- Circuit breaker bypass: 12 locations
- Math.clamp: 11 locations

### Files to be Modified (Phase 1)
1. streaming.ts - Replace TTFT tracking
2. ollamaController.ts - Replace TTFT calculation
3. orchestrator.ts - Replace Date.now() with Timer
4. health-check-scheduler.ts - Replace Date.now() with Timer
5. recovery-test-coordinator.ts - Replace Date.now() with Timer
6. intelligent-recovery-manager.ts - Replace Date.now() with Timer

### Feature Flags Created
- All Phase 1 flags enabled by default
- useTimerUtility: true
- useTTFTTracker: true

### Monitoring Baseline
- Current request latency: TBD (measure in production)
- TTFT variance: TBD (measure in production)
- Metrics accuracy: TBD (compare after migration)

### Success Criteria
1. All TTFT measurements within 5ms of each other
2. No metrics loss during high-throughput testing
3. < 1ms overhead from new utilities
4. All tests passing
