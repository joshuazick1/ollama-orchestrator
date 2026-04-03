# Active Testing, Adaptive Timeout & Program Cohesion Deep Analysis

> **Date**: 2026-04-03
> **Branch**: `phase2/metrics-rollups`
> **Status**: Research complete — 57 findings across 9 categories, 8-wave remediation plan + Anthropic compatibility analysis (10 new findings, 7-wave plan), pending implementation decisions

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Active Testing Architecture](#active-testing-architecture)
3. [Adaptive Timeout Architecture](#adaptive-timeout-architecture)
4. [Active Testing Findings](#active-testing-findings)
5. [Adaptive Timeout Findings](#adaptive-timeout-findings)
6. [Config/Schema Cohesion Findings](#configschema-cohesion-findings)
7. [Cross-Subsystem Integration Findings](#cross-subsystem-integration-findings)
8. [Error Handling Findings](#error-handling-findings)
9. [Dead Code & Unused Exports Findings](#dead-code--unused-exports-findings)
10. [Type Safety Findings](#type-safety-findings)
11. [SQLite Migration — JSON Persistence Removal](#sqlite-migration--json-persistence-removal)
12. [Minimal Inference Probing System](#minimal-inference-probing-system)
13. [Findings Summary Matrix](#findings-summary-matrix)
14. [Recommended Remediation Order](#recommended-remediation-order)
15. [Anthropic Messages API Compatibility](#anthropic-messages-api-compatibility--architecture-analysis)

---

## Executive Summary

A comprehensive review of the active testing, adaptive timeout, and overall program cohesion uncovered **57 findings** across 9 categories, supplemented by **10 Anthropic compatibility findings** (F-AC-\*) across 7 new sub-waves. The original 17 active testing/timeout findings remain, supplemented by 30 additional findings from a broader cohesion sweep covering config/schema synchronization, cross-subsystem integration, error handling, dead code, and type safety — plus 6 SQLite migration findings and 4 inference probing findings from the new feature investigations.

**Critical theme — Config/Schema Desynchronization**: The Zod schema (`schema.ts`) and runtime config (`config.ts`) have diverged significantly. This isn't 3 isolated mismatches — it's a **systemic problem** with 13+ fields missing from the schema, 4 default value mismatches, and 4 schema-only fields that don't exist in the runtime config. The schema was created for frontend validation but was never kept in sync with the backend.

**Critical theme — Subsystem Isolation**: Subsystems maintain independent state about servers but lack synchronization. When servers are added/removed, ban state, timeout state, and metrics are not cleaned up. Config hot-reload only propagates to 3 of 7+ subsystems. The ban manager and circuit breaker operate in complete isolation despite governing overlapping concerns.

**Critical theme — Silent Failure**: The persistence layer swallows all errors and returns empty collections. A corrupt data file causes silent data loss. Error context is discarded in 4+ locations via `.catch(() => 'Unknown error')`. Health check probe failures log at debug level only.

**Critical theme — Split Persistence**: 6 operational data stores still use JSON flat files (`JsonFileHandler`) despite the project being in Phase 2/4 of SQLite migration. This causes full-file rewrites on every save, no query capability over operational state, and data loss on corruption. Meanwhile, request/decision history already writes to SQLite successfully via `MetricsStore` with 7 well-indexed tables.

**Critical theme — Blind Load Balancing**: With ~400 models across ~60 servers, the load balancer has no mechanism to proactively gather performance data. Servers/models without user traffic have zero metrics, forcing random selection. The cross-model inference fallback (parameter-size-based) can reduce the probe requirement from ~24,000 to ~300-420 probes, but no probe system exists to leverage this.

**New — Anthropic Messages API Compatibility**: The orchestrator will gain a third first-class API surface (`POST /v1/messages`) alongside the existing Ollama native and OpenAI-compatible endpoints. The architecture is a **direct proxy with end-translation**: servers are typed as `ollama`, `openai`, or `anthropic` backends; translation happens at the response boundary, not in the routing layer. This yields 10 new findings (F-AC-1 through F-AC-10) across types, health checks, request/response streaming translation, auth, and config.

Key findings by area:

- **Active Testing** (9 findings): Schema/config mismatch, dead code, duplicate test results, coverage gaps
- **Anthropic Compatibility** (10 findings): No capability flag, no streaming translator, no request validation, no error format, no auth header handling, SSE ordering risk, unsupported Anthropic-only features, no reverse translation
- **Adaptive Timeouts** (8 findings): Double adaptation bug, one-way ratchet, dead state, persistence loss
- **Config/Schema** (6 findings): Systemic desynchronization — 13+ missing fields, 4 default mismatches
- **Integration** (7 findings): Missing cleanup on server removal, config hot-reload gaps, no ban↔CB sync
- **Error Handling** (5 findings): Silent persistence failures, discarded error context, debug-level probes
- **Dead Code** (6 findings): Entire `domain-errors.ts` unused, 6 `*WithFlag` wrappers, 3 unused feature flags
- **Type Safety** (6 findings): Repeated `as any` casts, non-null assertions on Map.get(), detached promises
- **SQLite Migration** (6 findings): 6 JSON persistence points to migrate to SQLite `OperationalStore`
- **Inference Probing** (4 findings): No proactive probing, no probe/user traffic discrimination, incomplete parameter size data

---

## Active Testing Architecture

### Three Independent Test Trigger Paths

```
                           ┌─────────────────────────────┐
                           │  RecoveryTestCoordinator     │
                           │  (Central Hub)               │
                           │                              │
                           │  • Server-level coordination │
                           │  • Queuing & concurrency     │
                           │  • REC-13 cross-path guard   │
                           │  • Test invalidation         │
                           │  • Adaptive timeout calc     │
                           └──────────┬──────────────────┘
                                      │
               ┌──────────────────────┼──────────────────────┐
               │                      │                      │
    ┌──────────▼──────────┐ ┌────────▼────────────┐ ┌──────▼──────────────┐
    │ ActiveTestScheduler │ │ HealthCheckScheduler │ │ Request Path        │
    │                     │ │                      │ │                     │
    │ Polls every 1s      │ │ Health every 30s     │ │ Incoming request    │
    │ Checks CB registry  │ │ Recovery every 60s   │ │ finds half-open CB  │
    │ for expired retries │ │ On success + open CB │ │                     │
    │ Detects full model  │ │ → force close        │ │ Calls coordinator   │
    │   outages           │ │ → trigger tests      │ │ directly            │
    └─────────────────────┘ └──────────────────────┘ └─────────────────────┘
```

### Key Components

| Component                  | File                                        | Lines | Role                                                                      |
| -------------------------- | ------------------------------------------- | ----- | ------------------------------------------------------------------------- |
| ActiveTestScheduler        | `src/active-test-scheduler.ts`              | 279   | Polls for open CBs with expired `nextRetryAt`; detects full model outages |
| RecoveryTestCoordinator    | `src/recovery-test-coordinator.ts`          | 1,469 | Central hub — coordination, queuing, concurrency, timeout calculation     |
| CircuitBreaker             | `src/circuit-breaker/circuit-breaker.ts`    | 1,155 | State machine (closed→open→half-open→closed); delegates recovery tests    |
| HealthCheckScheduler       | `src/health-check-scheduler.ts`             | 732   | Periodic health probes; triggers recovery on successful health check      |
| RecoveryFailureTracker     | `src/analytics/recovery-failure-tracker.ts` | 812   | Tracks recovery patterns, failure analysis                                |
| Orchestrator (integration) | `src/orchestrator/orchestrator.ts`          | 4,594 | `runActiveTestsForServer` (line 3755), `recordSuccess` (line 3293)        |

### Test Result Flow

```
Test Execution
    │
    ├─ Success
    │   └─ breaker.recordSuccess()
    │       └─ consecutiveSuccesses++
    │           └─ if ≥ threshold (3) → transition to 'closed'
    │
    └─ Failure
        └─ breaker.recordFailure()
            └─ if half-open → transition to 'open'
                └─ nextRetryAt = now + exponential backoff
```

### Concurrency Control (REC-13)

The system implements a cross-path concurrency guard to prevent multiple trigger paths from testing the same server simultaneously:

- **Orchestrator level**: `serversUndergoingActiveTests` Set (line 3753) — fast-path optimization
- **Coordinator level**: `activeServers` Set (line 123) — authoritative guard
- **Test files**: `tests/unit/recovery-concurrency-guard.test.ts` (254 lines)

---

## Adaptive Timeout Architecture

### Core Component: TimeoutManager

**File**: `src/utils/timeout-manager.ts` (261 lines)

```
Per-Server:Model TimeoutState
┌─────────────────────────────────────────────┐
│  key: "server1:llama3"                      │
│  baseTimeout: 120000        (initial value) │
│  currentTimeout: 145000     (adapted)       │
│  consecutiveFailures: 2     (DEAD — unused) │
│  consecutiveSuccesses: 5    (DEAD — unused) │
│  lastUpdated: 1712150400000                 │
└─────────────────────────────────────────────┘
```

### Adaptation Algorithm

- **Method**: Exponential Moving Average (EMA) with α = 0.3
- **Formula**: `newTimeout = α × targetTimeout + (1 - α) × currentTimeout`
- **Target**: `responseTime × multiplier` where multiplier = 3× for active tests, 2× for slow requests
- **Bounds**: [15,000ms min, 600,000ms max]
- **Failure escalation**: `currentTimeout × 1.5` on timeout errors

### Integration Points

```
Request Path                          Active Test Path
    │                                     │
    ├─ getTimeout(server, model)          ├─ getTimeout(server, model) × 3
    │   → used for fetch timeout          │   → used for test timeout
    │                                     │
    ├─ Response received                  ├─ Test success
    │   └─ if responseTime > 5s           │   └─ updateFromResponseTime()  ← (×3 multiplier)
    │       └─ updateFromResponseTime()   │
    │           (only if > current)        │
    │                                     │
    └─ Timeout error                      └─ Timeout error
        └─ recordFailure()                    └─ recordFailure()
            └─ current × 1.5                      └─ current × 1.5
```

### Persistence

- **Save**: `orchestrator-persistence.ts` → `Record<string, number>` (currentTimeout values only)
- **Load**: Reconstructs `TimeoutState` with `baseTimeout = currentTimeout = savedValue`
- **Frequency**: On orchestrator shutdown / periodic save

---

## Active Testing Findings

### F-AT-1: Schema/Config `halfOpenTimeout` Mismatch (Bug)

**Severity**: High
**Files**: `src/config/schema.ts:208`, `src/config/config.ts:258`

The Zod schema and default config disagree on `halfOpenTimeout` by a factor of 5:

```typescript
// schema.ts:208 — Zod schema default
halfOpenTimeout: z.number().default(60000); // 1 minute

// config.ts:258 — DEFAULT_CONFIG
halfOpenTimeout: 300000; // 5 minutes (comment: "match activeTestTimeout")
```

**Impact**: At runtime, `DEFAULT_CONFIG` wins because the orchestrator initializes from it. However, if a user provides partial circuit breaker config through the Zod validation path (e.g., API config update with only some CB fields), any omitted `halfOpenTimeout` gets the Zod default of 60s. Half-open breakers would revert to open far too aggressively — a 5x difference in recovery window.

**Fix**: Align the Zod schema default to `300000` to match `DEFAULT_CONFIG`.

---

### F-AT-2: `activeTestTimeout` Missing From Zod Schema (Gap)

**Severity**: Medium
**Files**: `src/config/config.ts:261`, `src/config/schema.ts`

`DEFAULT_CONFIG` defines `activeTestTimeout: 300000` (line 261), but `circuitBreakerConfigSchema` in `schema.ts` does not include this field. It cannot be validated or overridden through the standard config schema path (API config updates, config file validation).

**Fix**: Add `activeTestTimeout: z.number().min(5000).max(600000).default(300000)` to `circuitBreakerConfigSchema`.

---

### F-AT-3: `RecoveryTestConfig` Has No Schema Validation (Gap)

**Severity**: Medium
**Files**: `src/config/config.ts:90-101`, `src/config/schema.ts`

The `RecoveryTestConfig` interface defines 5 configuration fields:

```typescript
interface RecoveryTestConfig {
  serverCooldownMs: number; // 30000
  maxWaitForInFlightMs: number; // 10000
  modelTestTimeoutMs: number; // 30000
  tagsTestTimeoutMs: number; // 5000
  testPromptTokens: number; // 1
}
```

None of these have corresponding Zod schema definitions, meaning they cannot be validated or configured through the standard validation pipeline.

**Fix**: Create a `recoveryTestConfigSchema` in `schema.ts` and wire it into the main config schema.

---

### F-AT-4: Duplicate Concurrency Guards (Redundancy — Not a Bug)

**Severity**: Informational
**Files**: `src/orchestrator/orchestrator.ts:3753`, `src/recovery-test-coordinator.ts:123`

Both the orchestrator (`serversUndergoingActiveTests` Set) and the coordinator (`activeServers` Set) maintain independent concurrency guards. This is defense-in-depth — the orchestrator's check is a fast-path optimization that avoids entering the coordinator, while the coordinator's is the authoritative guard.

**Recommendation**: No change needed. Add a comment documenting the intentional layering.

---

### F-AT-5: Dead Code in `runActiveTestsForServer` (Bug)

**Severity**: Medium
**Files**: `src/orchestrator/orchestrator.ts:3812-3844`

In `runActiveTestsForServer`, lines 3842-3844 check `if (serverCb.getState() === 'half-open')` to push to `halfOpenBreakers`. This code is **unreachable** because the same condition at lines 3812-3836 handles half-open breakers first (performs a health check and returns `[]` early).

```typescript
// Line 3812-3836: FIRST check — handles half-open, returns early
if (serverCb.getState() === 'half-open') {
  // ... health check logic ...
  return []; // ← Returns here, so execution never reaches...
}

// Line 3842-3844: SECOND check — UNREACHABLE
if (serverCb.getState() === 'half-open') {
  halfOpenBreakers.push(serverCb); // ← Dead code
}
```

**Fix**: Remove the unreachable second check (lines 3842-3844).

---

### F-AT-6: Test Invalidation Adds Duplicate Result (Minor Bug)

**Severity**: Low
**Files**: `src/recovery-test-coordinator.ts:1273-1281`

After a **successful** test, if invalidation is detected (e.g., server state changed during the test), a second result with `success: false` is pushed to the results array. The caller receives **both** a success and a failure result for the same breaker:

```typescript
// After successful test result is already pushed...
if (this.isTestInvalidated(/*...*/)) {
  results.push({
    breakerKey,
    success: false, // Contradicts the success already in results
    reason: 'Test invalidated: ...',
  });
}
```

**Impact**: Callers iterating over results may see contradictory outcomes for the same breaker key. In practice, the current callers process all results and the last one wins, but this is fragile.

**Fix**: Replace the successful result instead of appending a second one, or skip pushing the success result when invalidation is detected.

---

### F-AT-7: `maxHalfOpenPerServer` Hardcoded (Not Configurable)

**Severity**: Low
**Files**: `src/orchestrator/orchestrator.ts:3907`

```typescript
const maxHalfOpenPerServer = 3; // Configurable limit
```

The comment says "Configurable limit" but it's a hardcoded constant. Not configurable through any config path.

**Fix**: Move to config (either `circuitBreakerConfig` or `recoveryTestConfig`).

---

### F-AT-8: Test Coverage Gaps in RecoveryTestCoordinator

**Severity**: High
**Files**: `tests/unit/recovery-test-coordinator.test.ts` (136 lines)

The `RecoveryTestCoordinator` is the **most critical component** in the recovery pipeline (1,469 lines), yet its test file only covers:

- Constructor initialization
- Embedding model detection

**NOT tested**:

- `performCoordinatedRecoveryTest()` — the core execution path
- `runActiveTests()` — batch test execution
- Adaptive timeout calculation
- Server cooldown enforcement
- Queue management and concurrency limits
- Test invalidation logic (F-AT-6)
- Error handling within test execution

**Fix**: Add comprehensive tests for the core execution paths. Priority targets: `performCoordinatedRecoveryTest()`, queue management, and test invalidation.

---

### F-AT-9: `performRecoveryTest` in CircuitBreaker Has No Error Handling

**Severity**: Low
**Files**: `src/circuit-breaker/circuit-breaker.ts:904`

`CircuitBreaker.performRecoveryTest()` delegates to `RecoveryTestCoordinator.performCoordinatedRecoveryTest()` but has no try/catch around the call. If the coordinator throws (e.g., timeout, network error during test), the error propagates unhandled to the caller.

**Impact**: The callers (`ActiveTestScheduler`, `HealthCheckScheduler`) do have their own error handling, so this is mitigated. However, the circuit breaker itself should handle errors from its own recovery path to maintain encapsulation.

**Fix**: Wrap the delegation call in try/catch, log the error, and return a failure result rather than throwing.

---

## Adaptive Timeout Findings

### F-TO-1: `defaultTimeout` Initialized From Wrong Config (Questionable)

**Severity**: Medium
**Files**: `src/utils/timeout-manager.ts:218`, `src/config/config.ts`

```typescript
// timeout-manager.ts:218
defaultTimeout: currentConfig.circuitBreaker.openTimeout; // 120000 (2 minutes)
```

`openTimeout` is the **circuit breaker state duration** — how long a CB stays open before transitioning to half-open. It's semantically unrelated to request timeouts. The config has a dedicated `requestTimeoutMs: 300000` (5 minutes) that appears to be the intended default but is not used.

**Impact**: Default timeout is 120s instead of the intended 300s. This means first-ever requests to a server:model pair will use a 2-minute timeout when the system was designed for 5 minutes. Likely not an issue for most models, but large/slow models (70B+) could timeout prematurely.

**Fix**: Initialize `defaultTimeout` from `requestTimeoutMs` or a dedicated timeout config field.

---

### F-TO-2: `consecutiveFailures`/`consecutiveSuccesses` Never Read (Dead State)

**Severity**: Low
**Files**: `src/utils/timeout-manager.ts`

`TimeoutState` tracks `consecutiveFailures` and `consecutiveSuccesses`. They are incremented and decremented throughout the code but **nothing ever reads them**:

- Not used in timeout calculation
- Not used in any conditional logic
- Explicitly excluded from persistence (`saveTimeoutsToDisk` only saves `currentTimeout`)

**Impact**: Memory waste (two numbers per server:model entry). More importantly, dead state creates confusion — future developers may assume these fields are meaningful.

**Fix**: Remove both fields and their increment/decrement logic, or implement the intended escalation behavior they were designed for.

---

### F-TO-3: Double Timeout Adaptation on Active Test Success (Bug)

**Severity**: High
**Files**: `src/orchestrator/orchestrator.ts:2770, 3316`

When an active test succeeds, `updateFromResponseTime()` is called **twice** with the same parameters:

1. **First call** (line ~2770): In the request completion handler, after receiving a response
2. **Second call** (line ~3316): In `recordSuccess()`, which is also called from the request completion handler

The EMA formula `new = 0.3 × target + 0.7 × current` applied twice gives an effective alpha of:

```
After first:  T₁ = 0.3 × target + 0.7 × T₀
After second: T₂ = 0.3 × target + 0.7 × T₁
            = 0.3 × target + 0.7 × (0.3 × target + 0.7 × T₀)
            = 0.51 × target + 0.49 × T₀
```

**Impact**: Effective α ≈ 0.51 instead of the designed 0.3. Timeouts converge ~70% faster than intended. A single fast response has outsized influence on the timeout value, which could cause premature timeouts for servers with variable response times.

**Fix**: Remove the duplicate call. The `recordSuccess()` path should not call `updateFromResponseTime()` since the request handler already does.

---

### F-TO-4: Regular Request Timeout Adaptation is One-Way (Design Issue)

**Severity**: Medium
**Files**: `src/orchestrator/orchestrator.ts:2774-2783`

For regular (non-active-test) requests, the timeout is only updated if the suggested timeout exceeds the current value:

```typescript
if (suggestedTimeout > currentTimeout) {
  timeoutManager.updateFromResponseTime(server, model, responseTime);
}
```

**Impact**: Timeouts ratchet up but never come down from regular traffic. If a server has one slow response (e.g., cold model load taking 30s), the timeout stays elevated at ~60s+ indefinitely. The only mechanism for timeout reduction is the active test path (which uses a 3× multiplier, so still tends to stay high).

No decay or aging mechanism exists — unlike metrics (which have time-based decay), timeouts are static once set.

**Fix options**:

1. **Time-based decay**: Gradually reduce timeout toward `baseTimeout` if no recent slow responses
2. **Bidirectional EMA**: Apply the EMA in both directions (not just when increasing)
3. **Slow decay constant**: e.g., reduce by 5% every 5 minutes toward `baseTimeout`

---

### F-TO-5: `recordFailure` Is No-Op for Unknown Keys (Silent Drop)

**Severity**: Medium
**Files**: `src/utils/timeout-manager.ts:124`

```typescript
recordFailure(key: string): void {
  const state = this.timeouts.get(key);
  if (!state) return;  // ← Silent return — first failure ignored
  // ... escalation logic
}
```

If no `TimeoutState` exists for a server:model key (i.e., the server has never had a successful request recorded), `recordFailure()` silently returns. The timeout escalation (×1.5) is completely skipped.

**Impact**: The first failure on a previously-unseen server:model pair is ignored. Timeout escalation only works after at least one success has created the state entry via `updateFromResponseTime()`. This means a server that fails immediately on first contact gets no timeout adjustment.

**Fix**: Create a default `TimeoutState` entry on first `recordFailure()` if none exists, then apply the escalation.

---

### F-TO-6: Timeout Score Creates Feedback Loop (Design Concern)

**Severity**: Low
**Files**: `src/load-balancer/load-balancer.ts`

The load balancer's `timeoutScore` formula:

```typescript
timeoutScore = Math.max(0, 100 - (timeoutMs / 300000) * 100);
```

Higher timeout → lower score → less traffic routed to that server → fewer successful responses → timeout remains elevated (no decay mechanism per F-TO-4) → score stays low.

This is a **positive feedback loop**. The 5% weight limits the severity, but combined with F-TO-4's one-way ratchet, a server that had one slow period could be de-prioritized semi-permanently.

**Impact**: Limited by the 5% weight, but worth addressing alongside F-TO-4.

**Fix**: Addressed implicitly by fixing F-TO-4 (adding timeout decay). With decay, the feedback loop is self-correcting.

---

### F-TO-7: `calculateAdaptiveTimeout` in `circuit-breaker-helpers.ts` is Dead Code

**Severity**: Low
**Files**: `src/utils/circuit-breaker-helpers.ts:40-49`

```typescript
export function calculateAdaptiveTimeout(
  baseTimeout: number,
  consecutiveFailures: number,
  maxTimeout: number = 300000
): number {
  const multiplier = Math.min(Math.pow(1.5, consecutiveFailures), 10);
  return Math.min(baseTimeout * multiplier, maxTimeout);
}
```

This function is functionally identical to the logic in `TimeoutManager.calculateAdaptiveTimeout()` and is **never called** from anywhere in the codebase.

**Fix**: Remove the dead function.

---

### F-TO-8: Persistence Loses State Across Restarts (Design Issue)

**Severity**: Medium
**Files**: `src/orchestrator/orchestrator-persistence.ts`

The persistence layer saves only `Record<string, number>` — a map of keys to `currentTimeout` values. On load, it reconstructs `TimeoutState` with:

```typescript
baseTimeout: savedValue,      // ← Should be the original default, not the adapted value
currentTimeout: savedValue,
lastUpdated: Date.now()        // ← Original timestamp lost
```

**Impact**:

1. **`baseTimeout` concept is lost**: After restart, `baseTimeout === currentTimeout`, so any logic comparing the two (e.g., "has this timeout diverged from default?") gives incorrect results.
2. **`lastUpdated` is reset**: The system thinks all timeouts were just updated, which could suppress necessary re-adaptation.
3. **`updateDefaultTimeout()` check breaks**: The method checks `currentTimeout === baseTimeout` to decide whether to update — after restart, this always matches, causing unintended overwrites.

**Fix**: Persist the full `TimeoutState` object (or at minimum `baseTimeout` + `currentTimeout` + `lastUpdated`).

---

## Config/Schema Cohesion Findings

The Zod schema (`schema.ts`) and runtime config (`config.ts`) have diverged significantly. This is a **systemic problem**, not isolated mismatches.

### F-CS-1: `rateLimitWindowMs` Default Mismatch — 15× Discrepancy (Bug)

**Severity**: High
**Files**: `src/config/schema.ts:28`, `src/config/config.ts:311`

```typescript
// schema.ts:28 — Zod default
rateLimitWindowMs: z.number().int().min(1000).default(900000); // 15 minutes

// config.ts:311 — DEFAULT_CONFIG
rateLimitWindowMs: 60000; // 1 minute
```

**Impact**: If a user updates security config through the Zod validation path without specifying `rateLimitWindowMs`, they get a 15-minute window instead of the intended 1-minute window — rate limiting becomes 15× more permissive than designed.

**Fix**: Align the Zod default to `60000`.

---

### F-CS-2: `tags.cacheTtlMs` Default Mismatch — 10× Discrepancy (Bug)

**Severity**: Medium
**Files**: `src/config/schema.ts:90`, `src/config/config.ts:352`

```typescript
// schema.ts:90 — Zod default
cacheTtlMs: z.number().int().min(1000).default(30000); // 30 seconds

// config.ts:352 — DEFAULT_CONFIG
cacheTtlMs: 300000; // 5 minutes
```

**Impact**: Tags cache would expire 10× faster if schema defaults are applied, causing unnecessary re-fetching of model tags from all servers.

**Fix**: Align the Zod default to `300000`.

---

### F-CS-3: `corsOrigins` Default Mismatch (Bug)

**Severity**: Medium
**Files**: `src/config/schema.ts:27`, `src/config/config.ts:310`

```typescript
// schema.ts:27 — Zod default
corsOrigins: z.array(z.string()).default(['*']); // Allow all origins

// config.ts:310 — DEFAULT_CONFIG
corsOrigins: []; // No origins allowed
```

**Impact**: Schema defaults to open CORS (`['*']`) while config defaults to closed (`[]`). Depending on which path initializes the config, the security posture could be unexpectedly permissive.

**Fix**: Align to the more secure default (`[]`).

---

### F-CS-4: Streaming Config Missing 4 Fields From Schema (Gap)

**Severity**: Medium
**Files**: `src/config/schema.ts:61-68`, `src/config/config.ts:327-336`

The streaming schema defines 6 fields but config.ts defines 10. Missing from schema:

| Field                  | Config Default | Purpose                         |
| ---------------------- | -------------- | ------------------------------- |
| `activityTimeoutMs`    | 60000          | Timeout between chunks          |
| `stallThresholdMs`     | 300000         | Mark as stalled after no chunks |
| `stallCheckIntervalMs` | 10000          | Stall check frequency           |
| `maxHandoffAttempts`   | 2              | Max failover attempts           |

**Fix**: Add the 4 missing fields to `streamingConfigSchema`.

---

### F-CS-5: Circuit Breaker `backoff` Config Missing From Schema (Gap)

**Severity**: Medium
**Files**: `src/config/config.ts:300-306`, `src/config/schema.ts`

```typescript
// config.ts:300-306 — exists in DEFAULT_CONFIG
backoff: {
  standardDelaysMs: [5000, 15000, 30000, 60000, 120000],
  permanentDelaysMs: [30000, 60000, 120000, 300000, 600000],
  rateLimitBaseMs: 60000,
  rateLimitMultiplier: 2,
  rateLimitMaxMs: 600000,
}
```

Not present in the Zod schema at all. Cannot be configured through the validation pipeline.

**Fix**: Add `backoffConfigSchema` and include in `circuitBreakerConfigSchema`.

---

### F-CS-6: Entire `storage` and `modelManager.contextLimitTtlMs` Sections Missing From Schema (Gap)

**Severity**: Medium
**Files**: `src/config/config.ts:395-421`, `src/config/schema.ts`

The `storage` section (retention, performance, temporal — 3 sub-objects with ~20 fields total) exists in `DEFAULT_CONFIG` but has no Zod schema. Same for `modelManager.contextLimitTtlMs`.

Additionally, the schema defines fields that don't exist in `DEFAULT_CONFIG`:

- `queue` section (schema only)
- `userAgent` (schema only)
- `enableAuth` (schema only)

**Fix**: Create `storageConfigSchema` and add missing field to `modelManagerConfigSchema`. Remove or implement schema-only fields.

---

## Cross-Subsystem Integration Findings

### F-INT-1: Server Removal Doesn't Clean Up Ban or Timeout State (Bug)

**Severity**: High
**Files**: `src/orchestrator/orchestrator.ts:782-805`

When `removeServer()` is called, it removes from `servers` array, `modelAggregator`, and `circuitBreakerRegistry`. But it does **NOT**:

| Subsystem           | Cleanup Method Available     | Called on Remove? |
| ------------------- | ---------------------------- | ----------------- |
| `banManager`        | `removeServerBans(serverId)` | **No**            |
| `timeoutManager`    | (no method exists)           | **No**            |
| `metricsAggregator` | (no method exists)           | **No**            |

**Impact**: After server removal, stale ban entries and timeout state persist in memory. If the same server ID is re-added, it inherits orphaned bans and timeouts from its previous life.

**Fix**: Call `banManager.removeServerBans(serverId)` in `removeServer()`. Add and call cleanup methods for timeout and metrics state.

---

### F-INT-2: Config Hot-Reload Only Propagates to 3 of 7+ Subsystems (Bug)

**Severity**: High
**Files**: `src/orchestrator/orchestrator.ts`, `src/config/config.ts:248-256`

When config changes at runtime, only these subsystems pick up changes:

| Subsystem              | Has `updateConfig()`?        | Wired to Hot-Reload?            |
| ---------------------- | ---------------------------- | ------------------------------- |
| LoadBalancer           | Yes                          | **Yes**                         |
| CircuitBreakerRegistry | Yes (`updateAllConfig`)      | **Yes**                         |
| HealthCheckScheduler   | Yes                          | **Yes**                         |
| TimeoutManager         | Yes (`updateDefaultTimeout`) | **Yes** (via component watcher) |
| MetricsAggregator      | Yes (`setDecayConfig`)       | **No**                          |
| TemporalScorer         | Yes (`updateConfig`)         | **No**                          |
| BanManager             | No                           | **No**                          |
| ActiveTestScheduler    | No                           | **No**                          |

**Impact**: Changing decay settings, temporal config, failure cooldown periods, or active test intervals at runtime has no effect on already-running subsystems.

**Fix**: Wire `MetricsAggregator.setDecayConfig()` and `TemporalScorer.updateConfig()` to the config manager. Add `updateConfig()` methods to BanManager and ActiveTestScheduler.

---

### F-INT-3: Ban Manager and Circuit Breaker Operate in Complete Isolation (Design Issue)

**Severity**: Medium
**Files**: `src/utils/ban-manager.ts`, `src/circuit-breaker/circuit-breaker.ts`

These subsystems govern overlapping concerns (whether a server:model should receive traffic) but have zero cross-notification:

- When `banManager.addBan()` is called → circuit breaker is not notified
- When `banManager.removeBan()` is called → circuit breaker is not notified
- When circuit breaker opens → ban manager is not notified

A server can be unbanned in BanManager but have an open circuit breaker (or vice versa), creating inconsistent filtering in `getBestServerForModel()` where both checks run independently.

**Impact**: Not a bug per se (both checks are evaluated), but creates confusion about which mechanism is authoritative for server exclusion. No unified view of "why is this server excluded?"

**Fix**: Consider an event-based notification pattern, or at minimum document the intentional independence with a comment explaining the dual-check design.

---

### F-INT-4: Metrics Reset Doesn't Invalidate Temporal Scorer Cache (Bug)

**Severity**: Medium
**Files**: `src/metrics/metrics-aggregator.ts:1120-1124`, `src/load-balancer/temporal-scorer.ts:40`

When `metricsAggregator.reset()` is called, the temporal scorer's profile cache (60-second TTL) is not invalidated. Stale "good performance" profiles can persist for up to 60 seconds after a metric reset, causing the load balancer to prefer a server based on historical patterns while current metrics show poor or absent performance.

**Fix**: Call `temporalScorer.clearCache()` when metrics are reset, or have the temporal scorer subscribe to metric reset events.

---

### F-INT-5: `getServers()` Returns Filtered Copy But Callback Returns Live Reference (Inconsistency)

**Severity**: Low
**Files**: `src/orchestrator/orchestrator.ts:203, 810-818`

`getServers()` returns a de-duplicated filtered copy (safe), but the health check callback at line 203 captures `() => this.servers` — a direct reference to the live array. If the server array is modified during a health check cycle, the callback sees partial state.

**Fix**: Change the callback to `() => [...this.servers]` for consistency.

---

### F-INT-6: Health Check and Active Test Scheduling Overlap (Low Risk)

**Severity**: Low
**Files**: `src/health-check-scheduler.ts`, `src/active-test-scheduler.ts`

Both schedulers can independently trigger tests for the same server:model. While REC-13 prevents concurrent test _execution_, both schedulers still do the work of identifying candidates and entering the coordinator, only to be rejected. The health check scheduler limits to 1 model per server per cycle, but the active test scheduler has no such limit.

**Impact**: Wasted work (not correctness issue) when both schedulers target the same server.

**Fix**: Low priority — the REC-13 guard is sufficient for correctness. Could add a shared "recently tested" cache to avoid redundant candidate identification.

---

### F-INT-7: Model Manager Server Registration Never Wired (Gap)

**Severity**: Low
**Files**: `src/model-manager.ts:166-179`, `src/orchestrator/orchestrator.ts:743-805`

`ModelManager` has `registerServer()` and `unregisterServer()` methods that are never called from the orchestrator's `addServer()`/`removeServer()` methods. The model manager operates with incomplete knowledge of the server fleet.

**Fix**: Wire `modelManager.registerServer()` in `addServer()` and `modelManager.unregisterServer()` in `removeServer()`.

---

## Error Handling Findings

### F-EH-1: Persistence Layer Swallows All Errors (Bug)

**Severity**: High
**Files**: `src/orchestrator/orchestrator-persistence.ts`, `src/decision-history.ts`, `src/request-history.ts`

All persistence load functions catch errors and return empty collections:

```typescript
// orchestrator-persistence.ts
} catch (err) {
  logger.error('Exception while loading servers:', { error: err });
  return [];  // Silent failure — caller thinks no servers exist
}
```

**Impact**: If a data file is corrupt, the system silently starts with empty state. No alert, no recovery attempt, no indication to operators. Data loss is invisible.

**Fix**: Throw errors from persistence load functions. Let callers decide how to handle (e.g., start with defaults but emit a warning event, or refuse to start).

---

### F-EH-2: Error Context Discarded via `.catch(() => 'Unknown error')` (Bug)

**Severity**: Medium
**Files**: `src/orchestrator/orchestrator.ts:641,707`, `src/recovery-test-coordinator.ts:751,935`

When extracting error text from failed HTTP responses:

```typescript
const errorText = await response.text().catch(() => 'Unknown error');
```

Original error context (e.g., "model not loaded", "VRAM exhausted", "connection refused") is discarded and replaced with a generic string. This makes production debugging significantly harder.

**Fix**: Preserve the error: `.catch((e) => `Failed to read error body: ${e.message}`)`.

---

### F-EH-3: Health Check Probe Failures Logged at Debug Level Only (Design Issue)

**Severity**: Medium
**Files**: `src/health-check-scheduler.ts:296-301`

```typescript
.catch((err: unknown) => {
  logger.debug('Health probe failed for /api/tags', { ... });
  return null;
})
```

Health check failures won't appear in production logs (typically set to `info` or `warn`). A server that's flapping will have invisible probe failures.

**Fix**: Log at `warn` level, or at minimum `info`.

---

### F-EH-4: Shutdown Promise Not Error-Handled (Bug)

**Severity**: Low
**Files**: `src/index.ts:287,307`

```typescript
void orchestrator.shutdown().then(() => {
  process.exit(0);
});
// No .catch() — if shutdown fails, process may hang
```

**Fix**: Add `.catch()` with `process.exit(1)` to ensure the process terminates even on shutdown failure.

---

### F-EH-5: Streaming Cleanup Errors Logged at Debug Level (Design Issue)

**Severity**: Low
**Files**: `src/streaming.ts:267,285,387,733,740,747`

Multiple catch blocks during streaming cleanup log at debug level only. Resource leaks from failed cleanup are invisible in production.

**Fix**: Elevate to `warn` level.

---

## Dead Code & Unused Exports Findings

### F-DC-1: `domain-errors.ts` — Entire File Is Dead Code (Dead Code)

**Severity**: Medium
**Files**: `src/utils/domain-errors.ts` (108 lines)

Nine exported items (8 error classes + 1 type guard function) are **never instantiated or called** in production code:

- `OrchestratorError`, `ServerNotFoundError`, `ModelNotFoundError`, `ValidationError`, `ConflictError`, `ServerUnavailableError`, `CircuitBreakerOpenError`, `TimeoutError`, `isOrchestratorError`

These were created during the audit (E-4) but never wired into the error handling paths.

**Fix**: Either remove the file, or wire the domain errors into the appropriate throw sites (controllers, orchestrator).

---

### F-DC-2: Six `*WithFlag` Wrapper Functions Never Called (Dead Code)

**Severity**: Low
**Files**: Multiple utility files

| Function                       | File                            |
| ------------------------------ | ------------------------------- |
| `shouldBypassWithFlag`         | `circuit-breaker-helpers.ts:55` |
| `getErrorMessageWithFlag`      | `error-helpers.ts:87`           |
| `sleepWithFlag`                | `async-helpers.ts:98`           |
| `pruneCollectionWithFlag`      | `collection-helpers.ts:93`      |
| `clampWithFlag`                | `math-helpers.ts:54`            |
| `calculatePercentilesWithFlag` | `statistics.ts:151`             |

These appear to be incomplete feature flag wrappers that were never wired up. They reference feature flags that are also unused (F-DC-3).

**Fix**: Remove all `*WithFlag` functions.

---

### F-DC-3: Three Feature Flags Never Checked in Production (Dead Code)

**Severity**: Low
**Files**: `src/config/feature-flags.ts`

| Flag                       | Status                             |
| -------------------------- | ---------------------------------- |
| `useCircuitBreakerHelpers` | Only checked inside its own module |
| `useTTFTTracker`           | Never checked anywhere             |
| `useContextBuilder`        | Never checked anywhere             |

**Fix**: Remove unused flags.

---

### F-DC-4: Utility Functions Only Used in Tests (Dead Code)

**Severity**: Low
**Files**: Multiple utility files

| Function                       | File                            | Status     |
| ------------------------------ | ------------------------------- | ---------- |
| `extractCircuitBreakerOptions` | `circuit-breaker-helpers.ts:23` | Tests only |
| `timed`                        | `timer.ts:79`                   | Tests only |
| `timedAsync`                   | `timer.ts:88`                   | Tests only |
| `deepMergeAll`                 | `deep-merge.ts:46`              | Tests only |

**Fix**: Move to test utilities or remove.

---

### F-DC-5: `parseRetryAfterMs` Never Imported Anywhere (Dead Code)

**Severity**: Low
**Files**: `src/utils/recovery-backoff.ts:155`

Function exported but never imported — not even in tests.

**Fix**: Remove.

---

### F-DC-6: Error Classifier Convenience Functions Only Used in Tests (Dead Code)

**Severity**: Low
**Files**: `src/utils/error-classifier.ts`

| Function             | Status     |
| -------------------- | ---------- |
| `setErrorClassifier` | Tests only |
| `isRetryableError`   | Tests only |
| `isTransientError`   | Tests only |

**Fix**: Move to test utilities or remove.

---

## Type Safety Findings

### F-TS-1: Repeated `as any` Casts to Access CircuitBreaker Properties (Type Gap)

**Severity**: Medium
**Files**: `src/recovery-test-coordinator.ts:405,438,504,614,643,650,767,840,1162,1356,1392`

```typescript
const breakerName = (breaker as any).name || 'unknown';
(breaker as any).setModelType('embedding');
```

11+ locations cast `CircuitBreaker` to `any` to access `.name` and `.setModelType()`. These properties exist on the class but aren't exposed in the type definition used by the coordinator.

**Fix**: Add `name` and `modelType` accessors to the CircuitBreaker interface/type.

---

### F-TS-2: Non-null Assertions on `Map.get()` (Type Safety)

**Severity**: Medium
**Files**: `src/decision-history.ts:342,356`, `src/orchestrator/orchestrator.ts:1320,1345`

```typescript
const serverStats = stats.get(event.selectedServerId)!;
const existing = allTags.get(modelKey)!;
```

Uses `!` assertion immediately after `Map.get()` without checking for undefined. If the map doesn't contain the key (race condition, timing issue), these throw at runtime.

**Fix**: Add proper undefined checks or use a get-or-create pattern.

---

### F-TS-3: `as any` for AbortSignal Compatibility (Type Gap)

**Severity**: Low
**Files**: `src/streaming.ts:279-281,723-729`

```typescript
if (typeof (abortSignal as any).addEventListener === 'function') {
  (abortSignal as any).addEventListener('abort', abortHandler);
}
```

AbortSignal type compatibility is handled via runtime checks with `as any` casts. This is a pragmatic workaround but bypasses compile-time safety.

**Fix**: Create a typed wrapper/adapter for AbortSignal compatibility.

---

### F-TS-4: Detached Promise in Stall Handler (Bug)

**Severity**: Medium
**Files**: `src/streaming.ts:447-518`

The `onStall()` callback returns a promise that is not awaited:

```typescript
onStall(abortController, streamingRequestId)
  .then(result => { ... })
  .catch((stallError: unknown) => { ... });
// Detached — if this rejects after the parent function returns, it's unhandled
```

**Fix**: Store the promise reference and ensure it's settled before the parent function completes, or add a top-level `.catch()` that logs and swallows.

---

### F-TS-5: Dynamic Property Access via `as any` (Type Gap)

**Severity**: Low
**Files**: `src/orchestrator/orchestrator.ts:1820,1947,2557`

```typescript
const availableModels = (s as any)[modelListKey] ?? s.models;
```

Runtime-derived property key bypasses the type system entirely. If `modelListKey` is incorrect, no compile-time error.

**Fix**: Use a type-safe property accessor or a discriminated union pattern.

---

### F-TS-6: `as unknown` Casts in Stream Handoff (Type Gap)

**Severity**: Low
**Files**: `src/utils/stream-handoff.ts:127,338,381`

```typescript
messagesCount: ((continuationRequest.messages as unknown[]) || []).length,
```

Cascading type uncertainty — `messages` type is unclear through the chain, patched with `as unknown[]`.

**Fix**: Type the `messages` field properly at the source.

---

## SQLite Migration — JSON Persistence Removal

### Current State

The project is in a **partial migration** state. Request history and decision history already persist to SQLite via `MetricsStore` (their JSON `persist()` methods are explicit no-ops). However, **6 other data types still use JSON files** through `JsonFileHandler`, creating split-brain persistence, silent data loss on corruption, and no query capability over operational state.

### Existing SQLite Infrastructure

The `MetricsStore` (`src/storage/metrics-store.ts`) already provides a mature SQLite layer with:

- **7 tables**: `requests`, `decisions`, `decision_candidates`, `failover_attempts`, `hourly_rollups`, `daily_rollups`, `temporal_profiles`
- **Library**: `better-sqlite3` with WAL mode, foreign keys, 2MB cache
- **Buffered writes**: Batch flush every 1000ms or 100 records
- **Retention pipeline**: Hourly pruning with configurable retention periods (30d requests, 90d rollups, 14d profiles)
- **Migration support**: `applySchema()` with versioned migrations via `PRAGMA user_version`
- **Comprehensive indexes**: 21 indexes across all tables covering common query patterns

### JSON Persistence Points to Migrate

| #   | File                          | JSON Path                           | Data                                        | Write Pattern            | Records    | Migration Target                                |
| --- | ----------------------------- | ----------------------------------- | ------------------------------------------- | ------------------------ | ---------- | ----------------------------------------------- |
| 1   | `data/servers.json`           | `config-manager.ts:131`             | `AIServer[]` — server registry              | On add/remove            | ~60        | **KEEP AS JSON** (user request)                 |
| 2   | `data/bans.json`              | `config-manager.ts:137`             | `string[]` — banned server:model pairs      | On ban/unban             | ~50-200    | **F-DB-1**: New `bans` table                    |
| 3   | `data/timeouts.json`          | `config-manager.ts:145`             | `Record<string, number>` — per-key timeouts | On timeout change        | ~200-600   | **F-DB-2**: New `adaptive_timeouts` table       |
| 4   | `data/circuit-breakers.json`  | `circuit-breaker-persistence.ts:49` | CB state per server:model                   | Debounced 30s            | ~200-600   | **F-DB-3**: New `circuit_breaker_state` table   |
| 5   | `data/metrics.json`           | `metrics-persistence.ts:31`         | Server metrics (24h window)                 | Debounced 30s            | ~200-600   | **F-DB-4**: New `server_metrics_snapshot` table |
| 6   | `data/recovery-failures.json` | `recovery-failure-tracker.ts:692`   | Recovery failure tracking                   | Debounced 30s (if dirty) | ~50-200    | **F-DB-5**: New `recovery_failures` table       |
| 7   | `data/metrics-summary.json`   | `analytics-engine.ts:1159`          | Hourly metric snapshots                     | Every 1hr                | ~720 (30d) | **F-DB-6**: New `metrics_summary` table         |

### Findings

#### F-DB-1: Bans — Migrate to SQLite

**Current**: `bans.json` stores a flat `string[]` of `"server:model"` entries via `JsonFileHandler`. Reads on startup, writes on every ban/unban.

**Problem**: No timestamps, no history, no queryability. Cannot answer "when was X banned?" or "how many times has X been banned this week?"

**Proposed table**:

```sql
CREATE TABLE IF NOT EXISTS bans (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id     TEXT NOT NULL,
  model         TEXT NOT NULL,
  reason        TEXT,               -- why banned (error type, manual, etc.)
  banned_at     INTEGER NOT NULL,   -- epoch ms
  unbanned_at   INTEGER,            -- epoch ms, NULL = still active
  UNIQUE(server_id, model, banned_at)
);
CREATE INDEX idx_bans_active ON bans(server_id, model) WHERE unbanned_at IS NULL;
CREATE INDEX idx_bans_ts ON bans(banned_at);
```

**Retention**: 90 days for historical records. Active bans never expire via retention (only via explicit unban).

**Migration path**: Read existing `bans.json` → insert each as active ban with `banned_at = now`, `reason = 'migrated'` → delete JSON file.

#### F-DB-2: Adaptive Timeouts — Migrate to SQLite

**Current**: `timeouts.json` stores `Record<string, number>` — a flat map of key → timeout value. Keys are `"server:model"` or `"server:*"`.

**Problem**: Loses adaptation history. Only stores current value, not the EMA state, base timeout, or last update time. Related to F-TO-8 (persistence loses state across restarts).

**Proposed table**:

```sql
CREATE TABLE IF NOT EXISTS adaptive_timeouts (
  key              TEXT PRIMARY KEY,   -- "serverId:model" or "serverId:*"
  server_id        TEXT NOT NULL,
  model            TEXT,               -- NULL for server-wide timeouts
  base_timeout_ms  REAL NOT NULL,      -- initial configured timeout
  current_timeout  REAL NOT NULL,      -- current adapted value
  ema_latency      REAL,               -- EMA latency for adaptation
  sample_count     INTEGER DEFAULT 0,
  last_updated     INTEGER NOT NULL,   -- epoch ms
  created_at       INTEGER NOT NULL    -- epoch ms
);
CREATE INDEX idx_timeouts_server ON adaptive_timeouts(server_id);
```

**Retention**: Prune entries not updated in 30 days (stale server:model combos).

**Synergy with F-TO-8**: This table design directly addresses the persistence state loss finding — it stores the full `TimeoutState` (base + current + EMA + last_updated), not just the current value.

#### F-DB-3: Circuit Breaker State — Migrate to SQLite

**Current**: `circuit-breakers.json` stores serialized CB state per server:model. Debounced 30s writes via `CircuitBreakerPersistence`.

**Problem**: Entire file is rewritten on every save (even if only one CB changed). No history of state transitions.

**Proposed table**:

```sql
CREATE TABLE IF NOT EXISTS circuit_breaker_state (
  server_id         TEXT NOT NULL,
  model             TEXT NOT NULL,
  state             TEXT NOT NULL,       -- 'closed' | 'open' | 'half-open'
  failure_count     INTEGER DEFAULT 0,
  success_count     INTEGER DEFAULT 0,
  last_failure_at   INTEGER,             -- epoch ms
  last_success_at   INTEGER,             -- epoch ms
  opened_at         INTEGER,             -- epoch ms, when transitioned to open
  next_retry_at     INTEGER,             -- epoch ms, when to attempt half-open
  error_window      TEXT,                -- JSON array of recent error timestamps
  adaptive_threshold INTEGER,            -- current adaptive failure threshold
  updated_at        INTEGER NOT NULL,
  PRIMARY KEY (server_id, model)
);

-- Optional: state transition log for debugging/analytics
CREATE TABLE IF NOT EXISTS circuit_breaker_transitions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id     TEXT NOT NULL,
  model         TEXT NOT NULL,
  from_state    TEXT NOT NULL,
  to_state      TEXT NOT NULL,
  reason        TEXT,                    -- what triggered transition
  timestamp     INTEGER NOT NULL
);
CREATE INDEX idx_cb_transitions_ts ON circuit_breaker_transitions(timestamp);
CREATE INDEX idx_cb_transitions_server ON circuit_breaker_transitions(server_id, model, timestamp);
```

**Retention**: `circuit_breaker_state` — no expiry (active state). `circuit_breaker_transitions` — 30 days.

**Migration path**: Read existing `circuit-breakers.json` → upsert each into `circuit_breaker_state` → delete JSON file.

#### F-DB-4: Server Metrics Snapshot — Migrate to SQLite

**Current**: `metrics.json` stores `ServerModelMetrics` objects per server:model. Debounced 30s writes. 24h retention window.

**Problem**: Overlaps partially with `hourly_rollups` but serves a different purpose (hot operational metrics vs. historical aggregates). Full rewrite on every save.

**Proposed table**:

```sql
CREATE TABLE IF NOT EXISTS server_metrics_snapshot (
  server_id             TEXT NOT NULL,
  model                 TEXT NOT NULL,
  latency_avg           REAL,
  latency_p95           REAL,
  latency_p99           REAL,
  success_rate          REAL,
  throughput            REAL,
  tokens_per_second     REAL,
  ttft_avg              REAL,
  in_flight             INTEGER DEFAULT 0,
  total_requests        INTEGER DEFAULT 0,
  recent_errors         INTEGER DEFAULT 0,
  parameter_size        TEXT,              -- e.g. "8B", "70B"
  family                TEXT,              -- e.g. "llama", "mistral"
  quantization          TEXT,              -- e.g. "Q4_K_M"
  last_request_at       INTEGER,           -- epoch ms
  updated_at            INTEGER NOT NULL,
  PRIMARY KEY (server_id, model)
);
CREATE INDEX idx_metrics_snap_updated ON server_metrics_snapshot(updated_at);
```

**Retention**: Delete entries where `updated_at < now - 24h` (matches current JSON behavior).

**Migration path**: Read existing `metrics.json` → upsert each → delete JSON file.

#### F-DB-5: Recovery Failures — Migrate to SQLite

**Current**: `recovery-failures.json` stores failure tracking per server with timestamps, error types, and recovery attempt results. Debounced 30s writes, 7-day retention.

**Proposed table**:

```sql
CREATE TABLE IF NOT EXISTS recovery_failures (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id         TEXT NOT NULL,
  model             TEXT,
  error_type        TEXT NOT NULL,
  error_message     TEXT,
  phase             TEXT,                -- 'detection' | 'recovery_attempt' | 'post_recovery'
  recovery_attempted INTEGER DEFAULT 0,  -- boolean
  recovery_success  INTEGER,             -- boolean, NULL if not attempted
  latency_ms        REAL,
  timestamp         INTEGER NOT NULL
);
CREATE INDEX idx_recovery_server_ts ON recovery_failures(server_id, timestamp);
CREATE INDEX idx_recovery_ts ON recovery_failures(timestamp);
CREATE INDEX idx_recovery_error ON recovery_failures(error_type, timestamp);
```

**Retention**: 30 days (extended from current 7-day JSON retention — SQLite can handle the volume).

**Migration path**: Read existing `recovery-failures.json` → insert records → delete JSON file.

#### F-DB-6: Metrics Summary — Migrate to SQLite

**Current**: `metrics-summary.json` stores hourly metric snapshots for 30-day trend analysis. Written every hour by `AnalyticsEngine`.

**Problem**: Already conceptually similar to `hourly_rollups` but stored separately as JSON. Contains per-server snapshots including healthy count, model count, and top-level stats.

**Proposed table**:

```sql
CREATE TABLE IF NOT EXISTS metrics_summary (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp           INTEGER NOT NULL,
  total_servers       INTEGER,
  healthy_servers     INTEGER,
  total_models        INTEGER,
  total_requests_1h   INTEGER,
  avg_latency_ms      REAL,
  overall_success_rate REAL,
  total_in_flight     INTEGER,
  snapshot_data       TEXT,               -- JSON blob for detailed per-server breakdown
  hour_of_day         INTEGER,
  day_of_week         INTEGER
);
CREATE INDEX idx_summary_ts ON metrics_summary(timestamp);
CREATE INDEX idx_summary_temporal ON metrics_summary(hour_of_day, day_of_week);
```

**Retention**: 90 days (extended from current 30-day JSON retention).

**Migration path**: Read existing `metrics-summary.json` → insert records → delete JSON file.

### Architecture Decisions

#### Extend `MetricsStore` or Create New Store?

**Recommendation: Create a new `OperationalStore`** (`src/storage/operational-store.ts`).

Rationale:

- `MetricsStore` is focused on request/decision analytics with batch-write patterns optimized for high-throughput event streams
- The new tables (bans, timeouts, CB state) are operational state with different access patterns: low-volume writes, frequent reads, upsert-heavy
- Separate stores allow independent testing, independent connection pools if needed, and clearer ownership boundaries
- Both stores share the same database file but manage different table sets

```typescript
// src/storage/operational-store.ts
export class OperationalStore {
  constructor(dbPath?: string); // defaults to same ./data/metrics.db

  // Bans
  addBan(serverId: string, model: string, reason?: string): void;
  removeBan(serverId: string, model: string): void;
  getActiveBans(): Array<{ serverId: string; model: string; bannedAt: number }>;
  removeServerBans(serverId: string): void;
  getBanHistory(serverId?: string, since?: number): BanRecord[];

  // Adaptive Timeouts
  saveTimeout(key: string, state: TimeoutState): void;
  getTimeout(key: string): TimeoutState | undefined;
  getAllTimeouts(): Map<string, TimeoutState>;
  pruneStaleTimeouts(maxAgeDays: number): number;

  // Circuit Breaker State
  saveCircuitBreakerState(serverId: string, model: string, state: CBState): void;
  getCircuitBreakerState(serverId: string, model: string): CBState | undefined;
  getAllCircuitBreakerStates(): Map<string, CBState>;
  recordTransition(serverId: string, model: string, from: string, to: string, reason: string): void;
  getTransitions(serverId: string, model?: string, since?: number): CBTransition[];

  // Server Metrics Snapshot
  saveMetricsSnapshot(serverId: string, model: string, metrics: ServerModelMetrics): void;
  getMetricsSnapshot(serverId: string, model: string): ServerModelMetrics | undefined;
  getAllMetricsSnapshots(): Map<string, ServerModelMetrics>;
  pruneStaleSnapshots(maxAgeMs: number): number;

  // Recovery Failures
  recordFailure(serverId: string, model: string | undefined, failure: RecoveryFailure): void;
  getFailures(serverId?: string, since?: number): RecoveryFailureRecord[];
  getFailureStats(serverId: string): RecoveryStats;
  pruneOldFailures(maxAgeDays: number): number;

  // Metrics Summary
  recordSummary(snapshot: MetricsSummary): void;
  getSummaries(since?: number, until?: number): MetricsSummary[];
  getLatestSummary(): MetricsSummary | undefined;
  pruneOldSummaries(maxAgeDays: number): number;

  // Lifecycle
  close(): void;
}
```

#### Migration Strategy

1. **Schema migration**: Increment `PRAGMA user_version` from 1 → 2. Add new tables in `MIGRATIONS[2]`.
2. **Data migration**: On first startup after upgrade, detect existing JSON files → import → rename to `.json.bak`.
3. **Dual-read period**: Not needed — this is a one-shot migration. JSON files are small enough to import atomically.
4. **Rollback**: `.json.bak` files preserved for manual rollback if needed.

#### Write Pattern Changes

| Data Type         | Current Write Pattern                  | New Write Pattern                |
| ----------------- | -------------------------------------- | -------------------------------- |
| Bans              | Full rewrite on change                 | Individual INSERT/UPDATE         |
| Timeouts          | Full rewrite on change                 | Individual UPSERT                |
| CB State          | Full rewrite, debounced 30s            | Individual UPSERT, debounced 30s |
| Metrics Snapshot  | Full rewrite, debounced 30s            | Individual UPSERT, debounced 30s |
| Recovery Failures | Full rewrite, debounced 30s (if dirty) | Individual INSERT (append-only)  |
| Metrics Summary   | Full rewrite, hourly                   | Individual INSERT (append-only)  |

---

## Minimal Inference Probing System

### Problem Statement

With ~400 models available across ~60 servers, the load balancer needs performance data to make informed routing decisions. Without data, the balancer falls back to random/round-robin selection. Currently, data only accumulates from real user requests — servers or models that receive no traffic have no metrics.

**Goal**: Design a system that runs the **minimum number of inference requests** to ensure every server has enough data for proper load balancing, leveraging the existing cross-model inference fallback to avoid redundant probes.

### How Cross-Model Inference Currently Works

The system already has a fallback chain in `MetricsAggregator.getMetricsWithFallback()`:

| Priority | Source                      | Condition                                                   | Confidence                          |
| -------- | --------------------------- | ----------------------------------------------------------- | ----------------------------------- |
| 1        | **Direct data**             | Exact server:model metrics with ≥5 samples                  | 100%                                |
| 2        | **Blended**                 | Direct data <5 samples + parameter-size fallback available  | Proportional                        |
| 3        | **Parameter-size fallback** | No direct data, but same-size model metrics exist on server | 50% (configurable `fallbackWeight`) |
| 4        | **No data**                 | Nothing available for this server                           | Random selection                    |

**Key insight**: Similarity is determined **solely by `parameterSize`** (e.g., "8B", "70B"). The `family` field (llama, mistral, etc.) is stored but **not used** for fallback scoring.

This means: if a server has good metrics for `llama3:8b`, those metrics automatically apply (at 50% confidence) to `qwen2:8b`, `gemma2:9b`, and every other ~8B model on that server.

### Minimum Probe Set Algorithm

#### Definitions

- **S** = set of all servers (|S| ≈ 60)
- **M** = set of all models (|M| ≈ 400)
- **M(s)** = models available on server s
- **P(m)** = parameter size of model m (e.g., "8B")
- **P(s)** = unique parameter sizes across all models on server s = { P(m) | m ∈ M(s) }

#### The Coverage Requirement

For every server **s**, we need at least one model probed per unique parameter size on that server. This ensures cross-model inference can provide fallback scores for all other models of the same size.

```
∀s ∈ S, ∀p ∈ P(s): ∃ at least one model m ∈ M(s) where P(m) = p that has been probed on s
```

#### Minimum Probe Count

```
Total probes = Σ(s ∈ S) |P(s)|
```

**Example with typical distribution:**

| Parameter Size | Servers with this size | Representative models                      |
| -------------- | ---------------------- | ------------------------------------------ |
| 1B-3B          | ~40 servers            | qwen2:1.5b, llama3.2:3b, phi-3:3.8b        |
| 7B-8B          | ~55 servers            | llama3:8b, qwen2:7b, mistral:7b, gemma2:9b |
| 13B-14B        | ~30 servers            | llama2:13b, qwen2:14b                      |
| 32B-34B        | ~15 servers            | qwen2.5:32b, codellama:34b                 |
| 70B-72B        | ~10 servers            | llama3:70b, qwen2:72b                      |
| 405B+          | ~3 servers             | llama3.1:405b                              |

**Estimated minimum probes**: ~40 + 55 + 30 + 15 + 10 + 3 = **~153 probes** (instead of 400 × 60 = 24,000 naïve approach)

With ~400 models across 60 servers, if the average server has ~5-7 unique parameter sizes, total probes ≈ **300-420**.

#### Model Selection Per Size Class (Greedy Optimization)

When multiple models share the same parameter size on a server, choose the probe target using:

1. **Already-loaded model** → Probe costs no cold-start time (check via `/api/ps`)
2. **Most common model across fleet** → Maximizes reuse of probe data if we cross-reference
3. **Smallest quantization** → Fastest inference, least VRAM impact
4. **Shortest context** → Fastest response time for probe

### Probing System Design

#### Architecture

```
┌──────────────────────────────────────────────────────┐
│                  InferenceProbeScheduler               │
│──────────────────────────────────────────────────────│
│                                                       │
│  ┌─────────────────┐    ┌──────────────────────────┐ │
│  │ Coverage Analyzer│    │  Probe Queue              │ │
│  │                  │    │  (priority-ordered)       │ │
│  │  Builds minimum  │───►│                          │ │
│  │  probe set from  │    │  [server, model, size,   │ │
│  │  model map +     │    │   priority, state]       │ │
│  │  existing metrics│    │                          │ │
│  └─────────────────┘    └──────────┬───────────────┘ │
│                                    │                   │
│                          ┌─────────▼──────────┐       │
│                          │  Probe Executor     │       │
│                          │                     │       │
│                          │  Sends minimal     │       │
│                          │  inference request  │       │
│                          │  Records metrics    │       │
│                          └─────────────────────┘       │
└──────────────────────────────────────────────────────┘
```

#### Coverage Analyzer Algorithm

```typescript
interface ProbeTarget {
  serverId: string;
  model: string;
  parameterSize: string;
  priority: 'critical' | 'normal' | 'low';
  reason: string;
}

function computeMinimumProbeSet(
  modelMap: Record<string, string[]>, // model -> serverIds
  serverModels: Record<string, string[]>, // serverId -> models
  metricsAgg: MetricsAggregator,
  runningModels: Record<string, string[]> // serverId -> currently loaded models
): ProbeTarget[] {
  const probes: ProbeTarget[] = [];

  for (const [serverId, models] of Object.entries(serverModels)) {
    // Group models by parameter size
    const sizeGroups: Map<string, string[]> = groupByParameterSize(models);

    for (const [paramSize, modelsInGroup] of sizeGroups) {
      // Check: does this server already have ANY metrics for this size class?
      const hasData = modelsInGroup.some(m => {
        const metrics = metricsAgg.getMetrics(serverId, m);
        return metrics && metrics.totalRequests >= 5; // minSamplesForExact
      });

      if (hasData) continue; // Already covered — skip

      // Select best probe target from this group
      const target = selectProbeTarget(serverId, modelsInGroup, runningModels[serverId] ?? []);

      probes.push({
        serverId,
        model: target,
        parameterSize: paramSize,
        priority: determinePriority(serverId, paramSize, modelsInGroup.length),
        reason: `No data for ${paramSize} class on ${serverId} (${modelsInGroup.length} models covered)`,
      });
    }
  }

  return probes;
}

function selectProbeTarget(serverId: string, candidates: string[], loadedModels: string[]): string {
  // Prefer already-loaded model (no cold start penalty)
  const loaded = candidates.find(m => loadedModels.includes(m));
  if (loaded) return loaded;

  // Otherwise pick the most common model across fleet (arbitrary tiebreak)
  return candidates[0];
}

function determinePriority(
  serverId: string,
  paramSize: string,
  coveredModelCount: number
): 'critical' | 'normal' | 'low' {
  // Critical: this size class has many models (high impact of bad routing)
  if (coveredModelCount >= 10) return 'critical';
  // Normal: moderate coverage gap
  if (coveredModelCount >= 3) return 'normal';
  // Low: only 1-2 models in this size class
  return 'low';
}
```

#### Probe Execution

Each probe is a minimal inference request designed to measure server performance characteristics without wasting resources:

```typescript
interface ProbeRequest {
  model: string;
  prompt: string; // Short, deterministic prompt
  options: {
    num_predict: 10; // Generate only 10 tokens
    temperature: 0; // Deterministic (no wasted compute on sampling)
  };
}

// Probe prompt: short enough to be fast, long enough to measure latency
const PROBE_PROMPT = 'Count from 1 to 10:';
```

**What we measure from each probe:**

- **Latency** (total duration, including cold start if applicable)
- **TTFT** (time to first token — measures model load + prompt processing)
- **Tokens per second** (throughput indicator)
- **Cold start detection** (was model already loaded?)
- **Success/failure** (server health indicator)

These metrics flow through the existing `RequestContext` → `request-history.ts` → `MetricsStore.recordRequest()` pipeline. No new recording infrastructure needed.

#### Scheduling Strategy

```typescript
interface ProbeSchedulerConfig {
  enabled: boolean; // default: true
  intervalMs: number; // default: 3600000 (1 hour) — recheck coverage
  maxConcurrentProbes: number; // default: 2 — don't overwhelm servers
  maxProbesPerServer: number; // default: 1 — one at a time per server
  probeTimeoutMs: number; // default: 30000 (30s)
  cooldownAfterUserRequestMs: number; // default: 300000 (5min) — don't probe busy servers
  minSamplesForCoverage: number; // default: 5 — match crossModelInference.minSamplesForExact
  onlyDuringLowTraffic: boolean; // default: true — defer probes when servers are busy
  lowTrafficThreshold: number; // default: 0.3 — probe when server load < 30%
}
```

**Scheduling rules:**

1. **On startup**: Compute full probe set, execute critical probes first
2. **Hourly**: Recompute coverage gaps (new models may appear, metrics may expire)
3. **On server add**: Immediately compute probe set for new server
4. **On model discovery**: When `/api/tags` reveals a new model, check if its size class needs a probe
5. **Backoff**: If a probe fails, exponential backoff (reuse existing `recovery-backoff.ts` logic)
6. **Throttle**: Max 2 concurrent probes globally, max 1 per server
7. **Defer during traffic**: Skip probes for servers currently handling user requests (check in-flight count)

#### Integration Points

| Component              | Integration                           | Purpose                                                    |
| ---------------------- | ------------------------------------- | ---------------------------------------------------------- |
| `HealthCheckScheduler` | After `/api/tags` + `/api/ps` results | Trigger coverage re-evaluation when model list changes     |
| `MetricsAggregator`    | Read existing metrics                 | Determine which server:size combinations already have data |
| `ModelManager`         | Read `/api/ps` results                | Prefer probing already-loaded models (no cold start)       |
| `InFlightManager`      | Read current load                     | Defer probes for busy servers                              |
| `RecoveryBackoff`      | Reuse backoff logic                   | Exponential backoff on probe failures                      |
| `RequestHistory`       | Record probe results                  | Probe metrics flow through standard recording pipeline     |
| `LoadBalancer`         | Immediate benefit                     | Better routing decisions from first hour of operation      |

#### Probe Results Flow

Probe results follow the **exact same path** as user requests:

```
InferenceProbeScheduler
  → orchestrator.handleGenerate() [or direct fetch]
    → request-history.recordRequest()
      → MetricsStore.recordRequest()
        → requests table
          → hourly_rollups (next hour)
            → temporal_profiles (next rebuild)
```

The only addition: mark probe requests with a flag (e.g., `is_probe: true` column in `requests` table) so:

- Analytics can distinguish probe traffic from real traffic
- Probe requests are excluded from user-facing analytics
- Probe requests still count toward load balancer metrics (that's the whole point)

### Findings

#### F-PR-1: No Proactive Probe System Exists

**Severity**: High | **Effort**: High | **Category**: Feature Gap

The system has no mechanism to proactively gather performance data. New servers or infrequently-used models have zero metrics, forcing the load balancer into blind selection. The cross-model inference fallback mitigates this partially, but only when at least one model per size class per server has data — which is not guaranteed.

**Solution**: Implement `InferenceProbeScheduler` as described above.

#### F-PR-2: No `is_probe` Discrimination in Request Data

**Severity**: Medium | **Effort**: Low | **Category**: Feature Gap

The `requests` table has no way to distinguish probe traffic from user traffic. Probe requests would inflate analytics (total request counts, error rates) and pollute user-facing dashboards.

**Solution**: Add `is_probe INTEGER DEFAULT 0` column to `requests` table. Filter `WHERE is_probe = 0` in analytics queries. Include probe data in load balancer metric calculations.

#### F-PR-3: Model Parameter Size Not Always Available

**Severity**: Medium | **Effort**: Medium | **Category**: Data Gap

The cross-model inference system depends on `parameterSize` being set on `ServerModelMetrics`, but this field comes from Ollama's `/api/show` endpoint which is **not called for every model**. The `updateServerStatus()` method calls `/api/tags` (which returns model names and sizes in bytes) but doesn't always parse parameter size from the model details.

**Solution**: Ensure `parameterSize` is extracted from `/api/tags` response (the `details.parameter_size` field) or computed from `size` bytes during model discovery. Fall back to name-based heuristics (e.g., `llama3:8b` → "8B") when API data is unavailable.

#### F-PR-4: `family` Field Unused for Inference Grouping

**Severity**: Low | **Effort**: Medium | **Category**: Enhancement

The `family` field (e.g., "llama", "mistral") is stored on `ServerModelMetrics` but not used for cross-model inference. Two architecturally different 8B models (llama vs. phi) are treated as equivalent for fallback purposes. In practice this is acceptable — same-size models on the same hardware tend to have similar throughput characteristics — but could be refined.

**Solution**: Consider adding `family` as a secondary grouping dimension in a future iteration. For now, parameter-size grouping is sufficient and keeps the probe count minimal.

---

## Findings Summary Matrix

### Active Testing (F-AT-\*)

| ID         | Title                                         | Category   | Severity | Effort |
| ---------- | --------------------------------------------- | ---------- | -------- | ------ |
| **F-AT-1** | Schema/Config `halfOpenTimeout` mismatch      | Bug        | High     | Low    |
| **F-AT-2** | `activeTestTimeout` missing from Zod schema   | Gap        | Medium   | Low    |
| **F-AT-3** | `RecoveryTestConfig` has no schema validation | Gap        | Medium   | Medium |
| **F-AT-5** | Dead code in `runActiveTestsForServer`        | Bug        | Medium   | Low    |
| **F-AT-6** | Test invalidation adds duplicate result       | Bug        | Low      | Low    |
| **F-AT-7** | `maxHalfOpenPerServer` hardcoded              | Gap        | Low      | Low    |
| **F-AT-9** | `performRecoveryTest` no error handling       | Bug        | Low      | Low    |
| **F-AT-4** | Duplicate concurrency guards                  | Redundancy | Info     | None   |
| **F-AT-8** | RecoveryTestCoordinator test coverage         | Coverage   | High     | High   |

### Adaptive Timeouts (F-TO-\*)

| ID         | Title                                             | Category  | Severity | Effort |
| ---------- | ------------------------------------------------- | --------- | -------- | ------ |
| **F-TO-1** | `defaultTimeout` from wrong config                | Design    | Medium   | Low    |
| **F-TO-2** | Dead `consecutiveFailures`/`consecutiveSuccesses` | Dead Code | Low      | Low    |
| **F-TO-3** | Double timeout adaptation on active test success  | Bug       | High     | Low    |
| **F-TO-4** | One-way timeout ratchet (never shrinks)           | Design    | Medium   | Medium |
| **F-TO-5** | `recordFailure` no-op for unknown keys            | Bug       | Medium   | Low    |
| **F-TO-6** | Timeout score feedback loop                       | Design    | Low      | Low\*  |
| **F-TO-7** | Dead `calculateAdaptiveTimeout` helper            | Dead Code | Low      | Low    |
| **F-TO-8** | Persistence loses state across restarts           | Design    | Medium   | Medium |

\* F-TO-6 is implicitly fixed by F-TO-4.

### Config/Schema Cohesion (F-CS-\*)

| ID         | Title                                               | Category | Severity | Effort |
| ---------- | --------------------------------------------------- | -------- | -------- | ------ |
| **F-CS-1** | `rateLimitWindowMs` 15× default mismatch            | Bug      | High     | Low    |
| **F-CS-2** | `tags.cacheTtlMs` 10× default mismatch              | Bug      | Medium   | Low    |
| **F-CS-3** | `corsOrigins` default mismatch (`['*']` vs `[]`)    | Bug      | Medium   | Low    |
| **F-CS-4** | Streaming config missing 4 fields from schema       | Gap      | Medium   | Low    |
| **F-CS-5** | CB `backoff` config missing from schema             | Gap      | Medium   | Low    |
| **F-CS-6** | `storage` + `contextLimitTtlMs` missing from schema | Gap      | Medium   | Medium |

### Cross-Subsystem Integration (F-INT-\*)

| ID          | Title                                             | Category | Severity | Effort |
| ----------- | ------------------------------------------------- | -------- | -------- | ------ |
| **F-INT-1** | Server removal doesn't clean up ban/timeout state | Bug      | High     | Low    |
| **F-INT-2** | Config hot-reload only propagates to 3/7+ systems | Bug      | High     | Medium |
| **F-INT-3** | Ban manager ↔ circuit breaker isolation           | Design   | Medium   | Medium |
| **F-INT-4** | Metrics reset doesn't invalidate temporal cache   | Bug      | Medium   | Low    |
| **F-INT-5** | `getServers` callback returns live reference      | Bug      | Low      | Low    |
| **F-INT-6** | Health check and active test scheduling overlap   | Design   | Low      | Low    |
| **F-INT-7** | Model manager server registration never wired     | Gap      | Low      | Low    |

### Error Handling (F-EH-\*)

| ID         | Title                                         | Category | Severity | Effort |
| ---------- | --------------------------------------------- | -------- | -------- | ------ |
| **F-EH-1** | Persistence layer swallows all errors         | Bug      | High     | Medium |
| **F-EH-2** | Error context discarded via `'Unknown error'` | Bug      | Medium   | Low    |
| **F-EH-3** | Health probe failures at debug level only     | Design   | Medium   | Low    |
| **F-EH-4** | Shutdown promise not error-handled            | Bug      | Low      | Low    |
| **F-EH-5** | Streaming cleanup errors at debug level       | Design   | Low      | Low    |

### Dead Code (F-DC-\*)

| ID         | Title                                           | Category  | Severity | Effort |
| ---------- | ----------------------------------------------- | --------- | -------- | ------ |
| **F-DC-1** | `domain-errors.ts` entire file is dead code     | Dead Code | Medium   | Low    |
| **F-DC-2** | Six `*WithFlag` wrapper functions never called  | Dead Code | Low      | Low    |
| **F-DC-3** | Three feature flags never checked in production | Dead Code | Low      | Low    |
| **F-DC-4** | Utility functions only used in tests            | Dead Code | Low      | Low    |
| **F-DC-5** | `parseRetryAfterMs` never imported anywhere     | Dead Code | Low      | Low    |
| **F-DC-6** | Error classifier convenience fns — tests only   | Dead Code | Low      | Low    |

### Type Safety (F-TS-\*)

| ID         | Title                                        | Category    | Severity | Effort |
| ---------- | -------------------------------------------- | ----------- | -------- | ------ |
| **F-TS-1** | `as any` casts for CircuitBreaker properties | Type Gap    | Medium   | Medium |
| **F-TS-2** | Non-null assertions on `Map.get()`           | Type Safety | Medium   | Low    |
| **F-TS-3** | `as any` for AbortSignal compatibility       | Type Gap    | Low      | Medium |
| **F-TS-4** | Detached promise in stall handler            | Bug         | Medium   | Low    |
| **F-TS-5** | Dynamic property access via `as any`         | Type Gap    | Low      | Low    |
| **F-TS-6** | `as unknown` casts in stream handoff         | Type Gap    | Low      | Low    |

### SQLite Migration (F-DB-\*)

| ID         | Title                                           | Category  | Severity | Effort |
| ---------- | ----------------------------------------------- | --------- | -------- | ------ |
| **F-DB-1** | Bans persisted as JSON flat array               | Migration | High     | Medium |
| **F-DB-2** | Adaptive timeouts lose state on restart         | Migration | High     | Medium |
| **F-DB-3** | Circuit breaker state full-file rewrite on save | Migration | High     | Medium |
| **F-DB-4** | Server metrics snapshot full-file rewrite       | Migration | Medium   | Medium |
| **F-DB-5** | Recovery failures persisted as JSON             | Migration | Medium   | Medium |
| **F-DB-6** | Metrics summary persisted as JSON               | Migration | Medium   | Medium |

### Inference Probing (F-PR-\*)

| ID         | Title                                        | Category    | Severity | Effort |
| ---------- | -------------------------------------------- | ----------- | -------- | ------ |
| **F-PR-1** | No proactive probe system exists             | Feature Gap | High     | High   |
| **F-PR-2** | No `is_probe` discrimination in request data | Feature Gap | Medium   | Low    |
| **F-PR-3** | Model parameter size not always available    | Data Gap    | Medium   | Medium |
| **F-PR-4** | `family` field unused for inference grouping | Enhancement | Low      | Medium |

### Anthropic Compatibility (F-AC-\*)

| ID          | Title                                         | Category | Severity | Effort |
| ----------- | --------------------------------------------- | -------- | -------- | ------ |
| **F-AC-1**  | No Anthropic capability flag on AIServer      | Gap      | High     | Low    |
| **F-AC-2**  | No Anthropic model discovery mechanism        | Gap      | Medium   | Medium |
| **F-AC-3**  | No Anthropic streaming translator             | Gap      | High     | High   |
| **F-AC-4**  | No Anthropic request validation schema        | Gap      | Medium   | Medium |
| **F-AC-5**  | No Anthropic error format                     | Gap      | Medium   | Medium |
| **F-AC-6**  | No `anthropic-version` header handling        | Gap      | Low      | Low    |
| **F-AC-7**  | Anthropic SDK strict SSE event ordering       | Risk     | High     | High   |
| **F-AC-8**  | No support for Anthropic-only features        | Design   | Medium   | Medium |
| **F-AC-9**  | Ollama `stream: true` + `tools` not supported | Gap      | Medium   | High   |
| **F-AC-10** | Config schema — no Anthropic section          | Gap      | Medium   | Low    |

---

## Recommended Remediation Order

Based on severity, dependency relationships, and effort:

### Wave 1 — Critical Bugs & Schema Alignment (Low effort, high impact)

| Task | Finding                        | Description                                                            |
| ---- | ------------------------------ | ---------------------------------------------------------------------- |
| 1.1  | F-AT-1, F-CS-1, F-CS-2, F-CS-3 | Align ALL Zod schema defaults to match DEFAULT_CONFIG                  |
| 1.2  | F-AT-2, F-CS-4, F-CS-5         | Add missing fields to existing Zod schemas                             |
| 1.3  | F-TO-3                         | Remove duplicate `updateFromResponseTime` call                         |
| 1.4  | F-TO-5                         | Create default state in `recordFailure` for unknown keys               |
| 1.5  | F-INT-1                        | Call `banManager.removeServerBans()` + add cleanup in `removeServer()` |
| 1.6  | F-AT-5                         | Remove unreachable dead code in `runActiveTestsForServer`              |
| 1.7  | F-AT-6                         | Fix duplicate result on test invalidation                              |
| 1.8  | F-EH-2                         | Preserve error context instead of `'Unknown error'`                    |

### Wave 2 — Config Gaps & Integration Wiring (Medium effort)

| Task | Finding        | Description                                                                                 |
| ---- | -------------- | ------------------------------------------------------------------------------------------- |
| 2.1  | F-AT-3, F-CS-6 | Create `recoveryTestConfigSchema`, `storageConfigSchema`, wire into config                  |
| 2.2  | F-INT-2        | Wire `MetricsAggregator.setDecayConfig()` and `TemporalScorer.updateConfig()` to hot-reload |
| 2.3  | F-TO-1         | Initialize `defaultTimeout` from `requestTimeoutMs`                                         |
| 2.4  | F-INT-4        | Invalidate temporal cache on metrics reset                                                  |
| 2.5  | F-AT-7         | Make `maxHalfOpenPerServer` configurable                                                    |
| 2.6  | F-AT-9         | Add error handling to `performRecoveryTest`                                                 |
| 2.7  | F-EH-1         | Make persistence errors propagate instead of returning empty                                |

### Wave 3 — Dead Code Cleanup (Low effort)

| Task | Finding                | Description                                              |
| ---- | ---------------------- | -------------------------------------------------------- |
| 3.1  | F-TO-2                 | Remove dead `consecutiveFailures`/`consecutiveSuccesses` |
| 3.2  | F-TO-7                 | Remove dead `calculateAdaptiveTimeout` helper            |
| 3.3  | F-DC-1                 | Remove or wire `domain-errors.ts`                        |
| 3.4  | F-DC-2, F-DC-3         | Remove `*WithFlag` wrappers and unused feature flags     |
| 3.5  | F-DC-4, F-DC-5, F-DC-6 | Remove test-only functions from production code          |

### Wave 4 — Design Improvements (Medium-high effort)

| Task | Finding | Description                                                              |
| ---- | ------- | ------------------------------------------------------------------------ |
| 4.1  | F-TO-4  | Implement timeout decay mechanism (fixes F-TO-6 implicitly)              |
| 4.2  | F-TO-8  | Persist full `TimeoutState` (baseTimeout + currentTimeout + lastUpdated) |
| 4.3  | F-INT-3 | Document ban↔CB intentional isolation or add event notification          |
| 4.4  | F-TS-1  | Add proper type definitions for CircuitBreaker properties                |
| 4.5  | F-TS-2  | Replace non-null assertions with proper undefined checks                 |
| 4.6  | F-TS-4  | Fix detached promise in stall handler                                    |
| 4.7  | F-AT-4  | Document intentional concurrency guard layering                          |

### Wave 5 — Error Handling & Low-Priority Polish (Medium effort)

| Task | Finding                | Description                                                     |
| ---- | ---------------------- | --------------------------------------------------------------- |
| 5.1  | F-EH-3, F-EH-5         | Elevate debug-level error logs to warn                          |
| 5.2  | F-EH-4                 | Add `.catch()` to shutdown promise                              |
| 5.3  | F-INT-5                | Return defensive copy from server callback                      |
| 5.4  | F-INT-7                | Wire `modelManager.registerServer()` / `unregisterServer()`     |
| 5.5  | F-TS-3, F-TS-5, F-TS-6 | Type safety improvements (AbortSignal wrapper, property access) |

### Wave 6 — Test Coverage (High effort)

| Task | Finding | Description                                                  |
| ---- | ------- | ------------------------------------------------------------ |
| 6.1  | F-AT-8  | Comprehensive tests for `RecoveryTestCoordinator` core paths |

### Wave 7 — SQLite Migration: OperationalStore (High effort)

Depends on Wave 1 (schema alignment) and Wave 2 (config wiring). Must be completed before Wave 8.

| Task | Finding        | Description                                                                              |
| ---- | -------------- | ---------------------------------------------------------------------------------------- |
| 7.1  | Infrastructure | Create `OperationalStore` class (`src/storage/operational-store.ts`) with shared DB conn |
| 7.2  | Infrastructure | Add schema migration v2 with 8 new tables in `src/storage/schema.ts`                     |
| 7.3  | F-DB-1         | Migrate bans: new `bans` table, update `BanManager` to use `OperationalStore`            |
| 7.4  | F-DB-2, F-TO-8 | Migrate adaptive timeouts: new `adaptive_timeouts` table, persist full `TimeoutState`    |
| 7.5  | F-DB-3         | Migrate CB state: new `circuit_breaker_state` + `circuit_breaker_transitions` tables     |
| 7.6  | F-DB-4         | Migrate server metrics snapshot: new `server_metrics_snapshot` table                     |
| 7.7  | F-DB-5         | Migrate recovery failures: new `recovery_failures` table                                 |
| 7.8  | F-DB-6         | Migrate metrics summary: new `metrics_summary` table                                     |
| 7.9  | Cleanup        | Remove `JsonFileHandler` usage from migrated paths, add JSON→SQLite auto-migration       |
| 7.10 | Testing        | Unit tests for `OperationalStore` CRUD operations and migration                          |

### Wave 8 — Inference Probing System (High effort)

Depends on Wave 7 (SQLite migration provides `is_probe` column and clean data layer).

| Task | Finding     | Description                                                                       |
| ---- | ----------- | --------------------------------------------------------------------------------- |
| 8.1  | F-PR-3      | Ensure `parameterSize` extraction from `/api/tags` + name heuristic fallback      |
| 8.2  | F-PR-2      | Add `is_probe` column to `requests` table, update analytics queries to filter     |
| 8.3  | F-PR-1      | Implement `InferenceProbeScheduler` — coverage analyzer + probe queue             |
| 8.4  | F-PR-1      | Implement probe executor — minimal inference requests via orchestrator pipeline   |
| 8.5  | F-PR-1      | Implement scheduling — startup probing, hourly re-evaluation, server-add triggers |
| 8.6  | F-PR-1      | Add `probeScheduler` config section to schema + DEFAULT_CONFIG                    |
| 8.7  | Integration | Wire probe scheduler into orchestrator lifecycle (startup, shutdown, config)      |
| 8.8  | Testing     | Unit tests for coverage analyzer algorithm + probe scheduling logic               |

### Wave 9 — Anthropic API Compatibility (High effort)

Independent of Waves 1-8. Adds Anthropic Messages API as third first-class backend type.

| Task | Finding                | Description                                                                                     |
| ---- | ---------------------- | ----------------------------------------------------------------------------------------------- |
| 9.1  | F-AC-1, F-AC-10        | Add `supportsAnthropic` + `anthropicModels` to `AIServer`, add Anthropic config schema          |
| 9.2  | F-AC-1, F-AC-2         | Add `POST /v1/messages` health check probe + model discovery                                    |
| 9.3  | All                    | Create `anthropic-controller.ts` + `anthropic.routes.ts` for `POST /v1/messages`                |
| 9.4  | All                    | Build `AnthropicToOllamaTranslator` + `AnthropicToOpenAITranslator` request translators         |
| 9.5  | F-AC-3, F-AC-7, F-AC-9 | Build `anthropic-stream-translator.ts` — Ollama NDJSON → Anthropic SSE state machine            |
| 9.6  | All                    | Build reverse translators (`OllamaToAnthropic`, `OpenAIToAnthropic`) for Ollama/OpenAI backends |
| 9.7  | All                    | Integration tests for all translation paths + SSE event ordering verification                   |

---

# Anthropic Messages API Compatibility — Architecture Analysis

> **Date**: 2026-04-03
> **Branch**: `phase2/metrics-rollups`
> **Status**: Analysis complete — architecture designed, implementation plan pending approval

## Table of Contents

1. [Executive Summary](#anthropic-executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Capability Detection](#capability-detection)
4. [Request Translation Matrix](#request-translation-matrix)
5. [Response Translation Matrix](#response-translation-matrix)
6. [Streaming Translation](#streaming-translation)
7. [Model Mapping](#model-mapping)
8. [Authentication](#authentication)
9. [Findings (F-AC-\*)](#findings-f-ac-)
10. [Implementation Plan — Wave 9](#wave-9--anthropic-api-compatibility)
11. [Escalation Path](#escalation-path)

---

## Anthropic Executive Summary

The orchestrator currently supports two backend API surfaces (Ollama native `/api/*` and OpenAI-compatible `/v1/*`). The goal is to add Anthropic Messages API (`POST /v1/messages`) as a **third first-class backend type**, alongside Ollama and OpenAI, with **translation at the response boundary** — not at the request boundary.

**Core principle — Direct Proxy + End-Translation**:

- Servers are configured by their native API type (`ollama`, `openai`, `anthropic`)
- Incoming requests are routed to a compatible backend
- If the backend's native format matches the request format → passthrough
- If the backend's native format differs → translate the request to the backend's format, then translate the response back to the client's format
- Translation is **at the edge** (request in, response out), not in the routing layer

**Key architecture decisions**:

- Add `supportsAnthropic?: boolean` to `AIServer` type (mirrors `supportsOllama`, `supportsV1`)
- Detect Anthropic capability via `POST /v1/messages` probe (returns `400 missing required parameter` on success — Anthropic returns errors for missing `max_tokens` even on valid servers)
- Add `anthropicModels?: string[]` to `AIServer` (mirrors `v1Models`)
- Build `src/controllers/anthropic-controller.ts` for `/v1/messages` endpoints
- Build `src/streaming/anthropic-stream-translator.ts` for Ollama NDJSON → Anthropic SSE event translation
- Add explicit `anthropicModels` alias map in config for model name resolution
- Auth: accept both `x-api-key` and `Authorization: Bearer` on Anthropic routes

**Effort estimate**: Medium (1-2 days), 4-5 commits

---

## Architecture Overview

### Three Backend Types, Three API Surfaces

```
Client Request                    Backend Server (by native type)
─────────────────                 ──────────────────────────────────────────────

Anthropic (/v1/messages)    →    Ollama backend       → translate request + response
                               →    OpenAI backend      → translate request + response
                               →    Anthropic backend   → passthrough

OpenAI (/v1/chat/completions) →    Ollama backend       → translate (existing)
                               →    OpenAI backend      → passthrough (existing)

Ollama (/api/chat)            →    Ollama backend       → passthrough
                               →    OpenAI backend       → translate (existing)
                               →    Anthropic backend   → translate request + response
```

### Routing Priority

When selecting a backend for an incoming request:

1. **Prefer native match**: Route to a backend whose native type matches the incoming API format
2. **Fall back to any compatible**: If no native backend is healthy, route to any backend that can speak the format (via translation)
3. **Failover**: Use `tryRequestWithFailover()` with the same 3-phase failover cycle

### Dual-Mode Streaming (Updated for 3 Backends)

```
Incoming Request Format     Native Backend?     Action
─────────────────────────────────────────────────────────────────────────
Anthropic SSE               Yes                 Passthrough SSE
Anthropic SSE               No (Ollama)         Ollama NDJSON → Anthropic SSE
Anthropic SSE               No (OpenAI)         OpenAI SSE → Anthropic SSE
OpenAI SSE                  Yes                 Passthrough SSE (existing)
OpenAI SSE                  No (Ollama)         Ollama NDJSON → OpenAI SSE (existing)
Ollama NDJSON               Yes                 Passthrough NDJSON
Ollama NDJSON               No (OpenAI)         OpenAI → Ollama translation
Ollama NDJSON               No (Anthropic)      Anthropic → Ollama translation
```

---

## Capability Detection

### Current Detection (Ollama + OpenAI)

```typescript
// AIServer type — existing fields
supportsOllama?: boolean;  // probed via GET /api/tags
supportsV1?: boolean;     // probed via GET /v1/models
v1Models?: string[];      // OpenAI-compatible model list
```

### New: Anthropic Detection

Anthropic's `POST /v1/messages` is the primary endpoint. Unlike OpenAI's `/v1/models`, there is no dedicated model listing endpoint. Detection strategies:

**Strategy A — `OPTIONS /v1/messages` probe**:

```typescript
// Send OPTIONS request to detect Anthropic endpoint
// Returns CORS headers + Allow: "POST, OPTIONS" on Anthropic servers
```

**Strategy B — Test `POST /v1/messages` with minimal request**:

```typescript
// Send { max_tokens: 1, messages: [] }
// Expect 400 with "Missing required parameter: messages" (valid server)
// Expect 404 (not an Anthropic server)
// Expect connection error (not reachable)
```

**Strategy C — Health check extension**:
Add `supportsAnthropic` probe in `health-check-scheduler.ts` using Strategy B. Use a cached "is this an Anthropic server" flag since it doesn't change at runtime.

### Proposed `AIServer` Type Extension

```typescript
// NEW fields in AIServer type (orchestrator.types.ts)
supportsAnthropic?: boolean;   // Whether server supports /v1/messages Anthropic endpoint
anthropicModels?: string[];   // Anthropic-compatible model list (if discoverable)
```

### Probe Schedule

| Endpoint       | Method | Probe Interval | Timeout | Capability Flag     |
| -------------- | ------ | -------------- | ------- | ------------------- |
| `/api/tags`    | GET    | 30s            | 5s      | `supportsOllama`    |
| `/v1/models`   | GET    | 30s            | 5s      | `supportsV1`        |
| `/v1/messages` | POST   | 60s            | 10s     | `supportsAnthropic` |

---

## Request Translation Matrix

### Anthropic → Ollama (for `/v1/messages` → Ollama backend)

| Anthropic Field      | Ollama Field                    | Notes                                          |
| -------------------- | ------------------------------- | ---------------------------------------------- |
| `model` (aliased)    | `model`                         | Via `anthropicModels` alias map                |
| `system` (top-level) | `messages[0]: {role: "system"}` | Prepend as first message                       |
| `messages[].role`    | `messages[].role`               | Map: `assistant`→`assistant`, `user`→`user`    |
| `messages[].content` | `messages[].content`            | Flatten content blocks to string               |
| `max_tokens`         | `options.num_predict`           | Required; cap at Ollama default if excessive   |
| `temperature`        | `options.temperature`           | —                                              |
| `top_p`              | `options.top_p`                 | —                                              |
| `top_k`              | `options.top_k`                 | Anthropic-only, pass through if supported      |
| `stop_sequences[]`   | `options.stop`                  | Array → comma-separated string                 |
| `stream: false`      | `stream: false`                 | —                                              |
| `stream: true`       | `stream: true`                  | Full streaming pipeline                        |
| `tools[].name`       | `tools[].function.name`         | Anthropic `input_schema` → Ollama `parameters` |
| `thinking.skip`      | —                               | **Unsupported**: return validation error       |
| `cache_control`      | —                               | **Unsupported**: return validation error       |

**Content block flattening**:

```typescript
// Anthropic content blocks → Ollama string
function flattenContent(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .map(block => {
      if (block.type === 'text') return block.text;
      if (block.type === 'image') return '[image]';
      if (block.type === 'tool_result') return `[tool: ${block.tool_use_id}]`;
      return '';
    })
    .join('\n');
}
```

### Anthropic → OpenAI (for `/v1/messages` → OpenAI backend)

| Anthropic Field      | OpenAI Field                    | Notes                                          |
| -------------------- | ------------------------------- | ---------------------------------------------- |
| `model`              | `model`                         | Pass through (may need alias)                  |
| `system` (top-level) | `messages[0]: {role: "system"}` | Prepend as first message                       |
| `messages[].content` | `messages[].content`            | Same flattening as above                       |
| `max_tokens`         | `max_tokens`                    | Required                                       |
| `temperature`        | `temperature`                   | —                                              |
| `top_p`              | `top_p`                         | —                                              |
| `tools[].name`       | `tools[].name`                  | `input_schema` → `parameters` (same structure) |
| `stop_sequences[]`   | `stop`                          | Anthropic array → OpenAI string/array          |
| `stream: true`       | `stream: true`                  | OpenAI SSE passthrough                         |

### Ollama → Anthropic (for `/api/chat` → Anthropic backend)

| Ollama Field              | Anthropic Field      | Notes                             |
| ------------------------- | -------------------- | --------------------------------- |
| `model`                   | `model`              | Via `anthropicModels` reverse map |
| `messages[0].role=system` | `system` (top-level) | Extract from messages             |
| `messages[].content`      | `messages[].content` | String → text content block       |
| `options.num_predict`     | `max_tokens`         | Required                          |
| `options.temperature`     | `temperature`        | —                                 |
| `options.top_p`           | `top_p`              | —                                 |
| `options.stop`            | `stop_sequences`     | String → array                    |

### OpenAI → Anthropic (for `/v1/chat/completions` → Anthropic backend)

| OpenAI Field  | Anthropic Field | Notes                                    |
| ------------- | --------------- | ---------------------------------------- |
| `model`       | `model`         | Pass through                             |
| `messages`    | `messages`      | String content → text blocks             |
| `max_tokens`  | `max_tokens`    | Required                                 |
| `temperature` | `temperature`   | —                                        |
| `tools`       | `tools`         | Schema compatible (both use JSON Schema) |

---

## Response Translation Matrix

### Ollama → Anthropic SSE (streaming)

```typescript
// Ollama NDJSON streaming chunks → Anthropic SSE events

// 1. First chunk (stream start)
{ message: { content: "" }, done: false }
  → event: message_start
    data: {"type":"message_start","message":{"id":"...","type":"message","role":"assistant","content":[],"model":"...","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}

  → event: content_block_start
    data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

// 2. Text delta chunks
{ message: { content: "Hello" }, done: false }
  → event: content_block_delta
    data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

// 3. Final chunk (stream end)
{ done: true, eval_count: 42, eval_duration: 123456789012, prompt_eval_count: 10 }
  → event: content_block_stop
    data: {"type":"content_block_stop","index":0}

  → event: message_delta
    data: {"type":"message_delta","delta":{"stop_sequence":null,"usage":{"output_tokens":42}},"usage":{"input_tokens":10,"output_tokens":42}}

  → event: message_stop
    data: {"type":"message_stop"}

// 4. Keepalive (periodic)
  → event: ping
    data: {"type":"ping"}
```

### OpenAI SSE → Anthropic SSE

```typescript
// OpenAI SSE → translate to Anthropic SSE events

// OpenAI: data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}
// Anthropic: event: content_block_delta, data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

// OpenAI: data: {"choices":[{"delta":{},"finish_reason":"stop"}]}
// Anthropic: event: content_block_stop + event: message_stop

// OpenAI: data: {"choices":[{"delta":{"tool_calls":[...]}}]}
// Anthropic: event: content_block_start (tool_use) + content_block_delta (input_json)
```

### Ollama → Anthropic (non-streaming)

```typescript
// Ollama final response → Anthropic response format
{
  id: `msg_${ulid()}`,
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: ollama.response }],
  model: ollama.model,
  stop_reason: mapStopReason(ollama.done_reason),
  stop_sequence: null,
  usage: {
    input_tokens: ollama.prompt_eval_count ?? 0,
    output_tokens: ollama.eval_count ?? 0,
  },
}
```

### Anthropic → Ollama (non-streaming)

```typescript
// Anthropic response → Ollama-compatible format (for passthrough to non-streaming clients)
{
  model: response.model,
  response: response.content[0]?.text ?? '',
  done: true,
  prompt_eval_count: response.usage?.input_tokens,
  eval_count: response.usage?.output_tokens,
}
```

---

## Streaming Translation

### Ollama NDJSON → Anthropic SSE (the core translation challenge)

Anthropic SSE uses **typed events** (`event:` prefix), while Ollama uses raw NDJSON lines. The translation must:

1. **Parse Ollama NDJSON** line-by-line (using existing `parseNDJSONStream` from `streaming.ts`)
2. **Emit Anthropic SSE events** in correct order:
   - `message_start` (once, before any content)
   - `content_block_start` (once per content block)
   - `content_block_delta` (for each text/tool delta)
   - `content_block_stop` (once per block)
   - `message_delta` (final usage + stop_reason)
   - `message_stop` (once, at end)
   - `ping` (periodic keepalive every ~10s)

### Event Ordering Invariants (Anthropic strictness)

Anthropic SDKs are strict about SSE event ordering. The translator must guarantee:

```
message_start
  → content_block_start (index: 0)
    → content_block_delta (may be many)
  → content_block_stop (index: 0)
  → [more blocks if tool_use]
→ message_delta (final)
→ message_stop
```

Any violation of this ordering will cause SDK errors. The translator needs a state machine to ensure correct event sequencing.

### Tool Calls Translation

If Ollama returns a tool call:

```json
{"message":{"content":"","tool_calls":[{"function":{"name":"get_weather","arguments":"{\"location\":\"Boston\"}"}}]}
```

Translate to Anthropic:

```
event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_...","name":"get_weather"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"location\":\"Boston\"}"}}
```

### Error Translation

Anthropic error events:

```
event: error
data: {"type":"error","error":{"type":"invalid_request_error","message":"..."}}
```

Must translate Ollama errors (HTTP status codes, NDJSON error format) to Anthropic error events:

- 401 → `authentication_error`
- 400 → `invalid_request_error`
- 429 → `rate_limit_error`
- 503 → `overloaded_error`
- Other → `server_error`

---

## Model Mapping

### Explicit Alias Map

Model names differ across providers. The orchestrator maintains an explicit mapping:

```typescript
// Config section (new)
interface AnthropicConfig {
  models: {
    aliases: Record<string, string>; // "claude-opus-4-6": "llama3:70b"
    reverseAliases: Record<string, string>; // "llama3:70b": "claude-opus-4-6"
  };
}
```

### Lookup Order

For an incoming request with model `claude-opus-4-6`:

1. Check `anthropicModels[model]` alias map → resolve to Ollama/OpenAI model name
2. If no alias, use model name as-is (for native Anthropic backends)
3. If resolved name not available on selected backend → `400 Unsupported model`

### Reverse Mapping (for Ollama → Anthropic responses)

When an Ollama backend is used for an Anthropic request, the `model` field in the Anthropic response should reflect the **client-facing** Anthropic model name, not the resolved Ollama model name.

```typescript
// Outbound response model
const responseModel = reverseAliasMap[ollamaModel] ?? ollamaModel;
```

### No Heuristic Detection

Do **not** use prefix matching like `claude-*` → assume Anthropic. This creates operational debt at fleet scale. Only explicit aliases are acceptable.

---

## Authentication

### Anthropic-Specific Headers

| Header              | Value          | Notes                             |
| ------------------- | -------------- | --------------------------------- |
| `x-api-key`         | API key        | Primary Anthropic auth header     |
| `Authorization`     | `Bearer <key>` | Also accepted (SDK compatibility) |
| `anthropic-version` | `2023-06-01`   | Required on all requests          |

### Proposed Auth Middleware Changes

```typescript
// src/middleware/auth.ts — update for Anthropic routes

// On /v1/messages routes, accept both header styles:
function extractAnthropicKey(req: Request): string | undefined {
  return (
    (req.headers['x-api-key'] as string) ?? req.headers['authorization']?.replace('Bearer ', '')
  );
}

// Validate against configured keys (same as existing auth system)
```

### `anthropic-version` Header

Must be present and valid on all Anthropic requests. If missing → `400 missing required header: anthropic-version`.

---

## Findings (F-AC-\*)

### F-AC-1: No Anthropic Capability Flag on AIServer

**Severity**: High | **Category**: Gap | **Effort**: Low

The `AIServer` type in `orchestrator.types.ts` has `supportsOllama` and `supportsV1` but no `supportsAnthropic`. The health check scheduler has no probe for Anthropic endpoints.

**Fix**: Add `supportsAnthropic?: boolean` and `anthropicModels?: string[]` to `AIServer`. Add `POST /v1/messages` probe to `health-check-scheduler.ts`.

---

### F-AC-2: No Anthropic Model Discovery Mechanism

**Severity**: Medium | **Category**: Gap | **Effort**: Medium

OpenAI backends expose `/v1/models` for model discovery. Anthropic has no equivalent — `POST /v1/messages` is the only endpoint. Model lists for Anthropic backends must be configured explicitly or discovered out-of-band.

**Fix**: Add `anthropicModels` array to server config. Allow manual configuration or infer from backend response errors (attempt a minimal request and note which models are rejected).

---

### F-AC-3: No Anthropic Streaming Translator

**Severity**: High | **Category**: Gap | **Effort**: High

The most complex gap. Ollama NDJSON → Anthropic SSE translation requires a state machine that maintains correct event ordering (`message_start` → `content_block_start` → `content_block_delta*` → `content_block_stop` → `message_delta` → `message_stop`). This is substantially different from Ollama → OpenAI SSE translation.

**Fix**: Build `src/streaming/anthropic-stream-translator.ts` as a standalone translator class. Start with text-only streaming, add tool call support in a subsequent minor wave.

---

### F-AC-4: No Anthropic Request Validation Schema

**Severity**: Medium | **Category**: Gap | **Effort**: Medium

The existing `src/middleware/validation.ts` has Zod schemas for Ollama (`GenerateRequestBody`, `ChatRequestBody`) and OpenAI (`OpenAIChatRequest`, `OpenAICompletionRequest`) but no Anthropic schemas. Anthropic's `MessagesRequest` has specific requirements: `max_tokens` is required, `messages` is required and non-empty, `system` is optional but must be a string if present.

**Fix**: Add `AnthropicMessagesRequest` Zod schema to `validation.ts`. Validate `anthropic-version` header presence.

---

### F-AC-5: No Anthropic Error Format

**Severity**: Medium | **Category**: Gap | **Effort**: Medium

The existing error handler in `index.ts` returns OpenAI-format errors for `/v1` routes. Anthropic uses a different error format:

```typescript
// Anthropic error response
{
  type: "error",
  error: {
    type: "invalid_request_error", // | "authentication_error" | "rate_limit_error" | "overloaded_error" | "server_error"
    message: "Human-readable message"
  }
}
```

**Fix**: Add `isAnthropicError()` helper in `ollama-error.ts` or a new `anthropic-error.ts`. Update error handler to detect Anthropic routes and format errors accordingly.

---

### F-AC-6: No `anthropic-version` Header Handling

**Severity**: Low | **Category**: Gap | **Effort**: Low

The `anthropic-version: 2023-06-01` header is required on all Anthropic API requests but not currently validated or passed through to backends.

**Fix**: Add header validation in `anthropic-controller.ts`. Reject requests missing the header with `400 missing required header: anthropic-version`.

---

### F-AC-7: Anthropic SDK Strictness — SSE Event Ordering

**Severity**: High | **Category**: Risk | **Effort**: High

Anthropic SDKs are strict about SSE event ordering. The Ollama → Anthropic translator must guarantee: `message_start` before any content, `content_block_start` before `content_block_delta`, `message_delta` before `message_stop`. The existing streaming code has no concept of SSE event ordering — it just pipes NDJSON chunks.

**Fix**: Design the translator as a state machine with explicit event queue. Add integration tests that verify event ordering against the Anthropic SDK reference implementation. Do not attempt passthrough of raw Ollama NDJSON — translation is required.

---

### F-AC-8: No Support for Anthropic-Only Features

**Severity**: Medium | **Category**: Design | **Effort**: Medium

Extended thinking (`thinking.skip`, `thinking.type`, `thinking.budget_tokens`), prompt caching (`cache_control`), and citations are Anthropic-only features with no Ollama equivalent. Currently the design explicitly fails on these with validation errors, which is correct — but this should be documented and tested.

**Fix**: Add explicit validation in `anthropic-controller.ts` for unsupported fields. Add tests that verify these return `400 unsupported_field: thinking`. Document the limitation clearly.

---

### F-AC-9: Ollama `stream: true` + `tools` Not Supported

**Severity**: Medium | **Category**: Gap | **Effort**: High

Ollama's streaming with tool calls is not fully standardized. The streaming translator must handle the case where Ollama returns a `tool_call` in the message object during streaming. This pattern is not well-tested in the existing codebase.

**Fix**: Add Ollama tool call streaming tests. Extend `anthropic-stream-translator.ts` to handle `message.tool_calls` in streaming chunks. Map to Anthropic `content_block_start` (tool_use) + `content_block_delta` (input_json_delta) events.

---

### F-AC-10: Config Schema — No Anthropic Section

**Severity**: Medium | **Category**: Gap | **Effort**: Low

The config schema (`schema.ts`) and `DEFAULT_CONFIG` have no `anthropic` section. Model aliases, API keys, and capability thresholds need a config home.

**Fix**: Add `anthropicConfigSchema` to `schema.ts` with fields: `models.aliases`, `models.reverseAliases`, `apiKey`, `supportedFeatures`. Add to `DEFAULT_CONFIG`.

---

## Implementation Plan — Wave 9 (Anthropic API Compatibility)

**Depends on**: None (self-contained, follows existing patterns)
**Preceded by**: Waves 1-8 (existing remediation plan)

### Wave 9.1 — Type System & Config (Low effort)

| Task  | Finding | Description                                                                                                 |
| ----- | ------- | ----------------------------------------------------------------------------------------------------------- |
| 9.1.1 | F-AC-1  | Add `supportsAnthropic?: boolean` and `anthropicModels?: string[]` to `AIServer` in `orchestrator.types.ts` |
| 9.1.2 | F-AC-10 | Add `anthropicConfigSchema` to `schema.ts` — model aliases, apiKey                                          |
| 9.1.3 | F-AC-10 | Add `ANTHROPIC` section to `DEFAULT_CONFIG` in `config.ts`                                                  |
| 9.1.4 | F-AC-10 | Add `API_ENDPOINTS.ANTHROPIC` constant to `api-endpoints.ts`                                                |
| 9.1.5 | F-AC-4  | Add `AnthropicMessagesRequest` Zod schema to `validation.ts`                                                |

**Files touched**: `orchestrator.types.ts`, `schema.ts`, `config.ts`, `api-endpoints.ts`, `validation.ts`

---

### Wave 9.2 — Health Check Extension (Medium effort)

| Task  | Finding | Description                                                                                                                                       |
| ----- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9.2.1 | F-AC-1  | Add `supportsAnthropic` probe to `health-check-scheduler.ts` — `POST /v1/messages` with `{max_tokens:1, messages:[{role:"user",content:"test"}]}` |
| 9.2.2 | F-AC-2  | Add `discoverAnthropicModels()` — infer model list from `400 missing required parameter` error type, or configure explicitly                      |

**Files touched**: `health-check-scheduler.ts`

---

### Wave 9.3 — Controller & Routes (Medium effort)

| Task  | Finding | Description                                                                                         |
| ----- | ------- | --------------------------------------------------------------------------------------------------- |
| 9.3.1 | All     | Create `src/controllers/anthropic-controller.ts` — `handleMessages` handler for `POST /v1/messages` |
| 9.3.2 | All     | Create `src/routes/anthropic.routes.ts` — route definitions                                         |
| 9.3.3 | All     | Update `src/routes/orchestrator.ts` barrel to export `anthropicRouter`                              |
| 9.3.4 | F-AC-6  | Validate `anthropic-version` header in handler                                                      |
| 9.3.5 | F-AC-4  | Validate incoming Anthropic request with Zod schema                                                 |
| 9.3.6 | F-AC-5  | Add Anthropic error formatter helper                                                                |

**Files touched**: `src/controllers/anthropic-controller.ts`, `src/routes/anthropic.routes.ts`, `src/routes/orchestrator.ts`

**Route mounting** (in `src/index.ts`):

```typescript
// After existing /v1 routes:
app.use('/v1', inferenceRateLimiter, v1Router);
// Anthropic routes share /v1 prefix — mount after v1Router so /v1/chat/completions is matched first
// Or mount at same level with explicit ordering
```

**Note**: `/v1/messages` and `/v1/chat/completions` share the `/v1` prefix. Express matches routes in registration order. The OpenAI router's `POST /chat/completions` must be registered before the Anthropic router's `POST /messages`.

---

### Wave 9.4 — Request Translation (Medium effort)

| Task  | Finding | Description                                                                                                 |
| ----- | ------- | ----------------------------------------------------------------------------------------------------------- |
| 9.4.1 | All     | Build `AnthropicToOllamaTranslator` class in `src/translators/anthropic-to-ollama.ts`                       |
| 9.4.2 | All     | Build `AnthropicToOpenAITranslator` class in `src/translators/anthropic-to-openai.ts`                       |
| 9.4.3 | F-AC-8  | Add validation: reject `thinking.*` and `cache_control` fields with `400 unsupported_field`                 |
| 9.4.4 | All     | Wire translators into `anthropic-controller.ts` — select backend-native format and apply correct translator |

**Files touched**: `src/translators/anthropic-to-ollama.ts`, `src/translators/anthropic-to-openai.ts`, `src/controllers/anthropic-controller.ts`

---

### Wave 9.5 — Streaming Translation (High effort)

| Task  | Finding        | Description                                                                                                                   |
| ----- | -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 9.5.1 | F-AC-3, F-AC-7 | Build `src/streaming/anthropic-stream-translator.ts` — Ollama NDJSON → Anthropic SSE state machine                            |
| 9.5.2 | F-AC-9         | Handle Ollama tool calls in streaming → Anthropic `content_block_start` (tool_use) + `content_block_delta` (input_json_delta) |
| 9.5.3 | All            | Wire streaming translator into `anthropic-controller.ts` for streaming responses                                              |
| 9.5.4 | All            | Add integration test: verify Anthropic SSE event ordering                                                                     |

**Files touched**: `src/streaming/anthropic-stream-translator.ts`, `src/controllers/anthropic-controller.ts`

**Testing gate**: Must pass event ordering test before Wave 9.5 is complete.

---

### Wave 9.6 — Reverse Translation (Ollama/OpenAI → Anthropic) (Medium effort)

| Task  | Finding | Description                                                                                 |
| ----- | ------- | ------------------------------------------------------------------------------------------- |
| 9.6.1 | All     | Build `OllamaToAnthropicTranslator` for Ollama responses → Anthropic format                 |
| 9.6.2 | All     | Build `OpenAIToAnthropicTranslator` for OpenAI responses → Anthropic format                 |
| 9.6.3 | All     | Wire reverse translators into Ollama and OpenAI controllers when target client is Anthropic |

**Files touched**: `src/translators/ollama-to-anthropic.ts`, `src/translators/openai-to-anthropic.ts`, `src/controllers/ollama-controller.ts`, `src/controllers/openai-controller.ts`

**Note**: This enables Ollama and OpenAI backends to serve requests from Anthropic SDK clients. The orchestrator already has a concept of "passthrough" vs "translate" — this extends it to the third dimension.

---

### Wave 9.7 — Testing & Integration (High effort)

| Task  | Finding | Description                                                                       |
| ----- | ------- | --------------------------------------------------------------------------------- |
| 9.7.1 | All     | Unit tests for all four translator classes                                        |
| 9.7.2 | All     | Integration tests: `/v1/messages` → Ollama backend, verify Anthropic SSE response |
| 9.7.3 | All     | Integration tests: `/v1/messages` → OpenAI backend, verify Anthropic SSE response |
| 9.7.4 | F-AC-3  | Streaming event ordering test against reference                                   |
| 9.7.5 | F-AC-8  | Test unsupported fields (`thinking`, `cache_control`) return correct errors       |
| 9.7.6 | F-AC-6  | Test missing `anthropic-version` returns `400`                                    |

**Files touched**: `tests/unit/anthropic-translators.test.ts`, `tests/integration/anthropic.test.ts`

---

### Wave 9 Summary

| Wave      | Focus                    | Effort   | Commits  |
| --------- | ------------------------ | -------- | -------- |
| 9.1       | Types, Config, Constants | Low      | 1-2      |
| 9.2       | Health Check Extension   | Medium   | 1        |
| 9.3       | Controller & Routes      | Medium   | 1-2      |
| 9.4       | Request Translation      | Medium   | 1-2      |
| 9.5       | Streaming Translation    | High     | 1-2      |
| 9.6       | Reverse Translation      | Medium   | 1-2      |
| 9.7       | Testing & Integration    | High     | 2-3      |
| **Total** |                          | **High** | **8-14** |

---

## Escalation Path

### When to Add `supportsAnthropic` Passthrough

Currently, all Anthropic requests go through translation to Ollama/OpenAI backends. If a **native Anthropic backend** (e.g., Claude API proxy, direct Anthropic server) is added to the fleet in the future, the architecture supports clean escalation:

1. Add `supportsAnthropic: true` probe for that server
2. In `anthropic-controller.ts`, check: if `server.supportsAnthropic === true` → passthrough (no translation)
3. The existing dual-mode pattern (`supportsV1`) already demonstrates this

### Architecture Extensibility — Fourth Backend

If a fourth backend type is added (e.g., Google AI, AWS Bedrock), the pattern scales:

- Add `supports<Backend>` to `AIServer`
- Add translator classes (`IncomingTo<Backend>Translator`, `<Backend>ToIncomingTranslator`)
- Add health check probe
- Wire into existing controller/route structure

The routing layer (`tryRequestWithFailover`) is backend-agnostic — it only cares about capability flags.
