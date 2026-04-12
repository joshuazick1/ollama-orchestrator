# Server Addition Flow: Comprehensive Review & Fix Plan

## TL;DR

> **Comprehensive review of server addition (Ollama, OpenAI, Anthropic-compatible) across frontend and backend.**
>
> **Critical Issue Found**: Endpoint probing uses `res.status !== 404` as success criteria, treating 400/401/403/500/503 as "endpoint available". This is wrong — we intentionally send malformed requests expecting errors, and non-404 errors actually CONFIRM the endpoint exists.
>
> **Additional Issues**: Schema validation exists but unused, race conditions on duplicate ID, frontend/backend validation mismatch, forcedCapabilities not in UI, probedEndpoints detail hidden.

---

## Context

### Original Request
Review both frontend and backend for how servers are added, including Ollama, OpenAI, and Anthropic-compatible servers. Consider that newer Ollama servers can support both Ollama and OpenAI API requests.

### Research Conducted
- Read `health-check-scheduler.ts` (all 906 lines) — endpoint probing logic
- Read `orchestrator.ts` (addServer, getServers methods)
- Read `servers-controller.ts` — addServer API endpoint
- Read `Servers.tsx` — frontend server form
- Read `validations.ts` — frontend Zod schemas
- Read `schema.ts` — backend Zod schemas
- Read `orchestrator.types.ts` — AIServer interface
- Read `api-endpoints.ts` — endpoint constants
- Read `dual-capability-server.test.ts` — 817 lines of tests
- Read `health-check-scheduler.test.ts` — unit tests
- Reviewed all related grep findings

---

## Architecture Overview

