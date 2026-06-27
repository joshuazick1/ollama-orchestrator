# Deployment Guide

This guide covers deploying the Ollama Orchestrator in production environments with proper monitoring and operational practices.

## Prerequisites

- **Node.js**: v20 or higher
- **Docker and Docker Compose** (optional, for containerized deployment)
- At least 4GB RAM per Ollama server
- Network connectivity to Ollama servers
- Persistent storage for metrics/logs

## Quick Start

### Option 1: Docker Compose (Recommended)

1. **Clone the repository:**

   ```bash
   git clone https://github.com/joshuazick1/ollama-orchestrator.git
   cd ollama-orchestrator
   ```

2. **Configure Environment:**

   ```bash
   cp .env.example .env
   ```

3. **Start production stack:**

   ```bash
   docker-compose -f docker-compose.prod.yml up -d
   ```

4. **Verify services are running:**
   ```bash
   docker-compose -f docker-compose.prod.yml ps
   ```

### Option 2: Node.js (Non-Docker)

1. **Clone and install:**

   ```bash
   git clone https://github.com/joshuazick1/ollama-orchestrator.git
   cd ollama-orchestrator
   npm install
   ```

2. **Configure environment:**

   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

3. **Build and start:**

   ```bash
   npm run build
   npm start
   ```

4. **Run in development mode:**
   ```bash
   npm run dev
   ```

## Service Endpoints

### Docker Compose

- **Orchestrator API**: `http://localhost:5100`
- **Prometheus**: `http://localhost:9090`
- **Grafana**: `http://localhost:3000` (User: `admin`, Password: set in `.env`)
- **Ollama Server**: `http://localhost:11434`

### Non-Docker

- **Orchestrator API**: `http://localhost:5100`
- **Prometheus Metrics**: `http://localhost:9090/metrics` (if enabled)

## Configuration

### Environment Variables

The orchestrator supports many environment variables. Here are the most common:

```bash
# Server
NODE_ENV=production
PORT=5100
ORCHESTRATOR_PORT=5100
ORCHESTRATOR_HOST=0.0.0.0
ORCHESTRATOR_LOG_LEVEL=info          # debug | info | warn | error

# Authentication (new — was missing entirely)
ORCHESTRATOR_ENABLE_AUTH=true        # default: true — set false to disable all auth
ORCHESTRATOR_API_KEYS=               # comma-separated user API keys
ORCHESTRATOR_ADMIN_API_KEYS=         # comma-separated admin API keys

# CORS & Rate Limiting
ORCHESTRATOR_CORS_ORIGINS=           # comma-separated origins
ORCHESTRATOR_RATE_LIMIT_WINDOW=900000
ORCHESTRATOR_RATE_LIMIT_MAX=100

# Feature Toggles
ORCHESTRATOR_ENABLE_CIRCUIT_BREAKER=true
ORCHESTRATOR_ENABLE_METRICS=true
ORCHESTRATOR_ENABLE_STREAMING=true
ORCHESTRATOR_ENABLE_PERSISTENCE=true

# Load Balancer Weights (must sum to 1.0)
ORCHESTRATOR_LB_WEIGHT_LATENCY=0.35
ORCHESTRATOR_LB_WEIGHT_SUCCESS_RATE=0.30
ORCHESTRATOR_LB_WEIGHT_LOAD=0.20
ORCHESTRATOR_LB_WEIGHT_CAPACITY=0.15

# Circuit Breaker
ORCHESTRATOR_CB_FAILURE_THRESHOLD=5         # default: 5
ORCHESTRATOR_CB_MAX_FAILURE_THRESHOLD=10    # default: 10
ORCHESTRATOR_CB_MIN_FAILURE_THRESHOLD=3     # default: 3
ORCHESTRATOR_CB_OPEN_TIMEOUT=120000
ORCHESTRATOR_CB_HALF_OPEN_TIMEOUT=60000     # default: 60000 (1 min)
ORCHESTRATOR_CB_RECOVERY_SUCCESS_THRESHOLD=3
ORCHESTRATOR_CB_ERROR_RATE_THRESHOLD=0.5    # default: 0.5
ORCHESTRATOR_CB_ADAPTIVE_THRESHOLDS=true

# Health Checks
ORCHESTRATOR_HC_ENABLED=true
ORCHESTRATOR_HC_INTERVAL=30000
ORCHESTRATOR_HC_TIMEOUT=5000
ORCHESTRATOR_HC_MAX_CONCURRENT=10
ORCHESTRATOR_HC_FAILURE_THRESHOLD=3

# Retry & Timeout
ORCHESTRATOR_RETRY_MAX_RETRIES=2
ORCHESTRATOR_RETRY_DELAY=500
ORCHESTRATOR_RETRY_BACKOFF_MULTIPLIER=2
ORCHESTRATOR_RETRY_MAX_DELAY=5000
ORCHESTRATOR_INFERENCE_TIMEOUT_MS=90000     # total failover budget (new — was missing)

# Metrics & Monitoring
ORCHESTRATOR_METRICS_ENABLED=true
ORCHESTRATOR_METRICS_PROMETHEUS_ENABLED=true
ORCHESTRATOR_METRICS_PROMETHEUS_PORT=9090

# Streaming
ORCHESTRATOR_STREAMING_ENABLED=true
ORCHESTRATOR_STREAMING_MAX_CONCURRENT=100
ORCHESTRATOR_STREAMING_TIMEOUT=300000
ORCHESTRATOR_STREAMING_STALL_THRESHOLD_MS=300000

# Persistence
ORCHESTRATOR_PERSISTENCE_PATH=./data
```

