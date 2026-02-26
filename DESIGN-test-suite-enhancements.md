# Test Suite Enhancement Design Document

## TESTING REQUIREMENTS

### All Tests Must Be Thorough

**Simple tests are NOT acceptable.** Each test file must include:

1. **Happy Path Tests** - Verify basic functionality works correctly
2. **Edge Case Tests** - Boundary conditions, empty inputs, null values
3. **Error Handling Tests** - All error paths must be tested
4. **Integration Tests** - Tests must verify how components work together
5. **Multi-Server Tests** - Tests must use multiple servers (not just single server)
6. **Dual-Protocol Tests** - ALL tests that interact with backends MUST test BOTH:
   - Ollama servers (using `/api/*` endpoints)
   - OpenAI-compatible servers (using `/v1/*` endpoints)
7. **Concurrent Tests** - Tests for race conditions and parallel operations
8. **Timeout Tests** - Verify timeout behavior
9. **Configuration Variation Tests** - Test with different config values

### Dual-Protocol Testing Mandate

**Every test that involves backend communication MUST test both:**

- **Ollama Servers**: Test with `type: 'ollama'`, verify `/api/tags`, `/api/generate`, `/api/chat` work
- **OpenAI Servers**: Test with `type: 'openai'`, verify `/v1/models`, `/v1/chat/completions` work

**This means:**

- Server selection tests must verify selection works for both Ollama and OpenAI-capable servers
- Failover tests must verify failover works for both protocol types
- Streaming tests must verify streaming works for both protocols
- Metrics tests must verify metrics are collected for both protocol types

### Dual-Capability Servers (Servers Supporting BOTH Ollama AND OpenAI)

**In addition to the Dual-Protocol Testing Mandate above, tests MUST also cover:**

Some servers support BOTH Ollama AND OpenAI protocols simultaneously. These dual-capability servers require additional testing:

1. **Server Capability Detection**
   - Test health check detects BOTH `/api/tags` AND `/v1/models` endpoints
   - Test server shows `supportsOllama: true` AND `supportsV1: true`
   - Test model lists are separate: `models` array and `v1Models` array

2. **Protocol Routing**
   - Test `/api/*` requests route to dual-capability servers
   - Test `/v1/*` requests route to dual-capability servers
   - Test load balancer considers both capabilities

3. **Model Management**
   - Test model operations work on dual-capability servers
   - Test model appears in both Ollama and OpenAI model lists

4. **Metrics Collection**
   - Test metrics collected for both protocol types on same server
   - Test metrics don't mix between protocols

5. **Failover Behavior**
   - Test failover works when one protocol fails but other works
   - Test circuit breaker affects both protocols or per-protocol as needed

---

**Server Type Testing Matrix:**

| Server Type                | Test Required            | Endpoints to Test                                      |
| -------------------------- | ------------------------ | ------------------------------------------------------ |
| Ollama-only                | YES                      | `/api/tags`, `/api/generate`, `/api/chat`              |
| OpenAI-only                | YES                      | `/v1/models`, `/v1/chat/completions`, `/v1/embeddings` |
| **Dual-capability (BOTH)** | **YES - Extra coverage** | **ALL endpoints above**                                |

---

## Overview

This document outlines findings from reviewing the existing test suite against the project documentation and provides recommendations for enhancement. The focus areas are:

1. Verifying test expectations match documentation specifications
2. Identifying functionality described in docs that lacks test coverage
3. Addressing scalability testing for hundreds of nodes with numerous concurrent requests
4. Creating comprehensive tests for stalled streaming response handlers

---

## DOCUMENTATION VS TEST COVERAGE ANALYSIS

### Documentation Sources Reviewed

- README.md - Key features, configuration options, API endpoints
- docs/API.md - Comprehensive API reference
- docs/OPERATIONS.md - Health checks, monitoring, troubleshooting
- docs/EXAMPLES.md - Usage examples
- docs/DEPLOYMENT.md - Production deployment configuration
- docs/OPENAI-SUPPORT-IMPLEMENTATION.md - OpenAI-compatible server support

---

## SECTION 1: Test Coverage vs Documentation Specifications

### 1.1 Intelligent Load Balancing (README lines 361-367)

**Documentation States:**

- Weighted scoring: latency (35%), success rate (30%), load (20%), capacity (15%)
- Historical metrics with sliding windows (1m, 5m, 15m, 1h)
- Circuit breakers prevent routing to failing servers
- Considers in-flight requests, model availability, health

**Test Coverage:**

- ✅ `load-balancer.test.ts` - Tests score calculation with metrics
- ✅ Tests for latency penalization
- ✅ Tests for success rate penalization
- ✅ Tests for load-based selection
- ✅ Tests for round-robin, least-connections algorithms

**GAPS FOUND:**

- ❌ NO TEST for weighted scoring exact percentages (35/30/20/15)
- ❌ NO TEST for sliding windows (1m, 5m, 15m, 1h) - no test verifies historical metrics are used
- ❌ NO TEST for in-flight requests consideration in load balancer selection
- ❌ NO TEST for model availability consideration in selection
- ❌ NO TEST verifies load balancer considers circuit breaker state

**TEST RECOMMENDATION:** Add tests to verify exact weight percentages and all selection criteria

---

### 1.2 Request Failover and Retry (README lines 368-373)

**Documentation States:**

- Automatic failover to next best server
- Configurable retries (default 2) for transient errors
- Error classification: permanent, non-retryable, transient, retryable
- Cooldown periods for failed server:model combos

**Test Coverage:**

- ✅ `circuit-breaker.test.ts` - Tests error classification (lines 218-268)
- ✅ Tests for non-retryable, transient, rate limited, network errors
- ✅ Tests for HTTP 5xx as transient/retryable
- ✅ Tests for HTTP 4xx as non-retryable

**GAPS FOUND:**

- ❌ NO TEST for automatic failover to next best server (end-to-end)
- ❌ NO TEST for default retry count of 2
- ❌ NO TEST verifies failover happens after failure
- ❌ NO TEST for cooldown periods on server:model combos

**TEST RECOMMENDATION:** Add integration tests for failover flow with multiple servers

---

### 1.3 Model Management (README lines 375-380)

**Documentation States:**

- Dynamic registry of model availability
- Proactive warmup based on usage patterns
- Per-server model control (pull, copy, delete)
- Fleet statistics

**Test Coverage:**

- ✅ `model-manager.test.ts` - Tests model manager functionality

**GAPS FOUND:**

- ❌ NO TEST for dynamic model registry updates
- ❌ NO TEST for proactive warmup based on usage patterns
- ❌ NO TEST for per-server pull, copy, delete operations
- ❌ NO TEST for fleet statistics aggregation

**TEST RECOMMENDATION:** Add tests for model operations across multiple servers

---

### 1.4 Streaming Support (README lines 382-388)

**Documentation States:**

- NDJSON streaming for generate/chat
- TTFT metrics
- Max 100 concurrent streams (configurable)
- 5-minute timeout

**Test Coverage:**

