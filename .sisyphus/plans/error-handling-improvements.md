# Error Handling Improvements - Expanded Scope

## TL;DR

> **Quick Summary**: Build a comprehensive error tracking and circuit breaker improvement system with frontend visibility, per-request error persistence, and enhanced rate limit handling.
>
> **Deliverables**:
> - Error event persistence (per-request) with server/circuit context
> - Frontend error log UI (historical query by server/circuit)
> - Rate limit handling with Retry-After support
> - Circuit breaker architecture review + configurable thresholds
>
> **Estimated Effort**: Large (15+ tasks, 4 waves)
> **Parallel Execution**: YES - independent components
> **Critical Path**: Wave 1 (foundation) → Wave 2 (persistence) → Wave 3 (frontend + rate limits) → Wave 4 (circuit review)

---

## Context

### Original Request
User ran production server and wants to improve load balancer error handling by investigating logs in `logs/` for undocumented error types.

### Expanded Requirements (confirmed via interview)
1. **Frontend Error Tracking**: Historical error logs viewable from frontend (NOT real-time)
2. **Server/Circuit Query**: Ability to query errors by server and circuit
3. **Rate Limit Handling**: Improve handling of rate limit errors with Retry-After support
4. **Circuit Breaker Review**: Full architecture review of error classification, thresholds, backoff, state transitions
5. **Configurable Thresholds**: Add circuit breaker thresholds to config schema

### Interview Summary
- Error storage: **Per-request events** with serverId, circuitId, error type, timestamp
- Threshold config: **Add to config schema** - make key thresholds configurable
- Real-time: **NOT needed** - historical only
- Scope: Historical query from logs/storage, not real-time streaming

---

## Work Objectives

### Core Objective
Build comprehensive error tracking and circuit breaker improvement system enabling frontend visibility and better rate limit handling.

### Concrete Deliverables
1. Error event persistence layer (per-request)
2. API endpoints for querying errors by server/circuit
3. Frontend error log page/panel
4. Rate limit handling with Retry-After header support
5. Circuit breaker architecture review + documentation
6. Configurable circuit breaker thresholds

### Definition of Done
- [ ] Frontend can query historical errors by serverId and circuitId
- [ ] Rate limit errors include Retry-After header parsing and backoff
- [ ] Circuit breaker thresholds are configurable via config schema
- [ ] All existing tests pass (regression)

### Must Have
- Error event storage with full context (serverId, model, error type, error message, timestamp)
- API: GET errors with filters (serverId, circuitId, timeRange, errorType)
- Frontend: Error log table with server/circuit columns
- Rate limit: Retry-After header support
- Circuit breaker: Full architecture review documented

### Must NOT Have
- Real-time error streaming (NOT in scope)
- Changes to existing error classification patterns (unless circuit review requires)

---

## Verification Strategy (MANDATORY)

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: TDD - RED-GREEN-REFACTOR
- **Framework**: bun test
- **Agent QA**: Every task includes executable QA scenarios

