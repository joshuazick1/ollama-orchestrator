# Timeout Architecture Audit — 2026-04-07

## Executive Summary

The Ollama Orchestrator implements a **5-layer timeout system** for AI endpoint servers. The adaptive design is sound — it learns from historical response times, detects stalled streams, and can hand off to healthy servers mid-stream. However, there is **one critical bug** (unbounded `fetch` in `handleEmbed`), several configuration gaps, and tuning concerns for slow public servers.

---

## 1. Timeout Layer Architecture

```
Client Request
    │
    ▼
┌─────────────────────────────────────────┐
│ Layer 1: X-Request-Timeout Header       │  Client-supplied cap (max 600s)
│ resolveRequestTimeout()                 │
└────────────────┬────────────────────────┘
                 ▼
┌─────────────────────────────────────────┐
│ Layer 2: TimeoutManager                 │  Adaptive per server:model
│ getTimeout(serverId, model)             │  Default: 120s, Range: 15s–600s
│ EMA smoothing (α=0.3), decay 5%/5min   │
└────────────────┬────────────────────────┘
                 ▼
┌─────────────────────────────────────────┐
│ Layer 3: fetchWithTimeout /             │  HTTP-level abort
│ fetchWithActivityTimeout                │  Non-streaming: single timeout
│                                         │  Streaming: connection + activity
└────────────────┬────────────────────────┘
                 ▼
┌─────────────────────────────────────────┐
│ Layer 4: Stall Detector                 │  Post-first-chunk stall detection
│ createStallDetector()                   │  Default: 300s (5min)
│ Interval-based chunk gap check          │  Triggers stream handoff
└────────────────┬────────────────────────┘
                 ▼
┌─────────────────────────────────────────┐
│ Layer 5: Circuit Breaker                │  Failure isolation
│ openTimeout: 120s, halfOpenTimeout: 300s│  Prevents cascading failures
│ activeTestTimeout: 300s                 │
└─────────────────────────────────────────┘
```

---

## 2. Timeout Configuration Inventory

### 2.1 TimeoutManager Defaults

| Parameter               | Default           | Range | Env Var  | File                    |
| ----------------------- | ----------------- | ----- | -------- | ----------------------- |
| `defaultTimeout`        | 120,000ms (2min)  | —     | **None** | `timeout-manager.ts:22` |
| `minTimeout`            | 15,000ms (15s)    | —     | **None** | `timeout-manager.ts:23` |
| `maxTimeout`            | 600,000ms (10min) | —     | **None** | `timeout-manager.ts:24` |
| `activeTestMultiplier`  | 3x                | —     | —        | `timeout-manager.ts:25` |
| `slowRequestMultiplier` | 2x                | —     | —        | `timeout-manager.ts:26` |
| `decayRatePerMs`        | 1.67e-7 (5%/5min) | —     | —        | `timeout-manager.ts:27` |

### 2.2 Orchestrator Config Timeouts

| Setting                            | Default     | Env Var                                          | Purpose                        | File            |
| ---------------------------------- | ----------- | ------------------------------------------------ | ------------------------------ | --------------- |
| `streaming.timeoutMs`              | 300s (5min) | `ORCHESTRATOR_STREAMING_TIMEOUT_MS`              | Overall streaming timeout      | `config.ts:352` |
| `streaming.activityTimeoutMs`      | 60s         | `ORCHESTRATOR_STREAMING_ACTIVITY_TIMEOUT_MS`     | Gap between chunks             | `config.ts:354` |
| `streaming.stallThresholdMs`       | 300s (5min) | `ORCHESTRATOR_STREAMING_STALL_THRESHOLD_MS`      | Mark stream as stalled         | `config.ts:355` |
| `streaming.stallCheckIntervalMs`   | 10s         | `ORCHESTRATOR_STREAMING_STALL_CHECK_INTERVAL_MS` | Stall check frequency          | `config.ts:356` |
| `healthCheck.timeoutMs`            | 10s         | `ORCHESTRATOR_HEALTH_CHECK_TIMEOUT_MS`           | Health probe timeout           | `config.ts:363` |
| `tags.requestTimeoutMs`            | 5s          | —                                                | Tag aggregation timeout        | `config.ts:377` |
| `circuitBreaker.openTimeout`       | 120s (2min) | —                                                | Open → half-open wait          | `config.ts:277` |
| `circuitBreaker.halfOpenTimeout`   | 300s (5min) | —                                                | Half-open → open if no success | `config.ts:278` |
| `circuitBreaker.activeTestTimeout` | 300s (5min) | —                                                | Active test request timeout    | `config.ts:281` |
| `recoveryTest.modelTestTimeoutMs`  | 120s (2min) | —                                                | Model inference recovery test  | `config.ts:396` |
| `recoveryTest.tagsTestTimeoutMs`   | 5s          | —                                                | Lightweight /api/tags recovery | `config.ts:397` |
| `modelManager.warmupTimeoutMs`     | 60s         | —                                                | Model warmup timeout           | `config.ts:404` |
| `retry.maxRetryDelayMs`            | 5s          | —                                                | Max delay between retries      | `config.ts:384` |
| `probeScheduler.probeTimeoutMs`    | 30s         | —                                                | Inference probe timeout        | `config.ts:450` |

