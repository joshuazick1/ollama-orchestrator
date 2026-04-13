# Plan: Fix Health Check & Capability Detection for OpenAI Endpoints

## TL;DR

> **Problem**: Servers with actual OpenAI (v1) endpoint support are incorrectly marked as `supportsV1: false`, causing "Model 'llama3.2:latest' not found on any openai server" errors.
>
> **Root Cause**: Capability detection uses flawed inference probing that either skips v1 checks for Ollama servers, misinterprets 400 errors, or fails the entire chain.
>
> **Solution**: Implement lightweight endpoint existence checks (HEAD/OPTIONS requests, minimal POSTs that return fast without inference) and fix the capability chain logic.

---

## Context

### The Bug Flow
1. User requests `/v1/chat/completions` with model `llama3.2:latest`
2. `tryRequestWithFailover` filters candidates by `requiredCapability === 'openai'`
3. Servers with `supportsV1 === false` are filtered out at line 1707
4. Result: "Model 'llama3.2:latest' not found on any openai server" (generated at line 1861)

### Why Probing Is Broken

**Current probing uses a non-existent model (`__probe_nonexistent_model_000000__`)**:
- Inference POSTs return 400 "model not found" 
- This is interpreted as "endpoint doesn't exist" (wrong!)
- 400 means the endpoint EXISTS but the model doesn't

**Ollama servers skip v1 probe**:
```typescript
const probeV1 = server.type !== 'ollama';  // Line 313-314
```
Many Ollama servers now expose OpenAI compatibility - we shouldn't skip this.

**The fallback chain can fail**:
```typescript
const supportsV1 = forced.supportsV1 ?? inferredV1 ?? v1Response?.ok;
//            = false ?? false ?? null = false
```

---

## Work Objectives

### Core Objective
Fix capability detection so servers are correctly identified as supporting v1 endpoints WITHOUT triggering model loading or inference.

### Concrete Deliverables
1. `src/health-check-scheduler.ts` - Fix capability detection chain
2. `src/orchestrator/orchestrator.ts` - Fix server filtering logic  
3. `src/types/api-request.types.ts` - Add `v1EndpointHealth` type
4. Updated health check tests in `tests/`

### Definition of Done
- [ ] `/v1/models` HEAD/GET returns servers correctly as `supportsV1: true`
- [ ] Servers with `type: 'ollama'` that have v1 endpoints are detected
- [ ] No actual model loading or inference occurs during probing
- [ ] 400 "model not found" is correctly interpreted as "endpoint exists"
- [ ] Probe timeouts don't incorrectly mark servers as unsupported

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (bun test, vitest patterns)
- **Automated tests**: Tests-after (add tests for new behavior)
- **Framework**: bun test + integration tests

### QA Policy
Every task includes agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/`.

**Test approach**:
1. Start local Ollama with known models
2. Verify health check correctly detects v1 support
3. Verify OpenAI requests route correctly
4. No actual inference should occur during checks

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation - no dependencies):
├── Task 1: Add v1 endpoint existence check methods to health-check-scheduler.ts
├── Task 2: Fix supportsV1 detection chain logic  
├── Task 3: Remove Ollama-type v1 probe skip
├── Task 4: Add 400 error handling as positive indicator
└── Task 5: Add probe timeout handling improvements

Wave 2 (Integration - depends on Wave 1):
├── Task 6: Fix server filtering in tryRequestWithFailover
├── Task 7: Update orchestrator.ts onHealthCheckResult for new capability format
└── Task 8: Add/update unit tests for new capability detection

Wave FINAL (Verification):
├── Task F1: Integration test with local Ollama + v1 endpoint
├── Task F2: Verify no inference occurs during probing (log inspection)
└── Task F3: Verify OpenAI requests route correctly
```

### Dependency Matrix
- 1, 2, 3, 4, 5 → 6, 7 → 8
- F1, F2, F3 → complete

---

## TODOs

---

