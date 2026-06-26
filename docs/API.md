# Ollama Orchestrator API Reference

Complete API reference for the Ollama Orchestrator. All endpoints, request/response schemas, authentication requirements, and error formats are documented here.

## Table of Contents

- [Table of Contents](#table-of-contents)
- [Base URL](#base-url)
- [Authentication](#authentication)
  - [Bearer JWT (Cookie-Based)](#bearer-jwt-cookie-based)
  - [API Key (Header-Based)](#api-key-header-based)
  - [CSRF Protection](#csrf-protection)
  - [When Auth Is Disabled (`ENABLE_AUTH=false`)](#when-auth-is-disabled-enable_authfalse)
  - [Auth Config Summary](#auth-config-summary)
- [Error Response Formats](#error-response-formats)
- [Server-Specific Bypass (`--:serverId`)](#server-specific-bypass---serverid)
- [Streaming Responses](#streaming-responses)
- [Setup](#setup)
- [Authentication Endpoints](#authentication-endpoints)
- [Health and Metrics](#health-and-metrics)
- [Orchestrator Monitoring Endpoints](#orchestrator-monitoring-endpoints)
  - [Servers](#servers)
  - [Models](#models)
  - [Health and Stats](#health-and-stats)
  - [Events Stream](#events-stream)
  - [Circuit Breakers (Read)](#circuit-breakers-read)
  - [Metrics](#metrics)
  - [Recovery Tests](#recovery-tests)
  - [Performance Probe](#performance-probe)
  - [Errors](#errors)
  - [Cluster Status](#cluster-status)
- [Orchestrator Admin Endpoints](#orchestrator-admin-endpoints)
  - [Server Management](#server-management)
  - [Server Configuration](#server-configuration)
  - [Server Maintenance](#server-maintenance)
  - [Per-Server Model Management](#per-server-model-management)
  - [Model Actions](#model-actions)
  - [Configuration](#configuration)
  - [Ban Management](#ban-management)
  - [Circuit Breaker Management (Write)](#circuit-breaker-management-write)
  - [Recovery Failure Tracking](#recovery-failure-tracking)
  - [Logging](#logging)
- [User Management Endpoints](#user-management-endpoints)
- [Ollama-Compatible Inference Endpoints](#ollama-compatible-inference-endpoints)
- [OpenAI-Compatible Endpoints](#openai-compatible-endpoints)
- [Anthropic-Compatible Endpoints](#anthropic-compatible-endpoints)
- [Cohere Endpoints](#cohere-endpoints)
- [AWS Bedrock Endpoints](#aws-bedrock-endpoints)
- [Batches Endpoints](#batches-endpoints)
- [Provider Configuration](#provider-configuration)

---

## Base URL

The orchestrator runs on port **5100** by default. Endpoints are mounted at:

| Prefix                | Description                                                 |
| --------------------- | ----------------------------------------------------------- |
| `/api/orchestrator/*` | Orchestrator management routes                              |
| `/api/*`              | Ollama-compatible inference routes                          |
| `/v1/*`               | OpenAI-compatible, Anthropic-compatible, and Batches routes |
| `/chat/*`             | Cohere routes                                               |
| `/model/*`            | AWS Bedrock routes                                          |

---

## Authentication

The orchestrator supports three authentication mechanisms. All can be used simultaneously.

### Bearer JWT (Cookie-Based)

The orchestrator issues httpOnly JWT cookies on successful login. Subsequent requests automatically include the cookie.

**Login flow:**

```bash
# Step 1: Get CSRF token
curl -c cookies.txt http://localhost:5100/api/orchestrator/auth/csrf-token

# Step 2: Login (token from cookie is sent automatically)
curl -b cookies.txt -X POST http://localhost:5100/api/orchestrator/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"yourpassword"}'
# Response sets access_token and refresh_token httpOnly cookies

# Step 3: Subsequent requests include the cookie automatically
curl -b cookies.txt http://localhost:5100/api/orchestrator/servers
```

**Token refresh:**

```bash
curl -b cookies.txt -X POST http://localhost:5100/api/orchestrator/auth/refresh
```

### API Key (Header-Based)

API keys are configured via environment variables:

| Env Var          | Description                                                    |
| ---------------- | -------------------------------------------------------------- |
| `API_KEYS`       | Comma-separated list of standard API keys (grants `user` role) |
| `ADMIN_API_KEYS` | Comma-separated list of admin API keys (grants `admin` role)   |

```bash
# Standard key
curl -H "X-API-Key: your-api-key" http://localhost:5100/api/orchestrator/servers

# Admin key
curl -H "X-API-Key: your-admin-api-key" http://localhost:5100/api/orchestrator/servers/add

# Also works as Bearer token (for clients that use Authorization header)
curl -H "Authorization: Bearer your-api-key" http://localhost:5100/api/orchestrator/servers
```

### CSRF Protection

State-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) require CSRF validation when `ENABLE_AUTH=true`.

**Option 1 — Same-origin (browsers send automatically):**

Include an `Origin` or `Referer` header matching the server host. Browsers enforce this automatically for same-origin requests.

**Option 2 — Double Submit Cookie (scripts and API clients):**

```bash
# Step 1: Get CSRF token (sets csrf-token cookie)
curl -c cookies.txt http://localhost:5100/api/orchestrator/auth/csrf-token

# Step 2: Extract token from cookie and include in X-CSRF-Token header
TOKEN=$(grep csrf-token cookies.txt | awk '{print $7}')
curl -b cookies.txt -X POST http://localhost:5100/api/orchestrator/auth/logout \
  -H "X-CSRF-Token: $TOKEN"
```

### When Auth Is Disabled (`ENABLE_AUTH=false`)

When `ENABLE_AUTH=false` or `ORCHESTRATOR_AUTH_ENABLED=false`:

- All requests are treated as internal admin
- CSRF validation is skipped
- JWT cookies are still issued but not required
- No API key is required

```bash
# With auth disabled, everything works without credentials
curl http://localhost:5100/api/orchestrator/servers
curl -X POST http://localhost:5100/api/orchestrator/servers/add \
  -H "Content-Type: application/json" \
  -d '{"id":"s1","url":"http://localhost:11434"}'
```

### Auth Config Summary

| Endpoint Group                                  | Auth Required | Auth Type                                             |
| ----------------------------------------------- | ------------- | ----------------------------------------------------- |
| Setup (`POST /api/orchestrator/setup`)          | No            | None                                                  |
| Auth (`/api/orchestrator/auth/*`)               | No            | None (except `/me`)                                   |
| Ollama inference (`/api/*`)                     | Conditional   | `optionalAuth` — JWT cookie, API key, or none         |
| OpenAI (`/v1/*`)                                | Conditional   | `optionalAuth` or `requireAuth` depending on endpoint |
| Anthropic (`/v1/*`)                             | Conditional   | `requireAuth` (most), none (models list)              |
| Batches (`/v1/*`)                               | Mixed         | None (list/get), `requireAuth` (create/cancel)        |
| Cohere (`/chat/*`)                              | Yes           | `requireAuth`                                         |
| Bedrock (`/model/*`)                            | No            | None                                                  |
| Health (`/health/*`)                            | No            | None                                                  |
| Metrics (`/metrics`)                            | No            | localhost-only in production                          |
| Orchestrator monitoring (`/api/orchestrator/*`) | Yes           | `requireAuth` (JWT or API key)                        |
| Orchestrator admin (`/api/orchestrator/*`)      | Yes           | `requireAuth` + `requireAdmin` (JWT or API key)       |
| User management (`/api/orchestrator/users/*`)   | Yes           | `requireAuth` (self or admin for most)                |

---

## Error Response Formats

**Inference routes** (`/api/*`, `/v1/*` excluding `/api/orchestrator/*`):

```json
{
  "error": {
    "message": "The model 'llama2' is not available",
    "type": "server_error",
    "code": "model_not_found"
  }
}
```

**Orchestrator routes** (`/api/orchestrator/*`):

```json
{
  "error": "Error message here",
  "details": "Additional error details"
}
```

RFC 7807 format for 404 responses:

```json
{
  "type": "https://orchestrator.local/errors/not_found",
  "status": 404,
  "title": "Not Found",
  "detail": "Server 'unknown-server' not found"
}
```

**Anthropic format:**

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "Missing required header: anthropic-version"
  }
}
```

**Status Codes:**

| Code | Meaning                                        |
| ---- | ---------------------------------------------- |
| 200  | Success                                        |
| 201  | Created                                        |
| 400  | Bad Request (validation failure)               |
| 401  | Authentication required or failed              |
| 403  | Forbidden (insufficient permissions)           |
| 404  | Not Found                                      |
| 409  | Conflict (e.g., user already exists)           |
| 429  | Rate Limited                                   |
| 500  | Internal Server Error                          |
| 503  | Service Unavailable (e.g., no healthy servers) |

---

## Server-Specific Bypass (`--:serverId`)

Route inference requests directly to a specific server, bypassing the load balancer. Useful for debugging and targeted testing.

**Pattern:** Append `--<serverId>` to the endpoint path before any additional path segments.

**Examples:**

| Standard Endpoint           | Bypass Endpoint                       |
| --------------------------- | ------------------------------------- |
| `POST /api/chat`            | `POST /api/chat--server-1`            |
| `POST /api/generate`        | `POST /api/generate--my-server`       |
| `POST /api/embeddings`      | `POST /api/embeddings--gpu-server-1`  |
| `POST /v1/chat/completions` | `POST /v1/chat/completions--server-1` |
| `POST /v1/completions`      | `POST /v1/completions--server-1`      |
| `POST /v1/embeddings`       | `POST /v1/embeddings--server-1`       |
| `POST /v1/messages`         | `POST /v1/messages--server-1`         |
| `POST /chat/chat`           | `POST /chat/chat--server-1`           |

The `--serverId` suffix is parsed as a route parameter by the matching controller.

---

## Streaming Responses

Three streaming content types are used:

| Content-Type           | Used By                                                                                                             | Format                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `application/x-ndjson` | Ollama endpoints (`/api/generate`, `/api/chat`)                                                                     | Newline-delimited JSON objects |
| `text/event-stream`    | OpenAI SSE (`/v1/chat/completions?stream=true`, `/v1/completions?stream=true`), Anthropic messages, model pull/copy | SSE with `data:` prefix        |
| `application/jsonl`    | Batch results (`/v1/messages/batches/:id/results`)                                                                  | Newline-delimited JSON objects |

**Ollama streaming (NDJSON):**

```
Content-Type: application/x-ndjson
{"model":"llama2:13b","response":"Hello","done":false}
{"model":"llama2:13b","response":"!","done":false}
{"model":"llama2:13b","response":"","done":true,"total_duration":5000000000}
```

**OpenAI/Anthropic SSE:**

```
Content-Type: text/event-stream

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}

data: [DONE]
```

**Model pull/copy progress (SSE):**

```
data: {"status":"pulling manifest","digest":"sha256:..."}
data: {"status":"pulling分层","digested":"sha256:...","size":"10MB"}
data: {"status":"success"}
```

---

## Setup

### POST /api/orchestrator/setup

Create the initial admin user. Only works when no admin users exist.

**Auth:** None (rate-limited with admin rate limiter)

**Request Body:**

```json
{
  "username": "admin",
  "email": "admin@example.com",
  "password": "your-secure-password"
}
```

| Field      | Type   | Required | Description                        |
| ---------- | ------ | -------- | ---------------------------------- |
| `username` | string | Yes      | 3-64 chars, alphanumeric + `_` `-` |
| `email`    | string | No       | Valid email format                 |
| `password` | string | Yes      | 16-128 characters                  |

**Response (200):**

```json
{
  "success": true,
  "message": "Admin created. Please log in."
}
```

**Errors:**

- `403` — Setup already completed (admin users exist)
- `400` — Validation failed

---

## Authentication Endpoints

All auth endpoints are prefixed with `/api/orchestrator/auth`.

### GET /api/orchestrator/auth/csrf-token

Retrieve a CSRF token. Sets the `csrf-token` cookie.

**Auth:** None

**Response (200):**

```json
{
  "message": "CSRF token set"
}
```

### POST /api/orchestrator/auth/login

Authenticate and receive JWT cookies.

**Auth:** None (CSRF required)

**Request Body:**

```json
{
  "username": "admin",
  "password": "password"
}
```

**Response (200):**

```json
{
  "user": {
    "id": "usr_abc123",
    "username": "admin",
    "email": "admin@local",
    "role": "admin"
  }
}
```

**Errors:**

- `400` — Validation failed
- `401` — Invalid credentials

### POST /api/orchestrator/auth/logout

Clear authentication cookies.

**Auth:** None (CSRF required)

**Response (200):**

```json
{
  "message": "Logged out successfully"
}
```

### POST /api/orchestrator/auth/refresh

Refresh the access token using the refresh cookie.

**Auth:** None (CSRF required)

**Response (200):**

```json
{
  "user": {
    "id": "usr_abc123",
    "username": "admin",
    "email": "admin@local",
    "role": "admin"
  }
}
```

**Errors:**

- `401` — No refresh token or invalid/expired refresh token

### GET /api/orchestrator/auth/status

Check authentication configuration status.

**Auth:** None

**Response (200):**

```json
{
  "enabled": true,
  "setupRequired": false
}
```

| Field           | Type    | Description                                        |
| --------------- | ------- | -------------------------------------------------- |
| `enabled`       | boolean | Whether auth is enabled                            |
| `setupRequired` | boolean | True when auth is enabled but no admin user exists |

### GET /api/orchestrator/auth/me

Get current authenticated user info.

**Auth:** Required (`requireAuth`)

**Response (200):**

```json
{
  "user": {
    "id": "usr_abc123",
    "username": "admin",
    "email": "admin@local",
    "role": "admin"
  },
  "needsSetup": false
}
```

**Errors:**

- `401` — Not authenticated

---

## Health and Metrics

### GET /health

Full health check with orchestrator statistics.

**Auth:** None

**Response (200):**

```json
{
  "status": "ok",
  "uptime": 3600.5,
  "timestamp": "2026-01-01T12:00:00.000Z",
  "healthy": 5,
  "total": 6,
  "orchestrator": {
    "totalServers": 6,
    "healthyServers": 5,
    "inFlightRequests": 12,
    "circuitBreakersByState": {
      "HEALTHY": 24,
      "RECOVERING": 1,
      "SUSPECT": 0,
      "UNHEALTHY": 0
    }
  }
}
```

### GET /health/live

Liveness probe. Returns 200 if the process is running.

**Auth:** None

**Response (200):**

```json
{
  "status": "ok"
}
```

### GET /health/ready

Readiness probe. Returns 503 if no healthy servers are available.

**Auth:** None

**Response (200):**

```json
{
  "status": "ready",
  "healthyServers": 5
}
```

**Response (503):**

```json
{
  "status": "not_ready",
  "reason": "No healthy servers available",
  "totalServers": 6
}
```

### GET /metrics

Prometheus-compatible metrics endpoint.

**Auth:** None (localhost/internal IPs only in production)

**Response (200):**

```
# HELP orchestrator_requests_total Total number of requests
# TYPE orchestrator_requests_total counter
orchestrator_requests_total{method="POST",endpoint="/api/chat"} 1234
...
```

---

## Orchestrator Monitoring Endpoints

All endpoints in this section are prefixed with `/api/orchestrator` and require authentication (`requireAuth`).

### Servers

### GET /api/orchestrator/servers

List all registered servers with status.

**Auth:** Required

**Query Parameters:**

| Param           | Type    | Default | Description                 |
| --------------- | ------- | ------- | --------------------------- |
| `excludeGhosts` | boolean | false   | Exclude ghost servers       |
| `healthyOnly`   | boolean | false   | Return only healthy servers |

**Response (200):**

```json
{
  "success": true,
  "count": 6,
  "ghostCount": 1,
  "servers": [
    {
      "id": "server-1",
      "url": "http://localhost:11434",
      "maxConcurrency": 4,
      "status": "healthy",
      "healthy": true,
      "draining": false,
      "maintenance": false,
      "models": ["llama2:13b", "codellama:7b"],
      "tags": [],
      "lastHealthCheck": 1735689600000,
      "inFlightRequests": 2
    }
  ]
}
```

### GET /api/orchestrator/model-map

Get model-to-server and server-to-model mappings.

**Auth:** Required

**Response (200):**

```json
{
  "success": true,
  "modelToServers": {
    "llama2:13b": ["server-1", "server-2"],
    "codellama:7b": ["server-1"]
  },
  "serverToModels": {
    "server-1": ["llama2:13b", "codellama:7b"],
    "server-2": ["llama2:13b"]
  }
}
```

### GET /api/orchestrator/models

List all models across the fleet.

**Auth:** Required

**Response (200):**

```json
{
  "success": true,
  "count": 12,
  "models": [
    {
      "name": "llama2:13b",
      "servers": ["server-1", "server-2"],
      "totalServers": 2,
      "loadedCount": 2
    }
  ]
}
```

### GET /api/orchestrator/health

Get orchestrator health status.

**Auth:** Required

**Response (200):**

```json
{
  "success": true,
  "status": "healthy",
  "uptime": 3600,
  "version": "1.0.0"
}
```

### POST /api/orchestrator/health-check

Trigger immediate health checks on all servers.

**Auth:** Required

**Response (200):**

```json
{
  "success": true,
  "servers": [
    {
      "id": "server-1",
      "status": "healthy",
      "latencyMs": 45
    }
  ]
}
```

### GET /api/orchestrator/stats

Get comprehensive orchestrator statistics.

**Auth:** Required

**Response (200):**

```json
{
  "success": true,
  "stats": {
    "totalServers": 6,
    "healthyServers": 5,
    "inFlightRequests": 12,
    "totalRequests": 5432,
    "averageLatencyMs": 250,
    "errorRate": 0.02
  }
}
```

### Events Stream

### GET /api/orchestrator/events

Server-Sent Events stream of real-time metrics.

**Auth:** Required

**Content-Type:** `text/event-stream`

**Response (200):**

```
data: {"type":"metrics","totalRequests":5432,"inFlightRequests":12,"healthyServers":5}

data: {"type":"decision","serverId":"server-1","model":"llama2:13b","latencyMs":245}

data: {"type":"circuit_breaker","serverId":"server-2","model":"codellama:7b","state":"OPEN"}
```

### Circuit Breakers (Read)

### GET /api/orchestrator/circuit-breakers

Get all circuit breakers and summary by state.

**Auth:** Required

**Response (200):**

```json
{
  "success": true,
  "circuitBreakers": [
    {
      "serverId": "server-1",
      "model": "llama2:13b",
      "state": "CLOSED",
      "failureCount": 0,
      "lastFailure": null,
      "lastStateChange": 1735689000000
    }
  ],
  "byState": {
    "CLOSED": 24,
    "HALF_OPEN": 1,
    "OPEN": 0
  }
}
```

### GET /api/orchestrator/servers/:serverId/models/:model/circuit-breaker

Get circuit breaker details for a specific server:model.

**Auth:** Required

**Response (200):**

```json
{
  "success": true,
  "circuitBreaker": {
    "serverId": "server-1",
    "model": "llama2:13b",
    "state": "CLOSED",
    "failureCount": 0,
    "lastFailure": null,
    "lastStateChange": 1735689000000,
    "recoveryAttempts": 0,
    "totalRequests": 150,
    "successfulRequests": 148,
    "failedRequests": 2
  }
}
```

### Metrics

### GET /api/orchestrator/metrics

Get detailed metrics for all servers and global statistics.

**Auth:** Required

**Response (200):**

```json
{
  "success": true,
  "timestamp": "2026-01-01T12:00:00.000Z",
  "global": {
    "totalRequests": 5432,
    "errorRate": 0.02,
    "avgLatencyMs": 250,
    "p95LatencyMs": 850,
    "p99LatencyMs": 1200,
    "requestsPerSecond": 1.5
  },
  "servers": [
    {
      "id": "server-1",
      "status": "healthy",
      "requests": 2100,
      "errors": 42,
      "avgLatencyMs": 245,
      "p95LatencyMs": 820,
      "p99LatencyMs": 1100,
      "utilization": 0.65
    }
  ]
}
```

### GET /api/orchestrator/metrics/prometheus

Get Prometheus-format metrics.

**Auth:** Required

**Response (200):** Prometheus text format (same as `/metrics`)

### GET /api/orchestrator/metrics/:serverId/:model

Get metrics for a specific server:model combination.

**Auth:** Required

**Response (200):**

```json
{
  "success": true,
  "serverId": "server-1",
  "model": "llama2:13b",
  "metrics": {
    "totalRequests": 500,
    "errorRate": 0.02,
    "avgLatencyMs": 240,
    "p95LatencyMs": 800,
    "ttftMs": { "avg": 120, "p95": 350 },
    "successRate": 0.98
  }
}
```

### GET /api/orchestrator/metrics/recovery-tests

Get aggregate recovery test metrics.

**Auth:** Required

**Response (200):**

```json
{
  "success": true,
  "aggregate": {
    "totalTests": 45,
    "passed": 42,
    "failed": 3,
    "passRate": 0.933
  },
  "recoveryProbabilities": {
    "server-1/llama2:13b": 0.95,
    "server-2/llama2:13b": 0.88
  }
}
```

### GET /api/orchestrator/metrics/recovery-tests/:breakerName

Get recovery test history for a specific circuit breaker.

**Auth:** Required

**Response (200):**

```json
{
  "success": true,
  "breakerName": "server-1/llama2:13b",
  "recoveryEvents": [
    {
      "timestamp": "2026-01-01T10:00:00.000Z",
      "testResult": "SUCCESS",
      "latencyMs": 150
    }
  ]
}
```

### Recovery Tests

### GET /api/orchestrator/in-flight

Get all currently in-flight requests.

**Auth:** Required

**Response (200):**

```json
{
  "total": 12,
  "inFlight": [
    {
      "id": "req_abc123",
      "serverId": "server-1",
      "model": "llama2:13b",
      "startTime": "2026-01-01T12:00:00.000Z",
      "promptTokens": 50,
      "outputTokens": 0
    }
  ]
}
```

### Performance Probe

### POST /api/orchestrator/performance-probe

Start an async performance probe across the fleet. Returns immediately with a task ID.

**Auth:** Required

**Response (202):**

```json
{
  "taskId": "probe_abc123",
  "status": "running",
  "probeModels": ["llama2:13b", "codellama:7b"],
  "totalProbes": 12
}
```

### GET /api/orchestrator/performance-probe/:taskId

Get status of a performance probe task.

**Auth:** Required

**Response (200):**

```json
{
  "taskId": "probe_abc123",
  "status": "completed",
  "results": [
    {
      "serverId": "server-1",
      "model": "llama2:13b",
      "ttftMs": 120,
      "throughput": 45.2
    }
  ]
}
```

### DELETE /api/orchestrator/performance-probe/:taskId

Cancel a running performance probe.

**Auth:** Required

**Response (200):**

```json
{
  "taskId": "probe_abc123",
  "status": "cancelled"
}
```

### GET /api/orchestrator/performance-probe/history

Get historical performance probe data points.

**Auth:** Required

**Query Parameters:**

| Param             | Type   | Description          |
| ----------------- | ------ | -------------------- |
| `serverId`        | string | Filter by server     |
| `model`           | string | Filter by model      |
| `startTime`       | string | ISO timestamp start  |
| `endTime`         | string | ISO timestamp end    |
| `intervalMinutes` | number | Aggregation interval |

**Response (200):**

```json
{
  "dataPoints": [
    {
      "timestamp": "2026-01-01T12:00:00.000Z",
      "serverId": "server-1",
      "model": "llama2:13b",
      "ttftMs": 120,
      "throughput": 45.2
    }
  ]
}
```

### GET /api/orchestrator/performance-probe/history/export

Export performance probe history as CSV or JSON.

**Auth:** Required

**Query Parameters:**

| Param       | Type   | Description                    |
| ----------- | ------ | ------------------------------ |
| `format`    | string | `csv` or `json` (default: csv) |
| `serverId`  | string | Filter by server               |
| `model`     | string | Filter by model                |
| `startTime` | string | ISO timestamp start            |
| `endTime`   | string | ISO timestamp end              |

**Response (200):** File download with `Content-Disposition: attachment`

### GET /api/orchestrator/performance-probe/scheduler-status

Get the performance probe scheduler status.

**Auth:** Required

**Response (200):**

```json
{
  "success": true,
  "enabled": true,
  "intervalMs": 86400000,
  "lastRun": "2026-01-01T00:00:00.000Z",
  "nextRun": "2026-01-02T00:00:00.000Z",
  "jitterMs": 5000,
  "maxConcurrent": 8
}
```

### GET /api/orchestrator/performance-probe/recent

Get recent performance probe tasks.

**Auth:** Required

**Query Parameters:**

| Param   | Type   | Default | Description         |
| ------- | ------ | ------- | ------------------- |
| `limit` | number | 10      | Max tasks to return |

**Response (200):**

```json
{
  "tasks": [
    {
      "taskId": "probe_abc123",
      "status": "completed",
      "completedAt": "2026-01-01T12:05:00.000Z"
    }
  ]
}
```

### GET /api/orchestrator/performance-probe/coverage-grid

Get probe coverage grid showing which server:model pairs have been tested.

**Auth:** Required

**Query Parameters:**

| Param      | Type   | Default | Description         |
| ---------- | ------ | ------- | ------------------- |
| `days`     | number | 7       | Time window in days |
| `serverId` | string | —       | Filter by server    |

**Response (200):**

```json
{
  "success": true,
  "grid": [
    {
      "serverId": "server-1",
      "model": "llama2:13b",
      "lastProbed": "2026-01-01T12:00:00.000Z",
      "probeCount": 24
    }
  ]
}
```

### GET /api/orchestrator/performance-probe/scheduled-probes

Get scheduled probes for new server:model pairs.

**Auth:** Required

**Response (200):**

```json
{
  "success": true,
  "newServerProbes": [
    {
      "serverId": "server-3",
      "model": "llama2:13b",
      "scheduledAt": "2026-01-01T12:10:00.000Z"
    }
  ]
}
```

### POST /api/orchestrator/performance-probe/server/:serverId

Run performance probe for a specific server.

**Auth:** Required

**Response (202):**

```json
{
  "success": true,
  "taskId": "probe_xyz789"
}
```

### Errors

### GET /api/orchestrator/errors

Get recent error events.

**Auth:** Required

**Query Parameters:**

| Param       | Type   | Description               |
| ----------- | ------ | ------------------------- |
| `startTime` | string | ISO timestamp start       |
| `endTime`   | string | ISO timestamp end         |
| `errorType` | string | Filter by error type      |
| `limit`     | number | Max results (default 100) |

**Response (200):**

```json
{
  "success": true,
  "errors": [
    {
      "id": "err_abc123",
      "timestamp": "2026-01-01T12:00:00.000Z",
      "serverId": "server-1",
      "model": "llama2:13b",
      "errorType": "timeout",
      "message": "Request timed out after 30000ms",
      "recoverable": true
    }
  ],
  "count": 1,
  "total": 45
}
```

### GET /api/orchestrator/errors/:serverId

Get errors for a specific server.

**Auth:** Required

**Query Parameters:** Same as `/errors`

**Response (200):**

```json
{
  "success": true,
  "errors": [...]
}
```

### GET /api/orchestrator/errors/:serverId/:circuitId

Get errors for a specific circuit (server:model).

**Auth:** Required

**Query Parameters:** Same as `/errors`

**Response (200):**

```json
{
  "success": true,
  "errors": [...]
}
```

### Cluster Status

### GET /api/orchestrator/cluster-status

Get cluster-wide status summary.

**Auth:** Required

**Response (200):**

```json
{
  "status": "ok",
  "data": {
    "totalServers": 6,
    "healthyServers": 5,
    "degradedServers": 1,
    "downServers": 0,
    "averageResponseTime": 0,
    "totalInFlight": 12,
    "errorRate": 0.02,
    "servers": [
      {
        "serverId": "server-1",
        "status": "healthy",
        "lastHealthCheck": 0,
        "responseTime": 0,
        "inFlight": 2,
        "errorRate": 0
      }
    ]
  }
}
```

---

## Orchestrator Admin Endpoints

All endpoints in this section are prefixed with `/api/orchestrator` and require admin authentication (`requireAdmin`) unless noted.

### Server Management

### POST /api/orchestrator/servers/add

Add a new server to the fleet.

**Auth:** Admin required

**Request Body:**

```json
{
  "id": "server-1",
  "url": "http://localhost:11434",
  "type": "ollama",
  "maxConcurrency": 4,
  "apiKey": "optional-api-key"
}
```

| Field            | Type   | Required | Description                                     |
| ---------------- | ------ | -------- | ----------------------------------------------- |
| `id`             | string | No       | Unique identifier (auto-generated if omitted)   |
| `url`            | string | Yes      | Server URL                                      |
| `type`           | string | No       | `ollama`, `openai`, or `auto` (default: `auto`) |
| `maxConcurrency` | number | No       | Max concurrent requests (default: 4)            |
| `apiKey`         | string | No       | API key for the server                          |

**Response (201):**

```json
{
  "success": true,
  "id": "server-1",
  "url": "http://localhost:11434",
  "maxConcurrency": 4
}
```

### DELETE /api/orchestrator/servers/:id

Remove a server from the fleet.

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "id": "server-1"
}
```

### PATCH /api/orchestrator/servers/:id

Update server configuration.

**Auth:** Required (not admin-level — any authenticated user)

**Request Body:**

```json
{
  "maxConcurrency": 8
}
```

| Field            | Type   | Required | Description                 |
| ---------------- | ------ | -------- | --------------------------- |
| `maxConcurrency` | number | No       | New max concurrent requests |

**Response (200):**

```json
{
  "success": true,
  "id": "server-1",
  "maxConcurrency": 8
}
```

### POST /api/orchestrator/servers/:id/capability-probe

Probe server capabilities.

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "confirmed": ["supportsOllama", "supportsV1"],
  "revoked": [],
  "rateLimited": false
}
```

### GET /api/orchestrator/anthropic/servers/:serverId/capabilities

Get Anthropic-specific capabilities for a server.

**Auth:** Required

**Response (200):**

```json
{
  "serverId": "server-1",
  "type": "openai",
  "supportsAnthropic": true,
  "endpointOverrides": {
    "anthropic_messages": "/v1/messages"
  }
}
```

### POST /api/orchestrator/servers/test-connection

Test connection to a server without adding it.

**Auth:** Admin required

**Request Body:**

```json
{
  "url": "http://localhost:11434",
  "apiKey": "optional-key",
  "name": "test-server"
}
```

**Response (202):**

```json
{
  "success": true,
  "testId": "test_abc123",
  "status": "pending"
}
```

### GET /api/orchestrator/servers/test-connection/:testId

Get result of a connection test.

**Auth:** Admin required

**Response (200):**

```json
{
  "testId": "test_abc123",
  "status": "completed",
  "progress": 100,
  "result": {
    "url": "http://localhost:11434",
    "reachable": true,
    "version": "0.5.0"
  }
}
```

### POST /api/orchestrator/servers/:id/test

Test an existing server.

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "status": "healthy",
  "capabilities": {
    "supportsOllama": true,
    "supportsV1": true,
    "supportsAnthropic": false
  },
  "models": ["llama2:13b", "codellama:7b"]
}
```

### GET /api/orchestrator/servers/ghost-stats

Get ghost server statistics.

**Auth:** Required

**Query Parameters:**

| Param           | Type    | Default | Description                |
| --------------- | ------- | ------- | -------------------------- |
| `limit`         | number  | 10      | Max results                |
| `onlyRemovable` | boolean | false   | Only show removable ghosts |

**Response (200):**

```json
{
  "thresholdMs": 300000,
  "summary": {
    "totalGhosts": 2,
    "removableGhosts": 1
  },
  "servers": [...]
}
```

### Server Configuration

### PATCH /api/orchestrator/servers/:id/config

Update advanced server configuration.

**Auth:** Required

**Request Body:**

```json
{
  "type": "openai",
  "v1Models": ["gpt-4", "gpt-3.5-turbo"],
  "forcedCapabilities": {
    "supportsOllama": false,
    "supportsV1": true,
    "supportsAnthropic": false
  },
  "endpointOverrides": {
    "anthropic_messages": "/v1/messages",
    "anthropic_auth": {
      "headerName": "x-api-key",
      "headerPrefix": ""
    },
    "modelPrefix": "anthropic/"
  }
}
```

| Field                | Type     | Required | Description                          |
| -------------------- | -------- | -------- | ------------------------------------ |
| `type`               | string   | No       | `ollama`, `openai`, or `auto`        |
| `v1Models`           | string[] | No       | Models supporting OpenAI v1 protocol |
| `forcedCapabilities` | object   | No       | Override capability detection        |
| `endpointOverrides`  | object   | No       | Custom endpoint configuration        |

**Response (200):**

```json
{
  "success": true,
  "id": "server-1",
  "type": "openai",
  "v1Models": ["gpt-4"],
  "forcedCapabilities": {...},
  "endpointOverrides": {...}
}
```

### POST /api/orchestrator/servers/:id/refresh-v1-models

Refresh the list of v1-compatible models from a server.

**Auth:** Required

**Response (200):**

```json
{
  "success": true,
  "discoveredV1Models": ["gpt-4", "gpt-3.5-turbo"]
}
```

### Server Maintenance

### POST /api/orchestrator/servers/:id/drain

Gracefully drain a server (stop accepting new requests, wait for existing to complete).

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "id": "server-1",
  "draining": true,
  "drainStartedAt": "2026-01-01T12:00:00.000Z"
}
```

### POST /api/orchestrator/servers/:id/undrain

Remove server from drained state.

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "id": "server-1",
  "draining": false
}
```

### POST /api/orchestrator/servers/:id/maintenance

Enable or disable maintenance mode.

**Auth:** Admin required

**Request Body:**

```json
{
  "enabled": true
}
```

**Response (200):**

```json
{
  "success": true,
  "id": "server-1",
  "maintenance": {
    "enabled": true,
    "startedAt": "2026-01-01T12:00:00.000Z"
  }
}
```

### Per-Server Model Management

### GET /api/orchestrator/servers/:id/models

List models available on a specific server.

**Auth:** Required

**Response (200):**

```json
{
  "success": true,
  "serverId": "server-1",
  "models": ["llama2:13b", "codellama:7b", "mistral:7b"]
}
```

### POST /api/orchestrator/servers/:id/models/pull

Pull a model to a specific server. Streams progress events.

**Auth:** Admin required

**Request Body:**

```json
{
  "model": "llama2:13b"
}
```

**Response (200):** SSE stream of progress events:

```
data: {"status":"pulling manifest","digest":"sha256:..."}
data: {"status":"pulling分层","digested":"sha256:...","size":"10MB"}
data: {"status":"success"}
```

### DELETE /api/orchestrator/servers/:id/models/:model

Delete a model from a specific server.

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "message": "Model 'llama2:13b' deleted from server-1"
}
```

### POST /api/orchestrator/servers/:id/models/copy

Copy/pull a model to a specific server. Streams progress events.

**Auth:** Admin required

**Request Body:**

```json
{
  "model": "llama2:13b",
  "sourceServerId": "server-1"
}
```

| Field            | Type   | Required | Description                                         |
| ---------------- | ------ | -------- | --------------------------------------------------- |
| `model`          | string | Yes      | Model name                                          |
| `sourceServerId` | string | No       | Source server (if not specified, pulls from origin) |

**Response (200):** SSE stream (same format as `/models/pull`)

### Model Actions

### POST /api/orchestrator/models/:model/warmup

Warmup a model on specified servers or all servers.

**Auth:** Admin required

**Request Body:**

```json
{
  "servers": ["server-1", "server-2"],
  "priority": "normal"
}
```

| Field      | Type     | Required | Description                                |
| ---------- | -------- | -------- | ------------------------------------------ |
| `servers`  | string[] | No       | Target server IDs (all servers if omitted) |
| `priority` | string   | No       | `low`, `normal`, `high`                    |

**Response (200):**

```json
{
  "success": true,
  "jobs": [
    {
      "serverId": "server-1",
      "status": "loading",
      "estimatedTime": 15000
    }
  ],
  "summary": {
    "totalServers": 3,
    "loadedOn": 1,
    "loadingOn": 2,
    "failedOn": 0
  }
}
```

### POST /api/orchestrator/models/:model/unload

Unload a model from servers to free memory.

**Auth:** Admin required

**Request Body:**

```json
{
  "serverId": "server-1"
}
```

| Field      | Type   | Required | Description                              |
| ---------- | ------ | -------- | ---------------------------------------- |
| `serverId` | string | No       | Specific server (all servers if omitted) |

**Response (200):**

```json
{
  "success": true,
  "results": [
    {
      "serverId": "server-1",
      "status": "unloaded"
    }
  ],
  "summary": {
    "totalServers": 3,
    "unloaded": 2,
    "failed": 0
  }
}
```

### POST /api/orchestrator/models/:model/cancel

Cancel a pending warmup operation.

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "cancelled": true
}
```

### GET /api/orchestrator/models/status

Get warmup status for all models.

**Auth:** Required

**Response (200):**

```json
{
  "success": true,
  "summary": {
    "totalModels": 5,
    "totalServers": 6,
    "loadedModels": 10,
    "loadingModels": 2
  },
  "models": [
    {
      "model": "llama2:13b",
      "status": {
        "totalServers": 3,
        "loadedOn": 2,
        "loadingOn": 1,
        "notLoadedOn": 0
      },
      "servers": [
        {
          "serverId": "server-1",
          "status": "loaded",
          "loadTime": 12345
        }
      ]
    }
  ]
}
```

### GET /api/orchestrator/models/recommendations

Get warmup recommendations based on usage patterns.

**Auth:** Required

**Response (200):**

```json
{
  "success": true,
  "recommendations": [
    {
      "model": "codellama:13b",
      "reason": "High usage pattern detected in last 24h",
      "priority": "high"
    }
  ]
}
```

### GET /api/orchestrator/models/idle

List models that have not been used recently.

**Auth:** Required

**Query Parameters:**

| Param       | Type   | Default | Description                            |
| ----------- | ------ | ------- | -------------------------------------- |
| `threshold` | number | 1800000 | Idle threshold in ms (default: 30 min) |

**Response (200):**

```json
{
  "success": true,
  "threshold": 1800000,
  "models": [
    {
      "model": "llama2:7b",
      "lastUsed": "2026-01-01T10:00:00.000Z",
      "idleTimeMs": 7200000
    }
  ]
}
```

### GET /api/orchestrator/models/:model/status

Get status for a specific model.

**Auth:** Required

**Response (200):**

```json
{
  "success": true,
  "model": "llama2:13b",
  "status": {
    "totalServers": 3,
    "loadedOn": 2,
    "loadingOn": 1,
    "notLoadedOn": 0,
    "failedOn": 0
  },
  "servers": [...]
}
```

### GET /api/orchestrator/models/fleet-stats

Get fleet-wide model statistics.

**Auth:** Required

**Response (200):**

```json
{
  "success": true,
  "totalServers": 6,
  "popularModels": [
    {
      "model": "llama2:13b",
      "serverCount": 6,
      "avgLoadTime": 15000
    }
  ]
}
```

### Configuration

### GET /api/orchestrator/config

Get current orchestrator configuration.

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "config": {
    "port": 5100,
    "loadBalancer": {
      "algorithm": "fastest-response",
      "weights": {...}
    },
    "circuitBreaker": {...},
    "security": {...}
  },
  "source": "config.yaml"
}
```

### GET /api/orchestrator/config/schema

Get JSON schema for configuration validation.

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "schema": {...}
}
```

### GET /api/orchestrator/config/export

Export current configuration.

**Auth:** Admin required

**Response (200):**

```json
{
  "exportedAt": "2026-01-01T12:00:00.000Z",
  "version": "1.0.0",
  "config": {...}
}
```

### POST /api/orchestrator/config

Update full configuration.

**Auth:** Admin required

**Request Body:** Partial or full configuration object

**Response (200):**

```json
{
  "success": true,
  "config": {...}
}
```

### PATCH /api/orchestrator/config/:section

Update a specific configuration section.

**Auth:** Admin required

**Path Parameters:**

- `section` — Config section name (e.g., `loadBalancer`, `circuitBreaker`, `security`)

**Request Body:** Partial configuration for that section

**Response (200):**

```json
{
  "success": true,
  "section": "loadBalancer",
  "config": {...}
}
```

### POST /api/orchestrator/config/reload

Reload configuration from file.

**Auth:** Admin required

**Request Body:**

```json
{
  "configPath": "/path/to/config.yaml"
}
```

| Field        | Type   | Required | Description                                   |
| ------------ | ------ | -------- | --------------------------------------------- |
| `configPath` | string | No       | Path to config file (uses default if omitted) |

**Response (200):**

```json
{
  "success": true,
  "config": {...}
}
```

### POST /api/orchestrator/config/reload-from-env

Reload configuration from environment variables.

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "config": {...}
}
```

### POST /api/orchestrator/config/save

Save current configuration to file.

**Auth:** Admin required

**Request Body:**

```json
{
  "configPath": "/path/to/save.yaml"
}
```

| Field        | Type   | Required | Description                               |
| ------------ | ------ | -------- | ----------------------------------------- |
| `configPath` | string | No       | Path to save to (uses default if omitted) |

**Response (200):**

```json
{
  "success": true,
  "path": "/path/to/save.yaml"
}
```

### POST /api/orchestrator/config/import

Import configuration from a JSON object.

**Auth:** Admin required (CSRF required)

**Request Body:**

```json
{
  "config": {...},
  "version": "1.0.0"
}
```

**Response (200):**

```json
{
  "success": true,
  "mode": "replace",
  "config": {...}
}
```

### Ban Management

### GET /api/orchestrator/bans

Get all active bans.

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "count": 2,
  "bans": [
    {
      "serverId": "server-1",
      "model": "llama2:13b",
      "bannedAt": "2026-01-01T12:00:00.000Z",
      "reason": "excessive_errors"
    }
  ]
}
```

### DELETE /api/orchestrator/bans

Clear all bans.

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "removed": 5
}
```

### DELETE /api/orchestrator/bans/server/:serverId

Clear all bans for a specific server.

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "removed": 2
}
```

### DELETE /api/orchestrator/bans/model/:model

Clear all bans for a specific model.

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "removed": 3
}
```

### DELETE /api/orchestrator/bans/:serverId/:model

Remove a specific ban.

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "message": "Ban removed for server-1/llama2:13b"
}
```

### Circuit Breaker Management (Write)

### GET /api/orchestrator/circuit-breakers/:serverId/:model

Get circuit breaker state for a server:model.

**Auth:** Admin required

**Response (200):** StateProjection object with fields like `state`, `failureCount`, `lastFailure`, etc.

### POST /api/orchestrator/circuit-breakers/:serverId/:model/reset

Reset circuit breaker to closed state.

**Auth:** Admin required

**Response (200):**

```json
{
  "message": "Circuit breaker reset",
  "previousState": "HALF_OPEN",
  "currentState": "CLOSED"
}
```

### POST /api/orchestrator/circuit-breakers/:serverId/:model/open

Force circuit breaker to open state.

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "message": "Circuit breaker forced open",
  "circuitBreaker": {...}
}
```

### POST /api/orchestrator/circuit-breakers/:serverId/:model/close

Force circuit breaker to closed state.

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "message": "Circuit breaker forced closed",
  "circuitBreaker": {...}
}
```

### POST /api/orchestrator/circuit-breakers/:serverId/:model/half-open

Force circuit breaker to half-open state.

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "message": "Circuit breaker forced to half-open",
  "circuitBreaker": {...}
}
```

### GET /api/orchestrator/circuit-breakers/:serverId

Get all circuit breakers for a server.

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "state": "HALF_OPEN",
  "uiState": {...},
  "breakers": [...]
}
```

### POST /api/orchestrator/circuit-breakers/:serverId/reset

Reset all circuit breakers for a server.

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "resetCount": 5
}
```

### POST /api/orchestrator/circuit-breakers/server/:serverId/reset-all

Reset all circuit breakers for a server (alternate path).

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "resetCount": 5
}
```

### DELETE /api/orchestrator/circuit-breakers/server/:serverId

Delete all circuit breakers for a server.

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "deletedCount": 5
}
```

### GET /api/orchestrator/servers/circuit-breakers

Get circuit breakers for all servers.

**Auth:** Required

**Response (200):**

```json
{
  "success": true,
  "circuitBreakers": [...]
}
```

### GET /api/orchestrator/models/circuit-breakers

Get circuit breakers grouped by model.

**Auth:** Required

**Response (200):**

```json
{
  "success": true,
  "models": {
    "llama2:13b": [...],
    "codellama:7b": [...]
  }
}
```

### POST /api/orchestrator/servers/:serverId/models/:model/recovery-test

Manually trigger a recovery test for a server:model.

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "breakerState": "HALF_OPEN"
}
```

### Recovery Failure Tracking

### GET /api/orchestrator/recovery-failures

Get recovery failures summary.

**Auth:** Admin required

**Query Parameters:**

| Param      | Type   | Default | Description       |
| ---------- | ------ | ------- | ----------------- |
| `windowMs` | number | 3600000 | Time window in ms |

**Response (200):** Summary object with failure statistics

### GET /api/orchestrator/recovery-failures/stats/all

Get recovery statistics for all servers.

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "servers": [
    {
      "serverId": "server-1",
      "totalFailures": 5,
      "recoveryAttempts": 10,
      "successfulRecoveries": 8
    }
  ]
}
```

### GET /api/orchestrator/recovery-failures/recent

Get recent failure records.

**Auth:** Admin required

**Query Parameters:**

| Param   | Type   | Default | Description |
| ------- | ------ | ------- | ----------- |
| `limit` | number | 50      | Max records |

**Response (200):**

```json
{
  "success": true,
  "records": [
    {
      "serverId": "server-1",
      "model": "llama2:13b",
      "failureTime": "2026-01-01T12:00:00.000Z",
      "failureType": "timeout"
    }
  ]
}
```

### GET /api/orchestrator/recovery-failures/:serverId

Get recovery statistics for a specific server.

**Auth:** Admin required

**Response (200):** Server recovery stats object

### GET /api/orchestrator/recovery-failures/:serverId/history

Get failure history for a server.

**Auth:** Admin required

**Query Parameters:**

| Param    | Type   | Default | Description       |
| -------- | ------ | ------- | ----------------- |
| `limit`  | number | 100     | Max records       |
| `offset` | number | 0       | Pagination offset |

**Response (200):**

```json
{
  "success": true,
  "history": [...]
}
```

### GET /api/orchestrator/recovery-failures/:serverId/analysis

Analyze failures for a specific server.

**Auth:** Admin required

**Query Parameters:**

| Param      | Type   | Default | Description          |
| ---------- | ------ | ------- | -------------------- |
| `windowMs` | number | 3600000 | Analysis time window |

**Response (200):** Analysis object with patterns and recommendations

### GET /api/orchestrator/recovery-failures/:serverId/circuit-breaker-impact

Get circuit breaker impact analysis for a server.

**Auth:** Admin required

**Response (200):** Impact analysis object

### GET /api/orchestrator/recovery-failures/:serverId/circuit-breaker-transitions

Get circuit breaker state transitions for a server.

**Auth:** Admin required

**Query Parameters:**

| Param   | Type   | Default | Description     |
| ------- | ------ | ------- | --------------- |
| `model` | string | —       | Filter by model |
| `limit` | number | 100     | Max transitions |

**Response (200):**

```json
{
  "success": true,
  "transitions": [
    {
      "model": "llama2:13b",
      "fromState": "CLOSED",
      "toState": "OPEN",
      "timestamp": "2026-01-01T12:00:00.000Z"
    }
  ]
}
```

### POST /api/orchestrator/recovery-failures/:serverId/reset

Reset recovery statistics for a server.

**Auth:** Admin required

**Response (200):**

```json
{
  "success": true,
  "message": "Recovery stats reset for server-1"
}
```

### Logging

### GET /api/orchestrator/logs

Get application logs.

**Auth:** Required

**Query Parameters:**

| Param   | Type   | Default | Description                                        |
| ------- | ------ | ------- | -------------------------------------------------- |
| `limit` | number | 100     | Max log entries                                    |
| `level` | string | —       | Filter by level (`debug`, `info`, `warn`, `error`) |
| `since` | string | —       | ISO timestamp — return logs after this time        |

**Response (200):**

```json
{
  "logs": [
    {
      "timestamp": "2026-01-01T12:00:00.000Z",
      "level": "info",
      "message": "Server added: server-1",
      "requestId": "req_abc123"
    }
  ],
  "count": 1,
  "total": 150
}
```

### POST /api/orchestrator/logs/clear

Clear application logs.

**Auth:** Admin required

**Response (200):**

```json
{
  "message": "Logs cleared"
}
```

### POST /api/orchestrator/logs/client-error

Report a client-side error.

**Auth:** Admin required

**Request Body:**

```json
{
  "message": "Uncaught error",
  "stack": "Error: ... at ...",
  "componentStack": "Component stack...",
  "timestamp": "2026-01-01T12:00:00.000Z"
}
```

**Response (200):**

```json
{
  "success": true
}
```

---

## User Management Endpoints

All endpoints are prefixed with `/api/orchestrator` and require authentication. Admin-only endpoints are marked.

### GET /api/orchestrator/users

List all users.

**Auth:** Admin only

**Response (200):**

```json
{
  "users": [
    {
      "id": "usr_abc123",
      "username": "admin",
      "email": "admin@local",
      "role": "admin",
      "isActive": true,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

### POST /api/orchestrator/users

Create a new user.

**Auth:** Admin only (CSRF required)

**Request Body:**

```json
{
  "username": "newuser",
  "email": "user@example.com",
  "password": "password123",
  "role": "user"
}
```

| Field      | Type   | Required | Description                 |
| ---------- | ------ | -------- | --------------------------- |
| `username` | string | Yes      | 1-50 characters             |
| `email`    | string | Yes      | Valid email format          |
| `password` | string | Yes      | Minimum 8 characters        |
| `role`     | string | No       | `user` (default) or `admin` |

**Response (201):**

```json
{
  "user": {
    "id": "usr_xyz789",
    "username": "newuser",
    "email": "user@example.com",
    "role": "user",
    "isActive": true,
    "createdAt": "2026-01-01T12:00:00.000Z",
    "updatedAt": "2026-01-01T12:00:00.000Z"
  }
}
```

### GET /api/orchestrator/users/:id

Get a specific user.

**Auth:** Self or Admin

**Response (200):**

```json
{
  "user": {
    "id": "usr_abc123",
    "username": "admin",
    "email": "admin@local",
    "role": "admin",
    "isActive": true,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
}
```

### PUT /api/orchestrator/users/:id

Update a user.

**Auth:** Self or Admin (CSRF required)

**Request Body:**

```json
{
  "username": "newname",
  "email": "newemail@example.com",
  "password": "newpassword123",
  "role": "user"
}
```

**Response (200):**

```json
{
  "user": {
    "id": "usr_abc123",
    "username": "newname",
    "email": "newemail@example.com",
    "role": "user",
    "isActive": true,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T12:00:00.000Z"
  }
}
```

### DELETE /api/orchestrator/users/:id

Delete a user.

**Auth:** Admin only (CSRF required)

**Response (200):**

```json
{
  "message": "User deactivated successfully"
}
```

### GET /api/orchestrator/users/:id/access

Get server and model access for a user.

**Auth:** Self or Admin

**Response (200):**

```json
{
  "serverAccess": [
    {
      "serverId": "server-1",
      "grantedAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "modelAccess": [
    {
      "serverId": "server-1",
      "model": "llama2:13b",
      "grantedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

### POST /api/orchestrator/users/:id/access/server

Grant server access to a user.

**Auth:** Self or Admin (CSRF required)

**Request Body:**

```json
{
  "serverId": "server-1"
}
```

**Response (201):**

```json
{
  "message": "Server access granted"
}
```

### DELETE /api/orchestrator/users/:id/access/server/:serverId

Revoke server access.

**Auth:** Self or Admin (CSRF required)

**Response (200):**

```json
{
  "message": "Server access revoked"
}
```

### POST /api/orchestrator/users/:id/access/model

Grant model access to a user.

**Auth:** Self or Admin (CSRF required)

**Request Body:**

```json
{
  "serverId": "server-1",
  "model": "llama2:13b"
}
```

**Response (201):**

```json
{
  "message": "Model access granted"
}
```

### DELETE /api/orchestrator/users/:id/access/model/:serverId/:model

Revoke model access.

**Auth:** Self or Admin (CSRF required)

**Response (200):**

```json
{
  "message": "Model access revoked"
}
```

### POST /api/orchestrator/users/:id/rotate-api-key

Rotate a user's API key.

**Auth:** Self or Admin (CSRF required)

**Response (200):**

```json
{
  "apiKey": "new-api-key-value",
  "message": "API key rotated successfully. Store this key securely - it will not be shown again."
}
```

---

## Ollama-Compatible Inference Endpoints

All endpoints are prefixed with `/api` and use the inference rate limiter.

### GET /api/tags

List all available models across servers (aggregated).

**Auth:** Optional (`optionalAuth`)

**Response (200):**

```json
{
  "models": [
    {
      "name": "llama2:13b",
      "size": 7365960934,
      "modified_at": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

### POST /api/generate

Generate text using a model.

**Auth:** Required (`requireAuth`)

**Request Body:**

```json
{
  "model": "llama2:13b",
  "prompt": "Hello, world!",
  "stream": false,
  "context": [1, 2, 3],
  "options": {
    "num_predict": 100,
    "temperature": 0.7
  },
  "keep_alive": "5m"
}
```

| Field        | Type     | Required | Description                       |
| ------------ | -------- | -------- | --------------------------------- |
| `model`      | string   | Yes      | Model name                        |
| `prompt`     | string   | Yes      | Input prompt                      |
| `stream`     | boolean  | No       | Enable streaming (default: false) |
| `context`    | number[] | No       | Context tokens from previous call |
| `options`    | object   | No       | Model-specific options            |
| `keep_alive` | string   | No       | How long to keep model loaded     |

**Response (200) — non-streaming:**

```json
{
  "model": "llama2:13b",
  "response": "Hello! How can I help you today?",
  "done": true,
  "total_duration": 5000000000,
  "context": [1, 2, 3],
  "eval_count": 42
}
```

**Response (200) — streaming:** `Content-Type: application/x-ndjson`

```
{"model":"llama2:13b","response":"Hello","done":false}
{"model":"llama2:13b","response":"!","done":false}
{"model":"llama2:13b","response":"","done":true}
```

### POST /api/chat

Chat completion.

**Auth:** Required (`requireAuth`)

**Request Body:**

```json
{
  "model": "llama2:13b",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello!" }
  ],
  "stream": false,
  "options": {
    "temperature": 0.7
  },
  "keep_alive": "5m"
}
```

| Field        | Type    | Required | Description                       |
| ------------ | ------- | -------- | --------------------------------- |
| `model`      | string  | Yes      | Model name                        |
| `messages`   | array   | Yes      | Message history                   |
| `stream`     | boolean | No       | Enable streaming (default: false) |
| `options`    | object  | No       | Model-specific options            |
| `keep_alive` | string  | No       | How long to keep model loaded     |

**Response (200) — non-streaming:**

```json
{
  "model": "llama2:13b",
  "message": {
    "role": "assistant",
    "content": "Hello! How can I help you?"
  },
  "done": true,
  "total_duration": 5000000000
}
```

**Response (200) — streaming:** `Content-Type: application/x-ndjson`

```
{"model":"llama2:13b","message":{"role":"assistant","content":"Hello"},"done":false}
{"model":"llama2:13b","message":{"role":"assistant","content":"!"},"done":false}
{"model":"llama2:13b","message":{"role":"assistant","content":""},"done":true}
```

### POST /api/embeddings

Generate embeddings.

**Auth:** Required (`requireAuth`)

**Request Body:**

```json
{
  "model": "nomic-embed-text",
  "prompt": "Hello, world!"
}
```

**Response (200):**

```json
{
  "model": "nomic-embed-text",
  "embeddings": [[0.1, 0.2, 0.3, ...]]
}
```

### GET /api/ps

List running models.

**Auth:** Optional (`optionalAuth`)

**Response (200):**

```json
{
  "models": [
    {
      "name": "llama2:13b",
      "model": "llama2:13b",
      "size": 7365960934,
      "duration": 3600,
      "evaluating": false,
      "slots": 4
    }
  ]
}
```

### GET /api/version

Get Ollama version.

**Auth:** Optional (`optionalAuth`)

**Response (200):**

```json
{
  "version": "0.5.0"
}
```

### POST /api/show

Show model information.

**Auth:** Required (`requireAuth`)

**Request Body:**

```json
{
  "model": "llama2:13b"
}
```

**Response (200):** Model details including system prompt, parameters, etc.

### POST /api/embed

Generate embeddings using the embed endpoint.

**Auth:** Required (`requireAuth`)

**Request Body:**

```json
{
  "model": "nomic-embed-text",
  "input": "Text to embed",
  "truncate": true,
  "dimensions": 768,
  "options": {},
  "keep_alive": "5m"
}
```

**Response (200):**

```json
{
  "model": "nomic-embed-text",
  "embeddings": [[0.1, 0.2, ...]],
  "total_duration": 500000000
}
```

### POST /api/pull

Not supported in multi-node mode.

**Response (400):**

```json
{
  "error": "pull is not supported in multi-node mode"
}
```

### POST /api/delete

Not supported in multi-node mode.

**Response (400):**

```json
{
  "error": "delete is not supported in multi-node mode"
}
```

### POST /api/copy

Not supported in multi-node mode.

**Response (400):**

```json
{
  "error": "copy is not supported in multi-node mode"
}
```

### POST /api/create

Not supported in multi-node mode.

**Response (400):**

```json
{
  "error": "create is not supported in multi-node mode"
}
```

### POST /api/push

Not supported in multi-node mode.

**Response (400):**

```json
{
  "error": "push is not supported in multi-node mode"
}
```

### HEAD /api/blobs/:digest

Not supported.

**Response (400):**

```json
{
  "error": "blobs is not supported"
}
```

### POST /api/blobs/:digest

Not supported.

**Response (400):**

```json
{
  "error": "blobs is not supported"
}
```

---

## OpenAI-Compatible Endpoints

All endpoints are prefixed with `/v1` and use the inference rate limiter.

### POST /v1/chat/completions

OpenAI-compatible chat completions.

**Auth:** Required (`requireAuth`)

**Request Body:**

```json
{
  "model": "llama2:13b",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello!" }
  ],
  "temperature": 0.7,
  "max_tokens": 100,
  "stream": false
}
```

**Response (200) — non-streaming:**

```json
{
  "id": "chatcmpl_abc123",
  "object": "chat.completion",
  "created": 1735689600,
  "model": "llama2:13b",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 15,
    "total_tokens": 35
  }
}
```

**Response (200) — streaming:** `Content-Type: text/event-stream`

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

### POST /v1/completions

OpenAI-compatible text completions.

**Auth:** Required (`requireAuth`)

**Request Body:**

```json
{
  "model": "llama2:13b",
  "prompt": "Hello, world!",
  "temperature": 0.7,
  "max_tokens": 100,
  "stream": false
}
```

**Response (200):** OpenAI completion object (streaming uses SSE)

### POST /v1/embeddings

OpenAI-compatible embeddings.

**Auth:** Required (`requireAuth`)

**Request Body:**

```json
{
  "model": "nomic-embed-text",
  "input": "Hello, world!"
}
```

**Response (200):**

```json
{
  "object": "list",
  "data": [
    {
      "object": "embedding",
      "embedding": [0.1, 0.2, ...],
      "index": 0
    }
  ],
  "model": "nomic-embed-text",
  "usage": {
    "prompt_tokens": 10,
    "total_tokens": 10
  }
}
```

### GET /v1/models

List available models.

**Auth:** Optional (`optionalAuth`)

**Response (200):**

```json
{
  "object": "list",
  "data": [
    {
      "id": "llama2:13b",
      "object": "model",
      "created": 1700000000,
      "owned_by": "ollama"
    }
  ]
}
```

### GET /v1/models/:model

Get information about a specific model.

**Auth:** Optional (`optionalAuth`)

**Response (200):**

```json
{
  "id": "llama2:13b",
  "object": "model",
  "created": 1700000000,
  "owned_by": "ollama"
}
```

---

## Anthropic-Compatible Endpoints

All endpoints are prefixed with `/v1`.

### POST /v1/messages

Anthropic messages API.

**Auth:** Required (`requireAuth`)

**Headers:**

| Header              | Required | Description                   |
| ------------------- | -------- | ----------------------------- |
| `anthropic-version` | Yes      | Must be `2023-06-01` or later |
| `anthropic-beta`    | No       | Beta header for beta features |

**Request Body:**

```json
{
  "model": "claude-sonnet-4-20250514",
  "messages": [{ "role": "user", "content": "Hello!" }],
  "max_tokens": 1024,
  "stream": false
}
```

**Response (200) — non-streaming:**

```json
{
  "id": "msg_abc123",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Hello! How can I help you?"
    }
  ],
  "model": "claude-sonnet-4-20250514",
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 10,
    "output_tokens": 15
  }
}
```

**Response (200) — streaming:** `Content-Type: text/event-stream`

```
data: {"type":"message_start","message":{"id":"msg_abc123","type":"message"}}
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"!"}}
data: {"type":"content_block_stop","index":0}
data: {"type":"message_stop"}
```

### GET /v1/models

List available Anthropic models.

**Auth:** None

**Response (200):**

```json
{
  "object": "list",
  "data": [
    {
      "id": "claude-sonnet-4-20250514",
      "display_name": "Claude Sonnet 4",
      "version": "20250514",
      "context_window_tokens": 200000
    }
  ]
}
```

### GET /v1/models/:model

Get information about a specific Anthropic model.

**Auth:** None

**Response (200):**

```json
{
  "id": "claude-sonnet-4-20250514",
  "display_name": "Claude Sonnet 4",
  "version": "20250514",
  "context_window_tokens": 200000
}
```

### GET /v1/idle

Get idle models across the fleet.

**Auth:** None

**Response (200):**

```json
{
  "success": true,
  "models": [
    {
      "model": "llama2:7b",
      "idleTimeMs": 7200000
    }
  ]
}
```

### GET /v1/recommendations

Get model recommendations.

**Auth:** None

**Response (200):**

```json
{
  "success": true,
  "recommendations": [
    {
      "model": "codellama:13b",
      "reason": "High usage detected"
    }
  ]
}
```

### POST /v1/:model/warmup

Warmup a model.

**Auth:** Required (`requireAuth`)

**Request Body:**

```json
{
  "servers": ["server-1", "server-2"]
}
```

| Field     | Type     | Required | Description                     |
| --------- | -------- | -------- | ------------------------------- |
| `servers` | string[] | No       | Target servers (all if omitted) |

**Response (200):**

```json
{
  "success": true,
  "results": [
    {
      "serverId": "server-1",
      "status": "loading"
    }
  ],
  "summary": {
    "totalServers": 3,
    "loadedOn": 1,
    "loadingOn": 2
  }
}
```

### POST /v1/:model/unload

Unload a model.

**Auth:** Required (`requireAuth`)

**Request Body:**

```json
{
  "servers": ["server-1"]
}
```

| Field     | Type     | Required | Description                     |
| --------- | -------- | -------- | ------------------------------- |
| `servers` | string[] | No       | Target servers (all if omitted) |

**Response (200):**

```json
{
  "success": true,
  "results": [...],
  "summary": {...}
}
```

---

## Cohere Endpoints

### POST /chat/chat

Cohere chat API.

**Auth:** Required (`requireAuth`)

**Request Body:**

```json
{
  "model": "command-r-plus",
  "message": "Hello!",
  "stream": false
}
```

**Response (200):** Cohere chat response (streaming uses SSE)

### POST /chat/chat--:serverId

Cohere chat to a specific server.

**Auth:** Required (`requireAuth`)

Same as `/chat/chat` but routes to a specific server using the `--:serverId` bypass pattern.

---

## AWS Bedrock Endpoints

### POST /model/:modelId/invoke

Invoke a Bedrock model.

**Auth:** None

**Request Body:** Bedrock-compatible request body (model-specific)

**Response (200):** Model response (varies by provider)

### POST /model/:modelId/invoke-with-response-stream

Invoke a Bedrock model with streaming response.

**Auth:** None

**Request Body:** Bedrock-compatible request body

**Response (200):** Streaming response (content-type varies by model/provider)

---

## Batches Endpoints

All endpoints are prefixed with `/v1`.

### POST /v1/messages/batches

Create a batch request.

**Auth:** Required (`requireAuth`)

**Request Body:**

```json
{
  "model": "claude-sonnet-4-20250514",
  "messages": [{ "role": "user", "content": "Hello!" }]
}
```

**Response (201):** Batch object with `id`, `status`, `createdAt`

### GET /v1/messages/batches

List batches.

**Auth:** None

**Response (200):** List of batch objects

### GET /v1/messages/batches/:id

Get a specific batch.

**Auth:** None

**Response (200):** Batch object

### POST /v1/messages/batches/:id/cancel

Cancel a batch.

**Auth:** Required (`requireAuth`)

**Response (200):** Updated batch object with `status: "cancelled"`

### GET /v1/messages/batches/:id/results

Get batch results as JSONL stream.

**Auth:** None

**Content-Type:** `application/jsonl`

**Response (200):**

```
{"index":0,"result":{"id":"msg_abc","content":[{"type":"text","text":"Hello!"}]}}
{"index":1,"result":{"id":"msg_def","content":[{"type":"text","text":"Hi there!"}]}}
```

---

## Provider Configuration

This section documents how to configure servers for different AI providers.

### Provider Types

| Type     | Description                                        |
| -------- | -------------------------------------------------- |
| `ollama` | Standard Ollama server (default)                   |
| `openai` | OpenAI-compatible server                           |
| `auto`   | Auto-detect capabilities based on server responses |

### Configuring MiniMax

MiniMax is OpenAI-compatible with a different endpoint structure.

```json
{
  "id": "minimax-1",
  "url": "https://api.minimax.io",
  "type": "openai",
  "apiKey": "your-minimax-api-key",
  "v1Models": ["MiniMax-01-MiniChat", "abab6.5s-chat"],
  "forcedCapabilities": {
    "supportsOllama": false,
    "supportsV1": true,
    "supportsAnthropic": true
  },
  "endpointOverrides": {
    "anthropic_messages": "/anthropic/v1/messages",
    "anthropic_auth": {
      "headerName": "Authorization",
      "headerPrefix": "Bearer"
    }
  }
}
```

### Configuring OpenAI

```json
{
  "id": "openai-1",
  "url": "https://api.openai.com/v1",
  "type": "openai",
  "v1Models": ["gpt-4", "gpt-3.5-turbo"]
}
```

### Configuring Anthropic

```json
{
  "id": "anthropic-1",
  "url": "https://api.anthropic.com",
  "type": "openai",
  "forcedCapabilities": {
    "supportsOllama": false,
    "supportsV1": false,
    "supportsAnthropic": true
  },
  "endpointOverrides": {
    "anthropic_messages": "/v1/messages"
  }
}
```

### Configuring Azure OpenAI

```json
{
  "id": "azure-1",
  "url": "https://your-resource.openai.azure.com/openai/v1",
  "type": "openai",
  "apiKey": "your-azure-api-key"
}
```

### Configuring AWS Bedrock

Bedrock uses separate routes (`/model/:modelId/invoke`) and does not use the standard inference routes.

### endpointOverrides Reference

| Field                         | Type   | Description                                 |
| ----------------------------- | ------ | ------------------------------------------- |
| `anthropic_messages`          | string | Custom path for Anthropic messages endpoint |
| `anthropic_auth.headerName`   | string | Custom auth header name                     |
| `anthropic_auth.headerPrefix` | string | Auth prefix (e.g., "Bearer")                |
| `modelPrefix`                 | string | Prefix prepended to model names             |

### Provider Comparison

| Provider     | Base URL                                 | Auth      | Chat Endpoint                | Anthropic Endpoint       |
| ------------ | ---------------------------------------- | --------- | ---------------------------- | ------------------------ |
| OpenAI       | `api.openai.com/v1`                      | Bearer    | `/v1/chat/completions`       | N/A                      |
| Anthropic    | `api.anthropic.com`                      | x-api-key | N/A                          | `/v1/messages`           |
| MiniMax      | `api.minimax.io`                         | Bearer    | `/v1/text/chatcompletion_v2` | `/anthropic/v1/messages` |
| Azure OpenAI | `{resource}.openai.azure.com/openai/v1`  | api-key   | `/chat/completions`          | N/A                      |
| AWS Bedrock  | `bedrock-runtime.{region}.amazonaws.com` | AWS SigV4 | Varies by model              | N/A                      |

---

_Last updated: 2026-01-01_