### 2.3 HTTP Client Defaults

| Function                     | Parameter           | Default | File                        |
| ---------------------------- | ------------------- | ------- | --------------------------- |
| `fetchWithTimeout()`         | `timeout`           | 30s     | `fetch-with-timeout.ts:41`  |
| `fetchWithActivityTimeout()` | `connectionTimeout` | 30s     | `fetch-with-timeout.ts:142` |
| `fetchWithActivityTimeout()` | `activityTimeout`   | 60s     | `fetch-with-timeout.ts:143` |

---

## 3. Endpoint Coverage Analysis

### 3.1 Timeouts Applied Correctly

| Endpoint                        | Non-Streaming  | Streaming | Timeout Source                         | File                              |
| ------------------------------- | :------------: | :-------: | -------------------------------------- | --------------------------------- |
| `POST /api/generate`            |       ✅       |    ✅     | TimeoutManager + resolveRequestTimeout | `ollama-controller.ts:103-143`    |
| `POST /api/chat`                |       ✅       |    ✅     | TimeoutManager + resolveRequestTimeout | `ollama-controller.ts:591-640`    |
| `POST /api/embeddings`          |       ✅       |    N/A    | TimeoutManager + resolveRequestTimeout | `ollama-controller.ts:1016-1025`  |
| `POST /api/show`                |       ✅       |    N/A    | TimeoutManager + resolveRequestTimeout | `ollama-controller.ts:1155-1164`  |
| `POST /v1/chat/completions`     |       ✅       |    ✅     | TimeoutManager + resolveRequestTimeout | `openai-controller.ts:587-627`    |
| `POST /v1/completions`          |       ✅       |    ✅     | TimeoutManager + resolveRequestTimeout | `openai-controller.ts:988-1001`   |
| `POST /v1/embeddings`           |       ✅       |    N/A    | TimeoutManager + resolveRequestTimeout | `openai-controller.ts:1136-1145`  |
| `POST /v1/messages` (Anthropic) |       ✅       |    ✅     | TimeoutManager + resolveRequestTimeout | `anthropic-controller.ts:187-225` |
| `GET /api/ps`                   | ✅ (10s fixed) |    N/A    | Fixed 10s timeout                      | `ollama-controller.ts:1093`       |

### 3.2 Missing Timeouts

| Endpoint          | Issue                                         | Severity    | File                             |
| ----------------- | --------------------------------------------- | ----------- | -------------------------------- |
| `POST /api/embed` | **No timeout — raw `fetch()` with no signal** | 🔴 Critical | `ollama-controller.ts:1280-1284` |

---

## 4. Findings

### 4.1 Strengths

| #   | Finding                              | Detail                                                                                                                                                 |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | **Adaptive per server:model**        | `TimeoutManager` tracks independent timeouts per `serverId:model` key, allowing fast servers to have short timeouts while slow servers get longer ones |
| S2  | **Exponential smoothing**            | EMA with α=0.3 prevents wild swings from single outliers while still adapting to sustained changes                                                     |
| S3  | **Failure escalation**               | On timeout errors, the timeout increases 1.5x (capped at max), giving slow servers more breathing room                                                 |
| S4  | **Activity-based streaming timeout** | `fetchWithActivityTimeout` correctly separates connection timeout from activity timeout, resetting on each chunk                                       |
| S5  | **Stall detection with handoff**     | Post-first-chunk stall detector can seamlessly hand off to another server, preserving partial output                                                   |
| S6  | **Client-supplied timeout cap**      | `X-Request-Timeout` header lets clients enforce their own limits (capped at 600s)                                                                      |
| S7  | **Decay toward baseline**            | Timeouts decay back to baseline over time, preventing permanently inflated values after transient issues                                               |
| S8  | **Circuit breaker integration**      | Timeouts feed into circuit breaker state transitions, preventing repeated requests to failing servers                                                  |

