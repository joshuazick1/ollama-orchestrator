# Plan: Remaining Gap Analysis Fixes

## TL;DR

> Implement architectural changes to wire circuit breakers into `InferenceProbeScheduler` and `ModelManager`, apply route validation middleware, and clean up dead code.

**Estimated Effort**: Medium-Large (requires architectural changes)
**Parallel Execution**: YES - 3 waves

---

## Cancelled Items Reassessment

Based on deep analysis:

| Item | Original Issue | Final Assessment |
|------|---------------|------------------|
| **P1-9** | Health check probes return null silently | **NOT A BUG** - Intentional graceful degradation. Errors logged, fallback exists, throws if ALL fail. **CANCEL** |
| **P2-22** | nonCircuitBreaking flag ignored | `executeActiveTest()` is **DEAD CODE** - never called. `nonCircuitBreaking` concept missing from new flow. **REMOVE dead code** |

---

## Work Objectives

### Must Have

1. **P1-8**: Wire `CircuitBreakerRegistry` into `InferenceProbeScheduler`
2. **P2-21**: Wire `CircuitBreakerRegistry` into `ModelManager`
3. **P1-10**: Apply validation middleware to routes
4. **P2-22-REMOVE**: Remove dead `executeActiveTest` method and tests

### Must NOT Have

- Don't break existing probe scheduling logic
- Don't break warmup functionality
- Don't remove working code without确认
- Don't add validation that changes API contract

---

## Verification Strategy

**QA Policy**: Agent-executed QA only (no unit tests for these changes)
- Build must pass (`npm run build`)
- LSP diagnostics must show no errors
- Manual verification of architectural changes by review agent

---

## Execution Strategy

### Wave 1 (Foundation - Schema & Architecture)

| Task | Description | Blocks |
|------|-------------|--------|
| T1 | Create `embedRequestSchema` for `/api/embed` endpoint | T7 |
| T2 | Add `CircuitBreakerRegistry` getter to `InferenceProbeScheduler` | T3 |
| T3 | Implement CB notification in `executeProbe` failure/success | T4 |
| T4 | Add `CircuitBreakerRegistry` setter to `ModelManager` | T5 |
| T5 | Implement CB notification in `executeWarmup` failure | None |

### Wave 2 (Route Validation - Can run after T1)

| Task | Description | Blocks |
|------|-------------|--------|
| T6 | Apply `validateRequest` to inference routes (`/api/*`) | None |
| T7 | Apply `validateRequest` to admin routes (`/api/orchestrator/*`) | T1 (for embed schema) |
| T8 | Remove dead `executeActiveTest` method from orchestrator | None |
| T9 | Remove dead `executeActiveTest` tests from test files | T8 |

### Wave 3 (Integration & Review)

| Task | Description | Blocks |
|------|-------------|--------|
| T10 | Run build, verify no LSP errors | T3, T5, T6, T7, T8, T9 |
| T11 | Final verification | T10 |

---

## Task Details

### T1: Create `embedRequestSchema` for `/api/embed`

**File**: `src/middleware/validation.ts`

**What to do**:
```typescript
// Add new schema for POST /api/embed endpoint
export const embedRequestSchema = z.object({
  model: modelNameSchema,
  input: z.union([z.string(), z.array(z.string())]),
  truncate: z.boolean().optional(),
  dimensions: z.number().int().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  keep_alive: z.union([z.number().int(), z.string()]).optional(),
});
```

**Acceptance Criteria**:
- [ ] Schema added to validation.ts
- [ ] Build passes

---

### T2: Add `CircuitBreakerRegistry` getter to `InferenceProbeScheduler`

**File**: `src/inference-probe-scheduler.ts`

**What to do**:
1. Add import for `CircuitBreakerRegistry`
2. Add private field: `private getCircuitBreakerRegistry: () => CircuitBreakerRegistry`
3. Add to constructor parameters: `getCircuitBreakerRegistry: () => CircuitBreakerRegistry`
4. Store in constructor: `this.getCircuitBreakerRegistry = getCircuitBreakerRegistry`