### Config File

Create a `config.yaml` file:

```yaml
server:
  port: 5100
  host: '0.0.0.0'
  logLevel: 'info'

loadBalancer:
  weights:
    latency: 0.35
    successRate: 0.30
    load: 0.20
    capacity: 0.15
  thresholds:
    maxP95Latency: 5000
    minSuccessRate: 0.95

circuitBreaker:
  enabled: true
  failureThreshold: 5
  maxFailureThreshold: 10
  minFailureThreshold: 3
  openTimeout: 120000
  halfOpenTimeout: 60000
  recoverySuccessThreshold: 3
  errorRateThreshold: 0.5
  adaptiveThresholds: true

healthCheck:
  enabled: true
  intervalMs: 30000
  timeoutMs: 5000
  maxConcurrentChecks: 10
  failureThreshold: 3
  successThreshold: 2

metrics:
  enabled: true
  prometheusEnabled: true
  prometheusPort: 9090
  historyWindowMinutes: 60

streaming:
  enabled: true
  maxConcurrentStreams: 100
  timeoutMs: 300000

security:
  corsOrigins:
    - '*'
  rateLimitWindowMs: 900000
  rateLimitMax: 100
```

## Adding Ollama Servers

### Via API (Both Docker and Non-Docker)

```bash
curl -X POST http://localhost:5100/api/orchestrator/servers/add \
  -H "Content-Type: application/json" \
  -d '{
    "id": "ollama-1",
    "url": "http://ollama-server-1:11434",
    "maxConcurrency": 4
  }'
```

### Via Config File

Add servers to your config.yaml:

```yaml
servers:
  - id: ollama-1
    url: http://ollama-1:11434
    maxConcurrency: 4
  - id: ollama-2
    url: http://ollama-2:11434
    maxConcurrency: 4
```

## Health Checks

```bash
# Orchestrator health
curl http://localhost:5100/health

# Orchestrator internal health
curl http://localhost:5100/api/orchestrator/health

# Server status
curl http://localhost:5100/api/orchestrator/servers
```

## Monitoring Setup

### Prometheus Configuration

The production compose file includes Prometheus with pre-configured scrape targets. If running non-Docker, add this to your prometheus.yml:

```yaml
scrape_configs:
  - job_name: 'orchestrator'
    static_configs:
      - targets: ['localhost:9090']
```

