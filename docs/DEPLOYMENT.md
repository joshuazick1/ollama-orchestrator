# Deployment Guide

This guide covers deploying the Ollama Orchestrator in production environments with proper monitoring and operational practices.

## Prerequisites

- Docker and Docker Compose
- At least 4GB RAM per Ollama server
- Network connectivity to Ollama servers
- Persistent storage for metrics/logs (optional)

## Production Deployment

### Using Docker Compose

The recommended production setup includes the orchestrator, multiple Ollama servers, Prometheus metrics collection, and Grafana dashboards.

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/your-org/ollama-orchestrator.git
    cd ollama-orchestrator
    ```

2.  **Configure Environment:**
    Create a `.env` file from the example:

    ```bash
    cp .env.example .env
    ```

    **Important:** Edit `.env` and set a secure `GRAFANA_ADMIN_PASSWORD`.

3.  **Start production stack:**

    ```bash
    docker-compose -f docker-compose.prod.yml up -d
    ```

4.  **Verify services are running:**
    ```bash
    docker-compose -f docker-compose.prod.yml ps
    ```

### Service Endpoints

- **Orchestrator API**: `http://localhost:5100`
- **Prometheus**: `http://localhost:9090`
- **Grafana**: `http://localhost:3000` (User: `admin`, Password: Value of `GRAFANA_ADMIN_PASSWORD` from `.env`)
- **Ollama Server 1**: `http://localhost:11434`
- **Ollama Server 2**: `http://localhost:11435`

### Health Checks

```bash
# Orchestrator health
curl http://localhost:5100/health

# Orchestrator internal health
curl http://localhost:5100/api/orchestrator/health

# Prometheus readiness
curl http://localhost:9090/-/ready
```

## Configuration

### Environment Variables

```bash
# Server configuration
ORCHESTRATOR_PORT=5100
ORCHESTRATOR_HOST=0.0.0.0

# Logging
ORCHESTRATOR_LOG_LEVEL=info
ORCHESTRATOR_LOG_FORMAT=json

# Metrics
ORCHESTRATOR_METRICS_RETENTION_HOURS=24
ORCHESTRATOR_METRICS_PERSISTENCE_ENABLED=true

# Circuit breaker
ORCHESTRATOR_CIRCUIT_BREAKER_FAILURE_THRESHOLD=0.5
ORCHESTRATOR_CIRCUIT_BREAKER_RECOVERY_TIMEOUT=30000

# Queue
ORCHESTRATOR_QUEUE_MAX_SIZE=1000
ORCHESTRATOR_QUEUE_TIMEOUT=30000
```

### Config File

Create a `config.yaml` file:

```yaml
server:
  port: 5100
  host: '0.0.0.0'

logging:
  level: 'info'
  format: 'json'

metrics:
  retentionHours: 24
  persistence:
    enabled: true

circuitBreaker:
  failureThreshold: 0.5
  recoveryTimeout: 30000

queue:
  maxSize: 1000
  timeout: 30000
```

## Monitoring Setup

### Prometheus Configuration

The production compose file includes Prometheus with pre-configured scrape targets:

- Orchestrator metrics: `http://orchestrator:5100/metrics`
- Ollama servers: Health checks via orchestrator

### Grafana Dashboards

Pre-built dashboards are included for:

- **Orchestrator Overview**: Request rates, latencies, error rates
- **Server Performance**: Per-server metrics and load balancing
- **Queue Management**: Queue depth, processing rates
- **Circuit Breaker Status**: Breaker states and recovery metrics

Access Grafana at `http://localhost:3000` and import dashboards from the `monitoring/` directory.

### Key Metrics to Monitor

- `orchestrator_requests_total`: Total requests processed
- `orchestrator_requests_duration_seconds`: Request latency percentiles
- `orchestrator_requests_errors_total`: Error counts by type
- `orchestrator_queue_size`: Current queue depth
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
  ollama-1:
    deploy:
      resources:
        limits:
          memory: 8g
        reservations:
          memory: 4g
```

## Backup and Recovery

### Configuration Backup

```bash
# Backup current config
curl http://localhost:5100/api/orchestrator/config > config-backup.json
```

### Metrics Data

Metrics are persisted to `./data/metrics/` by default. Backup this directory for historical data.

### Logs

Use Docker logging drivers for centralized logging:

```yaml
services:
  orchestrator:
    logging:
      driver: 'json-file'
      options:
        max-size: '10m'
        max-file: '3'
```

## Security Considerations

- Run behind reverse proxy (nginx/caddy) for SSL termination
- Use internal networks for service communication
- Restrict API access with authentication if needed
- Regularly update base images for security patches
- Monitor for unusual request patterns

## Troubleshooting

See [Operations Guide](OPERATIONS.md) for common issues and resolution steps.
