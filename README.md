# Ollama Orchestrator API and Capabilities Documentation

## Overview

The Ollama Orchestrator is a production-ready Express.js-based API gateway in TypeScript/Node.js that routes Ollama inference requests across multiple server instances. It provides intelligent load balancing, failover, and concurrency management.

## Getting Started

### Prerequisites

- **Node.js**: v18 or higher
- **Docker**: For containerized deployment (optional but recommended)

### Project Structure

```
ollama-orchestrator/
├── src/                      # Main application source
│   ├── controllers/          # Request handlers
│   │   ├── analyticsController.ts
│   │   ├── circuitBreakerController.ts
│   │   ├── configController.ts
│   │   ├── logsController.ts
│   │   ├── metricsController.ts
│   │   ├── modelController.ts
│   │   ├── ollamaController.ts
│   │   ├── openaiController.ts
│   │   ├── queueController.ts
│   │   ├── recoveryFailureController.ts
│   │   ├── serverModelsController.ts
│   │   └── serversController.ts
│   ├── config/               # Configuration management
│   │   ├── config.ts
│   │   ├── configManager.ts
│   │   ├── envMapper.ts
│   │   ├── jsonFileHandler.ts
│   │   └── schema.ts
│   ├── analytics/            # Analytics and reporting
│   │   ├── analytics-engine.ts
│   │   ├── recovery-failure-tracker.ts
│   │   └── index.ts
│   ├── metrics/              # Metrics collection
│   │   ├── metrics-aggregator.ts
│   │   ├── metrics-persistence.ts
│   │   ├── prometheus-exporter.ts
│   │   └── index.ts
│   ├── middleware/           # Express middleware
│   │   ├── auth.ts
│   │   ├── rateLimiter.ts
│   │   └── validation.ts
│   ├── queue/                # Request queue
│   │   ├── request-queue.ts
│   │   └── index.ts
│   ├── utils/                # Utility functions
│   │   ├── fetchWithTimeout.ts
│   │   ├── logger.ts
│   │   ├── ollamaError.ts
│   │   └── urlUtils.ts
│   ├── circuit-breaker.ts    # Circuit breaker implementation
│   ├── health-check-scheduler.ts
│   ├── intelligent-recovery-manager.ts
│   ├── load-balancer.ts
│   ├── model-manager.ts
│   ├── orchestrator.ts       # Main orchestration logic
│   ├── recovery-test-coordinator.ts
│   ├── streaming.ts
│   └── index.ts              # Application entry point
├── tests/                    # Test suite
│   ├── unit/                 # Unit tests
│   ├── integration/          # Integration tests
│   ├── e2e/                  # End-to-end tests
│   ├── chaos/                # Chaos engineering tests
│   ├── performance/          # Load/stress tests
│   └── fixtures/             # Test fixtures
├── frontend/                 # React dashboard
│   ├── src/
│   │   ├── components/       # Reusable UI components
│   │   ├── pages/            # Dashboard pages
│   │   │   ├── Analytics.tsx
│   │   │   ├── CircuitBreakers.tsx
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Logs.tsx
│   │   │   ├── Models.tsx
│   │   │   ├── Queue.tsx
│   │   │   ├── Servers.tsx
│   │   │   └── Settings.tsx
│   │   └── ...
│   └── package.json
├── docs/                     # Documentation
│   ├── API.md
│   ├── DEPLOYMENT.md
│   ├── OPERATIONS.md
│   └── EXAMPLES.md
├── scripts/                  # Utility scripts
├── docker-compose.yml        # Development setup
├── docker-compose.prod.yml   # Production setup
├── Dockerfile
└── package.json
```

### Installation

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/joshuazick1/ollama-orchestrator.git
    cd ollama-orchestrator
    ```

2.  **Install dependencies:**

    ```bash
    npm install
    ```

3.  **Configure Environment:**
    ```bash
    cp .env.example .env
    # Edit .env to configure your Ollama servers and security settings
    ```

### Running Locally

```bash
# Start in development mode (hot-reload)
npm run dev