**Orchestrator instantiation** (line ~231):
```typescript
this.probeScheduler = new InferenceProbeScheduler(
  this.config.probeScheduler,
  () => this.servers,
  () => this.metricsAggregator,
  () => getMetricsStore(),
  () => this.circuitBreakerRegistry  // NEW
);
```

**Acceptance Criteria**:
- [ ] InferenceProbeScheduler accepts CB registry getter
- [ ] Orchestrator passes registry getter
- [ ] Build passes

---

### T3: Implement CB notification in `executeProbe` failure/success

**File**: `src/inference-probe-scheduler.ts`

**What to do**:
In `executeProbe` method (around line 387 for failure, line 393 for success):

On **failure** (after calling `recordProbeFailure(key)`):
```typescript
// Get the circuit breaker for this server:model and record failure
const breaker = this.getCircuitBreakerRegistry().getModelCircuitBreaker(serverId, model);
breaker?.recordFailure(
  new Error(`Probe failed: ${responseStatusText || 'HTTP ' + response.status}`),
  'transient'
);
```

On **success** (after clearing local failure state):
```typescript
// Record success with the circuit breaker
const breaker = this.getCircuitBreakerRegistry().getModelCircuitBreaker(serverId, model);
breaker?.recordSuccess();
```

**References**: 
- `src/orchestrator/orchestrator.ts:3435` - `recordFailure()` usage pattern
- `src/recovery-test-coordinator.ts:1317` - `breaker.recordFailure()` usage

**Acceptance Criteria**:
- [ ] Probe failures call `cb.recordFailure()` with 'transient' error type
- [ ] Probe successes call `cb.recordSuccess()`
- [ ] Build passes

---

### T4: Add `CircuitBreakerRegistry` setter to `ModelManager`

**File**: `src/model-manager.ts`

**What to do**:
1. Add import for `CircuitBreakerRegistry`
2. Add private field: `private circuitBreakerRegistry?: CircuitBreakerRegistry`
3. Add setter method:
```typescript
setCircuitBreakerRegistry(registry: CircuitBreakerRegistry): void {
  this.circuitBreakerRegistry = registry;
}
```

4. In orchestrator, after creating/getting ModelManager instance, call:
```typescript
getModelManager().setCircuitBreakerRegistry(this.circuitBreakerRegistry);
```

**Reference**: `src/orchestrator/orchestrator.ts` - how other components get CB registry

**Acceptance Criteria**:
- [ ] ModelManager has `setCircuitBreakerRegistry()` method
- [ ] Orchestrator calls the setter after setup
- [ ] Build passes

---

### T5: Implement CB notification in `executeWarmup` failure

**File**: `src/model-manager.ts`

**What to do**:
In `executeWarmup` catch block (around line 526-542), after setting job status to 'failed':

```typescript
// Notify circuit breaker of warmup failure
if (this.circuitBreakerRegistry) {
  const key = `${job.serverId}:${job.model}`;
  const cb = this.circuitBreakerRegistry.getOrCreate(key);
  cb.recordFailure(new Error(errorMessage), 'retryable');
}
```

**Reference**: `src/orchestrator/orchestrator.ts:3435` - recordFailure usage pattern

**Acceptance Criteria**:
- [ ] Warmup failures call `cb.recordFailure()` with 'retryable' error type
- [ ] Build passes

---

### T6: Apply `validateRequest` to inference routes

**Files**: `src/routes/inference.routes.ts`

**What to do**:
```typescript
import { 
  validateRequest, 
  generateRequestSchema, 
  chatRequestSchema, 
  embeddingsRequestSchema,
  embedRequestSchema,  // After T1
} from '../middleware/validation.js';

// Apply to routes
inferenceRouter.post('/generate', validateRequest(generateRequestSchema), asyncHandler(handleGenerate));
inferenceRouter.post('/chat', validateRequest(chatRequestSchema), asyncHandler(handleChat));
inferenceRouter.post('/embeddings', validateRequest(embeddingsRequestSchema), asyncHandler(handleEmbeddings));
inferenceRouter.post('/embed', validateRequest(embedRequestSchema), asyncHandler(handleEmbed));
```