- [x] 1. Add v1 Endpoint Existence Check Methods

  **What to do**:
  - Add new method `probeV1EndpointExistence(server, timeout)` that:
    1. Does a **lightweight check** for v1 endpoint existence
    2. Uses `HEAD /v1/models` or `GET /v1/models` (no body, no inference)
    3. Treats any HTTP response (including 4xx) as evidence endpoint exists
    4. Only network errors (ECONNREFUSED, ETIMEDOUT) mean "doesn't exist"
  - Add new method `probeV1EndpointsLightweight(server)` that:
    1. Sends minimal POST to `/v1/chat/completions` with `model: "__probe__"` 
    2. Payload: `{ "model": "__probe__", "messages": [], "max_tokens": 1 }`
    3. **Critical**: Use extremely short timeout (2s) so no model loading occurs
    4. Interpret 400 as "endpoint works, model doesn't" = positive
    5. Interpret 422 as "endpoint works, validation error" = positive  
    6. Interpret 4xx timeout as "endpoint exists but slow" = positive
    7. Only network errors = negative

  **Must NOT do**:
  - No actual inference - no model loading
  - No long timeouts that could trigger loading
  - Don't use real model names in probes

  **Recommended Agent Profile**:
  - **Category**: `ultrabrain`
    - Reason: This requires careful design of the probing protocol to avoid false positives/negatives
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `playwright`: Not needed - this is backend probing logic

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4, 5)
  - **Blocks**: Task 6
  - **Blocked By**: None (can start immediately)

  **References**:
  - `src/health-check-scheduler.ts:316-350` - Current v1 probe logic (lines 316-350)
  - `src/health-check-scheduler.ts:544-578` - probeInferenceEndpoint pattern to follow
  - `src/health-check-scheduler.ts:360-374` - Current supportsV1 chain

  **Acceptance Criteria**:
  - [ ] New method `probeV1EndpointExistence` exists
  - [ ] New method `probeV1EndpointsLightweight` exists  
  - [ ] Methods use 2s timeout max to prevent inference
  - [ ] 400/422 responses are treated as positive (endpoint exists)
  - [ ] Test file created: `src/health-check-scheduler.test.ts` (or add to existing)

  **QA Scenarios**:

  ```
  Scenario: probeV1EndpointExistence returns true for server with v1 endpoint
    Tool: Bash
    Preconditions: Local Ollama running on port 11434 with v1 endpoint
    Steps:
      1. Start local Ollama: `docker run -d -p 11434:11434 ollama/ollama:latest`
      2. Wait 5s for startup
      3. Call probeV1EndpointExistence with 5s timeout
      4. Inspect returned { exists: boolean, healthy: boolean, status: number }
    Expected Result: exists=true, status=200 (or any 2xx/4xx), no inference triggered
    Failure Indicators: Timeout > 5s, actual model loading in Ollama logs
    Evidence: .sisyphus/evidence/task-1-v1-probe-pass.{ext}

  Scenario: probeV1EndpointExistence returns false for server without v1 endpoint
    Tool: Bash  
    Preconditions: Nothing running on port 19999
    Steps:
      1. Call probeV1EndpointExistence with server on port 19999
      2. Inspect returned { exists: false, status: 0 }
    Expected Result: exists=false, status=0 (connection refused/timeout)
    Evidence: .sisyphus/evidence/task-1-v1-probe-fail.{ext}
  ```

  **Evidence to Capture**:
  - [ ] Test output showing probe completes in <3s
  - [ ] Ollama logs showing NO model loading during probe

  **Commit**: YES
  - Message: `feat(health-check): add lightweight v1 endpoint existence probes`
  - Files: `src/health-check-scheduler.ts`
  - Pre-commit: `bun test src/health-check-scheduler.test.ts`

---