- ✅ `streaming.test.ts` - Tests SSE headers, chunk writing
- ✅ Tests for client disconnection handling
- ✅ Tests for error handling
- ✅ Tests for retry logic with exponential backoff

**GAPS FOUND:**

- ❌ NO TEST verifies NDJSON streaming format
- ❌ NO TEST for TTFT metrics collection
- ❌ NO TEST for max 100 concurrent streams limit
- ❌ NO TEST for 5-minute timeout
- ❌ NO TEST for configurable stream limit

---

### 1.5 Request Queue (README lines 391-395)

**Documentation States:**

- Priority queue (max 1000, default)
- Prevents starvation with priority boosting
- Tracks wait times, dropped requests

**Test Coverage:**

- ✅ `request-queue.test.ts` - 621 lines comprehensive tests
- ✅ Tests for priority ordering
- ✅ Tests for queue full behavior
- ✅ Tests for pause/resume
- ✅ Tests for priority boost
- ✅ Tests for queue statistics

**GAPS FOUND:**

- ❌ NO TEST verifies max 1000 default size
- ❌ NO TEST for priority boosting prevents starvation (theoretical)
- ❌ NO TEST verifies wait time tracking accuracy

**STATUS:** Well tested, minor gaps only

---

### 1.6 Per-Server Concurrency (README lines 397-401)

**Documentation States:**

- In-flight tracking per server:model
- Default max 4 concurrent per server (configurable)
- Load balancer considers current load

**Test Coverage:**

- ✅ `in-flight-manager.test.ts` - Tests increment/decrement
- ✅ Tests for streaming request tracking

**GAPS FOUND:**

- ❌ NO TEST verifies default max 4 concurrent limit
- ❌ NO TEST for configurable max concurrency
- ❌ NO TEST verifies load balancer respects concurrency limits

---

### 1.7 Circuit Breaker Protection (README lines 409-413)

**Documentation States:**

- Failure thresholds (5-10 failures)
- Half-open recovery testing
- Adaptive thresholds

**Test Coverage:**

- ✅ `circuit-breaker.test.ts` - 583 lines comprehensive
- ✅ Tests for state transitions (closed -> open -> half-open -> closed)
- ✅ Tests for adaptive thresholds
- ✅ Tests for error rate tracking

**GAPS FOUND:**

- ❌ NO TEST verifies "5-10 failures" threshold range (as stated in docs)
- ❌ NO TEST for adaptive threshold range (5-10 mentioned)
- ❌ NO TEST for half-open recovery testing timeout

**STATUS:** Well tested, minor gaps

---

### 1.8 Health Checks (README lines 415-419)

**Documentation States:**

- Up to 10 concurrent checks
- Recovery monitoring
- Automatic gradual restoration

**Test Coverage:**

- ✅ `health-check-scheduler.test.ts` - Tests health check scheduler

**GAPS FOUND:**

- ❌ NO TEST verifies max 10 concurrent checks limit
- ❌ NO TEST for recovery monitoring
- ❌ NO TEST for automatic gradual restoration

---

### 1.9 Streaming Concurrency (README lines 421-425)

**Documentation States:**

- Max 100 concurrent streams
- Resource protection
- Timeout management

**Test Coverage:**

- Partial tests in streaming.test.ts

**GAPS FOUND:**

- ❌ NO TEST verifies max 100 streams limit
- ❌ NO TEST for resource protection
- ❌ NO TEST for timeout management during streaming

---

## SECTION 2: API Endpoint Coverage Analysis

### 2.1 Ollama-Compatible Endpoints (API.md)

| Endpoint             | Docs Lines     | Test Coverage                     |
| -------------------- | -------------- | --------------------------------- |
| GET /api/tags        | API.md 610-615 | ✅ Tested in orchestrator.test.ts |
| POST /api/generate   | API.md 617-629 | ✅ Tested                         |
| POST /api/chat       | API.md 632-645 | ✅ Tested                         |
| POST /api/embeddings | API.md 647-660 | ❌ NOT TESTED                     |
| GET /api/ps          | API.md 662-666 | ❌ NOT TESTED                     |
| GET /api/version     | API.md 668-672 | ❌ NOT TESTED                     |
| POST /api/show       | API.md 674-686 | ❌ NOT TESTED                     |
| POST /api/embed      | API.md 688-693 | ❌ NOT TESTED                     |

---

### 2.2 OpenAI-Compatible Endpoints (API.md)

| Endpoint                  | Docs Lines     | Test Coverage                         |
| ------------------------- | -------------- | ------------------------------------- |
| POST /v1/chat/completions | API.md 700-714 | ✅ Tested in openaiController.test.ts |
| POST /v1/completions      | API.md 716-720 | ❌ NOT TESTED                         |
| POST /v1/embeddings       | API.md 722-735 | ❌ NOT TESTED                         |
| GET /v1/models            | API.md 737-742 | ❌ NOT TESTED                         |
| GET /v1/models/:model     | API.md 744-747 | ❌ NOT TESTED                         |

**CRITICAL GAP:** OpenAI endpoints lack test coverage

---

### 2.3 Server-Specific Endpoints (API.md)

| Endpoint                             | Docs Lines     | Test Coverage |
| ------------------------------------ | -------------- | ------------- |
| POST /api/generate--:serverId        | API.md 755-762 | ❌ NOT TESTED |
| POST /api/chat--:serverId            | API.md 763-767 | ❌ NOT TESTED |
| POST /api/embeddings--:serverId      | API.md 769-773 | ❌ NOT TESTED |
| POST /v1/chat/completions--:serverId | API.md 775-779 | ❌ NOT TESTED |

**CRITICAL GAP:** Server-specific bypass endpoints not tested

---

### 2.4 Server Management Extended (API.md)

| Endpoint                                           | Docs Lines     | Test Coverage |
| -------------------------------------------------- | -------------- | ------------- |
| GET /api/orchestrator/model-map                    | API.md 821-825 | ❌ NOT TESTED |
| GET /api/orchestrator/models                       | API.md 827-830 | ✅ Tested     |
| POST /api/orchestrator/servers/:id/undrain         | API.md 839-843 | ❌ NOT TESTED |
| POST /api/orchestrator/servers/:id/maintenance     | API.md 845-849 | ❌ NOT TESTED |
| DELETE /api/orchestrator/servers/:id/models/:model | API.md 871-875 | ❌ NOT TESTED |
| POST /api/orchestrator/servers/:id/models/copy     | API.md 877-881 | ❌ NOT TESTED |

---

### 2.5 Analytics Endpoints (API.md)

| Endpoint                                           | Docs Lines     | Test Coverage |
| -------------------------------------------------- | -------------- | ------------- |
| GET /api/orchestrator/analytics/top-models         | API.md 222-248 | ❌ NOT TESTED |
| GET /api/orchestrator/analytics/server-performance | API.md 251-281 | ❌ NOT TESTED |
| GET /api/orchestrator/analytics/errors             | API.md 283-324 | ❌ NOT TESTED |
| GET /api/orchestrator/analytics/capacity           | API.md 326-356 | ❌ NOT TESTED |
| GET /api/orchestrator/analytics/trends/:metric     | API.md 358-387 | ❌ NOT TESTED |

