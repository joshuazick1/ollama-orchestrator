# Remaining Gap Analysis Fixes - Expanded Implementation Plan

**Status**: COMPLETE
**Session**: Use `/start-work remaining-gap-fixes` to resume

---

## TL;DR

> **Quick Summary**: Wire circuit breakers into InferenceProbeScheduler and ModelManager for probe/warmup failure tracking, apply validation middleware to API routes, and remove dead executeActiveTest code.
>
> **Deliverables**:
> - InferenceProbeScheduler notifies CB on probe success/failure
> - ModelManager notifies CB on warmup failure
> - Validation middleware applied to all inference and admin endpoints
> - Dead `executeActiveTest` code removed from orchestrator
>
> **Estimated Effort**: Short (1-2 days)
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Wave 1 → Wave 2 → Wave 3 → Final Verification

---

## Cancelled Items

| Item | Reason |
|------|--------|
| **P1-9**: Health check probes return null silently | NOT A BUG - Intentional graceful degradation. Errors logged, fallback exists, throws if ALL fail |
| **P2-22**: nonCircuitBreaking flag ignored | `executeActiveTest()` is DEAD CODE - never called from production |

---

## Context

### Original Request
Expand REMAINING_GAP_FIXES_PLAN.md with detailed implementation specifics, line numbers, acceptance criteria, and QA scenarios.

### Research Findings Summary

| Component | File | Key Discovery |
|-----------|------|---------------|
| **InferenceProbeScheduler** | `src/inference-probe-scheduler.ts` | Constructor ALREADY has `getCircuitBreakerRegistry` injected (lines 46-58) - just needs to USE it |
| **ModelManager** | `src/model-manager.ts` | Constructor (lines 159-161) only takes config - needs `setCircuitBreakerRegistry()` setter added |
| **CircuitBreaker** | `src/circuit-breaker/circuit-breaker.ts` | `recordFailure(error, errorType, retryAfterMs)` / `recordSuccess()` - CB handles state transitions internally |
| **Validation Middleware** | `src/middleware/validation.ts` | `validateRequest()` exists (lines 23-63) - routes currently have NO validation applied |
| **Dead Code** | `src/orchestrator/orchestrator.ts` | `executeActiveTest` (lines 554-661) - CONFIRMED zero production call sites |

### Metis Review (Pre-Plan Gap Analysis)

**Identified Gaps (addressed in this expanded plan)**:
- Added specific line numbers for all insertion points
- Added executable acceptance criteria with exact commands
- Added QA scenarios for each task (happy path + failure cases)
- Added full dependency matrix
- Added atomic commit strategy

---

## Work Objectives

### Core Objective
Wire circuit breakers into probe/warmup failure tracking, apply validation middleware, remove dead code.

### Concrete Deliverables
- [ ] `InferenceProbeScheduler.executeProbe()` notifies CB on success (line ~401) and failure (lines ~391, ~408)
- [ ] `ModelManager` gets `setCircuitBreakerRegistry()` setter; `executeWarmup()` catch block notifies CB (line ~526)
- [ ] `embedRequestSchema` added to `src/middleware/validation.ts`
- [ ] Validation middleware applied to `/api/generate`, `/api/chat`, `/api/embeddings`, `/api/embed`
- [ ] `executeActiveTest` method removed from `src/orchestrator/orchestrator.ts`
- [ ] Related tests removed from `tests/unit/orchestrator.test.ts`

### Definition of Done
- [ ] `npm run build` passes with zero errors
- [ ] All modified files have zero LSP diagnostics errors
- [ ] All unit tests pass (minus removed dead code tests)

### Must Have
- CB notifications use error type `'transient'` for probe failures
- CB notifications use error type `'retryable'` for warmup failures
- Validation middleware returns `400 Bad Request` with `{ error: 'Validation failed', details: [...] }` on failure
- Middleware applied BEFORE `asyncHandler` in route definitions

### Must NOT Have
- NO CB notifications outside identified insertion points
- NO validation on headers or query params (body only)
- NO changes to CB state machine logic (only notifications)
- NO changes to error handling flow beyond CB notifications

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: Tests-after (unit tests exist, some will be removed with dead code)
- **Framework**: bun test / vitest
- **No new tests added** - focus is integration, existing tests provide coverage