**Acceptance Criteria**:
- [ ] Inference routes have validation middleware applied
- [ ] Build passes
- [ ] Existing endpoints still work (verified by integration test or manual)

---

### T7: Apply `validateRequest` to admin routes

**Files**: `src/routes/admin.routes.ts`

**What to do**:
Apply validation to key admin endpoints:
```typescript
import { 
  validateRequest,
  addServerSchema,
  updateServerSchema,
  configUpdateSchema,
  warmupModelSchema,
  unloadModelSchema,
} from '../middleware/validation.js';

// Servers
adminRouter.post('/servers/add', validateRequest(addServerSchema), asyncHandler(addServer));
adminRouter.patch('/servers/:id', validateRequest(updateServerSchema), asyncHandler(updateServer));

// Config
adminRouter.post('/config', validateRequest(configUpdateSchema), asyncHandler(updateConfig));
adminRouter.patch('/config/:section', validateRequest(configUpdateSchema), asyncHandler(updateConfigSection));

// Models  
adminRouter.post('/models/:model/warmup', validateRequest(warmupModelSchema), asyncHandler(warmupModel));
adminRouter.post('/models/:model/unload', validateRequest(unloadModelSchema), asyncHandler(unloadModel));
```

**Acceptance Criteria**:
- [ ] Admin routes have validation middleware applied
- [ ] Build passes

---

### T8: Remove dead `executeActiveTest` method

**File**: `src/orchestrator/orchestrator.ts`

**What to do**:
Remove the entire `executeActiveTest` method (lines ~554-661), including:
- `executeActiveTest` method
- `executeInferenceActiveTest` method  
- `executeEmbeddingActiveTest` method
- Any helper methods only used by these

**Verification before removal**:
```bash
grep -n "executeActiveTest\|executeInferenceActiveTest\|executeEmbeddingActiveTest" src/orchestrator/orchestrator.ts
```
Confirm only the method definitions appear (no other callers).

**Acceptance Criteria**:
- [ ] Dead methods removed
- [ ] Build passes
- [ ] No references to these methods remain in production code

---

### T9: Remove dead `executeActiveTest` tests

**Files**: `src/__tests__/orchestrator.test.ts` (or similar test file)

**What to do**:
Find and remove test blocks for `executeActiveTest`:
```bash
grep -n "executeActiveTest" src/__tests__/orchestrator.test.ts
```

Remove test cases like:
- "executeActiveTest methods"
- "executeActiveTest - model type detection"
- Any tests using `orchestrator['executeActiveTest']`

**Acceptance Criteria**:
- [ ] Dead tests removed
- [ ] Build passes
- [ ] Other tests still pass

---

### T10: Build verification

**What to do**:
```bash
npm run build
```

**Verify**:
- [ ] No TypeScript errors
- [ ] No lint errors
- [ ] All files compile

---

### T11: Final verification

**What to do**:
Run the orchestrator and verify:
1. Server starts without errors
2. Health check endpoint works
3. Basic inference works

---

## Commit Strategy

| Wave | Tasks | Commit Message |
|------|-------|----------------|
| 1 | T2, T3, T4, T5 | `feat(circuit-breaker): wire CB into probe scheduler and model manager` |
| 2 | T1, T6, T7, T8, T9 | `feat(validation): apply Zod schemas to routes, remove dead code` |
| 3 | T10, T11 | `chore: verify build and runtime` |

---

## Success Criteria

- [ ] `InferenceProbeScheduler` notifies CB on probe failure/success
- [ ] `ModelManager` notifies CB on warmup failure
- [ ] Route validation middleware applied to all inference and admin endpoints
- [ ] Dead `executeActiveTest` code removed
- [ ] Build passes with no errors
- [ ] No LSP diagnostics errors in modified files