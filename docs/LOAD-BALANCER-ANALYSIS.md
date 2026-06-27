# Load Balancer Deep Analysis

> **Date**: 2026-04-02
> **Branch**: `phase2/metrics-rollups`
> **Status**: Research complete — pending enhancement decisions

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Scoring Algorithm Deep Dive](#scoring-algorithm-deep-dive)
4. [Selection Algorithms](#selection-algorithms)
5. [Persistence Layer Map](#persistence-layer-map)
6. [Data Retention Analysis](#data-retention-analysis)
7. [Idle Period Behavior](#idle-period-behavior)
8. [Metrics Gap Analysis](#metrics-gap-analysis)
9. [Edge Cases & Failure Modes](#edge-cases--failure-modes)
10. [Identified Bugs & Issues](#identified-bugs--issues)
11. [Enhancement Opportunities](#enhancement-opportunities)

---

## Executive Summary

The load balancer is a sophisticated multi-factor scoring system with 10 weighted scoring dimensions, 6 selection algorithms, dual-layer persistence (JSON + SQLite), and 3-phase failover. It is generally well-designed, but research uncovered **6 bugs/issues**, **several metrics gaps**, and **12 enhancement opportunities**.

Key findings:

- **Scoring**: 10-factor weighted scoring with configurable weights, but a schema/implementation mismatch exists
- **Persistence**: Dual JSON + SQLite architecture with retention ranging from "lost on restart" to 90 days
- **Idle behavior**: Metrics decay has an optimistic bias (success rate decays toward 1.0) and a hard floor at 10% after ~18 minutes — no further degradation regardless of idle duration
- **Data gaps**: Several collected metrics are never used by the scoring algorithm; some useful metrics are unavailable from Ollama

---

## Architecture Overview

### Request Flow

```
Client Request
    │
    ▼
Orchestrator (orchestrator.ts)
    │
    ├─ getAvailableServers()     → filter by health, bans, circuit breakers
    ├─ selectServer()            → load-balancer scoring + algorithm
    │     │
    │     ├─ MetricsAggregator   → real-time metrics (latency, success, load, TTFT, etc.)
    │     ├─ CircuitBreaker      → per-server:model failure tracking
    │     ├─ TemporalScorer      → time-of-day pattern recognition
    │     ├─ RequestHistory       → historical request data
    │     └─ DecisionHistory      → past LB decisions for analysis
    │
    ├─ executeRequest()          → proxy to selected server
    │
    └─ handleFailover()          → 3-phase failover on failure
```

### Key Components

| Component           | File                                                 | Role                                   |
| ------------------- | ---------------------------------------------------- | -------------------------------------- |
| Load Balancer       | `src/load-balancer/load-balancer.ts`                 | Scoring engine + algorithm dispatch    |
| Temporal Scorer     | `src/load-balancer/temporal-scorer.ts`               | Time-of-day performance patterns       |
| Metrics Aggregator  | `src/metrics/metrics-aggregator.ts`                  | Real-time metric collection + decay    |
| Metrics Persistence | `src/metrics/metrics-persistence.ts`                 | JSON file persistence for metrics      |
| TTFT Tracker        | `src/metrics/ttft-tracker.ts`                        | Time-to-first-token tracking           |
| Circuit Breaker     | `src/circuit-breaker/circuit-breaker.ts`             | Failure state machine                  |
| CB Persistence      | `src/circuit-breaker/circuit-breaker-persistence.ts` | JSON file persistence for CB state     |
| Decision History    | `src/decision-history.ts`                            | LB decision recording (JSON + SQLite)  |
| Request History     | `src/request-history.ts`                             | Request data recording (JSON + SQLite) |
| Metrics Store       | `src/storage/metrics-store.ts`                       | SQLite storage engine                  |
| Ban Manager         | `src/utils/ban-manager.ts`                           | Temporary + permanent server bans      |
| In-Flight Manager   | `src/utils/in-flight-manager.ts`                     | Concurrency limiting                   |
| Error Classifier    | `src/utils/error-classifier.ts`                      | Error categorization for retry logic   |
| Health Checks       | `src/health-check-scheduler.ts`                      | Periodic server liveness probes        |

---

## Scoring Algorithm Deep Dive

### The 10 Scoring Factors

The load balancer computes a composite score from 10 weighted factors. **Note**: The README and Zod config schema suggest only 4 factors, but the actual implementation uses 10.

| #   | Factor              | Default Weight | Range      | What It Measures                            |
| --- | ------------------- | -------------- | ---------- | ------------------------------------------- |
| 1   | **Latency**         | 0.18 (18%)     | 0–100      | Response time (60% recent + 40% P95 blend)  |
| 2   | **Success Rate**    | 0.18 (18%)     | 0–100      | Request success ratio over sliding window   |
| 3   | **Load**            | 0.18 (18%)     | 0–100      | Current in-flight requests vs capacity      |
| 4   | **Capacity**        | 0.05 (5%)      | 0–100      | Available model slots on server             |
| 5   | **Circuit Breaker** | 0.13 (13%)     | 0–100      | CB state (closed=100, half-open=40, open=0) |
| 6   | **Timeout**         | 0.05 (5%)      | 0–100      | Timeout rate penalty                        |
| 7   | **Throughput**      | 0.08 (8%)      | 0–100      | Tokens-per-second generation rate           |
| 8   | **VRAM**            | 0.05 (5%)      | 0–100      | Available VRAM headroom                     |
| 9   | **Temporal**        | 0.10 (10%)     | multiplier | Time-of-day performance pattern             |
| 10  | **Context**         | 0.05 (5%)      | 0–100      | Context window availability                 |

**Total**: 1.00 (weights must sum to 1.0, validated at config time)

### Score Calculation

```
baseScore = Σ (factor_i × weight_i)    // for factors 1-8, 10
finalScore = baseScore × temporalMultiplier
```

The temporal factor is a **multiplier** (typically 0.8–1.2), not an additive component, despite having a weight. This means temporal patterns can amplify or dampen the base score by up to ±20%.

### Latency Scoring Detail

Latency uses a **blended** approach:

```
effectiveLatency = (0.6 × lastResponseTime) + (0.4 × p95Latency)
latencyScore = max(0, 100 - (effectiveLatency / maxAcceptableLatency × 100))
```

Where `maxAcceptableLatency` defaults to 30,000ms. This blending prevents a single fast/slow response from dominating the score while still reacting quickly to recent changes.

### Schema vs Implementation Weight Mismatch

The Zod config schema (`src/config/schema.ts`) defines default weights as:

```typescript
// Schema defaults (4 weights only)
latency: 0.35, successRate: 0.30, load: 0.20, capacity: 0.15
```

But the actual `DEFAULT_LB_CONFIG` in `load-balancer.ts` uses the 10-weight system shown above. If a user provides a config with only the 4 schema weights, the remaining 6 factors would receive zero weight — effectively disabling circuit breaker scoring, timeout penalties, throughput, VRAM, temporal, and context factors.

---

## Selection Algorithms

The LB supports 6 selection algorithms, each with different tradeoffs:

### 1. `weighted` (Default)

Uses the full 10-factor scoring system. Selects the server with the highest composite score.

- **Strengths**: Considers all dimensions, highly configurable
- **Gaps**: Does NOT consider hot/cold model state or model eviction recency

### 2. `fastest-response`

Ranks by latency with model-awareness bonuses:

- Hot model (loaded in VRAM): **no penalty**
- Recently evicted (<30s): **2× latency penalty**
- Evicted 30s–2min ago: **1.2× latency penalty**
- Cold model: Uses estimated load time

**This is the only algorithm with model eviction awareness.**

### 3. `round-robin`

Simple rotation through healthy servers. Ignores all scoring. Useful for uniform workloads.

### 4. `least-connections`

Selects server with fewest active in-flight requests. Simple and effective for uniform servers.

### 5. `random`

Random selection among healthy servers. Provides natural load distribution without scoring overhead.

### 6. `streaming-optimized`

Specialized for streaming requests. Considers TTFT (time-to-first-token) and chunk delivery metrics in addition to standard scoring.

---

## Persistence Layer Map

### Dual-Layer Architecture

The system uses two persistence backends:

```
                    ┌─────────────────────────┐
                    │      In-Memory State     │
                    │  (hot path, lost on      │
                    │   restart)               │
                    └──────┬──────────┬────────┘
                           │          │
              ┌────────────▼──┐   ┌───▼──────────────┐
              │  JSON Files   │   │     SQLite        │
              │  (data/*.json)│   │  (data/metrics.db)│
              │  Legacy hot   │   │  Long-term store  │
              │  path         │   │                   │
              └───────────────┘   └───────────────────┘
```

### JSON File Stores

| File                         | Contents                                                           | Save Interval              | Retention                                                                | Restored on Restart       |
| ---------------------------- | ------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------ | ------------------------- |
| `data/metrics.json`          | ServerModelMetrics (latency, success rate, load, throughput, etc.) | 30 seconds                 | 24h configured, **but `cleanOldData()` is a no-op** — grows indefinitely | ✅ Yes                    |
| `data/circuit-breakers.json` | CB state per server:model (state, failure count, timestamps)       | 30 seconds                 | **Indefinite** — no time-based cleanup                                   | ✅ Yes                    |
| `data/decision-history.json` | Legacy LB decisions                                                | `persist()` is a **no-op** | N/A (SQLite is primary)                                                  | ✅ Yes (loaded but stale) |
| `data/request-history.json`  | Legacy request records                                             | `persist()` is a **no-op** | N/A (SQLite is primary)                                                  | ✅ Yes (loaded but stale) |
| `data/servers.json`          | Server configuration                                               | On change                  | Permanent                                                                | ✅ Yes                    |
| `data/bans.json`             | Ban state (temporary + permanent)                                  | On change                  | Permanent (temp bans have expiry)                                        | ✅ Yes                    |
| `data/timeouts.json`         | Timeout state                                                      | On change                  | Permanent                                                                | ✅ Yes                    |

### SQLite Tables

| Table                 | Contents                                                   | Retention                                                      | Write Buffer                 |
| --------------------- | ---------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------- |
| `requests`            | Individual request records (timing, status, server, model) | **30 days**                                                    | 100 items OR 1000ms flush    |
| `decisions`           | LB selection decisions (scores, algorithm, candidates)     | **30 days**                                                    | 100 items OR 1000ms flush    |
| `decision_candidates` | Per-decision candidate scores                              | **30 days**                                                    | Flushed with parent decision |
| `failover_attempts`   | Failover event records                                     | **30 days**                                                    | 100 items OR 1000ms flush    |
| `hourly_rollups`      | Aggregated hourly metrics                                  | **90 days**                                                    | Generated on schedule        |
| `daily_rollups`       | Aggregated daily metrics                                   | **90 days**                                                    | Generated on schedule        |
| `temporal_profiles`   | Time-of-day performance baselines                          | **Not time-pruned** — rebuilt from 14-day hourly rollup window | Rebuilt periodically         |

**Retention pruning** runs hourly via `cleanupOldData()` in MetricsStore.

### In-Memory Buffers (Lost on Restart)

| Buffer                     | Max Size         | Per                 |
| -------------------------- | ---------------- | ------------------- |
| `recentLatencies`          | 1,000 entries    | Per server:model    |
| `recentTTFTs`              | 500 entries      | Per server:model    |
| `recentStreamingDurations` | 500 entries      | Per server:model    |
| `recentChunkCounts`        | 500 entries      | Per server:model    |
| `recentMaxChunkGaps`       | 500 entries      | Per server:model    |
| `recentChunkSizes`         | 500 entries      | Per server:model    |
| `DecisionHistory` events   | 10,000 total     | Global, 24h TTL     |
| `RequestHistory` entries   | 5,000 per server | Per server, 24h TTL |
| Health check results       | Unbounded        | Per server          |
| Sliding window (CB)        | Configurable     | Per server:model    |

---

## Data Retention Analysis

### Is Data Persisted Long Enough?

| Data Type                 | Current Retention                       | Assessment                                                                                                          | Recommendation                      |
| ------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **Raw requests** (SQLite) | 30 days                                 | ✅ **Adequate** — sufficient for trend analysis and temporal profiling                                              | No change needed                    |
| **Hourly rollups**        | 90 days                                 | ✅ **Adequate** — provides 3 months of hourly granularity                                                           | No change needed                    |
| **Daily rollups**         | 90 days                                 | ⚠️ **Borderline** — may be insufficient for seasonal analysis                                                       | Consider 180–365 days               |
| **Temporal profiles**     | Rebuilt from 14-day window              | ⚠️ **Short** — only captures 2-week patterns; misses monthly/seasonal cycles                                        | Consider 30-day window              |
| **Metrics JSON**          | 24h configured, **actually indefinite** | 🐛 **Bug** — `cleanOldData()` is a no-op, so this file grows without bound                                          | Fix the no-op, enforce 24h          |
| **Circuit breaker JSON**  | Indefinite                              | ⚠️ **No cleanup** — CB entries for removed servers/models never purge                                               | Add stale entry cleanup             |
| **In-memory buffers**     | Lost on restart                         | ❌ **Gap** — restart causes cold-start scoring (all servers get identical 100/100/50/100 scores → random selection) | Consider warm-start from SQLite     |
| **Health check data**     | Not persisted                           | ⚠️ **Gap** — no historical health data available after restart                                                      | Low priority — checks run every 30s |

### Key Concern: Restart Cold Start

When the process restarts:

1. **Restored from JSON**: metrics (stale if cleanOldData worked), CB states, bans, timeouts
2. **Restored from SQLite**: Decision history (loaded into memory), request history (loaded into memory)
3. **NOT restored**: In-memory sliding windows, recent latency/TTFT arrays, health check status

This means the LB enters a **degraded scoring state** after restart. All servers receive near-identical scores until enough new requests flow through to differentiate them. In practice, the first ~50-100 requests after restart are effectively random-selected.

---

## Idle Period Behavior

### What Happens With No Requests?

This section traces the system's behavior during extended idle periods, using the actual decay math from the codebase.

### Decay Mechanics

The `MetricsAggregator.applyTimeDecay()` method decays metrics based on time since last update:

```typescript
const hoursSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60);
const decayFactor = Math.max(0.1, Math.pow(0.5, hoursSinceUpdate * 2));
// decayFactor = max(0.1, 0.5^(hours × 2))
```

**Decay factor over time:**

| Idle Duration | Hours | decayFactor | Effect on Metrics                       |
| ------------- | ----- | ----------- | --------------------------------------- |
| 0 min         | 0.0   | 1.000       | No decay — metrics used as-is           |
| 5 min         | 0.083 | 0.891       | ~11% blended toward target              |
| 10 min        | 0.167 | 0.794       | ~21% blended toward target              |
| 15 min        | 0.250 | 0.707       | ~29% blended toward target              |
| 18 min        | 0.300 | 0.660       | ~34% blended toward target              |
| 20 min        | 0.333 | 0.630       | ...                                     |
| 30 min        | 0.500 | 0.500       | 50% blended toward target               |
| 1 hour        | 1.0   | 0.250       | 75% blended toward target               |
| 1.5 hours     | 1.5   | 0.125       | 87.5% blended toward target             |
| 2 hours       | 2.0   | 0.100       | **Hits floor** — 90% toward target      |
| 6 hours+      | 6.0+  | 0.100       | **Same as 2 hours** — no further change |
| 24 hours+     | 24+   | 0.100       | **Same as 2 hours** — no further change |

### 🐛 Critical Issue: Optimistic Decay Direction

The decay targets are:

| Metric           | Decays Toward    | Problem?                                                      |
| ---------------- | ---------------- | ------------------------------------------------------------- |
| **Success Rate** | **1.0 (100%)**   | 🐛 **YES** — after idle, servers appear artificially reliable |
| Latency          | Last known value | Neutral — retains stale data                                  |
| Load             | 0.0 (no load)    | Reasonable — server likely unloaded                           |
| Throughput       | 0.0              | Conservative — assumes no throughput data                     |

**Impact**: After 2+ hours of inactivity, a server that previously had a 70% success rate will appear to have a ~97% success rate. This means the LB will preferentially route to previously-unreliable servers after idle periods.

**Expected behavior**: Success rate should decay toward a **conservative baseline** (e.g., 0.5 or the global average), not toward perfection.

### Decay Floor Problem

The `Math.max(0.1, ...)` floor means that after ~2 hours, decay **stops entirely**. Whether a system has been idle for 2 hours or 2 weeks, the metrics look identical. There is no mechanism to further degrade confidence in stale data.

### Idle Period Timeline

```
T+0:        Last request completed. Metrics are fresh.
T+30s:      Health check runs. Server connectivity confirmed.
T+1min:     Health check runs. Metrics beginning minor decay.
T+5min:     Decay factor = 0.89. Metrics still mostly fresh.
T+30min:    Decay factor = 0.50. Metrics significantly decayed.
T+2h:       Decay factor = 0.10 (floor hit). Metrics frozen at
            ~90% toward targets. Success rate approaching 1.0.
T+2h–∞:    No further change. Health checks continue every 30s.
            CB state: unchanged (closed stays closed, open auto-
            transitions to half-open after timeout, then stays
            half-open until a request tests it).
            In-memory buffers: still hold stale data (no auto-clear).
            Temporal scorer: returns 1.0 (neutral) when no data.
```

### Resumption After Extended Idle

When requests resume after a long idle period:

1. **First request**: Server selected based on decayed metrics (near-uniform scores with optimistic success rates)
2. **Metrics immediately update**: Fresh latency/success data overwrites decayed values
3. **Sliding windows**: Still contain stale entries until enough new data pushes them out
4. **Effective recovery**: ~10-20 requests to restore meaningful score differentiation

---

## Metrics Gap Analysis

### Collected But NOT Used by Scoring

These metrics are tracked in the system but never feed into the LB scoring algorithm:

| Metric                                        | Where Collected     | Why Potentially Useful                                                            |
| --------------------------------------------- | ------------------- | --------------------------------------------------------------------------------- |
| **Queue wait time**                           | `RequestHistory`    | Indicates server saturation before request processing begins                      |
| **Model load time** (`loadDuration`)          | Ollama response     | Only used as cold-start indicator, not as scoring input                           |
| **Cold start count**                          | Metrics display     | High cold-start rate indicates VRAM pressure / model eviction churn               |
| **Network overhead** (`avgNetworkOverheadMs`) | `MetricsAggregator` | High network overhead could indicate infrastructure issues                        |
| **Bypass in-flight count**                    | `InFlightManager`   | Number of requests that bypassed concurrency limits                               |
| **Error type breakdown**                      | `ErrorClassifier`   | Only aggregate rate used by CB; specific error types could enable smarter routing |

### NOT Available (Ollama Limitations)

These would be valuable but are not exposed by the Ollama API:

| Metric                       | Why Useful                       | Availability                            |
| ---------------------------- | -------------------------------- | --------------------------------------- |
| **GPU utilization %**        | Direct server load signal        | Not exposed by Ollama                   |
| **Memory pressure**          | Predict OOM / eviction risk      | Not exposed by Ollama                   |
| **Per-model VRAM**           | Fine-grained capacity tracking   | Only total VRAM from `/api/ps`          |
| **Server-side queue depth**  | True server saturation signal    | Not exposed by Ollama                   |
| **Model quantization level** | Quality/speed tradeoff awareness | Available in model info, not in metrics |

### Derived Metrics That Could Be Computed

| Metric                 | Derivation                               | Use Case                                 |
| ---------------------- | ---------------------------------------- | ---------------------------------------- |
| **Score stability**    | Variance of scores over last N decisions | Detect flapping / unstable routing       |
| **Failover frequency** | Count from failover_attempts table       | Identify chronically failing servers     |
| **Model affinity**     | Which server handles which model best    | Route model X preferentially to server Y |
| **Time-to-recovery**   | Duration of CB open→closed transitions   | Predict server recovery patterns         |

---

## Edge Cases & Failure Modes

### 3-Phase Failover

When a request fails, the orchestrator attempts failover in three phases:

| Phase       | Strategy                         | Max Attempts |
| ----------- | -------------------------------- | ------------ |
| **Phase 1** | Try each remaining server once   | N-1 servers  |
| **Phase 2** | Retry the full server cycle      | N servers    |
| **Phase 3** | Same-server retries with backoff | 3 attempts   |

**No jitter** is applied between retries, creating a thundering herd risk if multiple requests fail simultaneously and all retry the same sequence of servers.

### Cold Start Behavior

When a server has no metrics (fresh start or after long idle with full decay):

```
Default scores: latency=100, successRate=100, load=50, capacity=100
```

All healthy servers receive identical scores → **selection is effectively random**. There is no proactive testing mechanism to establish baseline metrics before routing production traffic.

### Circuit Breaker Edge Cases

- **CB sliding window not persisted**: On restart, a server that was accumulating errors gets a fresh window — the error history is lost
- **Half-open state handling**: Only 1 test request allowed through. If it succeeds, CB closes. If it fails, CB re-opens. No gradual ramp-up.
- **All CBs open**: No proactive recovery testing. The system waits for the CB timeout to expire and then tests on the next real user request.

### Model Eviction Awareness Gap

Model eviction penalties (recently evicted models get latency multipliers) are only implemented in `selectFastestResponse()`. The default `weighted` algorithm does NOT consider whether a model is hot (in VRAM) or cold (needs loading). This means:

- `weighted` algorithm may select a server that needs to load the model (adding 5-30s latency)
- `fastest-response` correctly penalizes this scenario
- Users on the default algorithm are unaware of this gap

### Streaming Request Cleanup

The `InFlightManager` tracks streaming requests in a `streamingRequests` Map. If a streaming request crashes or the client disconnects without proper cleanup, the entry is **never removed**. Over time, this can cause:

1. Artificially inflated in-flight counts
2. Eventual hitting of concurrency limits
3. Server effectively "blocked" from receiving new requests

---

## Identified Bugs & Issues

### 🐛 Bug 1: Optimistic Success Rate Decay

**Severity**: Medium-High
**Location**: `src/metrics/metrics-aggregator.ts` — `applyTimeDecay()`

Success rate decays toward 1.0 (perfect) instead of a conservative baseline. After 2+ hours idle, previously unreliable servers appear artificially reliable.

**Fix**: Decay toward 0.5 (neutral) or configurable conservative baseline.

### 🐛 Bug 2: `cleanOldData()` is a No-Op

**Severity**: Medium
**Location**: `src/metrics/metrics-persistence.ts`

The method intended to enforce 24h retention on `metrics.json` does nothing — data grows indefinitely. On a busy system, this file will grow without bound.

**Fix**: Implement the actual cleanup logic, iterating entries and removing those older than `retentionHours`.

### 🐛 Bug 3: `cleanupExpiredCooldowns()` Never Called

**Severity**: Low-Medium
**Location**: `src/utils/ban-manager.ts`

The method exists and correctly implements cooldown cleanup, but it is never invoked by any caller. Expired cooldown entries accumulate in memory indefinitely.

**Fix**: Call from a periodic cleanup timer (e.g., every 5 minutes).

### 🐛 Bug 4: Streaming Request Memory Leak

**Severity**: Medium
**Location**: `src/utils/in-flight-manager.ts`

Streaming requests that crash or disconnect without proper cleanup are never removed from the `streamingRequests` Map. This gradually inflates in-flight counts.

**Fix**: Add a periodic sweep (e.g., every 60s) that removes entries older than a maximum streaming duration threshold.

### 🐛 Bug 5: Decision/Request History Not Rebuilt from SQLite

**Severity**: Low
**Location**: `src/decision-history.ts`, `src/request-history.ts`

On restart, these components load from JSON files (where `persist()` is a no-op), so the in-memory state starts empty or stale. The rich 30-day SQLite data is not used to warm the in-memory caches.

**Fix**: On startup, query SQLite for recent entries (last 24h) to populate in-memory history.

### 🐛 Bug 6: CB Sliding Window Not Persisted

**Severity**: Low-Medium
**Location**: `src/circuit-breaker/circuit-breaker.ts`

The circuit breaker's sliding window (which tracks recent error rates) is not included in persistence. On restart, a server that was accumulating errors gets a fresh window, potentially allowing a burst of requests to a failing server before the CB re-triggers.

**Fix**: Include window data in CB persistence, or warm the window from SQLite request data on startup.

---

## Enhancement Opportunities

Ranked by impact and effort, based on the gaps and issues identified above:

| #   | Enhancement                                | Impact    | Effort      | Description                                                                              |
| --- | ------------------------------------------ | --------- | ----------- | ---------------------------------------------------------------------------------------- |
| 1   | **Fix optimistic decay**                   | 🔴 High   | 🟢 Low      | Change success rate decay target from 1.0 to conservative baseline (0.5)                 |
| 2   | **Cold start penalty in `weighted`**       | 🔴 High   | 🟢 Low      | Add model hot/cold awareness to default algorithm (currently only in `fastest-response`) |
| 3   | **Queue depth / wait time scoring**        | 🔴 High   | 🟡 Low-Med  | Use collected queue wait time as an additional scoring factor                            |
| 4   | **Adaptive weight tuning**                 | 🔴 High   | 🟡 Medium   | Auto-adjust scoring weights based on observed performance patterns                       |
| 5   | **Fix `cleanOldData()` no-op**             | 🟡 Medium | 🟢 Very Low | Implement the actual cleanup in `metrics-persistence.ts`                                 |
| 6   | **Retry jitter**                           | 🟡 Medium | 🟢 Very Low | Add randomized jitter to failover retries to prevent thundering herd                     |
| 7   | **Proactive recovery testing**             | 🟡 Medium | 🟡 Medium   | When all CBs open, send synthetic test requests to detect recovery                       |
| 8   | **Model eviction awareness (all algos)**   | 🟡 Medium | 🟢 Low      | Extend hot/cold model penalties to `weighted` and other algorithms                       |
| 9   | **Network overhead scoring**               | 🟡 Medium | 🟢 Low      | Incorporate `avgNetworkOverheadMs` into scoring                                          |
| 10  | **Fix streaming request leak**             | 🟡 Medium | 🟢 Very Low | Add periodic cleanup sweep for stale streaming entries                                   |
| 11  | **Schema/impl weight alignment**           | 🟢 Low    | 🟢 Very Low | Update Zod schema defaults to match actual 10-weight system                              |
| 12  | **Call `cleanupExpiredCooldowns()`**       | 🟢 Low    | 🟢 Very Low | Wire up the existing method to a periodic timer                                          |
| 13  | **Warm in-memory caches from SQLite**      | 🟢 Low    | 🟡 Low-Med  | On startup, populate DecisionHistory/RequestHistory from SQLite                          |
| 14  | **Dead code cleanup (`unified-recorder`)** | 🟢 Low    | 🟢 Very Low | Remove deprecated `unified-recorder.ts`                                                  |
| 15  | **Cross-model fallback weighting**         | 🟢 Low    | 🟢 Low      | Score servers based on cross-model performance when target model has no history          |
| 16  | **Context headroom prioritization**        | 🟢 Low    | 🟢 Low      | Prefer servers with more available context window for large prompts                      |

### Recommended Implementation Order

**Wave A — Bug Fixes (Low effort, immediate value):**

- Fix optimistic decay (#1)
- Fix `cleanOldData()` no-op (#5)
- Fix streaming request leak (#10)
- Wire up `cleanupExpiredCooldowns()` (#12)
- Schema/impl weight alignment (#11)
- Dead code cleanup (#14)
- Add retry jitter (#6)

**Wave B — Scoring Enhancements (Medium effort, high value):**

- Cold start penalty in `weighted` (#2)
- Model eviction awareness for all algorithms (#8)
- Network overhead scoring (#9)
- Queue depth / wait time scoring (#3)

**Wave C — Advanced Features (Higher effort, strategic value):**

- Proactive recovery testing (#7)
- Adaptive weight tuning (#4)
- Warm in-memory caches from SQLite (#13)
- Cross-model fallback weighting (#15)
- Context headroom prioritization (#16)

---

## Appendix: Configuration Reference

### Default Load Balancer Config

```typescript
const DEFAULT_LB_CONFIG = {
  algorithm: 'weighted',
  weights: {
    latency: 0.18,
    successRate: 0.18,
    load: 0.18,
    capacity: 0.05,
    circuitBreaker: 0.13,
    timeout: 0.05,
    throughput: 0.08,
    vram: 0.05,
    temporal: 0.1,
    context: 0.05,
  },
  thresholds: {
    maxAcceptableLatency: 30000, // ms
    minSuccessRate: 0.5,
    maxLoad: 0.9,
  },
};
```

### Retention Defaults (from `src/storage/types.ts`)

```typescript
const DEFAULT_RETENTION = {
  rawRequests: 30, // days
  hourlyRollups: 90, // days
  dailyRollups: 90, // days
  temporalWindow: 14, // days (for profile rebuilds)
};
```

### Health Check Config

```typescript
const HEALTH_CHECK = {
  interval: 30000, // 30 seconds
  timeout: 5000, // 5 second timeout per check
  unhealthyThreshold: 3, // 3 consecutive failures → unhealthy
};
```