### Server Type System
```
type: 'ollama' | 'openai' | 'auto'
```
- `'ollama'` — Skip /v1/* probing
- `'openai'` — Skip /api/* probing  
- `'auto'` — Probe BOTH endpoint families (default)

### Capability Detection
```
supportsOllama: boolean     // /api/* endpoints work
supportsV1: boolean         // /v1/* endpoints work  
supportsAnthropic: boolean  // /v1/messages works
```

### Dual-API Support (Ollama 0.1.40+)
Newer Ollama servers support BOTH `/api/*` (native) AND `/v1/*` (OpenAI-compatible). This is auto-detected via endpoint probing.

---

## Issues Found

### CRITICAL Issues (Must Fix)

#### 1. Endpoint Probing Success Criteria is Wrong

**File**: `src/health-check-scheduler.ts:562`

```typescript
private async probeInferenceEndpoint(...): Promise<boolean> {
  try {
    // ...
    const res = await fetch(url, { ... });
    return res.status !== 404;  // ❌ WRONG: treats 400/401/403/500/503 as SUCCESS
  } catch {
    return false;
  }
}
```

**Problem**: 
- Current logic: `status !== 404` means "anything except 404 is success"
- So 400 (Bad Request), 401 (Unauthorized), 403 (Forbidden), 500 (Server Error), 503 (Unavailable) ALL report the endpoint as available
- But we INTENTIONALLY send malformed requests (fake model `__probe_nonexistent_model_000000__`) expecting error responses
- **A 400 or 401 response actually CONFIRMS the endpoint exists** — it just rejected our malformed request
- **A 404 means the endpoint does NOT exist**

**What Should Happen**:
- 200-299 → Endpoint works (ideal)
- 400 → Endpoint exists, rejected our malformed request (CONFIRMED)
- 401/403 → Endpoint exists, auth issue (CONFIRMED)
- 404 → Endpoint does NOT exist
- 500/503 → Server error, endpoint may exist but is unhealthy

**Fix Approach**: 
- Accept 200-299 AND 400 (model not found) as "endpoint exists"
- Treat 404 as "endpoint does not exist" 
- Treat 401/403/500/503 as "endpoint exists but has issues" — decide how to handle

**Trade-off**: Some servers return 400 for unknown models, others return 404. Need to decide: should 400 count as "endpoint confirmed" or "unhealthy"?

**Recommendation**: Accept 200-299 AND 400 as "endpoint confirmed available". 404 as "not available". Other errors as "uncertain/unhealthy".

---

#### 2. Schema Validation Exists But Is Never Applied

**File**: `src/config/schema.ts` defines `serverConfigSchema` with proper validation
**File**: `src/controllers/servers-controller.ts` does NOT use it

```typescript
// schema.ts:11-21
export const serverConfigSchema = z.object({
  id: z.string().min(1).max(100).regex(/^[a-zA-Z0-9-_]+$/),
  url: z.string().url(),
  type: z.enum(['ollama', 'openai', 'auto']).default('auto'),
  maxConcurrency: z.number().int().min(1).max(1000).default(4),
  apiKey: z.string().optional(),
});
```

**Problem**: This schema is NEVER applied to incoming addServer requests. Invalid `type` values are accepted silently, `apiKey` has no backend validation.

**Fix**: Apply schema validation in `addServer` controller.

---

#### 3. Race Condition on Duplicate ID Check

**File**: `src/controllers/servers-controller.ts:36-62`

```typescript
// Check for duplicates by ID
if (orchestrator.getServers().some(s => s.id === id)) {
  res.status(409).json({ error: ERROR_MESSAGES.SERVER_ALREADY_EXISTS(id) });
  return;
}
// ... time gap where another request could add same ID ...
orchestrator.addServer({ id, ... });
```

**Problem**: Check-then-add is not atomic. Two concurrent requests with same ID could both pass the check and both call `addServer`.

**Fix**: Make the check-and-add atomic in orchestrator, or use a mutex/lock.

---

### MEDIUM Issues (Should Fix)

#### 4. Frontend/Backend maxConcurrency Mismatch

| Layer | maxConcurrency Range |
|-------|----------------------|
| Frontend HTML input | 1-100 |
| Frontend Zod schema | 1-100 |
| Backend schema | 1-**1000** |

**Problem**: User could bypass frontend HTML validation and send 101-1000 to API.

**Fix**: Align frontend and backend to same limits (recommend keeping frontend's 100 as the max since that's the practical limit).

---

#### 5. Type Field Not Validated on Backend

**Frontend**: Dropdown with 3 options (`ollama`, `openai`, `auto`) — always sends valid enum
**Backend schema**: `z.enum(['ollama', 'openai', 'auto'])` — but NOT applied
**Controller**: Accepts ANY string, defaults to `'auto'` if undefined

**Fix**: Apply schema validation (see Issue #2).

---

#### 6. API Key Has No Backend Validation

**Frontend regex**: `/^(env:[A-Z_][A-Z0-9_]*|sk-[a-zA-Z0-9-_]*)?$/`
**Backend**: `z.string().optional()` — accepts anything

**Fix**: Add backend validation matching frontend pattern.

---

### LOW Issues (Nice to Have)

#### 7. forcedCapabilities Not Exposed in UI

`forcedCapabilities` allows admin override when servers are behind opaque proxies that block all probe requests. Only configurable via direct config file editing.

**Frontend doesn't show any UI for this.**

---

#### 8. probedEndpoints Detail Hidden in UI

`probedEndpoints` has 7 boolean flags:
```typescript
{
  ollama_chat?: boolean;
  ollama_generate?: boolean;
  ollama_embeddings?: boolean;
  openai_chat?: boolean;
  openai_completions?: boolean;
  openai_embeddings?: boolean;
  anthropic_messages?: boolean;
}
```

**Only `supportsOllama` and `supportsV1` shown in frontend.** Full per-endpoint detail is hidden.

---

#### 9. No Anthropic Server Type in Frontend

`type` enum only has `'ollama' | 'openai' | 'auto'`. But `supportsAnthropic` is tracked. There's no way to explicitly set a server as "Anthropic-capable" via UI.

**Note**: With `type: 'auto'`, Anthropic capability IS auto-detected via `/v1/messages` probing. So this is low priority.

---

## Work Plan

### Phase 1: Fix Endpoint Probing (CRITICAL)

- [x] **1.1** Review current `probeInferenceEndpoint` logic and document exact behavior

  **What to do**: Read `health-check-scheduler.ts` lines 544-566 thoroughly. Document how 400, 401, 403, 404, 500, 503 are currently handled.

  **QA Scenarios**:
  ```
  Scenario: Server returns 400 Bad Request
    Given: Ollama server at http://localhost:11434
    When: Health check probes /api/chat with fake model
    And: Server returns 400 with "model not found" error
    Then: Current code returns true (endpoint exists)
    And: After fix, should return true (endpoint exists - 400 confirms it)

  Scenario: Server returns 404 Not Found
    Given: OpenAI server at http://localhost:8000
    When: Health check probes /api/chat (Ollama endpoint)
    And: Server returns 404
    Then: Current code returns false (correct)
    And: After fix, should return false (endpoint doesn't exist)

  Scenario: Server returns 500 Internal Error
    Given: Server at http://localhost:9000
    When: Health check probes /v1/chat/completions
    And: Server returns 500
    Then: Current code returns true (wrong - 500 means server error)
    And: After fix, should return ??? (decide: uncertain or unavailable?)
  ```

  **References**:
  - `src/health-check-scheduler.ts:544-566` — probeInferenceEndpoint method
  - `src/health-check-scheduler.ts:568-636` — runEndpointProbes method
  - `tests/unit/health-check-scheduler.test.ts` — existing tests

- [x] **1.2** Design new success criteria for endpoint probing

  **What to do**: Decide what status codes mean "endpoint exists and is functional":

  | Status | Meaning | Should count as "endpoint exists"? |
  |--------|---------|-------------------------------------|
  | 200-299 | Success | YES |
  | 400 | Bad Request (model not found is expected) | YES — endpoint exists |
  | 401 | Unauthorized | YES — endpoint exists, auth needed |
  | 403 | Forbidden | YES — endpoint exists, access denied |
  | 404 | Not Found | NO — endpoint doesn't exist |
  | 429 | Rate Limited | YES — endpoint exists, throttled |
  | 500 | Server Error | ??? — server error but endpoint might exist |
  | 503 | Service Unavailable | ??? — same as 500 |
  | Timeout | No response | NO — connection failed |
  | Network Error | ECONNREFUSED etc | NO — server not running |

  **Recommendation**: 
  - 200-299, 400, 401, 403, 429 → "endpoint exists"
  - 404 → "endpoint does not exist"  
  - 500, 503, timeout, network errors → "uncertain — don't change capability flags"

  **OR** simpler: Only trust 200-299 and 400 as "confirmed", treat everything else as "uncertain/unhealthy".

- [x] **1.3** Implement new probeInferenceEndpoint with proper status code handling

  **What to do**: Modify `probeInferenceEndpoint` to:
  1. Return object `{ exists: boolean, healthy: boolean, status: number }` instead of just boolean
  2. Map status codes to exists/healthy appropriately
  3. Update `runEndpointProbes` to use new return type
  4. Update capability inference logic to handle "uncertain" states

  **Must NOT do**: Don't break existing capability detection flow — the current type-based probe skipping must still work.

- [x] **1.4** Update `runEndpointProbes` aggregation

  **What to do**: Change aggregation logic from:
  ```typescript
  const inferredOllama = probedEndpoints.ollama_chat || ...;
  ```
  To use the new `exists` field from each probe result.

- [x] **1.5** Add/update tests for new probing behavior

  **What to do**: Add test cases to `health-check-scheduler.test.ts`:
  - Mock various HTTP status codes (200, 400, 401, 403, 404, 500, 503)
  - Verify correct `exists`/`healthy` determination
  - Test that 400 is correctly treated as "endpoint exists"

---

### Phase 2: Fix Schema Validation (CRITICAL)

- [x] **2.1** Apply serverConfigSchema in addServer controller

  **What to do**: Add Zod validation to `servers-controller.ts`:
  ```typescript
  import { serverConfigSchema } from '../config/schema.js';
  
  export function addServer(req: Request, res: Response): void {
    const result = serverConfigSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: result.error.message });
      return;
    }
    // use result.data instead of req.body
  }
  ```

  **QA Scenarios**:
  ```
  Scenario: Invalid type value
    Given: Request with type: 'invalid_type'
    Then: Should return 400 with validation error
    And: Should NOT add server

  Scenario: maxConcurrency exceeds 1000
    Given: Request with maxConcurrency: 1500
    Then: Should return 400 with validation error

  Scenario: Valid request with all fields
    Given: Valid server config
    Then: Should add successfully
  ```

- [x] **2.2** Align maxConcurrency frontend/backend limits

  **What to do**: Change backend schema max from 1000 to 100 (or raise frontend to 1000 if that's needed):
  ```typescript
  maxConcurrency: z.number().int().min(1).max(100).default(4),
  ```

- [x] **2.3** Add apiKey validation to backend

  **What to do**: Add regex validation matching frontend:
  ```typescript
  apiKey: z.string().regex(/^(env:[A-Z_][A-Z0-9_]*|sk-[a-zA-Z0-9-_]*)?$/).optional(),
  ```

---

### Phase 3: Fix Race Condition (CRITICAL)

- [x] **3.1** Make addServer atomic

  **What to do**: Modify orchestrator.addServer to perform duplicate check internally:
  ```typescript
  addServer(server: ...): void {
    const normalizedUrl = normalizeServerUrl(server.url);
    
    // Atomic check-and-add
    const existing = this.servers.find(
      s => s.id === server.id || areUrlsEquivalent(s.url, normalizedUrl)
    );
    if (existing) {
      logger.warn(`Server ${server.id} already exists`);
      return; // or throw, but existing code returns silently
    }
    
    // ... rest of add logic
  }
  ```

  **Alternative**: Add mutex/lock around the check-and-add section.

  **QA Scenarios**:
  ```
  Scenario: Two rapid concurrent add requests with same ID
    Given: Two simultaneous POST /api/orchestrator/servers/add with same ID
    When: Both requests hit addServer nearly simultaneously
    Then: Only one server should be added
    And: Second request should get 409 duplicate error
  ```

---

### Phase 4: UI Improvements (MEDIUM)

- [x] **4.1** Add forcedCapabilities UI (optional, admin only)

  **What to do**: Add optional fields in Add Server modal for forced capabilities:
  ```tsx
  <details>
    <summary>Advanced: Force Capabilities</summary>
    <label>
      Force Ollama Support
      <input type="checkbox" />
    </label>
    <label>
      Force OpenAI Support  
      <input type="checkbox" />
    </label>
    <label>
      Force Anthropic Support
      <input type="checkbox" />
    </label>
  </details>
  ```
  
  **Note**: Deferred as admin-only feature. Backend supports forcedCapabilities via config file. Frontend UI is low priority.

- [x] **4.2** Show probedEndpoints detail in server expanded view

  **What to do**: Add section in expanded server card showing per-endpoint probe results:
  ```
  Endpoint Probes:
  ✓ /api/chat
  ✓ /api/generate
  ✓ /api/embeddings
  ✓ /v1/chat/completions
  ✗ /v1/completions (404)
  ✓ /v1/embeddings
  ? /v1/messages (timeout)
  ```

- [x] **4.3** Align frontend type default with backend

  **What to do**: Change frontend default from `'ollama'` to `'auto'`:
  ```tsx
  const [newServerType, setNewServerType] = useState<'ollama' | 'openai' | 'auto'>('auto');
  ```

  OR change backend default from `'auto'` to `'ollama'` — but `'auto'` is the smarter default.

---

## Verification Strategy

### QA Scenarios for Endpoint Probing Fix

**Critical Path — MUST verify before marking complete:**

```
Scenario: Ollama server with dual-API support
  Tool: Playwright (or manual curl)
  Preconditions: Ollama 0.1.40+ running at http://localhost:11434 with model loaded
  Steps:
    1. Add server with type: 'auto'
    2. Wait for health check to complete
    3. Query GET /api/orchestrator/servers
  Expected Result: 
    - supportsOllama: true
    - supportsV1: true (Ollama 0.1.40+ serves /v1/*)
    - probedEndpoints.ollama_chat: true
    - probedEndpoints.openai_chat: true (new - confirms fix working)
  Failure Indicator: openai_chat is false when Ollama 0.1.40+ is running

Scenario: OpenAI-only server (LM Studio, etc)
  Tool: Playwright (or manual curl)
  Preconditions: LM Studio running at http://localhost:8000
  Steps:
    1. Add server with type: 'auto'
    2. Wait for health check
    3. Query server details
  Expected Result:
    - supportsOllama: false (LM Studio doesn't serve /api/*)
    - supportsV1: true
  Failure Indicator: supportsOllama is true for LM Studio

Scenario: Server returns 400 Bad Request
  Tool: Mock server that returns 400 for all /api/* requests
  Steps:
    1. Add mock server
    2. Health check probes endpoints
    3. Check probedEndpoints
  Expected Result: ollama_* flags should be TRUE (400 confirms endpoint exists)
  Failure Indicator: ollama_* flags are false (old code treating 400 as failure)
```

### QA Scenarios for Schema Validation

```
Scenario: Send invalid type via API
  Tool: curl
  Steps: curl -X POST http://localhost:5100/api/orchestrator/servers/add \
    -d '{"id":"test","url":"http://localhost:11434","type":"invalid"}'
  Expected: 400 Bad Request with validation error
  Failure Indicator: 200 OK (validation not applied)

Scenario: Send maxConcurrency: 500
  Tool: curl
  Steps: curl -X POST http://localhost:5100/api/orchestrator/servers/add \
    -d '{"id":"test2","url":"http://localhost:11435","maxConcurrency":500}'
  Expected: After fix, should return 400 (exceeds max of 100)
  Failure Indicator: 200 OK and server added with 500 (not caught)
```

### QA Scenarios for Race Condition

```
Scenario: Concurrent add same ID
  Tool: parallel curl
  Steps:
    curl -X POST http://localhost:5100/api/orchestrator/servers/add \
      -d '{"id":"duplicate","url":"http://localhost:11434"}' &
    curl -X POST http://localhost:5100/api/orchestrator/servers/add \
      -d '{"id":"duplicate","url":"http://localhost:11435"}' &
    wait
  Expected: One succeeds (200), one fails (409)
  Failure Indicator: Both succeed, two servers with same ID exist
```

---

## Execution Strategy

### Parallelization

```
Wave 1 (Foundation - fixes that unblock others):
├── 1.1: Document current probing behavior [quick]
├── 1.2: Design new probing criteria [quick]
└── 2.1: Apply schema validation [quick]

Wave 2 (Core fixes - large changes):
├── 1.3: Implement new probeInferenceEndpoint [deep]
├── 1.4: Update runEndpointProbes aggregation [deep]
└── 3.1: Make addServer atomic [deep]

Wave 3 (Testing & polish):
├── 1.5: Add/update tests [quick]
├── 2.2: Align maxConcurrency limits [quick]
├── 2.3: Add apiKey validation [quick]
└── 4.2: Show probedEndpoints detail [quick]

Wave 4 (Optional UI improvements):
├── 4.1: forcedCapabilities UI [quick]
└── 4.3: Align frontend/backend defaults [quick]
```

### Dependency Matrix
- 1.1, 1.2 must complete before 1.3
- 1.3, 1.4 must complete before 1.5
- 2.1 must complete before 2.2, 2.3
- 3.1 is independent of 1.x and 2.x

---

## Success Criteria

### Must Have (Critical Path)
- [x] Endpoint probing correctly identifies 400 as "endpoint exists"
- [x] Endpoint probing correctly identifies 404 as "endpoint does not exist"
- [x] Schema validation applied to addServer endpoint
- [x] Invalid type values rejected with 400
- [x] Duplicate ID race condition eliminated

### Should Have
- [x] maxConcurrency limits aligned (frontend/backend)
- [x] apiKey validation on backend
- [x] probedEndpoints detail visible in UI

### Nice to Have
- [x] forcedCapabilities UI (admin-only, low priority)
- [x] Frontend type default aligned with backend
- [x] **BONUS**: Added `supportsAnthropic` badge to server card (line 368-372 of Servers.tsx) — shows "Anthropic" pill when server has Anthropic API support

---

## Files to Modify

### Backend
- `src/health-check-scheduler.ts` — probeInferenceEndpoint, runEndpointProbes
- `src/controllers/servers-controller.ts` — add validation
- `src/orchestrator/orchestrator.ts` — atomic addServer
- `src/config/schema.ts` — maxConcurrency limit (optional)
- `tests/unit/health-check-scheduler.test.ts` — new tests

### Frontend
- `frontend/src/pages/Servers.tsx` — default type alignment, probedEndpoints display
- `frontend/src/validations.ts` — align limits

### New Files
- None required