**CRITICAL GAP:** All analytics endpoints lack test coverage

---

### 2.6 Decision History & Request History (API.md)

| Endpoint                                                          | Docs Lines       | Test Coverage |
| ----------------------------------------------------------------- | ---------------- | ------------- |
| GET /api/orchestrator/analytics/decisions                         | API.md 1084-1088 | ❌ NOT TESTED |
| GET /api/orchestrator/analytics/decisions/trends/:serverId/:model | API.md 1090-1094 | ❌ NOT TESTED |
| GET /api/orchestrator/analytics/selection-stats                   | API.md 1096-1100 | ❌ NOT TESTED |
| GET /api/orchestrator/analytics/algorithms                        | API.md 1102-1106 | ❌ NOT TESTED |
| GET /api/orchestrator/analytics/score-timeline                    | API.md 1108-1112 | ❌ NOT TESTED |
| GET /api/orchestrator/analytics/metrics-impact                    | API.md 1114-1118 | ❌ NOT TESTED |
| GET /api/orchestrator/analytics/servers-with-history              | API.md 1124-1128 | ❌ NOT TESTED |
| GET /api/orchestrator/analytics/requests/:serverId                | API.md 1130-1134 | ❌ NOT TESTED |
| GET /api/orchestrator/analytics/request-stats/:serverId           | API.md 1136-1140 | ❌ NOT TESTED |
| GET /api/orchestrator/analytics/request-timeline                  | API.md 1142-1146 | ❌ NOT TESTED |
| GET /api/orchestrator/analytics/requests/search                   | API.md 1148-1160 | ❌ NOT TESTED |

**CRITICAL GAP:** All decision history and request history endpoints not tested

---

## SECTION 3: Configuration Coverage

### 3.1 Load Balancer Weights (README lines 442-447)

**Documentation States:**

- Latency: 35%
- Success: 30%
- Load: 20%
- Capacity: 15%

**Test Coverage:**

- Partial tests in load-balancer.test.ts

**GAPS FOUND:**

- ❌ NO TEST verifies exact percentage values

---

### 3.2 Circuit Breaker Config (README lines 458-469)

| Config                   | Docs Value | Test Coverage |
| ------------------------ | ---------- | ------------- |
| baseFailureThreshold     | 3          | ✅ Tested     |
| openTimeout              | 120s       | ❌ NOT TESTED |
| halfOpenTimeout          | 300s       | ❌ NOT TESTED |
| halfOpenMaxRequests      | 3          | ❌ NOT TESTED |
| recoverySuccessThreshold | 5          | ✅ Tested     |
| activeTestTimeout        | 300s       | ❌ NOT TESTED |
| errorWindow              | 60s        | ❌ NOT TESTED |
| errorRateThreshold       | 30%        | ✅ Tested     |
| adaptiveThresholds       | enabled    | ✅ Tested     |

---

### 3.3 Health Check Config (README lines 471-478)

| Config           | Docs Value | Test Coverage |
| ---------------- | ---------- | ------------- |
| interval         | 30s        | ❌ NOT TESTED |
| timeout          | 5s         | ❌ NOT TESTED |
| maxConcurrent    | 10         | ❌ NOT TESTED |
| failureThreshold | 3          | ❌ NOT TESTED |
| recoveryInterval | 60s        | ❌ NOT TESTED |

---

### 3.4 Retry Config (README lines 479-485)

| Config         | Docs Value    | Test Coverage |
| -------------- | ------------- | ------------- |
| maxRetries     | 2             | ❌ NOT TESTED |
| baseDelay      | 500ms         | ❌ NOT TESTED |
| backoff        | 2x            | ❌ NOT TESTED |
| maxDelay       | 5s            | ❌ NOT TESTED |
| retryableCodes | 503, 502, 504 | ❌ NOT TESTED |

---

### 3.5 Streaming Config (README lines 503-510)

| Config               | Docs Value | Test Coverage |
| -------------------- | ---------- | ------------- |
| enabled              | true       | ❌ NOT TESTED |
| maxConcurrentStreams | 100        | ❌ NOT TESTED |
| timeout              | 5m         | ❌ NOT TESTED |
| buffer               | 1024       | ❌ NOT TESTED |
| TTFT weight          | 0.6        | ❌ NOT TESTED |
| duration weight      | 0.4        | ❌ NOT TESTED |

---

### 3.6 Tags Aggregation Config (README lines 512-517)

| Config         | Docs Value | Test Coverage |
| -------------- | ---------- | ------------- |
| cacheTTL       | 30s        | ❌ NOT TESTED |
| maxConcurrent  | 10         | ❌ NOT TESTED |
| batchDelay     | 50ms       | ❌ NOT TESTED |
| requestTimeout | 5s         | ❌ NOT TESTED |

---

## SECTION 4: OpenAI Support Documentation vs Tests

### 4.1 OpenAI Server Support (OPENAI-SUPPORT-IMPLEMENTATION.md)

**Documentation States:**

- Dual Protocol Support: Ollama (/api/_) and OpenAI (/v1/_)
- Per-Server Capability Detection (supportsOllama, supportsV1)
- Separate Model Aggregation per protocol
- API Key Authentication support
- Protocol-Specific Routing
- Model Management Restrictions for non-Ollama servers

**Test Coverage:**

- ✅ `openaiController.test.ts` - Basic tests

**GAPS FOUND:**

- ❌ NO TEST verifies dual protocol support works correctly
- ❌ NO TEST for capability detection (supportsOllama, supportsV1)
- ❌ NO TEST verifies model aggregation is separate per protocol
- ❌ NO TEST for API key authentication with env: prefix
- ❌ NO TEST verifies OpenAI requests route only to supportsV1 servers
- ❌ NO TEST verifies Ollama requests route only to supportsOllama servers
- ❌ NO TEST verifies model management blocked on non-Ollama servers
- ❌ NO TEST for API key redaction in responses

---

## SECTION 5: Operations & Deployment Documentation vs Tests

### 5.1 Health Check Verification (OPERATIONS.md lines 7-21)

**Documentation States:**

- curl http://localhost:5100/health
- curl http://localhost:5100/api/orchestrator/health
- curl http://localhost:5100/api/orchestrator/queue
- curl http://localhost:5100/api/orchestrator/servers

**Test Coverage:**

- ✅ Some endpoint tests exist
- ❌ NO INTEGRATION TEST verifies all health endpoints work together

---

### 5.2 Recovery Failure Analysis (OPERATIONS.md lines 218-248)

**Documentation States:**

- GET /api/orchestrator/recovery-failures
- GET /api/orchestrator/recovery-failures/{serverId}
- GET /api/orchestrator/recovery-failures/{serverId}/history
- GET /api/orchestrator/recovery-failures/{serverId}/analysis
- GET /api/orchestrator/recovery-failures/{serverId}/circuit-breaker-impact
- POST /api/orchestrator/recovery-failures/{serverId}/reset