- [x] 2. Fix supportsV1 Detection Chain Logic

  **What to do**:
  - Modify the `supportsV1` determination at line ~373 in health-check-scheduler.ts
  - Change from:
    ```typescript
    const supportsV1 = forced.supportsV1 ?? inferredV1 ?? v1Response?.ok;
    ```
  - To a more robust chain:
    ```typescript
    // Priority: forced > v1Models list success > lightweight probe > inference probe
    const supportsV1 = 
      forced.supportsV1 ?? 
      (v1Response?.ok === true) ??  // /v1/models returned 2xx
      v1EndpointExistence.exists ??  // lightweight check passed
      inferredV1;                   // fallback to inference probes
    ```
  - Add logging for each step to help debug future issues

  **Must NOT do**:
  - Don't remove the inference probe fallback entirely - it's still useful
  - Don't change forced capabilities handling

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: This is a straightforward logic change, not a complex redesign
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4, 5)
  - **Blocks**: Task 6
  - **Blocked By**: None

  **References**:
  - `src/health-check-scheduler.ts:360-374` - Current chain (what to modify)

  **Acceptance Criteria**:
  - [ ] Chain now checks v1Response?.ok before lightweight probes
  - [ ] Lightweight probes used before falling back to inference probes
  - [ ] Each step has debug logging

  **QA Scenarios**:

  ```
  Scenario: supportsV1 true when /v1/models returns 200
    Tool: Bash
    Preconditions: Server returns 200 on /v1/models
    Steps:
      1. Call checkServerHealth on that server
      2. Verify result.supportsV1 === true
    Expected Result: supportsV1=true in HealthCheckResult
    Evidence: .sisyphus/evidence/task-2-chain-v1models.{ext}
  ```

  **Evidence to Capture**:
  - [ ] Health check result showing supportsV1=true
  - [ ] Logs showing chain progression

  **Commit**: YES (can group with Task 1)
  - Message: `fix(health-check): improve supportsV1 detection chain`
  - Files: `src/health-check-scheduler.ts`

---

- [x] 3. Remove Ollama-Type v1 Probe Skip

  **What to do**:
  - Find and remove/modify the logic that skips v1 probing for Ollama servers
  - Current code at lines ~313-314:
    ```typescript
    const probeOllama = server.type !== 'openai';
    const probeV1 = server.type !== 'ollama';
    ```
  - Change to always probe v1 for 'auto' and 'ollama' type servers unless forcedCapabilities says otherwise:
    ```typescript
    const probeOllama = server.type !== 'openai' && server.forcedCapabilities?.supportsOllama !== false;
    const probeV1 = server.type !== 'ollama' || server.forcedCapabilities?.supportsV1 !== false;
    // Actually always probe v1 unless explicitly disabled
    const probeV1 = server.forcedCapabilities?.supportsV1 !== false; // undefined or true = probe
    ```
  - The issue: Many Ollama servers now have OpenAI compatibility built-in. We should probe ALL server types for v1 support unless explicitly told not to.

  **Must NOT do**:
  - Don't remove forcedCapabilities handling - that's an override
  - Don't break the probeOllama logic - that still makes sense

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple conditional change
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4, 5)
  - **Blocks**: Task 6
  - **Blocked By**: None

  **References**:
  - `src/health-check-scheduler.ts:313-314` - Current skip logic

  **Acceptance Criteria**:
  - [ ] 'ollama' type servers now get v1 probes unless forcedCapabilities disables it
  - [ ] 'auto' type servers continue to probe v1
  - [ ] 'openai' type servers continue to skip ollama probes

  **QA Scenarios**:

  ```
  Scenario: Ollama server with v1 endpoint gets probed for v1
    Tool: Bash
    Preconditions: Ollama server (type='ollama') with OpenAI compatibility on port 11434
    Steps:
      1. Add server with type='ollama' pointing to local Ollama
      2. Trigger health check
      3. Verify /v1/models was called (check logs or network)
    Expected Result: /v1/models probe attempted for Ollama server
    Evidence: .sisyphus/evidence/task-3-ollama-v1-probe.{ext}
  ```

  **Evidence to Capture**:
  - [ ] Logs showing /v1/models being called for 'ollama' type server

  **Commit**: YES (can group with Task 1, 2)