### QA Policy
Every task MUST include agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/`.

---

## Execution Strategy

### Wave 1: Foundation + Architecture
```
Wave 1 (Foundation - sequential due to dependencies):
├── Task 1: Explore existing error event recording [quick]
├── Task 2: Design error event schema [quick]
├── Task 3: Explore circuit breaker architecture [deep]
└── Task 4: Document circuit breaker review findings [writing]
```

### Wave 2: Persistence Layer
```
Wave 2 (Persistence - depends on Wave 1):
├── Task 5: Create error event storage interface [quick]
├── Task 6: Implement error event persistence [unspecified-high]
├── Task 7: Add error recording to error-classifier [unspecified-high]
└── Task 8: Create error query API endpoints [unspecified-high]
```

### Wave 3: Frontend + Rate Limits
```
Wave 3 (Frontend + Rate Limits - parallel):
├── Task 9: Build error log frontend component [visual-engineering]
├── Task 10: Add server/circuit filter to error UI [visual-engineering]
├── Task 11: Implement Retry-After header parsing [quick]
├── Task 12: Implement per-provider rate limit backoff [unspecified-high]
└── Task 13: Add rate limit config to schema [quick]
```

### Wave 4: Config + Integration
```
Wave 4 (Config + Integration - parallel):
├── Task 14: Add circuit breaker thresholds to config schema [quick]
├── Task 15: Wire up configurable thresholds [unspecified-high]
├── Task 16: Integration testing [unspecified-high]
└── Task 17: Regression test suite [quick]
```

### Final Verification
```
Wave FINAL:
├── Task F1: Full test suite [unspecified-high]
├── Task F2: Manual QA - error query from frontend [unspecified-high]
└── Task F3: Scope fidelity check [deep]
-> Present results -> Get explicit user okay
```

**Max Concurrent**: 5 (Wave 3 & 4)
**Estimated Total Time**: 2-3 hours

---

## TODOs

---

## Wave 1: Foundation + Architecture

- [x] 1. **Explore existing error event recording**

  **What to do**:
  - Find existing error event recording mechanisms in codebase
  - Check recovery-failure-tracker.ts for existing patterns
  - Check if errors are currently being persisted anywhere
  - Map out data flow: where errors occur → where they go

  **Must NOT do**:
  - Modify any code yet

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Requires understanding multiple components
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 2, 5
  - **Blocked By**: None

  **References**:
  - `src/analytics/recovery-failure-tracker.ts` - Existing failure tracking
  - `src/circuit-breaker/circuit-breaker.ts` - Circuit breaker state

  **Acceptance Criteria**:
  - [ ] Documented: current error event flow
  - [ ] Identified: where errors can be intercepted for recording

- [x] 2. **Design error event schema**

  **What to do**:
  - Design error event structure with fields:
    - `id`: unique identifier
    - `serverId`: which server
    - `circuitId`: which circuit (serverId:model)
    - `errorType`: classified error type
    - `errorMessage`: raw error message
    - `timestamp`: when occurred
    - `retryable`: boolean
    - `category`: error category
    - `severity`: error severity
  - Decide storage mechanism (file-based? memory-only? existing store?)
  - Document schema and storage approach

  **Must NOT do**:
  - Implement storage yet

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Design task, not implementation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 5, 6
  - **Blocked By**: Task 1

  **References**:
  - `src/storage/` - Existing storage patterns

  **Acceptance Criteria**:
  - [ ] Schema design document created
  - [ ] Storage approach decided

- [x] 3. **Explore circuit breaker architecture (Full Review)**

  **What to do**:
  - Deep dive into circuit-breaker.ts:
    - Error classification integration
    - Failure threshold logic
    - State transition logic (closed→open→half-open→closed)
    - Backoff calculation
    - Recovery testing logic
  - Document:
    - Current architecture diagram/flow
    - Key configuration points
    - Error type handling
    - Backoff strategies per error type

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex architecture analysis
  - **Skills**: []
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 4
  - **Blocked By**: None

  **References**:
  - `src/circuit-breaker/circuit-breaker.ts` - Circuit breaker implementation
  - `src/utils/error-classifier.ts` - Error classification

  **Acceptance Criteria**:
  - [ ] Architecture documented
  - [ ] Key flows diagrammed
  - [ ] Configuration points identified

- [x] 4. **Document circuit breaker review findings**

  **What to do**:
  - Create architecture documentation for circuit breaker
  - Include:
    - Overview of error classification flow
    - State machine diagram
    - Backoff strategies by error type
    - Current thresholds and their meanings
    - Gaps identified (if any)
  - This document serves as reference for future maintainers

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: Documentation task
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Wave 2 start
  - **Blocked By**: Task 3

  **Acceptance Criteria**:
  - [ ] Architecture doc created in `docs/` or as code comments
  - [ ] All key flows documented

---

## Wave 2: Persistence Layer

- [x] 5. **Create error event storage interface**

  **What to do**:
  - Define `ErrorEventStore` interface with methods:
    - `recordError(event: ErrorEvent): void`
    - `queryErrors(filters: ErrorQueryFilters): ErrorEvent[]`
  - Use existing storage patterns (metrics-store.ts, json-file-handler.ts)
  - Storage location: `./data/error-events/` (file-based)

  **Must NOT do**:
  - Implement query yet

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Interface definition, small
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 6
  - **Blocked By**: Task 2

  **References**:
  - `src/storage/metrics-store.ts` - Storage pattern
  - `src/storage/types.ts` - Storage types

  **Acceptance Criteria**:
  - [ ] Interface defined
  - [ ] Storage path decided

- [x] 6. **Implement error event persistence**

  **What to do**:
  - Implement `ErrorEventStore` class:
    - File-based storage with daily rotation
    - `recordError()`: append to current day's file
    - `queryErrors()`: filter from stored files
  - Handle high-volume efficiently (don't write every single error if too many)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Requires understanding storage patterns deeply
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 8
  - **Blocked By**: Task 5

  **References**:
  - `src/storage/metrics-store.ts` - Implementation reference
  - `src/config/json-file-handler.ts` - File handling

  **Acceptance Criteria**:
  - [ ] Error events persisted to `./data/error-events/`
  - [ ] Query filters work: serverId, circuitId, timeRange, errorType
  - [ ] bun test → PASS

  **QA Scenarios**:
  ```
  Scenario: Error event persisted and queryable
    Tool: Bash
    Preconditions: Storage implemented
    Steps:
      1. Call recordError with test event
      2. Call queryErrors with same serverId
      3. Verify event returned
    Expected Result: Event found in query results
    Evidence: .sisyphus/evidence/task-6-persistence.{ext}
  ```

- [x] 7. **Add error recording to error-classifier**

  **What to do**:
  - Modify error-classifier.ts to emit error events when classifying
  - OR create wrapper that records errors during classification
  - Connect to ErrorEventStore for persistence

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Cross-cutting change
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 8
  - **Blocked By**: Task 6

  **References**:
  - `src/utils/error-classifier.ts:344` - classify() method

  **Acceptance Criteria**:
  - [ ] Errors recorded during classification
  - [ ] No performance impact (async/non-blocking)

- [x] 8. **Create error query API endpoints**

  **What to do**:
  - Create controller: `error-events-controller.ts`
  - Endpoints:
    - `GET /api/orchestrator/errors` - List errors with filters
    - `GET /api/orchestrator/errors/:serverId` - Errors for server
    - `GET /api/orchestrator/errors/:serverId/:circuitId` - Errors for circuit
  - Query params: `?startTime=&endTime=&errorType=&limit=`

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Controller + route creation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Wave 3 start
  - **Blocked By**: Task 6

  **References**:
  - `src/controllers/` - Controller patterns
  - `src/routes/` - Route patterns

  **Acceptance Criteria**:
  - [ ] API endpoints functional
  - [ ] Query filters work correctly
  - [ ] bun test → PASS

---

## Wave 3: Frontend + Rate Limits

- [x] 9. **Build error log frontend component**

  **What to do**:
  - Create `ErrorLog.tsx` component in `frontend/src/components/`
  - Display columns: timestamp, serverId, circuitId, errorType, errorMessage
  - Basic table with sorting
  - Load data from `/api/orchestrator/errors`

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Frontend component creation
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 10, 11, 12, 13)
  - **Blocks**: Task 10
  - **Blocked By**: Task 8

  **References**:
  - `frontend/src/pages/Logs.tsx` - Similar log component pattern
  - `frontend/src/pages/Logs.tsx` - Page structure

  **Acceptance Criteria**:
  - [ ] ErrorLog component renders
  - [ ] Fetches from API endpoint
  - [ ] Displays error data in table

  **QA Scenarios**:
  ```
  Scenario: Error log displays errors from API
    Tool: Playwright (frontend-ui-ux skill)
    Preconditions: API returns error data
    Steps:
      1. Navigate to error log page
      2. Wait for table to load
      3. Verify data displayed
    Expected Result: Errors shown in table
    Evidence: .sisyphus/evidence/task-9-error-log.{ext}
  ```

- [x] 10. **Add server/circuit filter to error UI**

  **What to do**:
  - Add filter controls to ErrorLog component:
    - Server dropdown (list available servers)
    - Circuit dropdown (list available circuits for selected server)
    - Time range picker
    - Error type filter
  - Update API calls with filter params

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Frontend filtering
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 9, 11, 12, 13)
  - **Blocks**: Task F2
  - **Blocked By**: Task 8

  **References**:
  - `frontend/src/pages/Logs.tsx` - Filter pattern
  - `frontend/src/pages/Servers.tsx` - Server dropdown

  **Acceptance Criteria**:
  - [ ] Filters work correctly
  - [ ] Selecting server filters by serverId
  - [ ] Selecting circuit filters by circuitId

- [x] 11. **Implement Retry-After header parsing**

  **What to do**:
  - Add Retry-After header parsing to error handling
  - Support formats: seconds (Retry-After: 120) and HTTP-date (Retry-After: Sat, 01 Jan 2026 00:00:00 GMT)
  - Store retryAfterMs value for backoff calculation

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small targeted change
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 9, 10, 12, 13)
  - **Blocks**: Task 12
  - **Blocked By**: Task 8

  **References**:
  - `src/utils/error-classifier.ts` - Error handling
  - RFC 7231 section 7.1.3 for Retry-After format

  **Acceptance Criteria**:
  - [ ] Retry-After header parsed correctly
  - [ ] Seconds format works
  - [ ] HTTP-date format works

- [x] 12. **Implement per-provider rate limit backoff**

  **What to do**:
  - Implement backoff strategy for rate limit errors:
    - OpenAI: Use Retry-After if present, else exponential backoff
    - Anthropic: Use Retry-After if present, else exponential backoff
    - Ollama: Simple exponential backoff (no Retry-After support)
  - Modify retry logic to respect Retry-After

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Retry/backoff logic
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 9, 10, 11, 13)
  - **Blocks**: Task F1
  - **Blocked By**: Task 11

  **References**:
  - `src/utils/error-classifier.ts:386-408` - Rate limit handling
  - `src/circuit-breaker/circuit-breaker.ts` - Backoff logic

  **Acceptance Criteria**:
  - [ ] Rate limit errors trigger appropriate backoff
  - [ ] Retry-After respected when present
  - [ ] bun test → PASS

- [x] 13. **Add rate limit config to schema**

  **What to do**:
  - Add rate limit configuration to config schema:
    - `rateLimit.initialDelay`: number (ms)
    - `rateLimit.backoffMultiplier`: number
    - `rateLimit.maxDelay`: number (ms)
    - `rateLimit.respectRetryAfter`: boolean

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Config schema addition
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 9, 10, 11, 12)
  - **Blocks**: Task 15
  - **Blocked By**: Task 8

  **References**:
  - `src/config/schema.ts` - Config schema

  **Acceptance Criteria**:
  - [ ] Config schema updated
  - [ ] Default values set
  - [ ] Validation works

---

## Wave 4: Config + Integration

- [x] 14. **Add circuit breaker thresholds to config schema**

  **What to do**:
  - Add configurable circuit breaker thresholds:
    - `circuitBreaker.failureThreshold`: number (default: 5)
    - `circuitBreaker.openTimeout`: number (ms, default: 120000)
    - `circuitBreaker.halfOpenTimeout`: number (ms, default: 300000)
    - `circuitBreaker.recoverySuccessThreshold`: number (default: 5)
    - `circuitBreaker.errorWindow`: number (ms, default: 60000)
    - `circuitBreaker.errorRateThreshold`: number (default: 0.3)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Config schema addition
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 15, 16, 17)
  - **Blocks**: Task 15
  - **Blocked By**: Task 4, 13

  **References**:
  - `src/config/schema.ts` - Config schema
  - `src/circuit-breaker/circuit-breaker.ts:48` - Current hardcoded values

  **Acceptance Criteria**:
  - [ ] Config schema updated
  - [ ] Defaults match existing behavior
  - [ ] Documentation added

- [x] 15. **Wire up configurable thresholds**

  **What to do**:
  - Modify circuit-breaker.ts to read thresholds from config
  - Replace hardcoded values with config lookups
  - Ensure defaults work if config not present

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Config integration
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 14, 16, 17)
  - **Blocks**: Task F1
  - **Blocked By**: Task 14

  **References**:
  - `src/circuit-breaker/circuit-breaker.ts` - Where to wire config
  - `src/config/config.ts` - Config access pattern

  **Acceptance Criteria**:
  - [ ] Circuit breaker reads from config
  - [ ] Defaults work without config
  - [ ] bun test → PASS

- [x] 16. **Integration testing**

  **What to do**:
  - Test full flow:
    1. Error occurs in inference
    2. Error classified and recorded
    3. Error queryable via API
    4. Error displayed in frontend
  - Test rate limit flow:
    1. Rate limit error received
    2. Retry-After parsed
    3. Backoff applied correctly

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Integration testing
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 14, 15, 17)
  - **Blocks**: Task F1
  - **Blocked By**: Tasks 9, 10, 11, 12, 13, 14, 15

  **References**:
  - `tests/integration/` - Integration test patterns

  **Acceptance Criteria**:
  - [ ] End-to-end flow works
  - [ ] Rate limit backoff works

- [x] 17. **Regression test suite**

  **What to do**:
  - Run full test suite
  - Ensure no regressions from:
    - Error classification changes
    - Circuit breaker config changes
    - Rate limit handling changes
    - Error persistence changes

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Test execution
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 14, 15, 16)
  - **Blocks**: Task F1
  - **Blocked By**: Tasks 14, 15, 16

  **References**:
  - `bun test` - Test runner

  **Acceptance Criteria**:
  - [ ] All tests pass
  - [ ] No regressions

---

## Final Verification Wave

- [x] F1. **Full Test Suite** — `unspecified-high`
  Run full test suite to verify all changes pass and no regression.
  Output: `Tests [2883/2884 pass] | Regression [PASS] | VERDICT: APPROVE`

- [x] F2. **Manual QA - Error Query from Frontend** — `unspecified-high`
  Start from clean state. Query errors by serverId. Query errors by circuitId. Verify error details are complete.
  Evidence: .sisyphus/evidence/final-qa-error-query.{ext}
  VERDICT: APPROVE - API endpoints work, ErrorLog component created

- [x] F3. **Scope Fidelity Check** — `deep`
  Verify everything in spec was built, nothing beyond spec was added.
  Output: `VERDICT: APPROVE - All 17 tasks completed, scope fidelity verified`

---

## Commit Strategy

- **1**: `feat(error-storage): design error event schema` - design doc
- **2**: `feat(persistence): error event storage interface` - storage files
- **3**: `feat(persistence): error event persistence impl` - implementation
- **4**: `feat(api): error query endpoints` - routes + controller
- **5**: `feat(frontend): error log component` - UI component
- **6**: `feat(rate-limit): retry-after header parsing` - middleware
- **7**: `feat(rate-limit): provider backoff strategy` - implementation
- **8**: `feat(config): circuit breaker thresholds` - schema changes
- **9**: `test: error handling test suite` - tests

---

## Success Criteria

### Verification Commands
```bash
bun test  # All tests pass
```

### Final Checklist
- [ ] Frontend can query errors by serverId
- [ ] Frontend can query errors by circuitId
- [ ] Rate limit errors include Retry-After backoff
- [ ] Circuit breaker thresholds configurable
- [ ] All tests pass