**Test Coverage:**

- ❌ NOT TESTED - No recovery-failure-controller tests found

---

## SECTION 6: Scalability Testing Gap

### 6.1 Current State

The existing tests have significant gaps in scalability testing:

| Scenario                      | Current Limit | Desired      |
| ----------------------------- | ------------- | ------------ |
| Server count in load balancer | 3 servers     | 500+ servers |
| Concurrent requests           | 50            | 500+         |
| Tags aggregation              | 20 servers    | 500+ servers |
| Health check concurrency      | 10            | 100+         |

---

## SECTION 7: Stalled Streaming Response Handler

### 7.1 Current Implementation Analysis

The codebase has infrastructure for stalled streaming detection:

- `InFlightManager` tracks `StreamingRequestProgress` with `isStalled` flag
- `streamResponse()` in `streaming.ts` tracks `maxChunkGapMs`
- Load balancer penalizes frequently stalled streams (`chunkGapPenalty`)

### 7.2 Missing Test Scenarios

| Scenario                      | Description                                                        | Priority |
| ----------------------------- | ------------------------------------------------------------------ | -------- |
| Stall detection timeout       | Test that request is marked stalled after X seconds without chunks | HIGH     |
| Chunk gap threshold           | Verify `maxChunkGapMs` exceeds configured threshold                | HIGH     |
| Automatic stall recovery      | Test that stalled requests can recover when chunks resume          | HIGH     |
| Stall metrics collection      | Verify stall duration is recorded in metrics                       | HIGH     |
| Circuit breaker integration   | Test stalled stream triggers circuit breaker                       | MEDIUM   |
| Multi-server stalled streams  | Test 100+ stalled streams across multiple servers                  | MEDIUM   |
| Stall during server failure   | Test behavior when upstream server stalls/fails                    | HIGH     |
| Client timeout handling       | Test client disconnect during stalled stream                       | MEDIUM   |
| Stall detection configuration | Test configurable stall timeout threshold                          | LOW      |

---

## SECTION 8: Summary of Critical Gaps

### Priority 1 - Critical (No Test Coverage)

1. **All Analytics Endpoints** - No tests for any analytics API
2. **All Decision History Endpoints** - No tests for decision tracking
3. **All Request History Endpoints** - No tests for request history
4. **OpenAI Protocol Endpoints** - /v1/completions, /v1/embeddings not tested
5. **Server-Specific Endpoints** - Bypass routes not tested
6. **Model Management Operations** - Pull, copy, delete across servers not tested
7. **Failover Flow** - End-to-end failover not tested
8. **Stalled Streaming** - No tests for stalled stream detection

### Priority 2 - High (Incomplete Coverage)

1. **Load Balancer Exact Weights** - Percentages not verified
2. **Configuration Values** - Most config values not tested
3. **Health Check Behavior** - Concurrent checks, recovery monitoring
4. **Streaming Limits** - Max 100 concurrent, 5min timeout not verified
5. **OpenAI Support** - Capability detection, routing, API keys

### Priority 3 - Medium (Minor Gaps)

1. **Queue Configuration** - Default 1000, priority boost behavior
2. **Circuit Breaker Timeouts** - Various timeout values
3. **Tags Aggregation Config** - Cache, batch settings

---

## SECTION 9: Recommendations

### Phase 1: Critical Coverage (Immediate)

1. Create `tests/unit/analytics-controller.test.ts`
2. Create `tests/unit/decision-history.test.ts`
3. Create `tests/unit/request-history.test.ts`
4. Create `tests/unit/stalled-streaming-handler.test.ts`
5. Update `openaiController.test.ts` to cover all endpoints

### Phase 2: Configuration Coverage

6. Add configuration validation tests
7. Add load balancer weight percentage tests

### Phase 3: Scalability

8. Create `tests/scalability/large-cluster.test.ts`
9. Enhance existing tests with 100+ server scenarios

---

## SECTION 11: COMPREHENSIVE IMPLEMENTATION PLANS

---

### IMPLEMENTATION PLAN 1: Analytics Controller Tests

**File to Create:** `tests/unit/analytics-controller.test.ts`

**Required Test Coverage (MUST include ALL of the following):**

#### 1.1 Analytics Summary Tests

- [ ] Test GET /api/orchestrator/analytics/summary returns correct structure
- [ ] Test summary includes totalRequests, totalErrors, avgLatency, p95Latency
- [ ] Test summary calculates requestsPerSecond correctly
- [ ] Test summary identifies topModel and mostActiveServer
- [ ] Test with NO servers - verify zero counts returned
- [ ] Test with NO requests - verify zero counts returned
- [ ] Test with mixed success/failure requests - verify error rate calculation
- [ ] Test timeRange parameter: 1h, 24h, 7d variations

#### 1.2 Top Models Tests

- [ ] Test GET /api/orchestrator/analytics/top-models returns models sorted by usage
- [ ] Test limit parameter works (default 10, custom values)
- [ ] Test timeRange parameter variations
- [ ] Test includes percentage of total requests
- [ ] Test includes avgLatency per model
- [ ] Test includes errorRate per model
- [ ] Test with NO models - verify empty array
- [ ] Test with single model - verify correct percentages

#### 1.3 Server Performance Tests

- [ ] Test GET /api/orchestrator/analytics/server-performance returns all servers
- [ ] Test includes requests, avgLatency, p95Latency, p99Latency
- [ ] Test includes errorRate, throughput, utilization, score
- [ ] Test timeRange parameter variations
- [ ] Test performance comparison between servers
- [ ] Test with healthy vs unhealthy servers
- [ ] Test with servers at different load levels

#### 1.4 Error Analysis Tests

- [ ] Test GET /api/orchestrator/analytics/errors returns error breakdown
- [ ] Test errors grouped by type (timeout, server_error, network_error)
- [ ] Test errors grouped by server
- [ ] Test errors grouped by model
- [ ] Test includeRecent parameter
- [ ] Test recentErrors array with timestamps
- [ ] Test with NO errors - verify empty groups

#### 1.5 Capacity Analysis Tests

- [ ] Test GET /api/orchestrator/analytics/capacity returns current state
- [ ] Test includes queueSize, avgWaitTime, saturationLevel
- [ ] Test forecast includes predictedLoad, recommendedServers, bottleneckServer
- [ ] Test recommendations array
- [ ] Test timeRange parameter for forecast

#### 1.6 Trend Analysis Tests

- [ ] Test GET /api/orchestrator/analytics/trends/:metric
- [ ] Test valid metrics: latency, errors, throughput
- [ ] Test serverId filter parameter
- [ ] Test model filter parameter
- [ ] Test timeRange parameter
- [ ] Test analysis includes direction, slope, confidence

#### 1.7 Dual-Protocol Requirements (MANDATORY)