---

- [x] 4. Add 400 Error Handling as Positive Indicator

  **What to do**:
  - Modify `probeInferenceEndpoint` or create a wrapper to interpret 4xx responses properly
  - Current logic at lines ~567-572:
    ```typescript
    const exists =
      (status >= 200 && status < 300) ||
      status === 400 ||
      status === 401 ||
      status === 403 ||
      status === 429;
    ```
  - This DOES treat 400 as exists=true, but the issue is in how `inferredV1` uses `.exists` vs `.healthy`
  - The REAL fix: We need to distinguish "endpoint doesn't exist" from "endpoint exists but model doesn't"
  - For v1 detection specifically: 400 "model not found" means endpoint WORKS
  - Add new logic specifically for v1 endpoint detection that interprets 400 correctly:
    ```typescript
    // For v1 endpoints, 400 = "endpoint exists, model doesn't" = GOOD
    // Only 404/405/410 = "endpoint doesn't exist" = BAD
    const v1EndpointExists = 
      (status >= 200 && status < 300) ||  // 2xx = exists
      status === 400 ||  // "model not found" = exists but model doesn't
      status === 401 ||  // auth error = endpoint exists
      status === 403 ||  // forbidden = endpoint exists
      status === 422;  // validation error = endpoint exists
    ```

  **Must NOT do**:
  - Don't change existing inference probe logic for Ollama endpoints (that works differently)
  - Don't remove the existing status code handling entirely

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Logic adjustment
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3, 5)
  - **Blocks**: Task 6
  - **Blocked By**: None

  **References**:
  - `src/health-check-scheduler.ts:567-572` - Current status handling

  **Acceptance Criteria**:
  - [ ] 400 returns from v1 endpoints are interpreted as "endpoint works"
  - [ ] 404/405 from v1 endpoints are interpreted as "endpoint doesn't exist"
  - [ ] Other 4xx are treated as "endpoint exists but has issues"

  **QA Scenarios**:

  ```
  Scenario: 400 response from /v1/chat/completions is treated as positive
    Tool: Bash
    Preconditions: Server returns 400 "model not found" for /v1/chat/completions
    Steps:
      1. Call probeV1EndpointsLightweight
      2. Verify result.exists === true
    Expected Result: exists=true even though response was 400
    Evidence: .sisyphus/evidence/task-4-400-positive.{ext}
  ```

  **Evidence to Capture**:
  - [ ] Probe result showing exists=true with status=400

  **Commit**: YES (can group with previous tasks)

---

- [x] 5. Add Probe Timeout Handling Improvements

  **What to do**:
  - Improve timeout handling so slow probes don't incorrectly mark servers as unsupported
  - Current timeouts:
    - `/v1/models`: 5000ms
    - Inference probes: 10000ms (PROBE_TIMEOUT_MS)
  - Problem: If server is slow to respond (but not down), it gets marked unsupported
  - Fix:
    1. For v1 endpoint existence: Use short timeout (2s), treat timeout as "endpoint exists but slow" = true
    2. For inference probes: Already 10s, but could be adjusted
    3. Add logic: "If we got ANY response (including timeout) before giving up, endpoint likely exists"
  - New approach: Track `responseReceived` timestamp vs `timeout`. If response received before timeout, endpoint exists.

  **Must NOT do**:
  - Don't increase timeouts so much that we cause model loading
  - Don't remove timeouts entirely

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Straightforward timeout adjustment
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3, 4)
  - **Blocks**: Task 6
  - **Blocked By**: None

  **References**:
  - `src/health-check-scheduler.ts:16-17` - PROBE_TIMEOUT_MS constant
  - `src/health-check-scheduler.ts:339-349` - v1/models probe timeout

  **Acceptance Criteria**:
  - [ ] v1 probes timeout after 2s max
  - [ ] Timeout is treated as "endpoint exists but slow" not "doesn't exist"
  - [ ] Network errors (connection refused) are still treated as "doesn't exist"

  **QA Scenarios**:

  ```
  Scenario: Timeout still results in exists=true for v1 endpoint
    Tool: Bash
    Preconditions: Server that accepts connection but doesn't respond on /v1/chat/completions
    Steps:
      1. Call probeV1EndpointsLightweight with 2s timeout
      2. Verify result.exists === true (timeout treated as positive)
    Expected Result: exists=true even though request timed out
    Evidence: .sisyphus/evidence/task-5-timeout-positive.{ext}
  ```

  **Evidence to Capture**:
  - [ ] Probe result showing exists=true despite timeout

  **Commit**: YES (can group with previous tasks)

