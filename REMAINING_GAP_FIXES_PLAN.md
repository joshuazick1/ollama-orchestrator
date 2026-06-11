# Remaining Gap Analysis Fixes - Implementation Plan

**Status**: Ready to execute  
**Session**: Use `/start-work remaining-gap-fixes` to resume

---

## Overview

This plan implements architectural changes to wire circuit breakers into `InferenceProbeScheduler` and `ModelManager`, apply route validation middleware, and clean up dead code.

---

## Cancelled Items

| Item                                               | Reason                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **P1-9**: Health check probes return null silently | NOT A BUG - Intentional graceful degradation. Errors logged, fallback exists, throws if ALL fail |
| **P2-22**: nonCircuitBreaking flag ignored         | `executeActiveTest()` is DEAD CODE - never called from production                                |

---

## Tasks

### Wave 1: Circuit Breaker Wiring (Foundation)

| #   | Task                                  | File                               | Description                                      |
| --- | ------------------------------------- | ---------------------------------- | ------------------------------------------------ |
| T1  | Add embedRequestSchema                | `src/middleware/validation.ts`     | Create schema for `/api/embed` endpoint          |
| T2  | Wire CB into InferenceProbeScheduler  | `src/inference-probe-scheduler.ts` | Add `getCircuitBreakerRegistry` getter + field   |
| T3  | CB notification on probe fail/success | `src/inference-probe-scheduler.ts` | Call `cb.recordFailure()` / `cb.recordSuccess()` |
| T4  | Wire CB into ModelManager             | `src/model-manager.ts`             | Add `setCircuitBreakerRegistry()` setter         |
| T5  | CB notification on warmup failure     | `src/model-manager.ts`             | Call `cb.recordFailure()` in catch block         |

### Wave 2: Route Validation + Cleanup

| #   | Task                                 | File                                 | Description                           |
| --- | ------------------------------------ | ------------------------------------ | ------------------------------------- |
| T6  | Apply validation to inference routes | `src/routes/inference.routes.ts`     | Add `validateRequest()` middleware    |
| T7  | Apply validation to admin routes     | `src/routes/admin.routes.ts`         | Add `validateRequest()` middleware    |
| T8  | Remove dead executeActiveTest        | `src/orchestrator/orchestrator.ts`   | Delete unused methods (lines 554-661) |
| T9  | Remove dead tests                    | `src/__tests__/orchestrator.test.ts` | Delete tests for removed methods      |

### Wave 3: Integration

| #   | Task               | Description                       |
| --- | ------------------ | --------------------------------- |
| T10 | Build verification | `npm run build` - must pass       |
| T11 | Final verification | Server starts, health check works |

---

## Key Changes

### 1. InferenceProbeScheduler gets CircuitBreakerRegistry

```typescript
// NEW: Constructor gets CB registry getter
constructor(
  config: ProbeSchedulerConfig,
  getServers: () => AIServer[],
  getMetricsAggregator: () => MetricsAggregator,
  getMetricsStore: () => MetricsStore,
  getCircuitBreakerRegistry: () => CircuitBreakerRegistry  // NEW
)

// On probe failure (in executeProbe):
const breaker = this.getCircuitBreakerRegistry().getModelCircuitBreaker(serverId, model);
breaker?.recordFailure(new Error(`Probe failed: HTTP ${response.status}`), 'transient');

// On probe success:
breaker?.recordSuccess();
```

### 2. ModelManager gets CircuitBreakerRegistry

```typescript
// NEW: Add setter method
setCircuitBreakerRegistry(registry: CircuitBreakerRegistry): void {
  this.circuitBreakerRegistry = registry;
}

// On warmup failure (in executeWarmup catch):
if (this.circuitBreakerRegistry) {
  const cb = this.circuitBreakerRegistry.getOrCreate(`${job.serverId}:${job.model}`);
  cb.recordFailure(new Error(errorMessage), 'retryable');
}
```

### 3. Validation Middleware Applied

```typescript
// inference.routes.ts
import {
  validateRequest,
  generateRequestSchema,
  chatRequestSchema,
  embeddingsRequestSchema,
  embedRequestSchema,
} from '../middleware/validation.js';

inferenceRouter.post(
  '/generate',
  validateRequest(generateRequestSchema),
  asyncHandler(handleGenerate)
);
inferenceRouter.post('/chat', validateRequest(chatRequestSchema), asyncHandler(handleChat));
inferenceRouter.post(
  '/embeddings',
  validateRequest(embeddingsRequestSchema),
  asyncHandler(handleEmbeddings)
);
inferenceRouter.post('/embed', validateRequest(embedRequestSchema), asyncHandler(handleEmbed));
```

### 4. Dead Code Removed

```typescript
// REMOVE from orchestrator.ts (lines 554-661):
// - executeActiveTest()
// - executeInferenceActiveTest()
// - executeEmbeddingActiveTest()
```

---

## Success Criteria

- [ ] `InferenceProbeScheduler` notifies CB on probe failure/success
- [ ] `ModelManager` notifies CB on warmup failure
- [ ] Route validation middleware applied to all inference and admin endpoints
- [ ] Dead `executeActiveTest` code removed
- [ ] Build passes with no errors
- [ ] No LSP diagnostics errors in modified files

---

## Files Modified

| File                                 | Changes                                        |
| ------------------------------------ | ---------------------------------------------- |
| `src/inference-probe-scheduler.ts`   | Add CB registry getter, notify on fail/success |
| `src/model-manager.ts`               | Add CB registry setter, notify on warmup fail  |
| `src/orchestrator/orchestrator.ts`   | Pass registry to components, remove dead code  |
| `src/middleware/validation.ts`       | Add `embedRequestSchema`                       |
| `src/routes/inference.routes.ts`     | Apply validation middleware                    |
| `src/routes/admin.routes.ts`         | Apply validation middleware                    |
| `src/__tests__/orchestrator.test.ts` | Remove dead tests                              |

---

## How to Execute

```bash
# Start work session
/start-work remaining-gap-fixes

# Or resume existing session
/start-work
```

---

## Notes

- **Wave 1 tasks are independent** - can run T1, T2+3, T4+5 in parallel
- **T7 depends on T1** - embedRequestSchema must exist first
- **T9 depends on T8** - remove tests after removing code
- **Build must pass** before moving to next wave