- [ ] Tests MUST run with Ollama servers and verify metrics collected correctly
- [ ] Tests MUST run with OpenAI servers and verify metrics collected correctly
- [ ] Tests MUST verify metrics differ appropriately between protocols
- [ ] Tests MUST verify model names are parsed correctly for each protocol

---

### IMPLEMENTATION PLAN 2: Decision History Tests

**File to Create:** `tests/unit/decision-history.test.ts`

**Required Test Coverage (MUST include ALL of the following):**

#### 2.1 Decision History Tests

- [ ] Test GET /api/orchestrator/analytics/decisions returns decision records
- [ ] Test decision records include serverId, model, timestamp, reason
- [ ] Test limit parameter works
- [ ] Test with NO decisions - verify empty array
- [ ] Test decision ordering (most recent first)

#### 2.2 Decision Trends Tests

- [ ] Test GET /api/orchestrator/analytics/decisions/trends/:serverId/:model
- [ ] Test trends include selectionCount, rejectionCount, rejectionReasons
- [ ] Test with non-existent server - verify 404 or empty
- [ ] Test with non-existent model - verify 404 or empty

#### 2.3 Selection Stats Tests

- [ ] Test GET /api/orchestrator/analytics/selection-stats
- [ ] Test includes totalSelections, totalRejections per server
- [ ] Test includes selectionPercentage
- [ ] Test with multiple servers

#### 2.4 Algorithm Stats Tests

- [ ] Test GET /api/orchestrator/analytics/algorithms
- [ ] Test includes performance metrics per algorithm
- [ ] Test algorithms compared: weighted, round-robin, least-connections

#### 2.5 Score Timeline Tests

- [ ] Test GET /api/orchestrator/analytics/score-timeline
- [ ] Test includes server scores over time
- [ ] Test timeRange parameter
- [ ] Test with multiple servers

#### 2.6 Dual-Protocol Requirements (MANDATORY)

- [ ] Tests MUST verify decisions are recorded for Ollama server selections
- [ ] Tests MUST verify decisions are recorded for OpenAI server selections
- [ ] Tests MUST verify protocol is included in decision records

---

### IMPLEMENTATION PLAN 3: Request History Tests

**File to Create:** `tests/unit/request-history.test.ts`

**Required Test Coverage (MUST include ALL of the following):**

#### 3.1 Servers With History Tests

- [ ] Test GET /api/orchestrator/analytics/servers-with-history
- [ ] Test returns list of servers that have request history
- [ ] Test with NO history - verify empty array

#### 3.2 Server Request History Tests

- [ ] Test GET /api/orchestrator/analytics/requests/:serverId
- [ ] Test returns request records for specific server
- [ ] Test includes timestamp, model, duration, status
- [ ] Test with non-existent server - verify 404 or empty

#### 3.3 Request Stats Tests

- [ ] Test GET /api/orchestrator/analytics/request-stats/:serverId
- [ ] Test includes totalRequests, successCount, failureCount
- [ ] Test includes avgDuration, p95Duration
- [ ] Test with healthy vs unhealthy server

#### 3.4 Request Timeline Tests

- [ ] Test GET /api/orchestrator/analytics/request-timeline
- [ ] Test includes request volume over time
- [ ] Test timeRange parameter
- [ ] Test with multiple servers

#### 3.5 Search Requests Tests

- [ ] Test GET /api/orchestrator/analytics/requests/search
- [ ] Test serverId filter parameter
- [ ] Test model filter parameter
- [ ] Test status filter (success/failure)
- [ ] Test limit parameter
- [ ] Test with no matching requests - verify empty

#### 3.6 Dual-Protocol Requirements (MANDATORY)

- [ ] Tests MUST track requests to Ollama servers
- [ ] Tests MUST track requests to OpenAI servers
- [ ] Tests MUST distinguish protocol in request records

---

### IMPLEMENTATION PLAN 4: OpenAI Server Support Tests

**File to Create:** `tests/unit/openai-server-support.test.ts`

**Required Test Coverage (MUST include ALL of the following):**

#### 4.1 Dual Protocol Support Tests

- [ ] Test server supports Ollama capability detection
- [ ] Test server supports OpenAI capability detection
- [ ] Test server supports BOTH protocols simultaneously
- [ ] Test health check detects Ollama endpoint (/api/tags)
- [ ] Test health check detects OpenAI endpoint (/v1/models)

#### 4.2 Model Aggregation Tests

- [ ] Test GET /api/tags returns ONLY Ollama-capable servers
- [ ] Test GET /v1/models returns ONLY OpenAI-capable servers
- [ ] Test models from both protocols don't mix
- [ ] Test model deduplication works per protocol

#### 4.3 API Key Authentication Tests

- [ ] Test API key stored in server config
- [ ] Test env:VARIABLE_NAME resolution works
- [ ] Test API key passed in Authorization header
- [ ] Test API key REDACTED in responses (verify **_REDACTED_**)
- [ ] Test missing API key causes appropriate error

#### 4.4 Protocol-Specific Routing Tests

- [ ] Test Ollama requests route ONLY to supportsOllama=true servers
- [ ] Test OpenAI requests route ONLY to supportsV1=true servers
- [ ] Test mixed server pool - verify correct routing
- [ ] Test fallback when no servers support required protocol

#### 4.5 Model Management Restrictions Tests

- [ ] Test pull model blocked on OpenAI-only server (expect 400)
- [ ] Test delete model blocked on OpenAI-only server (expect 400)
- [ ] Test copy model blocked on OpenAI-only server (expect 400)
- [ ] Test model operations work on Ollama-capable servers

#### 4.6 OpenAI Endpoint Tests (ALL must be tested)

- [ ] Test POST /v1/chat/completions with messages
- [ ] Test POST /v1/chat/completions with stream=true
- [ ] Test POST /v1/chat/completions with stream=false
- [ ] Test POST /v1/completions with prompt
- [ ] Test POST /v1/completions with stream=true
- [ ] Test POST /v1/embeddings with input
- [ ] Test GET /v1/models returns model list
- [ ] Test GET /v1/models/:model returns specific model

#### 4.7 Error Handling Tests

- [ ] Test 400 error for invalid request body
- [ ] Test 404 error for non-existent model
- [ ] Test 500 error for server failure
- [ ] Test timeout handling
- [ ] Test circuit breaker integration

#### 4.8 Dual-Protocol Comparison Tests (MANDATORY)

- [ ] Test SAME model accessible via both protocols
- [ ] Test request succeeds on Ollama server via /api/chat
- [ ] Test request succeeds on same server via /v1/chat/completions
- [ ] Verify response format differs but content is same

---

### IMPLEMENTATION PLAN 5: Server-Specific Endpoints Tests

**File to Create:** `tests/unit/server-specific-routes.test.ts`

**Required Test Coverage (MUST include ALL of the following):**

#### 5.1 Ollama Server Bypass Tests

- [ ] Test POST /api/generate--:serverId routes to specific server
- [ ] Test POST /api/chat--:serverId routes to specific server
- [ ] Test POST /api/embeddings--:serverId routes to specific server
- [ ] Test bypasses load balancer (verify via logging/metrics)
- [ ] Test with non-existent server - verify 404