---

- [x] 6. Fix Server Filtering in tryRequestWithFailover

  **What to do**:
  - Review the filtering logic at lines ~1704-1724 in orchestrator.ts
  - Current logic:
    ```typescript
    if (requiredCapability === 'openai' && s.supportsV1 === false) {
      return false;
    }
    ```
  - This is correct IF supportsV1 is accurate. The issue was upstream.
  - However, add defensive check: if server has v1Models or discoveredV1Models, don't filter out just because supportsV1 is false (v1Models is strong evidence of v1 support):
    ```typescript
    const hasV1Evidence = 
      s.supportsV1 === true ||
      (s.v1Models && s.v1Models.length > 0) ||
      (s.discoveredV1Models && s.discoveredV1Models.length > 0);
    
    if (requiredCapability === 'openai' && !hasV1Evidence) {
      return false;
    }
    ```
  - This way even if supportsV1 detection fails, v1Models provides a fallback

  **Must NOT do**:
  - Don't remove the supportsV1 check entirely - it's still useful
  - Don't change the overall filtering structure

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Defensive addition, not complex
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential after Wave 1
  - **Blocks**: None
  - **Blocked By**: Tasks 1, 2, 3, 4, 5

  **References**:
  - `src/orchestrator/orchestrator.ts:1704-1724` - Current filtering logic

  **Acceptance Criteria**:
  - [ ] Servers with v1Models are not filtered out even if supportsV1=false
  - [ ] Original supportsV1 check still works when it's accurate
  - [ ] Test proves filtering works correctly

  **QA Scenarios**:

  ```
  Scenario: Server with v1Models but supportsV1=false passes filter
    Tool: Bash
    Preconditions: Server with v1Models=['llama3.2'] but supportsV1=false
    Steps:
      1. Call tryRequestWithFailover with model='llama3.2', requiredCapability='openai'
      2. Verify server is NOT filtered out
    Expected Result: Server is considered as candidate
    Evidence: .sisyphus/evidence/task-6-filter-pass.{ext}
  ```

  **Evidence to Capture**:
  - [ ] Server passes filter despite supportsV1=false

  **Commit**: YES
  - Message: `fix(orchestrator): improve v1 server filtering with v1Models fallback`
  - Files: `src/orchestrator/orchestrator.ts`

---