### QA Policy
Every task includes agent-executed QA scenarios (no human intervention).
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - foundation + cleanup):
├── T1: Add embedRequestSchema [quick]
├── T2: Wire CB into InferenceProbeScheduler [deep]
├── T3: Remove dead executeActiveTest [deep]
└── T4: Remove dead tests [deep]

Wave 2 (After Wave 1 - CB wiring + middleware):
├── T5: Wire CB into ModelManager [deep]
├── T6: Apply validation to inference routes [quick]
└── T7: Apply validation to admin routes [quick]

Wave 3 (Final):
├── T8: Build verification
└── T9: Final LSP diagnostics check

Wave FINAL (Verification):
├── F1: Plan compliance audit
├── F2: Code quality review
├── F3: Real manual QA
└── F4: Scope fidelity check
```

### Dependency Matrix

| Task | Blocks | Blocked By |
|------|--------|------------|
| T1 (embed schema) | T6, T7 | None |
| T2 (IPS CB) | T8 | None |
| T3 (remove dead code) | T4 | None |
| T4 (remove tests) | T8 | T3 |
| T5 (ModelManager CB) | T8 | None |
| T6 (inference routes) | T8 | T1 |
| T7 (admin routes) | T8 | T1 |
| T8 (build) | F1-F4 | T2, T4, T5, T6, T7 |
| F1-F4 | user approval | T8 |

---

## TODOs

### Wave 1 Tasks

---

- [x] **T1: Add embedRequestSchema**

  **What to do**:
  - Add `embedRequestSchema` to `src/middleware/validation.ts` following existing pattern
  - Based on `EmbedRequestBody` interface in `src/types/api-request.types.ts:40-48`:
    ```typescript
    export interface EmbedRequestBody {
      model?: string;
      input?: string | string[];
      prompt?: string;
      truncate?: boolean;
      options?: Record<string, unknown>;
      keep_alive?: number;
      dimensions?: number;
    }
    ```
  - Schema should use `modelNameSchema`, support both `input` (string or array) and `prompt` as alternatives

  **Must NOT do**:
  - Do NOT modify existing schemas (generateRequestSchema, chatRequestSchema, embeddingsRequestSchema)
  - Do NOT add validation to headers or query params

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - **Reason**: Simple schema addition following established pattern

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T2, T3, T4)
  - **Blocks**: T6, T7 (validation middleware applied to routes)
  - **Blocked By**: None

  **References**:

  **Pattern References** (existing code to follow):
  - `src/middleware/validation.ts:91-97` - `generateRequestSchema` definition pattern
  - `src/middleware/validation.ts:113-116` - `embeddingsRequestSchema` definition (similar structure)
  - `src/types/api-request.types.ts:40-48` - `EmbedRequestBody` interface

  **API/Type References** (contracts to implement against):
  - `z.union([z.string(), z.array(z.string())])` - for input field supporting both formats

  **Test References** (testing patterns to follow):
  - `src/middleware/validation.test.ts` - existing validation tests (if any)

  **Acceptance Criteria**:

  ```bash
  # Schema exists in validation.ts
  grep -n "embedRequestSchema" src/middleware/validation.ts
  # Expected: 1+ match (export line)

  # Schema exports correctly
  grep -n "export.*embedRequestSchema" src/middleware/validation.ts
  # Expected: 1 match

  # Build passes
  npm run build 2>&1 | grep -i error | wc -l
  # Expected: 0 errors related to validation.ts
  ```

  **QA Scenarios**:

  ```
  Scenario: Schema validates valid embed request
    Tool: Bash (node REPL)
    Preconditions: validation.ts compiled, z loaded
    Steps:
      1. Import embedRequestSchema from validation module
      2. Parse valid input: { "input": "hello world", "model": "llama2" }
      3. Parse valid input with array: { "input": ["a", "b"], "model": "llama2" }
      4. Parse valid with optional fields: { "input": "test", "model": "llama2", "truncate": true, "dimensions": 512 }
    Expected Result: All parse successfully without errors
    Evidence: .sisyphus/evidence/task-1-schema-valid.{ext}

  Scenario: Schema rejects invalid embed request
    Tool: Bash (node REPL)
    Preconditions: validation.ts compiled
    Steps:
      1. Import embedRequestSchema
      2. Parse invalid: { "input": 123 } (number instead of string/array)
      3. Parse invalid: { "model": "" } (empty string for model)
      4. Parse invalid: {} (missing required fields)
    Expected Result: Zod validation errors returned
    Failure Indicators: Parsing succeeds when it should fail
    Evidence: .sisyphus/evidence/task-1-schema-invalid.{ext}
  ```

  **Evidence to Capture**:
  - [ ] Schema export verified
  - [ ] Valid inputs parse correctly
  - [ ] Invalid inputs rejected with proper errors

  **Commit**: YES
  - Message: `feat(validation): add embedRequestSchema for /api/embed endpoint`
  - Files: `src/middleware/validation.ts`

---

- [x] **T2: Wire CB into InferenceProbeScheduler**

  **What to do**:
  - The constructor ALREADY has `getCircuitBreakerRegistry: () => CircuitBreakerRegistry` (line 46-58)
  - In `executeProbe()` method (lines 347-427), add CB notifications:
    1. **On success** (after line ~401): `this.getCircuitBreakerRegistry().getOrCreate(key).recordSuccess()`
    2. **On HTTP error** (after line ~391): `this.getCircuitBreakerRegistry().getOrCreate(key).recordFailure(error, 'transient')`
    3. **On exception** (after line ~408): `this.getCircuitBreakerRegistry().getOrCreate(key).recordFailure(error, 'transient')`
  - Use error type `'transient'` for probe failures
  - Key format: `serverId` or `serverId:model` - verify by checking how `key` is constructed in the method

  **Must NOT do**:
  - Do NOT add CB notifications outside `executeProbe()` method
  - Do NOT change the existing probe failure handling logic
  - Do NOT add async/await to CB notification calls (fire-and-forget is fine)

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []
  - **Reason**: Modifying existing probe execution logic, need to understand CB integration

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T3, T4)
  - **Blocks**: T8 (build verification)
  - **Blocked By**: None

  **References**:

  **Pattern References** (existing code to follow):
  - `src/circuit-breaker/circuit-breaker.ts:233-1150` - CircuitBreaker class with `recordFailure`/`recordSuccess`
  - `src/orchestrator/orchestrator.ts:3410-3531` - `recordSuccess`/`recordFailure` usage in orchestrator
  - `src/inference-probe-scheduler.ts:347-427` - executeProbe method to modify

  **API/Type References** (contracts to implement against):
  - `CircuitBreaker.recordFailure(error: Error | string, errorType?: ErrorType, retryAfterMs?: number): void`
  - `CircuitBreaker.recordSuccess(): void`
  - ErrorType: `'retryable' | 'non-retryable' | 'transient' | 'permanent' | 'rateLimited'`

  **Test References** (testing patterns to follow):
  - `tests/unit/inference-probe-scheduler.test.ts` - existing probe scheduler tests

  **Acceptance Criteria**:

  ```bash
  # CB notifications present in executeProbe
  grep -n "recordSuccess\|recordFailure" src/inference-probe-scheduler.ts
  # Expected: 3+ matches (1 success + 2 failure paths)

  # getCircuitBreakerRegistry is called
  grep -n "getCircuitBreakerRegistry" src/inference-probe-scheduler.ts
  # Expected: 3+ matches (getOrCreate calls)

  # Build passes
  npm run build 2>&1 | grep -i error | grep inference-probe-scheduler | wc -l
  # Expected: 0

  # LSP diagnostics clean
  lsp_diagnostics filePath=src/inference-probe-scheduler.ts
  # Expected: 0 errors
  ```

  **QA Scenarios**:

  ```
  Scenario: Probe success notifies CB
    Tool: Bash (grep)
    Preconditions: inference-probe-scheduler.ts modified
    Steps:
      1. Grep for "recordSuccess" in executeProbe method
      2. Verify it's called after successful HTTP response
    Expected Result: recordSuccess found at correct location
    Evidence: .sisyphus/evidence/task-2-success-notification.{ext}

  Scenario: Probe HTTP error notifies CB
    Tool: Bash (grep)
    Preconditions: inference-probe-scheduler.ts modified
    Steps:
      1. Grep for "recordFailure" near HTTP error handling (line ~391)
      2. Verify error type is 'transient'
    Expected Result: recordFailure found with 'transient' error type
    Evidence: .sisyphus/evidence/task-2-http-error-notification.{ext}

  Scenario: Probe exception notifies CB
    Tool: Bash (grep)
    Preconditions: inference-probe-scheduler.ts modified
    Steps:
      1. Grep for "recordFailure" in catch block (line ~408)
      2. Verify error type is 'transient'
    Expected Result: recordFailure found with 'transient' error type
    Evidence: .sisyphus/evidence/task-2-exception-notification.{ext}
  ```

  **Evidence to Capture**:
  - [ ] recordSuccess present in success path
  - [ ] recordFailure present in HTTP error path with 'transient'
  - [ ] recordFailure present in catch block with 'transient'

  **Commit**: YES
  - Message: `feat(probe-scheduler): notify circuit breaker on probe success and failure`
  - Files: `src/inference-probe-scheduler.ts`

---

- [x] **T3: Remove dead executeActiveTest**

  **What to do**:
  - Remove `executeActiveTest` method from `src/orchestrator/orchestrator.ts` (lines 554-661)
  - Also remove related helper methods if they are ONLY used by executeActiveTest:
    - `executeInferenceActiveTest`
    - `executeEmbeddingActiveTest`
  - Verify these helpers are truly dead before removal
  - Also check for any related private fields that might be exclusively for this method

  **Must NOT do**:
  - Do NOT remove methods that have other call sites
  - Do NOT modify any other methods in orchestrator.ts
  - Do NOT touch the orchestrator constructor or initialization

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`git-master`]
  - **Reason**: Dead code removal with test impact, need careful git handling

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T2, T4)
  - **Blocks**: T4 (remove tests)
  - **Blocked By**: None

  **References**:

  **Pattern References** (existing code to follow):
  - N/A - this is a removal task

  **API/Type References** (contracts to implement against):
  - `src/orchestrator/orchestrator.ts:554-661` - executeActiveTest method to remove
  - Search for any other references before removal

  **Test References** (testing patterns to follow):
  - `tests/unit/orchestrator.test.ts:1653-1689` - tests for executeActiveTest methods
  - `tests/unit/orchestrator.test.ts:2557-2582` - direct executeActiveTest tests
  - `tests/unit/orchestrator.test.ts:2640-2688` - model type detection tests

  **Acceptance Criteria**:

  ```bash
  # executeActiveTest method removed
  grep -n "executeActiveTest" src/orchestrator/orchestrator.ts
  # Expected: 0 matches

  # Helper methods removed (if they were only used by executeActiveTest)
  grep -n "executeInferenceActiveTest\|executeEmbeddingActiveTest" src/orchestrator/orchestrator.ts
  # Expected: 0 matches (or matches if they're used elsewhere)

  # Build passes
  npm run build 2>&1 | grep -i error | grep orchestrator | wc -l
  # Expected: 0

  # LSP diagnostics clean
  lsp_diagnostics filePath=src/orchestrator/orchestrator.ts
  # Expected: 0 errors
  ```

  **QA Scenarios**:

  ```
  Scenario: executeActiveTest is truly dead code
    Tool: Bash (grep)
    Preconditions: orchestrator.ts unchanged
    Steps:
      1. Search for any production call sites: grep -r "executeActiveTest" src/
      2. Verify only definition and comments remain
    Expected Result: Only definition at ~line 554, comment in recovery-test-coordinator.ts
    Failure Indicators: Any actual call sites found in production code
    Evidence: .sisyphus/evidence/task-3-dead-code-confirmation.{ext}

  Scenario: Related helper methods status
    Tool: Bash (grep)
    Preconditions: orchestrator.ts unchanged
    Steps:
      1. Search for executeInferenceActiveTest call sites
      2. Search for executeEmbeddingActiveTest call sites
      3. Determine if these are safe to remove
    Expected Result: Clear determination of whether helpers are dead or used
    Evidence: .sisyphus/evidence/task-3-helper-methods.{ext}
  ```

  **Evidence to Capture**:
  - [ ] executeActiveTest removed
  - [ ] Helper methods status verified
  - [ ] No broken references in orchestrator

  **Commit**: YES
  - Message: `refactor(orchestrator): remove dead executeActiveTest code`
  - Files: `src/orchestrator/orchestrator.ts`

---

- [x] **T4: Remove dead tests**

  **What to do**:
  - Remove test suites in `tests/unit/orchestrator.test.ts` that test removed methods:
    1. `describe('executeActiveTest methods')` around line 1653
    2. `describe('executeActiveTest - model type detection')` around line 2557
    3. `describe('Active test with model type detection')` around line 2640
  - Remove any test helpers or mocks exclusively used by these tests

  **Must NOT do**:
  - Do NOT remove tests for other orchestrator functionality
  - Do NOT modify test setup/teardown unless exclusively for removed tests

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`git-master`]
  - **Reason**: Test file modification, need careful removal

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T2, T3)
  - **Blocks**: T8 (build verification)
  - **Blocked By**: T3 (must remove code before removing tests)

  **References**:

  **Pattern References** (existing code to follow):
  - N/A - this is a removal task

  **Test References** (testing patterns to follow):
  - `tests/unit/orchestrator.test.ts:1653-2688` - exact line ranges for removal

  **Acceptance Criteria**:

  ```bash
  # Tests for removed methods are gone
  grep -n "executeActiveTest" tests/unit/orchestrator.test.ts
  # Expected: 0 matches

  # Remaining tests still pass
  bun test tests/unit/orchestrator.test.ts 2>&1 | tail -5
  # Expected: All tests pass (minus removed ones)

  # Build passes
  npm run build 2>&1 | grep -i error | wc -l
  # Expected: 0
  ```

  **QA Scenarios**:

  ```
  Scenario: Removed tests are truly only for dead code
    Tool: Bash (grep)
    Preconditions: orchestrator.test.ts unchanged
    Steps:
      1. Verify tests use bracket notation to access private method
      2. Verify no other tests depend on these test suites
    Expected Result: Tests only test removed functionality
    Evidence: .sisyphus/evidence/task-4-test-removal.{ext}

  Scenario: Other orchestrator tests still pass
    Tool: Bash
    Preconditions: test file modified
    Steps:
      1. Run remaining orchestrator tests
      2. Verify no failures in unrelated test suites
    Expected Result: All remaining tests pass
    Evidence: .sisyphus/evidence/task-4-remaining-tests.{ext}
  ```

  **Evidence to Capture**:
  - [ ] executeActiveTest tests removed
  - [ ] Other tests still pass

  **Commit**: YES
  - Message: `test(orchestrator): remove tests for dead executeActiveTest`
  - Files: `tests/unit/orchestrator.test.ts`

---

### Wave 2 Tasks

---

- [x] **T5: Wire CB into ModelManager**

  **What to do**:
  - Add `circuitBreakerRegistry` field to ModelManager class
  - Add `setCircuitBreakerRegistry(registry: CircuitBreakerRegistry): void` setter method
  - In `executeWarmup()` catch block (lines 526-542), add CB notification:
    ```typescript
    if (this.circuitBreakerRegistry) {
      const cb = this.circuitBreakerRegistry.getOrCreate(`${job.serverId}:${job.model}`);
      cb.recordFailure(errorMessage, 'retryable');
    }
    ```
  - Use error type `'retryable'` for warmup failures
  - Wrap in try-catch to prevent CB notification failures from crashing warmup

  **Must NOT do**:
  - Do NOT modify the existing warmup failure handling logic
  - Do NOT add CB notifications outside the catch block
  - Do NOT change warmup retry logic

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []
  - **Reason**: New field and setter, CB integration into existing warmup flow

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T6, T7)
  - **Blocks**: T8 (build verification)
  - **Blocked By**: None

  **References**:

  **Pattern References** (existing code to follow):
  - `src/circuit-breaker/circuit-breaker.ts:1155-1256` - CircuitBreakerRegistry.getOrCreate usage
  - `src/orchestrator/orchestrator.ts:4043-4073` - getModelCircuitBreaker pattern with `serverId:model` key
  - `src/model-manager.ts:482-543` - executeWarmup method to modify

  **API/Type References** (contracts to implement against):
  - `CircuitBreakerRegistry.getOrCreate(name: string): CircuitBreaker`
  - `CircuitBreaker.recordFailure(error: Error | string, errorType?: ErrorType): void`
  - ErrorType `'retryable'` for warmup failures

  **Test References** (testing patterns to follow):
  - `tests/unit/model-manager.test.ts` - existing ModelManager tests

  **Acceptance Criteria**:

  ```bash
  # setCircuitBreakerRegistry method exists
  grep -n "setCircuitBreakerRegistry" src/model-manager.ts
  # Expected: 1+ match

  # circuitBreakerRegistry field exists
  grep -n "circuitBreakerRegistry" src/model-manager.ts
  # Expected: 1+ match (field + setter)

  # recordFailure called in catch block
  grep -n "recordFailure" src/model-manager.ts
  # Expected: 1+ match in catch block

  # Build passes
  npm run build 2>&1 | grep -i error | grep model-manager | wc -l
  # Expected: 0

  # LSP diagnostics clean
  lsp_diagnostics filePath=src/model-manager.ts
  # Expected: 0 errors
  ```

  **QA Scenarios**:

  ```
  Scenario: setCircuitBreakerRegistry setter exists
    Tool: Bash (grep)
    Preconditions: model-manager.ts modified
    Steps:
      1. Grep for "setCircuitBreakerRegistry" method definition
      2. Verify it accepts CircuitBreakerRegistry parameter
    Expected Result: Method found with correct signature
    Evidence: .sisyphus/evidence/task-5-setter.{ext}

  Scenario: CB notification in warmup catch block
    Tool: Bash (grep)
    Preconditions: model-manager.ts modified
    Steps:
      1. Grep for "recordFailure" in executeWarmup method
      2. Verify error type is 'retryable'
      3. Verify it uses serverId:model key format
    Expected Result: recordFailure found with correct error type and key
    Evidence: .sisyphus/evidence/task-5-catch-notification.{ext}

  Scenario: CB notification wrapped in safety check
    Tool: Bash (grep)
    Preconditions: model-manager.ts modified
    Steps:
      1. Verify CB notification is inside "if (this.circuitBreakerRegistry)" check
      2. Verify notification won't crash if registry is null
    Expected Result: Null check present
    Evidence: .sisyphus/evidence/task-5-safety-check.{ext}
  ```

  **Evidence to Capture**:
  - [ ] Setter method exists with correct signature
  - [ ] recordFailure called with 'retryable' error type
  - [ ] Null check prevents crashes if registry not set

  **Commit**: YES
  - Message: `feat(model-manager): wire circuit breaker for warmup failure notifications`
  - Files: `src/model-manager.ts`

---

- [x] **T6: Apply validation to inference routes**

  **What to do**:
  - Add `validateRequest` middleware to routes in `src/routes/inference.routes.ts`:
    ```typescript
    import { validateRequest, generateRequestSchema, chatRequestSchema, embeddingsRequestSchema, embedRequestSchema } from '../middleware/validation.js';

    inferenceRouter.post('/generate', validateRequest(generateRequestSchema), asyncHandler(handleGenerate));
    inferenceRouter.post('/chat', validateRequest(chatRequestSchema), asyncHandler(handleChat));
    inferenceRouter.post('/embeddings', validateRequest(embeddingsRequestSchema), asyncHandler(handleEmbeddings));
    inferenceRouter.post('/embed', validateRequest(embedRequestSchema), asyncHandler(handleEmbed));
    ```
  - Import the schemas from middleware
  - Apply middleware BEFORE `asyncHandler`

  **Must NOT do**:
  - Do NOT apply validation to routes that don't have schemas yet
  - Do NOT change the order of other middleware
  - Do NOT modify asyncHandler behavior

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - **Reason**: Simple middleware application following established pattern

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T5, T7)
  - **Blocks**: T8 (build verification)
  - **Blocked By**: T1 (embedRequestSchema must exist first)

  **References**:

  **Pattern References** (existing code to follow):
  - `src/routes/inference.routes.ts` - existing route definitions to modify
  - `src/middleware/validation.ts:23-63` - validateRequest middleware

  **API/Type References** (contracts to implement against):
  - `validateRequest(schema: ZodType, source?: 'body' | 'query' | 'params')` returns Express middleware

  **Test References** (testing patterns to follow):
  - `tests/unit/inference.routes.test.ts` - existing route tests (if any)

  **Acceptance Criteria**:

  ```bash
  # validateRequest imported
  grep -n "import.*validateRequest" src/routes/inference.routes.ts
  # Expected: 1 match

  # Schemas imported
  grep -n "embedRequestSchema" src/routes/inference.routes.ts
  # Expected: 1 match in import

  # validateRequest applied to routes
  grep -n "validateRequest" src/routes/inference.routes.ts
  # Expected: 4 matches (one per route)

  # Build passes
  npm run build 2>&1 | grep -i error | grep inference.routes | wc -l
  # Expected: 0

  # LSP diagnostics clean
  lsp_diagnostics filePath=src/routes/inference.routes.ts
  # Expected: 0 errors
  ```

  **QA Scenarios**:

  ```
  Scenario: Validation middleware applied to all 4 inference routes
    Tool: Bash (grep)
    Preconditions: inference.routes.ts modified
    Steps:
      1. Grep for each route: /generate, /chat, /embeddings, /embed
      2. Verify validateRequest appears before asyncHandler for each
    Expected Result: All 4 routes have validateRequest middleware
    Evidence: .sisyphus/evidence/task-6-middleware-applied.{ext}

  Scenario: Invalid request returns 400
    Tool: Bash (curl)
    Preconditions: Server running with modified routes
    Steps:
      1. Send POST /api/generate with invalid body: { "prompt": 123 }
      2. Send POST /api/chat with invalid body: { "messages": "notarray" }
    Expected Result: 400 Bad Request with validation error details
    Failure Indicators: 500 or 200 instead of 400
    Evidence: .sisyphus/evidence/task-6-validation-error.{ext}
  ```

  **Evidence to Capture**:
  - [ ] All 4 routes have validateRequest
  - [ ] Invalid input returns 400

  **Commit**: YES
  - Message: `feat(routes): apply validation middleware to inference endpoints`
  - Files: `src/routes/inference.routes.ts`

---

- [x] **T7: Apply validation to admin routes**

  **What to do**:
  - Check `src/routes/admin.routes.ts` for endpoints that need validation
  - Identify which admin routes have corresponding schemas
  - Apply `validateRequest` middleware where schemas exist

  **Must NOT do**:
  - Do NOT apply validation to admin routes without schemas
  - Do NOT change admin route logic

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - **Reason**: Simple middleware application

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T5, T6)
  - **Blocks**: T8 (build verification)
  - **Blocked By**: T1 (schemas must exist first)

  **References**:

  **Pattern References** (existing code to follow):
  - `src/routes/admin.routes.ts` - admin route definitions
  - `src/middleware/validation.ts:23-63` - validateRequest middleware

  **Acceptance Criteria**:

  ```bash
  # Check what admin routes exist
  grep -n "Router\|post\|get" src/routes/admin.routes.ts | head -20
  # Expected: List of admin routes

  # validateRequest imported if used
  grep -n "import.*validateRequest" src/routes/admin.routes.ts
  # Expected: 0 or 1 match depending on whether admin needs validation

  # Build passes
  npm run build 2>&1 | grep -i error | grep admin.routes | wc -l
  # Expected: 0

  # LSP diagnostics clean
  lsp_diagnostics filePath=src/routes/admin.routes.ts
  # Expected: 0 errors
  ```

  **QA Scenarios**:

  ```
  Scenario: Admin routes validation status determined
    Tool: Bash (grep + read)
    Preconditions: admin.routes.ts exists
    Steps:
      1. List all admin routes
      2. Determine which have schemas available
      3. Document decision (apply or skip)
    Expected Result: Clear decision documented
    Evidence: .sisyphus/evidence/task-7-admin-routes.{ext}

  Scenario: Applied validation works correctly
    Tool: Bash (if validation applied)
    Preconditions: Admin routes modified
    Steps:
      1. If validation applied: test invalid input returns 400
      2. If no validation: document reason for skipping
    Expected Result: Either validation works or documented reason for skip
    Evidence: .sisyphus/evidence/task-7-admin-validation.{ext}
  ```

  **Evidence to Capture**:
  - [ ] Admin routes reviewed
  - [ ] Decision documented (apply or skip)

  **Commit**: YES (if validation applied) or NO (if none to apply)
  - Message: `feat(routes): apply validation middleware to admin endpoints` (or `docs: no admin route validation needed`)
  - Files: `src/routes/admin.routes.ts` (if modified)

---

### Wave 3 Tasks

---

- [x] **T8: Build verification**

  **What to do**:
  - Run `npm run build` and verify it passes with zero errors
  - Run `lsp_diagnostics` on all modified files
  - Verify all modified files have zero errors

  **Must NOT do**:
  - Do NOT proceed if build fails
  - Do NOT ignore LSP errors

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - **Reason**: Simple verification task

  **Parallelization**:
  - **Can Run In Parallel**: NO (sequential, final check)
  - **Blocks**: F1-F4 (final verification)
  - **Blocked By**: T2, T4, T5, T6, T7

  **Acceptance Criteria**:

  ```bash
  # Build passes
  npm run build
  # Expected: 0 errors

  # No LSP errors in modified files
  lsp_diagnostics filePath=src/inference-probe-scheduler.ts
  lsp_diagnostics filePath=src/model-manager.ts
  lsp_diagnostics filePath=src/orchestrator/orchestrator.ts
  lsp_diagnostics filePath=src/middleware/validation.ts
  lsp_diagnostics filePath=src/routes/inference.routes.ts
  lsp_diagnostics filePath=src/routes/admin.routes.ts
  # Expected: 0 errors for all
  ```

  **QA Scenarios**:

  ```
  Scenario: Full build succeeds
    Tool: Bash
    Preconditions: All tasks complete
    Steps:
      1. Run npm run build
      2. Capture output
    Expected Result: Build completes with 0 errors
    Evidence: .sisyphus/evidence/task-8-build.{ext}

  Scenario: All modified files have zero LSP errors
    Tool: Bash (lsp_diagnostics)
    Preconditions: Build succeeded
    Steps:
      1. Check each modified file
      2. Verify 0 errors each
    Expected Result: All files have 0 errors
    Evidence: .sisyphus/evidence/task-8-lsp-diagnostics.{ext}
  ```

  **Evidence to Capture**:
  - [ ] Build passes
  - [ ] All LSP diagnostics clean

  **Commit**: NO (part of final integration)

---

## Final Verification Wave

- [x] **F1: Plan compliance audit** — `oracle`

  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.

  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] **F2: Code quality review** — `unspecified-high`

  Run `tsc --noEmit` + linter + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).

  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] **F3: Real manual QA** — `unspecified-high` (+ `playwright` skill if UI)

  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (features working together, not isolation). Test edge cases: empty state, invalid input, rapid actions. Save to `.sisyphus/evidence/final-qa/`.

  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] **F4: Scope fidelity check** — `deep`

  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes.

  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

### Atomic Commits (in execution order)

| # | Message | Files | Pre-commit |
|---|---------|-------|------------|
| 1 | `feat(validation): add embedRequestSchema for /api/embed endpoint` | `src/middleware/validation.ts` | `npm run build` |
| 2 | `feat(probe-scheduler): notify circuit breaker on probe success and failure` | `src/inference-probe-scheduler.ts` | `npm run build` |
| 3 | `refactor(orchestrator): remove dead executeActiveTest code` | `src/orchestrator/orchestrator.ts` | `npm run build` |
| 4 | `test(orchestrator): remove tests for dead executeActiveTest` | `tests/unit/orchestrator.test.ts` | `bun test` |
| 5 | `feat(model-manager): wire circuit breaker for warmup failure notifications` | `src/model-manager.ts` | `npm run build` |
| 6 | `feat(routes): apply validation middleware to inference endpoints` | `src/routes/inference.routes.ts` | `npm run build` |
| 7 | `feat(routes): apply validation middleware to admin endpoints` | `src/routes/admin.routes.ts` | `npm run build` |

---

## Success Criteria

### Verification Commands

```bash
# All circuit breaker notifications present
grep -n "recordSuccess\|recordFailure" src/inference-probe-scheduler.ts | wc -l
# Expected: 3+ (1 success + 2 failure paths)