#### 5.2 OpenAI Server Bypass Tests

- [ ] Test POST /v1/chat/completions--:serverId routes to specific server
- [ ] Test POST /v1/completions--:serverId routes to specific server
- [ ] Test POST /v1/embeddings--:serverId routes to specific server
- [ ] Test bypasses load balancer
- [ ] Test with non-existent server - verify 404

#### 5.3 Error Handling Tests

- [ ] Test server specified but unhealthy
- [ ] Test server specified but model not available
- [ ] Test server specified but at max concurrency

#### 5.4 Dual-Protocol Requirements (MANDATORY)

- [ ] Tests MUST verify /api/\* bypass routes work with Ollama servers
- [ ] Tests MUST verify /v1/\* bypass routes work with OpenAI servers
- [ ] Tests MUST verify protocol capability requirements for each bypass route

---

### IMPLEMENTATION PLAN 6: Stalled Streaming Handler Tests

**File to Create:** `tests/unit/stalled-streaming-handler.test.ts`

**Required Test Coverage (MUST include ALL of the following):**

#### 6.1 Stall Detection Tests

- [ ] Test request marked stalled after chunk timeout (simulate no chunks)
- [ ] Test maxChunkGapMs exceeds configured threshold
- [ ] Test stall detection with different timeout values
- [ ] Test stall NOT marked when chunks arrive within timeout

#### 6.2 Chunk Gap Tracking Tests

- [ ] Test maxChunkGapMs calculated correctly between chunks
- [ ] Test with small gaps (< 1 second)
- [ ] Test with large gaps (> 30 seconds)
- [ ] Test gap tracking across many chunks

#### 6.3 Stall Recovery Tests

- [ ] Test stalled request recovers when chunks resume
- [ ] Test isStalled flag resets after chunk arrives
- [ ] Test multiple stall/recover cycles

#### 6.4 Stall Metrics Tests

- [ ] Test stall duration recorded in metrics
- [ ] Test stall count per server:model
- [ ] Test stall metrics exposed via API

#### 6.5 Streaming Timeout Tests

- [ ] Test 5-minute timeout enforced
- [ ] Test timeout triggers appropriate error
- [ ] Test timeout with stalled stream
- [ ] Test configurable timeout values

#### 6.6 Concurrent Stream Tests

- [ ] Test 100 concurrent streams handled
- [ ] Test stream limit enforcement
- [ ] Test resource cleanup after stream ends

#### 6.7 Server Failure During Stream Tests

- [ ] Test stream handling when upstream server fails
- [ ] Test failover during active stream
- [ ] Test stream cleanup on server failure

#### 6.8 Dual-Protocol Requirements (MANDATORY)

- [ ] Tests MUST verify stalled detection works with Ollama /api/chat streaming
- [ ] Tests MUST verify stalled detection works with OpenAI /v1/chat/completions streaming
- [ ] Tests MUST verify stall metrics are protocol-aware

---

### IMPLEMENTATION PLAN 7: Failover Integration Tests

**File to Create:** `tests/integration/failover.test.ts`

**Required Test Coverage (MUST include ALL of the following):**

#### 7.1 Automatic Failover Tests

- [ ] Test failover triggers on server failure mid-request
- [ ] Test failover to next best server
- [ ] Test failover with multiple server failures
- [ ] Test failover preserves request body/content
- [ ] Test failover with streaming - verify stream continues

#### 7.2 Retry Configuration Tests

- [ ] Test default retry count of 2 is enforced
- [ ] Test retry with different maxRetries values
- [ ] Test retry with 0 (no retries)
- [ ] Test exponential backoff between retries

#### 7.3 Cooldown Period Tests

- [ ] Test server enters cooldown after failure
- [ ] Test cooldown period duration (2 minutes default)
- [ ] Test server exits cooldown after period
- [ ] Test requests allowed after cooldown

#### 7.4 Circuit Breaker Integration Tests

- [ ] Test circuit breaker opens after threshold failures
- [ ] Test circuit breaker prevents requests to failing server
- [ ] Test circuit breaker half-open state
- [ ] Test circuit breaker recovery

#### 7.5 Error Classification Tests

- [ ] Test permanent errors (4xx) do NOT retry
- [ ] Test transient errors (5xx) DO retry
- [ ] Test timeout errors retry
- [ ] Test network errors retry

#### 7.6 Dual-Protocol Requirements (MANDATORY)

- [ ] Tests MUST verify failover works with Ollama servers
- [ ] Tests MUST verify failover works with OpenAI servers
- [ ] Tests MUST verify failover respects protocol capabilities
- [ ] Tests MUST verify model availability per protocol after failover

---

### IMPLEMENTATION PLAN 8: Load Balancer Weight Verification Tests

**File to Update:** `tests/unit/load-balancer.test.ts`

**Required Test Coverage (MUST add ALL of the following):**

#### 8.1 Exact Weight Percentage Tests

- [ ] Test latency weight is EXACTLY 35%
- [ ] Test success rate weight is EXACTLY 30%
- [ ] Test load weight is EXACTLY 20%
- [ ] Test capacity weight is EXACTLY 15%
- [ ] Test weights sum to 100%

#### 8.2 Sliding Window Tests

- [ ] Test 1-minute window metrics are used
- [ ] Test 5-minute window metrics are used
- [ ] Test 15-minute window metrics are used
- [ ] Test 1-hour window metrics are used

#### 8.3 Selection Criteria Tests

- [ ] Test in-flight requests considered in selection
- [ ] Test model availability considered
- [ ] Test server health considered
- [ ] Test circuit breaker state considered

#### 8.4 Algorithm Tests

- [ ] Test weighted algorithm uses all criteria
- [ ] Test round-robin algorithm cycles correctly
- [ ] Test least-connections algorithm selects lowest

#### 8.5 Dual-Protocol Requirements (MANDATORY)

- [ ] Tests MUST verify Ollama servers scored correctly
- [ ] Tests MUST verify OpenAI servers scored correctly
- [ ] Tests MUST verify capability (supportsOllama/supportsV1) affects scoring

---

### IMPLEMENTATION PLAN 4B: Dual-Capability Server Tests (Servers Supporting BOTH Ollama AND OpenAI)

**File to Create:** `tests/unit/dual-capability-server.test.ts`

**Required Test Coverage (MUST include ALL of the following):**

#### 4B.1 Health Check Capability Detection

- [ ] Test health check detects BOTH /api/tags AND /v1/models endpoints
- [ ] Test server shows supportsOllama: true AND supportsV1: true simultaneously
- [ ] Test server models appear in BOTH `models` array and `v1Models` array
- [ ] Test model names parsed correctly for each protocol (e.g., "llama3:latest" vs "llama3")
- [ ] Test health check updates both capability flags independently
- [ ] Test capability persists after server reconnect

#### 4B.2 Model List Aggregation