- [x] 7. Update onHealthCheckResult for New Capability Format

  **What to do**:
  - Review `onHealthCheckResult` at ~lines 299-513 in orchestrator.ts
  - The health check result now includes more nuanced capability info from the new probes
  - Ensure the updates to server.supportsV1 use the new logic correctly:
    ```typescript
    if (result.supportsV1 !== undefined && result.supportsV1 !== server.supportsV1) {
      server.supportsV1 = result.supportsV1;
    ```
  - This should already work since we changed how supportsV1 is calculated in health-check-scheduler
  - But verify that when supportsV1 changes, we log appropriately

  **Must NOT do**:
  - Don't change the core update logic
  - Don't remove the logging

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Review and verify existing logic
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential after Wave 1
  - **Blocks**: Task 8
  - **Blocked By**: Tasks 1, 2, 3, 4, 5

  **References**:
  - `src/orchestrator/orchestrator.ts:336-348` - supportsV1 update logic

  **Acceptance Criteria**:
  - [ ] supportsV1 updates correctly when health check returns new value
  - [ ] Change is logged
  - [ ] Persistence is triggered if value changed

  **QA Scenarios**:

  ```
  Scenario: supportsV1 updates on health check
    Tool: Bash
    Preconditions: Server with supportsV1=false, now returns 200 on /v1/models
    Steps:
      1. Trigger health check
      2. Inspect server.supportsV1 value after
    Expected Result: server.supportsV1 becomes true
    Evidence: .sisyphus/evidence/task-7-update.{ext}
  ```

  **Evidence to Capture**:
  - [ ] Before/after supportsV1 values

  **Commit**: YES (can group with Task 6)

---

- [x] 8. Add/Update Unit Tests for New Capability Detection

  **What to do**:
  - Add comprehensive tests for new capability detection in `src/health-check-scheduler.test.ts`
  - Test cases:
    1. Ollama server with v1 endpoint is detected as supportsV1=true
    2. Server returning 400 on probe is correctly interpreted as supportsV1=true
    3. Timeout results in exists=true for v1 endpoints
    4. Network error results in exists=false
    5. Server with v1Models but supportsV1=false still works in routing
  
  **Must NOT do**:
  - Don't write tests that require actual model inference
  - Don't write tests that take >10s each

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Test writing, straightforward
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Final wave
  - **Blocked By**: Tasks 6, 7

  **References**:
  - `tests/unit/health-check-scheduler.test.ts` - If exists, extend it

  **Acceptance Criteria**:
  - [ ] All new behaviors have test coverage
  - [ ] Tests run in <30s total
  - [ ] All tests pass

  **QA Scenarios**:

  ```
  Scenario: All capability detection tests pass
    Tool: Bash
    Preconditions: Code changes complete
    Steps:
      1. Run: bun test src/health-check-scheduler.test.ts
      2. Verify all tests pass
    Expected Result: 0 failures
    Evidence: .sisyphus/evidence/task-8-tests.{ext}
  ```

  **Evidence to Capture**:
  - [ ] Test output showing all passing

  **Commit**: YES
  - Message: `test(health-check): add capability detection tests`
  - Files: `src/health-check-scheduler.test.ts`

---

## Final Verification Wave

- [ ] F1. **Integration test with local Ollama + v1 endpoint** — `unspecified-high`
  
  Run full flow test with real Ollama server that has v1 endpoints. Verify:
  - Health check correctly detects v1 support
  - OpenAI request routes correctly
  - No inference occurs during health check
  
  Output: `Evidence of correct routing + no model loading in logs`

- [ ] F2. **Verify no inference occurs during probing** — `unspecified-high`
  
  Inspect Ollama logs during health check cycle. Confirm:
  - No model loading operations
  - No inference requests
  - Only lightweight endpoint existence checks
  
  Output: `Ollama log showing no loading/inference`

- [ ] F3. **Verify OpenAI requests route correctly** — `unspecified-high`
  
  Make actual OpenAI API call through orchestrator:
  - POST /v1/chat/completions with llama3.2
  - Verify request succeeds
  - Verify routed to correct server
  
  Output: `Successful OpenAI response from orchestrator`

---

## Commit Strategy

- **1-5**: `feat(health-check): add lightweight v1 endpoint probes` - health-check-scheduler.ts changes
- **6-7**: `fix(orchestrator): improve v1 server filtering` - orchestrator.ts changes  
- **8**: `test(health-check): add capability detection tests` - test file

---

## Success Criteria

### Verification Commands
```bash
# Health check should complete in <10s per server
# No actual model loading in Ollama during health checks
# OpenAI requests route correctly to servers with v1 endpoints
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] No inference during probing verified
- [ ] OpenAI requests succeed