# Build and start in production mode
npm run build
npm start
```

### Running with Docker

We provide a production-ready Docker Compose setup including Prometheus and Grafana.

```bash
# Start the full stack
docker-compose up -d
```

See [Deployment Guide](docs/DEPLOYMENT.md) for detailed production instructions.

### Documentation

- [API Reference](docs/API.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Operations Guide](docs/OPERATIONS.md)
- [Examples & Usage](docs/EXAMPLES.md)
- [Contributing Guide](CONTRIBUTING.md)

## API Endpoints

### Server Management

- **GET /api/orchestrator/servers** - Retrieve all registered servers with status
- **POST /api/orchestrator/servers/add** - Add a new server
- **DELETE /api/orchestrator/servers/:id** - Remove a server
- **PATCH /api/orchestrator/servers/:id** - Update server config (e.g., maxConcurrency)
- **GET /api/orchestrator/servers/:id/models** - List models on a server
- **POST /api/orchestrator/servers/:id/models/pull** - Pull a model to a server
- **DELETE /api/orchestrator/servers/:id/models/:model** - Delete a model
- **POST /api/orchestrator/servers/:id/models/copy** - Copy/pull a model
- **GET /api/orchestrator/models/fleet-stats** - Fleet-wide model stats

### Model Management

- **GET /api/orchestrator/model-map** - Model-to-server mapping
- **GET /api/orchestrator/models** - All models across fleet
- **GET /api/orchestrator/models/status** - Model status (warmup, loaded)
- **GET /api/orchestrator/models/recommendations** - Warmup recommendations
- **GET /api/orchestrator/models/idle** - Idle models for unloading
- **GET /api/orchestrator/models/:model/status** - Specific model status
- **POST /api/orchestrator/models/:model/warmup** - Warmup a model
- **POST /api/orchestrator/models/:model/unload** - Unload a model
- **POST /api/orchestrator/models/:model/cancel** - Cancel warmup

### Circuit Breaker Management

- **GET /api/orchestrator/circuit-breakers/:serverId/:model** - Get breaker details for server:model
- **GET /api/orchestrator/circuit-breakers/:serverId** - Get all breakers for a server
- **GET /api/orchestrator/servers/:serverId/models/:model/circuit-breaker** - Get circuit breaker info
- **POST /api/orchestrator/circuit-breakers/:serverId/:model/reset** - Reset circuit breaker
- **POST /api/orchestrator/circuit-breakers/:serverId/:model/open** - Force open circuit breaker
- **POST /api/orchestrator/circuit-breakers/:serverId/:model/close** - Force close circuit breaker
- **POST /api/orchestrator/circuit-breakers/:serverId/:model/half-open** - Force half-open state
- **POST /api/orchestrator/circuit-breakers/:serverId/reset** - Reset all breakers for server
- **POST /api/orchestrator/servers/:serverId/models/:model/recovery-test** - Trigger manual recovery test

### Health and Monitoring

- **GET /api/orchestrator/health** - Orchestrator health
- **POST /api/orchestrator/health-check** - Trigger health checks
- **GET /api/orchestrator/stats** - Comprehensive stats
- **GET /api/orchestrator/circuit-breakers** - Circuit breaker status

### Server-Specific Inference

Route requests directly to a specific server (bypasses load balancer for debugging/testing):

- **POST /api/generate--:serverId** - Generate to specific server
- **POST /api/chat--:serverId** - Chat to specific server
- **POST /api/embeddings--:serverId** - Embeddings to specific server
- **POST /v1/chat/completions--:serverId** - Chat completions to specific server
- **POST /v1/completions--:serverId** - Completions to specific server
- **POST /v1/embeddings--:serverId** - Embeddings to specific server

### Recovery Failure Tracking

- **GET /api/orchestrator/recovery-failures** - Get recovery failures summary
- **GET /api/orchestrator/recovery-failures/stats/all** - Get all server recovery stats
- **GET /api/orchestrator/recovery-failures/recent** - Get recent failure records
- **GET /api/orchestrator/recovery-failures/:serverId** - Get recovery stats for specific server
- **GET /api/orchestrator/recovery-failures/:serverId/history** - Get failure history for server
- **GET /api/orchestrator/recovery-failures/:serverId/analysis** - Analyze server failures
- **GET /api/orchestrator/recovery-failures/:serverId/circuit-breaker-impact** - Get CB impact analysis
- **GET /api/orchestrator/recovery-failures/:serverId/circuit-breaker-transitions** - Get CB transitions
- **POST /api/orchestrator/recovery-failures/:serverId/reset** - Reset recovery stats

### Ban Management

- **GET /api/orchestrator/bans** - Active bans (server:model)
- **DELETE /api/orchestrator/bans** - Clear all bans
- **DELETE /api/orchestrator/bans/server/:serverId** - Clear server bans
- **DELETE /api/orchestrator/bans/model/:model** - Clear model bans
- **DELETE /api/orchestrator/bans/:serverId/:model** - Remove specific ban

### Metrics

- **GET /api/orchestrator/metrics** - Metrics dashboard
- **GET /api/orchestrator/metrics/prometheus** - Prometheus metrics
- **GET /api/orchestrator/metrics/:serverId/:model** - Server:model metrics

### Queue Management

- **GET /api/orchestrator/queue** - Queue status
- **GET /api/orchestrator/in-flight** - In-flight requests by server
- **POST /api/orchestrator/queue/pause** - Pause queue
- **POST /api/orchestrator/queue/resume** - Resume queue
- **POST /api/orchestrator/drain** - Drain all servers

### Server Maintenance

- **POST /api/orchestrator/servers/:id/drain** - Drain specific server
- **POST /api/orchestrator/servers/:id/undrain** - Undrain specific server
- **POST /api/orchestrator/servers/:id/maintenance** - Set server maintenance mode

### Configuration

- **GET /api/orchestrator/config** - Current config
- **GET /api/orchestrator/config/schema** - Config schema
- **POST /api/orchestrator/config** - Update config
- **PATCH /api/orchestrator/config/:section** - Update section
- **POST /api/orchestrator/config/reload** - Reload config
- **POST /api/orchestrator/config/save** - Save config

### Ollama-Compatible Inference

- **GET /api/tags** - Aggregated model tags
- **POST /api/generate** - Text generation with failover/streaming
- **POST /api/chat** - Chat completion with failover/streaming
- **POST /api/embeddings** - Embeddings with failover
- **GET /api/ps** - Running models
- **GET /api/version** - Version info

### Analytics

- **GET /api/orchestrator/analytics/top-models** - Top models by usage
- **GET /api/orchestrator/analytics/server-performance** - Server performance
- **GET /api/orchestrator/analytics/errors** - Error analysis
- **GET /api/orchestrator/analytics/capacity** - Capacity data
- **GET /api/orchestrator/analytics/trends/:metric** - Metric trends
- **GET /api/orchestrator/analytics/summary** - Analytics summary

### Decision History

- **GET /api/orchestrator/analytics/decisions** - Get decision history
- **GET /api/orchestrator/analytics/decisions/trends/:serverId/:model** - Decision trends for server:model
- **GET /api/orchestrator/analytics/selection-stats** - Load balancer selection statistics
- **GET /api/orchestrator/analytics/algorithms** - Algorithm performance stats
- **GET /api/orchestrator/analytics/score-timeline** - Score timeline data
- **GET /api/orchestrator/analytics/metrics-impact** - Metrics impact analysis

### Request History

- **GET /api/orchestrator/analytics/servers-with-history** - Servers with request history
- **GET /api/orchestrator/analytics/requests/:serverId** - Request history for server
- **GET /api/orchestrator/analytics/request-stats/:serverId** - Request stats for server
- **GET /api/orchestrator/analytics/request-timeline** - Request timeline data
- **GET /api/orchestrator/analytics/requests/search** - Search request history

### Logging

- **GET /api/orchestrator/logs** - Application logs
- **POST /api/orchestrator/logs/clear** - Clear logs

### Root-Level

- **GET /health** - Health check
- **GET /metrics** - Prometheus metrics

## Key Capabilities

### Intelligent Load Balancing

- Weighted scoring: latency (35%), success rate (30%), load (20%), capacity (15%)
- Historical metrics with sliding windows (1m, 5m, 15m, 1h)
- Circuit breakers prevent routing to failing servers
- Considers in-flight requests, model availability, health

### Request Failover and Retry

- Automatic failover to next best server
- Configurable retries (default 2) for transient errors
- Error classification: permanent, non-retryable, transient, retryable
- Cooldown periods for failed server:model combos

### Model Management

- Dynamic registry of model availability
- Proactive warmup based on usage patterns
- Per-server model control (pull, copy, delete)
- Fleet statistics

### Streaming Support

- NDJSON streaming for generate/chat
- TTFT metrics
- Max 100 concurrent streams (configurable)
- 5-minute timeout

## Concurrent Request Handling

### Request Queue

- Priority queue (max 1000, default)
- Prevents starvation with priority boosting
- Tracks wait times, dropped requests

### Per-Server Concurrency

- In-flight tracking per server:model
- Default max 4 concurrent per server (configurable)
- Load balancer considers current load

### Load Balancer Integration

- Real-time in-flight consideration
- Capacity weighting
- Historical patterns

### Circuit Breaker Protection

- Failure thresholds (5-10 failures)
- Half-open recovery testing
- Adaptive thresholds

### Health Checks

- Up to 10 concurrent checks
- Recovery monitoring
- Automatic gradual restoration

### Streaming Concurrency

- Max 100 concurrent streams
- Resource protection
- Timeout management

## Configuration Options

### Core

- Port: 5100 (env: ORCHESTRATOR_PORT)
- Host: 0.0.0.0 (env: ORCHESTRATOR_HOST)
- Log level: info (debug/info/warn/error)

### Queue

- Max size: 1000
- Timeout: 5m
- Priority boosting: 5s intervals, 5-point boosts
- Max priority: 100

### Load Balancer Weights

- Latency: 35%
- Success: 30%
- Load: 20%
- Capacity: 15%

### Load Balancer Advanced

- Latency blend (recent/historical): 60%/40%
- Load factor multiplier: 0.5
- Default fallback latency: 1000ms
- Default max concurrency: 4
- Streaming optimization: TTFT 60%, duration 40%
- Algorithms: weighted, round-robin, least-connections

### Circuit Breaker

- Failure threshold: 5-10 (adaptive)
- Open timeout: 30s
- Half-open timeout: 60s
- Half-open max requests: 5
- Recovery success threshold: 3
- Error window: 60s
- Error rate threshold: 50%
- Adaptive thresholds: enabled

### Health Check

- Interval: 30s (healthy)
- Timeout: 5s
- Max concurrent: 10
- Failure threshold: 3
- Recovery interval: 60s

### Retry

- Max retries: 2 per server
- Base delay: 500ms
- Backoff: 2x
- Max delay: 5s
- Retryable codes: 503, 502, 504

### Security

- CORS origins: '\*' (configurable)
- Rate limit: 100 req/min (configurable)
- API keys: optional

### Metrics

- Enabled: true
- Prometheus enabled: true
- Prometheus port: 9090
- History: 60m
- Decay enabled: true
- Decay half-life: 5m
- Stale threshold: 2m

### Streaming

- Enabled: true
- Max concurrent streams: 100
- Timeout: 5m
- Buffer: 1024 bytes
- TTFT weight: 0.6
- Duration weight: 0.4

### Tags Aggregation

- Cache TTL: 30s
- Max concurrent: 10
- Batch delay: 50ms
- Request timeout: 5s

### Model Manager

- Max retries: 3
- Retry delay: 1000ms
- Warmup timeout: 60s
- Idle threshold: 30m
- Memory safety margin: 1.2x
- GB per billion params: 0.75

### Cooldown

- Failure cooldown: 2m
- Default max concurrency: 4

### Security

- CORS origins: '\*' (configurable)
- Rate limit: 100 req/15min (configurable)
- Rate limit window: 15min
- API keys: optional
- Admin API keys: optional
- Max streams: 100
- Timeout: 5m
- Buffer: 1024 bytes

### Tags Aggregation

- Cache TTL: 5m
- Max concurrent: 10
- Request timeout: 5s

### Persistence

- Path: './data'
- Reload interval: 30s
- Hot reload: enabled

## Concurrent Request Flow

1. Requests enter priority queue if enabled
2. Dequeued by priority
3. Load balancer selects optimal server (considers in-flight, metrics, circuit breakers, model availability)
4. Verifies not at maxConcurrency (default 4)
5. Increments in-flight count
6. Executes request with timeout/retry
7. Failover on failure to next server
8. Decrements in-flight, records metrics
9. For streaming: maintains connection, tracks concurrent streams

This system handles thousands of concurrent requests with high availability through adaptive load balancing and monitoring.