- [ ] Test GET /api/tags includes models from dual-capability servers
- [ ] Test GET /v1/models includes models from dual-capability servers
- [ ] Test models from dual-capability servers appear in BOTH endpoints
- [ ] Test model deduplication works across both endpoints
- [ ] Test same model accessible via both protocols (if model name allows)

#### 4B.3 Protocol Routing Tests

- [ ] Test /api/generate routes to dual-capability server
- [ ] Test /api/chat routes to dual-capability server
- [ ] Test /v1/chat/completions routes to dual-capability server
- [ ] Test /v1/completions routes to dual-capability server
- [ ] Test load balancer prioritizes dual-capability servers when appropriate
- [ ] Test requests route correctly in mixed pool (Ollama-only, OpenAI-only, dual-capability)

#### 4B.4 Model Management on Dual-Capability Servers

- [ ] Test pull model works on dual-capability server
- [ ] Test delete model works on dual-capability server
- [ ] Test copy model works on dual-capability server
- [ ] Test model appears in both model lists after pull
- [ ] Test model removed from both lists after delete

#### 4B.5 Metrics Collection

- [ ] Test metrics collected for /api/\* requests on dual-capability server
- [ ] Test metrics collected for /v1/\* requests on dual-capability server
- [ ] Test metrics separated by protocol (not mixed)
- [ ] Test latency tracked correctly for both protocols
- [ ] Test error rates tracked per protocol

#### 4B.6 Failover with Dual-Capability Servers

- [ ] Test failover from Ollama endpoint to OpenAI endpoint on same dual-capability server
- [ ] Test failover from OpenAI endpoint to Ollama endpoint on same dual-capability server
- [ ] Test circuit breaker affects BOTH protocols on dual-capability server
- [ ] Test cooldown applies to BOTH protocols
- [ ] Test partial failure (one protocol fails, other works)

#### 4B.7 Streaming on Dual-Capability Servers

- [ ] Test streaming /api/chat works on dual-capability server
- [ ] Test streaming /v1/chat/completions works on dual-capability server
- [ ] Test TTFT metrics collected for both protocols
- [ ] Test stalled stream detection works for both protocols

#### 4B.8 Mixed Server Pool Tests

- [ ] Test pool with Ollama-only, OpenAI-only, and dual-capability servers
- [ ] Test correct routing based on client request type
- [ ] Test load balancing considers protocol capability
- [ ] Test failover respects protocol requirements
- [ ] Test metrics aggregation handles all server types

#### 4B.9 Error Handling

- [ ] Test error when Ollama endpoint fails but OpenAI works
- [ ] Test error when OpenAI endpoint fails but Ollama works
- [ ] Test both endpoints fail - verify appropriate error
- [ ] Test timeout handling per protocol

#### 4B.10 Configuration Tests

- [ ] Test adding server with explicit supportsOllama: true, supportsV1: true
- [ ] Test auto-detection of capabilities
- [ ] Test overriding auto-detected capabilities manually
- [ ] Test API key configuration per protocol

---

**Testing Matrix for Mixed Server Pools:**

| Server 1        | Server 2        | Server 3        | Test Scenarios  |
| --------------- | --------------- | --------------- | --------------- |
| Ollama-only     | OpenAI-only     | -               | Basic routing   |
| Ollama-only     | Dual-capability | -               | Prioritize dual |
| OpenAI-only     | Dual-capability | -               | Prioritize dual |
| Ollama-only     | OpenAI-only     | Dual-capability | Full pool       |
| Dual-capability | Dual-capability | Dual-capability | Multiple dual   |

---

**File to Update/Create:** `tests/unit/model-manager.test.ts`

**Required Test Coverage (MUST add ALL of the following):**

#### 9.1 Model Registry Tests

- [ ] Test dynamic model registry updates on health check
- [ ] Test model availability tracked per server
- [ ] Test model removal when server unhealthy

#### 9.2 Warmup Tests

- [ ] Test warmup triggers model load
- [ ] Test warmup with specific servers
- [ ] Test warmup with priority (low, normal, high)
- [ ] Test warmup status tracking

#### 9.3 Pull/Copy/Delete Tests

- [ ] Test pull model to specific server
- [ ] Test copy model between servers
- [ ] Test delete model from server
- [ ] Test operations on multiple servers

#### 9.4 Fleet Statistics Tests

- [ ] Test fleet-wide model count
- [ ] Test model availability across servers
- [ ] Test model load distribution

#### 9.5 Dual-Protocol Requirements (MANDATORY)

- [ ] Tests MUST verify model operations work on Ollama servers
- [ ] Tests MUST verify model operations BLOCKED on OpenAI servers (expect 400)
- [ ] Tests MUST verify mixed server pools handled correctly

---

### IMPLEMENTATION PLAN 10: Scalability Tests

**File to Create:** `tests/scalability/large-cluster.test.ts`

**Required Test Coverage (MUST include ALL of the following):**

#### 10.1 Large Server Pool Tests

- [ ] Test load balancer selects from 500 servers within 100ms
- [ ] Test memory usage stable with 500 servers
- [ ] Test health checks complete within timeout with 500 servers

#### 10.2 Concurrent Request Tests

- [ ] Test 500 concurrent requests handled
- [ ] Test 500 concurrent requests distributed across 500 servers
- [ ] Test queue handles 1000 requests
- [ ] Test request timeout under high load

#### 10.3 Tags Aggregation Tests

- [ ] Test /api/tags aggregation from 500 servers
- [ ] Test aggregation completes within reasonable time
- [ ] Test caching reduces repeated aggregation load

#### 10.4 Health Check Concurrency Tests

- [ ] Test 100 concurrent health checks
- [ ] Test health check timeout handling
- [ ] Test recovery monitoring works at scale

#### 10.5 Dual-Protocol Requirements (MANDATORY)

- [ ] Tests MUST include 250 Ollama servers and 250 OpenAI servers
- [ ] Tests MUST verify routing works correctly at scale for both protocols
- [ ] Tests MUST verify metrics collection at scale for both protocols
- [ ] Tests MUST include dual-capability servers at scale (125 Ollama + 125 OpenAI + 250 dual-capability)

---

### IMPLEMENTATION PLAN 11: Recovery Failure Controller Tests

**File to Create:** `tests/unit/recovery-failure-controller.test.ts`

**Required Test Coverage (MUST include ALL of the following):**

#### 11.1 Recovery Failures Summary Tests

- [ ] Test GET /api/orchestrator/recovery-failures returns summary
- [ ] Test includes total failures, failure rate
- [ ] Test includes affected servers list

#### 11.2 Server Recovery Stats Tests

- [ ] Test GET /api/orchestrator/recovery-failures/:serverId
- [ ] Test includes recovery attempts, success count, failure count
- [ ] Test with non-existent server

#### 11.3 Failure History Tests

- [ ] Test GET /api/orchestrator/recovery-failures/:serverId/history
- [ ] Test includes timestamp, error type, recovery attempt
- [ ] Test history limited to recent records

#### 11.4 Analysis Tests