### 4.2 Issues

| ID     | Severity    | Finding                                                                       | Impact                                                                                                                                                                            | Location                                               |
| ------ | ----------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **T1** | 🔴 Critical | `handleEmbed` uses raw `fetch()` with **no timeout**                          | Request hangs indefinitely if server doesn't respond                                                                                                                              | `ollama-controller.ts:1280`                            |
| **T2** | 🟡 Medium   | TimeoutManager defaults not exposed via env vars                              | Cannot tune `defaultTimeout`, `minTimeout`, `maxTimeout` without code changes                                                                                                     | `timeout-manager.ts:21-28`                             |
| **T3** | 🟡 Medium   | `connectionTimeout` and `activityTimeout` use the same value for streaming    | A 120s timeout means 120s between chunks before abort — no differentiation between slow TTFT and slow token generation                                                            | All streaming paths                                    |
| **T4** | 🟡 Medium   | Stall threshold capped at 60s in streaming paths                              | `Math.min(Math.max(timeoutMs * 1.5, 10_000), 60_000)` — even if TimeoutManager says 300s, stall fires at 60s. This causes premature handoff attempts on legitimately slow servers | `ollama-controller.ts:112`, `openai-controller.ts:594` |
| **T5** | 🟢 Low      | Timeout decay is very slow                                                    | 5% per 5 minutes means a spike to 600s takes ~25 minutes to return to normal. During that window, all requests get inflated timeouts                                              | `timeout-manager.ts:19`                                |
| **T6** | 🟢 Low      | `createFetchWithTimeout` factory is dead code                                 | Never called anywhere in the codebase                                                                                                                                             | `fetch-with-timeout.ts:201-206`                        |
| **T7** | 🟢 Low      | `activeTestMultiplier` (3x) is more lenient than `slowRequestMultiplier` (2x) | Naming suggests active tests are more aggressive, but they actually get longer timeouts. A 100s response gets 300s timeout during active test vs 200s during normal traffic       | `timeout-manager.ts:104-106`                           |
| **T8** | 🟡 Medium   | No observability into timeout behavior                                        | No structured logging of timeout decisions, actual response times vs timeout, or timeout-triggered aborts. Makes tuning purely guesswork                                          | System-wide                                            |

### 4.3 Timeout Flow Diagram

```
Request arrives
    │
    ▼
resolveRequestTimeout(headers, orchestratorTimeout, maxAllowed)
    │  Applies X-Request-Timeout header if present
    │  Clamps to [1, 600000]
    ▼
timeoutMs (effective timeout for this request)
    │
    ├── Non-streaming ──→ fetchWithTimeout(url, { timeout: timeoutMs })
    │
    └── Streaming ──→ fetchWithActivityTimeout(url, {
                         connectionTimeout: timeoutMs,    // TTFT budget
                         activityTimeout: timeoutMs,       // Per-chunk gap budget
                       })
                              │
                              ├── Connection phase: aborts after timeoutMs if no response headers
                              │
                              └── Streaming phase: resets activity timer on each chunk
                                        │
                                        └── If gap > timeoutMs → AbortError
                                        │
                                        └── Stall detector (separate): if gap > stallThreshold → handoff
```

---

## 5. Recommendations

### 5.1 Immediate (Fix T1)

Add timeout to `handleEmbed` — use `fetchWithTimeout` with TimeoutManager value, consistent with all other endpoints.

### 5.2 Short-term (Fix T2, T4)

- Expose `TimeoutManager` defaults via env vars: `ORCHESTRATOR_TIMEOUT_DEFAULT_MS`, `ORCHESTRATOR_TIMEOUT_MIN_MS`, `ORCHESTRATOR_TIMEOUT_MAX_MS`
- Reconsider the 60s stall threshold cap — for slow public servers, 1.5x of a 300s timeout = 450s, but it's clamped to 60s, causing premature stall detection

### 5.3 Medium-term (Fix T3, T5, T7)

- Differentiate `connectionTimeout` (TTFT budget) from `activityTimeout` (per-chunk gap budget) — they serve different purposes
- Speed up decay rate or make it configurable
- Rename multipliers for clarity: `activeTestMultiplier` → `recoveryTestMultiplier`, `slowRequestMultiplier` → `normalRequestMultiplier`

### 5.4 Observability (Fix T8)

Implement structured timeout telemetry — see `TIMEOUT-TUNING-TELEMETRY-PLAN.md`.