### Grafana Dashboards

Pre-built dashboards are included for:

- **Orchestrator Overview**: Request rates, latencies, error rates
- **Server Performance**: Per-server metrics and load balancing
- **Circuit Breaker Status**: Breaker states and recovery metrics

Access Grafana at `http://localhost:3000` (Docker) and import dashboards.

### Key Metrics to Monitor

- `orchestrator_requests_total`: Total requests processed
- `orchestrator_requests_duration_seconds`: Request latency percentiles
- `orchestrator_requests_errors_total`: Error counts by type
- `orchestrator_circuit_breaker_state`: Breaker status (0=closed, 1=open, 2=half-open)
- `orchestrator_servers_active`: Number of healthy servers

## Scaling

### Horizontal Scaling

Add more Ollama servers via the API:

```bash
curl -X POST http://localhost:5100/api/orchestrator/servers/add \
  -H "Content-Type: application/json" \
  -d '{
    "id": "server-3",
    "url": "http://ollama-3:11434",
    "maxConcurrency": 4
  }'
```

### Vertical Scaling

Increase resources in docker-compose.prod.yml:

```yaml
services:
  ollama-orchestrator:
    deploy:
      resources:
        limits:
          memory: 2G
```

## Production Deployment Checklist

### Docker

- [ ] Use `docker-compose.prod.yml` for production
- [ ] Set appropriate memory limits
- [ ] Configure restart policies
- [ ] Enable health checks
- [ ] Set up log rotation
- [ ] Configure Prometheus and Grafana
- [ ] Set secure API keys
- [ ] Configure CORS origins
- [ ] Set up reverse proxy with SSL (nginx/caddy)

### Non-Docker/Node.js

- [ ] Use process manager (systemd, PM2)
- [ ] Set up log rotation (logrotate)
- [ ] Configure Prometheus endpoint
- [ ] Set secure API keys
- [ ] Configure CORS origins
- [ ] Set up reverse proxy with SSL (nginx/caddy)
- [ ] Configure persistence path
- [ ] Set up monitoring

## Security Considerations

- Run behind reverse proxy (nginx/caddy) for SSL termination
- Use internal networks for service communication
- Restrict API access with authentication
- Regularly update base images for security patches
- Monitor for unusual request patterns
- Configure API keys for production use:
  ```bash
  ORCHESTRATOR_API_KEYS=key1,key2
  ORCHESTRATOR_ADMIN_API_KEYS=admin-key
  ```

## Backup and Recovery

### Configuration Backup

```bash
# Backup current config
curl http://localhost:5100/api/orchestrator/config > config-backup.json

# Restore config
curl -X POST http://localhost:5100/api/orchestrator/config \
  -H "Content-Type: application/json" \
  -d @config-backup.json
```

### Data Backup

Metrics and runtime data are stored in `./data/` (non-Docker) or mounted volume (Docker). Backup this directory for recovery.

### Logs

Docker: Use logging drivers:

```yaml
services:
  orchestrator:
    logging:
      driver: 'json-file'
      options:
        max-size: '10m'
        max-file: '3'
```

Non-Docker: Use logrotate:

```bash
# /etc/logrotate.d/ollama-orchestrator
/var/log/ollama-orchestrator.log {
  daily
  rotate 7
  compress
  delaycompress
  missingok
  notifempty
  create 0640 root root
}
```

## Troubleshooting

See [Operations Guide](OPERATIONS.md) for common issues and resolution steps.

### Docker Issues

```bash
# Check logs
docker-compose -f docker-compose.prod.yml logs orchestrator

# Restart service
docker-compose -f docker-compose.prod.yml restart orchestrator

# Rebuild and restart
docker-compose -f docker-compose.prod.yml up -d --build
```

### Non-Docker Issues

```bash
# Check logs
npm start 2>&1 | tee logs/orchestrator.log

# Check process status
ps aux | grep node

# Restart
pkill -f "node dist/index.js" && npm start &
```