- [ ] Test GET /api/orchestrator/recovery-failures/:serverId/analysis
- [ ] Test includes failure patterns, root causes
- [ ] Test includes recommendations

#### 11.5 Circuit Breaker Impact Tests

- [ ] Test GET /api/orchestrator/recovery-failures/:serverId/circuit-breaker-impact
- [ ] Test includes breaker state changes during recovery
- [ ] Test includes impact on request success rate

#### 11.6 Reset Tests

- [ ] Test POST /api/orchestrator/recovery-failures/:serverId/reset
- [ ] Test clears failure history
- [ ] Test resets circuit breaker state

---

## SECTION 12: TESTING STANDARDS CHECKLIST

Before marking any test as complete, verify:

- [ ] Happy path works
- [ ] All error paths tested
- [ ] Edge cases covered (empty, null, zero, max values)
- [ ] Multiple servers used (not single server)
- [ ] Ollama servers tested (for any backend interaction)
- [ ] OpenAI servers tested (for any backend interaction)
- [ ] **Dual-capability servers tested (servers supporting BOTH protocols)**
- [ ] Concurrent operations tested
- [ ] Timeouts tested
- [ ] Configuration variations tested
- [ ] Metrics/logging verified
- [ ] Mixed server pools tested (Ollama-only, OpenAI-only, dual-capability)

---

## SECTION 13: FILES TO IMPLEMENT

### New Test Files to Create (Priority Order)

1. ✅ `tests/unit/analytics-controller.test.ts` - ALREADY EXISTS
2. ✅ `tests/unit/openai-server-support.test.ts` - **CREATED** (NEW)
3. ✅ `tests/unit/dual-capability-server.test.ts` - **CREATED** (NEW)
4. ✅ `tests/unit/stalled-streaming-handler.test.ts` - **CREATED** (NEW)
5. ✅ `tests/unit/server-specific-routes.test.ts` - **CREATED** (NEW)
6. ✅ `tests/unit/decision-history.test.ts` - ALREADY EXISTS
7. ✅ `tests/unit/request-history.test.ts` - ALREADY EXISTS
8. ✅ `tests/integration/failover.test.ts` - **CREATED** (NEW)
9. ✅ `tests/unit/recovery-failure-controller.test.ts` - ALREADY EXISTS
10. ✅ `tests/unit/large-cluster.test.ts` - **CREATED** (NEW - moved from scalability/)

### Existing Test Files to Enhance

1. `tests/unit/load-balancer.test.ts` - Add weight verification, dual-protocol tests, dual-capability tests
2. `tests/unit/orchestrator.test.ts` - Add 500 server tests, failover tests, dual-capability tests
3. `tests/unit/streaming.test.ts` - Add stalled detection tests, dual-capability tests
4. `tests/unit/model-manager.test.ts` - Add dual-protocol tests, dual-capability tests
5. `tests/unit/openaiController.test.ts` - Add comprehensive dual-capability tests

---

## REMAINING COVERAGE AREAS TO IMPLEMENT

### 1. Load Balancer Weight Verification (SECTION 8)

**Current Status:** ✅ COMPLETE - 39 tests added with exact weight verification

- [x] Test latency weight EXACTLY 35%
- [x] Test success rate weight EXACTLY 30%
- [x] Test load weight EXACTLY 20%
- [x] Test capacity weight EXACTLY 15%
- [x] Test weights sum to 100%
- [x] Test sliding windows (1m, 5m, 15m, 1h)
- [x] Test in-flight requests in selection
- [x] Test model availability in selection
- [x] Test circuit breaker state in selection
- [x] **Dual-protocol scoring tests**

### 2. Model Manager Enhancement (SECTION 9)

**Current Status:** 33 tests exist, NEEDS: Dual-protocol, fleet stats

- [ ] Test dynamic model registry updates
- [ ] Test proactive warmup based on usage patterns
- [ ] Test per-server pull/copy/delete operations
- [ ] Test fleet statistics aggregation
- [ ] **Dual-protocol model operations tests**

### 3. Streaming Tests Enhancement (SECTION 6)

**Current Status:** ✅ COMPLETE - ~50 tests added

- [x] Test NDJSON streaming format
- [x] Test TTFT metrics collection
- [x] Test max 100 concurrent streams limit
- [x] Test 5-minute timeout
- [x] **Test streaming with MANY chunks (100+)**
- [x] **Dual-protocol streaming tests**

### 4. Configuration Validation Tests

**Current Status:** Minimal coverage, NEEDS: All config values

- [ ] Retry config (maxRetries: 2, baseDelay: 500ms, backoff: 2x)
- [ ] Health check config (interval: 30s, timeout: 5s, maxConcurrent: 10)
- [ ] Streaming config (maxConcurrentStreams: 100, timeout: 5m)
- [ ] Tags aggregation config (cacheTTL: 30s, maxConcurrent: 10)

### 5. Orchestrator Large-Scale Tests

**Current Status:** Basic tests exist, NEEDS: 500+ servers

- [ ] Test 500+ servers in orchestrator
- [ ] Test concurrent requests across 100+ servers
- [ ] Test health check scheduling with large pools

---

## IMPLEMENTATION STATUS

### Completed Test Files (2026-02-25)

| File                              | Status      | Test Count | Lines |
| --------------------------------- | ----------- | ---------- | ----- |
| stalled-streaming-handler.test.ts | ✅ COMPLETE | 41 tests   | ~700  |
| dual-capability-server.test.ts    | ✅ COMPLETE | 47 tests   | ~800  |
| server-specific-routes.test.ts    | ✅ COMPLETE | ~30 tests  | ~600  |
| failover.test.ts                  | ✅ COMPLETE | ~40 tests  | ~750  |
| large-cluster.test.ts             | ✅ COMPLETE | 24 tests   | ~670  |
| openai-server-support.test.ts     | ✅ COMPLETE | ~40 tests  | ~680  |
| load-balancer-weights.test.ts     | ✅ COMPLETE | 39 tests   | ~750  |
| streaming-many-chunks.test.ts     | ✅ COMPLETE | ~50 tests  | ~680  |

### Phase 2 - Completed

| File                          | Target Tests | Status      |
| ----------------------------- | ------------ | ----------- |
| load-balancer-weights.test.ts | 30+ tests    | ✅ COMPLETE |
| streaming-many-chunks.test.ts | 25+ tests    | ✅ COMPLETE |

### Test Requirements Met

All new test files include:

- ✅ Happy path tests
- ✅ Edge case tests
- ✅ Error handling tests
- ✅ Multi-server tests (not single server)
- ✅ **Dual-protocol tests** (Ollama AND OpenAI)
- ✅ **Dual-capability server tests** (servers supporting BOTH)
- ✅ Concurrent operation tests
- ✅ Timeout tests
- ✅ Configuration variation tests

---

_Generated: February 2026_
_Review Scope: README.md, docs/API.md, docs/OPERATIONS.md, docs/EXAMPLES.md, docs/DEPLOYMENT.md, docs/OPENAI-SUPPORT-IMPLEMENTATION.md_