grep -n "recordFailure" src/model-manager.ts | wc -l
# Expected: 1+ (in catch block)

# Validation middleware applied
grep -n "validateRequest" src/routes/inference.routes.ts | wc -l
# Expected: 4 (one per route)

# Dead code removed
grep -n "executeActiveTest" src/orchestrator/orchestrator.ts
# Expected: 0 matches

grep -n "executeActiveTest" tests/unit/orchestrator.test.ts
# Expected: 0 matches

# Build and tests pass
npm run build
# Expected: 0 errors

bun test
# Expected: All tests pass (minus removed ones)
```

### Final Checklist

- [x] InferenceProbeScheduler notifies CB on probe success
- [x] InferenceProbeScheduler notifies CB on probe HTTP error
- [x] InferenceProbeScheduler notifies CB on probe exception
- [x] ModelManager notifies CB on warmup failure
- [x] embedRequestSchema added and exported
- [x] Validation middleware applied to /api/generate
- [x] Validation middleware applied to /api/chat
- [x] Validation middleware applied to /api/embeddings
- [x] Validation middleware applied to /api/embed
- [x] executeActiveTest method removed from orchestrator
- [x] Related tests removed from orchestrator.test.ts
- [x] Build passes with 0 errors
- [x] All LSP diagnostics clean
- [x] All remaining tests pass
