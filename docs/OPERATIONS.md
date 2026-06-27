# Operations Guide

This guide provides operational procedures, troubleshooting steps, and runbook for the Ollama Orchestrator.

## Health Checks

### Quick Health Verification

```bash
# Basic connectivity
curl -f http://localhost:5100/health

# Detailed health status
curl http://localhost:5100/api/orchestrator/health

# In-flight requests
curl http://localhost:5100/api/orchestrator/in-flight

# Server status
curl http://localhost:5100/api/orchestrator/servers
```

### Health Check Fields

- `status`: "healthy" or "unhealthy"
- `uptime`: Service uptime in seconds
- `version`: Current version
- `servers`: Count of healthy/total servers

### Extended Monitoring

```bash
# In-flight requests by server
curl http://localhost:5100/api/orchestrator/in-flight

# Server status
curl http://localhost:5100/api/orchestrator/servers

# Circuit breakers
curl http://localhost:5100/api/orchestrator/circuit-breakers

# Model status across fleet
curl http://localhost:5100/api/orchestrator/models/status

# Analytics summary
curl http://localhost:5100/api/orchestrator/analytics/summary
```

## Verifying Service Health

The orchestrator exposes two health endpoints:

- `GET /health` - Always returns 200 if the service is running (liveness probe)
- `GET /health/ready` - Returns 200 if ready, 503 if not ready (readiness probe)

### Systemd Readiness Gate

The systemd service uses `/health/ready` to gate startup. The `ExecStartPost` directive in the service file polls this endpoint for up to 30 seconds. If the endpoint returns 503 (no healthy servers configured) or the service fails to start, the service transitions to a **failed** state rather than silently restarting.

This prevents the "restart loop of death" where a misconfigured service restarts repeatedly without clear error indication.

### Quick Health Check

```bash
# Service status
systemctl is-active ollama-orchestrator
systemctl status ollama-orchestrator

# Liveness (always 200 if running)
curl -f http://localhost:5100/health

# Readiness (200 if ready, 503 if not)
curl -f http://localhost:5100/health/ready

# Recent logs
journalctl -u ollama-orchestrator --since "5 minutes ago"
```

### Init Failure Detection

If the service fails to start (e.g., bad config), check:

```bash
# Check if service is in failed state
systemctl status ollama-orchestrator

# View recent logs
journalctl -u ollama-orchestrator --since "1 minute ago"
```

The `ExecStartPost` will time out after 30s and mark the service as failed (not silently restart). This makes init failures visible immediately rather than hidden in restart loops.

## Common Issues and Solutions

### High Latency or Timeouts

**Symptoms:**

- Requests taking >30 seconds
- Timeout errors in client
- Queue depth increasing

**Diagnosis:**

```bash
# Check server performance
curl http://localhost:5100/api/orchestrator/analytics/server-performance

# Check in-flight status
curl http://localhost:5100/api/orchestrator/in-flight

# Check circuit breaker status
curl http://localhost:5100/api/orchestrator/metrics | grep circuit_breaker
```

**Solutions:**

1. Add more Ollama servers
2. Reduce maxConcurrency per server
3. Check Ollama server resources (CPU/memory)
4. Check in-flight request backlog

### Circuit Breaker Tripping

**Symptoms:**

- Requests failing with "circuit breaker open"
- Sudden increase in errors

**Diagnosis:**

```bash
# Check circuit breaker metrics
curl http://localhost:5100/api/orchestrator/metrics | grep circuit_breaker

# Check error rates
curl http://localhost:5100/api/orchestrator/analytics/errors
```

**Solutions:**

1. Investigate root cause (server down, network issues)
2. Adjust failure threshold if needed
3. Manually reset breaker:

```bash
curl -X POST http://localhost:5100/api/orchestrator/circuit-breakers/{serverId}/{model}/reset
```

### Server Failures

**Symptoms:**

- Specific server marked as unhealthy
- Requests routed away from failing server

**Diagnosis:**

```bash
# Check server health
curl http://localhost:5100/api/orchestrator/servers

# Check server metrics
curl http://localhost:5100/api/orchestrator/metrics | grep server
```

**Recovery:**

```bash
# Remove failed server
curl -X DELETE http://localhost:5100/api/orchestrator/servers/{server-id}

# Add replacement server
curl -X POST http://localhost:5100/api/orchestrator/servers/add \
  -H "Content-Type: application/json" \
  -d '{"id": "new-server", "url": "http://new-server:11434", "maxConcurrency": 4}'
```

### Server Drain/Undrain

**Symptoms:**

- Need to take a server offline for maintenance
- Gradual traffic reduction before shutdown

**Operations:**

```bash
# Drain a specific server (stop accepting new requests, wait for completion)
curl -X POST http://localhost:5100/api/orchestrator/servers/{serverId}/drain

# Check drain status
curl http://localhost:5100/api/orchestrator/servers

# Undrain a server (resume accepting requests)
curl -X POST http://localhost:5100/api/orchestrator/servers/{serverId}/undrain

# Alternative: set maintenance mode
curl -X POST http://localhost:5100/api/orchestrator/servers/{serverId}/maintenance \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "reason": "planned maintenance"}'
```

### Circuit Breaker Management

**Symptoms:**

- Server stuck in open/half-open state
- Need to force circuit breaker state for testing

**Operations:**

```bash
# Get all circuit breakers
curl http://localhost:5100/api/orchestrator/circuit-breakers

# Get specific breaker details
curl http://localhost:5100/api/orchestrator/circuit-breakers/{serverId}/{model}

# Force circuit breaker open (block traffic)
curl -X POST http://localhost:5100/api/orchestrator/circuit-breakers/{serverId}/{model}/open

# Force circuit breaker closed (allow traffic)
curl -X POST http://localhost:5100/api/orchestrator/circuit-breakers/{serverId}/{model}/close

# Force circuit breaker half-open (test recovery)
curl -X POST http://localhost:5100/api/orchestrator/circuit-breakers/{serverId}/{model}/half-open

# Reset circuit breaker to normal
curl -X POST http://localhost:5100/api/orchestrator/circuit-breakers/{serverId}/{model}/reset

# Reset all breakers for a server
curl -X POST http://localhost:5100/api/orchestrator/circuit-breakers/{serverId}/reset
```

### Recovery Failure Analysis

**Symptoms:**

- Multiple recovery test failures
- Server repeatedly failing health checks

**Diagnosis:**

```bash
# Get recovery failures summary
curl http://localhost:5100/api/orchestrator/recovery-failures

# Get stats for specific server
curl http://localhost:5100/api/orchestrator/recovery-failures/{serverId}

# Get failure history
curl http://localhost:5100/api/orchestrator/recovery-failures/{serverId}/history

# Analyze server failures
curl http://localhost:5100/api/orchestrator/recovery-failures/{serverId}/analysis

# Get circuit breaker impact
curl http://localhost:5100/api/orchestrator/recovery-failures/{serverId}/circuit-breaker-impact

# Trigger manual recovery test
curl -X POST http://localhost:5100/api/orchestrator/servers/{serverId}/models/{model}/recovery-test

# Reset recovery stats for a server
curl -X POST http://localhost:5100/api/orchestrator/recovery-failures/{serverId}/reset
```

### Ban Management

**Symptoms:**

- Server consistently failing for specific model
- Want to temporarily block server:model combinations

**Operations:**

```bash
# Get all active bans
curl http://localhost:5100/api/orchestrator/bans

# Clear all bans
curl -X DELETE http://localhost:5100/api/orchestrator/bans

# Clear bans for specific server
curl -X DELETE http://localhost:5100/api/orchestrator/bans/server/{serverId}

# Clear bans for specific model
curl -X DELETE http://localhost:5100/api/orchestrator/bans/model/{model}

# Remove specific ban
curl -X DELETE http://localhost:5100/api/orchestrator/bans/{serverId}/{model}
```

### Memory Issues

**Symptoms:**

- Out of memory errors
- Service restarts
- Slow performance

**Diagnosis:**

```bash
# Check memory usage in Docker
docker stats

# Check orchestrator metrics
curl http://localhost:5100/api/orchestrator/metrics | grep memory
```

**Solutions:**

1. Increase container memory limits
2. Reduce metrics retention period
3. Enable memory-based circuit breaking
4. Restart service during low-traffic periods

### Configuration Issues

**Symptoms:**

- Service fails to start
- Unexpected behavior after config changes

**Recovery:**

```bash
# Check current config
curl http://localhost:5100/api/orchestrator/config

# Validate config
curl http://localhost:5100/api/orchestrator/config/schema

# Reload from file
curl -X POST http://localhost:5100/api/orchestrator/config/reload \
  -H "Content-Type: application/json" \
  -d '{"configPath": "/path/to/config.yaml"}'

# Save current config to file
curl -X POST http://localhost:5100/api/orchestrator/config/save
```

## Maintenance Procedures

### Rolling Updates

```bash
# Enable maintenance mode for a specific server
curl -X POST http://localhost:5100/api/orchestrator/servers/{serverId}/maintenance \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'

# Wait for in-flight requests to complete
watch -n5 curl -s http://localhost:5100/api/orchestrator/in-flight

# Update and restart
docker-compose -f docker-compose.prod.yml up -d orchestrator

# Disable maintenance mode
curl -X POST http://localhost:5100/api/orchestrator/servers/{serverId}/maintenance \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

### Log Rotation

```bash
# Check current logs
docker-compose -f docker-compose.prod.yml logs --tail=100 orchestrator

# Rotate logs (if using json-file driver)
docker-compose -f docker-compose.prod.yml restart orchestrator
```

### Metrics Cleanup

```bash
# Check disk usage
du -sh ./data/

# Metrics are automatically managed based on historyWindowMinutes setting
# Default is 60 minutes. To reduce disk usage, decrease this in config:
curl -X PATCH http://localhost:5100/api/orchestrator/config/metrics \
  -H "Content-Type: application/json" \
  -d '{"historyWindowMinutes": 30}'
```

## Monitoring Alerts

### Critical Alerts

- Service down (health check fails)
- All servers unhealthy
- Queue at maximum capacity
- Circuit breaker permanently open
- Memory usage > 90%

### Warning Alerts

- Single server unhealthy
- Queue depth > 50
- Error rate > 5%
- Latency P95 > 10 seconds

### Prometheus Alert Rules

```yaml
groups:
  - name: orchestrator
    rules:
      - alert: OrchestratorDown
        expr: up{job="orchestrator"} == 0
        for: 1m
        labels:
          severity: critical

      - alert: AllServersUnhealthy
        expr: orchestrator_servers_healthy == 0
        for: 5m
        labels:
          severity: critical
```

## Performance Tuning

### Load Testing

```bash
# Run performance tests
npm run test:performance

# Monitor during test
watch curl http://localhost:5100/api/orchestrator/metrics
```

### Temporal Scoring Cold Start

The temporal scorer uses a 14-day historical window to predict server performance. During this cold-start period (or for brand-new servers with no 14-day history), the temporal scorer returns `null` and the load balancer falls back entirely to other scoring signals (latency, success rate, load, capacity).

**Implications:**

- New servers or servers returning after a long downtime may receive less optimal routing until 14 days of data accumulates
- The load balancer still functions correctly during cold-start — it simply has less historical context to work with
- If faster temporal learning is desired, consider shortening the temporal scorer's data window (configured in `persistence.metrics.historyWindowDays`)

**Recommendation:** If you are operating a fleet with frequent server additions/removals, keep the default 14-day window to avoid noisy temporal signals from short-lived data. If your server fleet is stable and you want faster adaptation to changed patterns, consider reducing the history window (e.g., to 7 days).

### Configuration Tuning

Based on load testing results:

```yaml
# High throughput
circuitBreaker:
  errorRateThreshold: 0.5
  openTimeout: 15000

# Low latency
circuitBreaker:
  errorRateThreshold: 0.3
  openTimeout: 5000
```

## Backup and Restore

### Configuration Backup

```bash
# Daily backup
curl http://localhost:5100/api/orchestrator/config > config-$(date +%Y%m%d).json
```

### Metrics Backup

```bash
# Backup metrics data
tar czf metrics-backup-$(date +%Y%m%d).tar.gz ./data/metrics/
```

### Full Restore

```bash
# Restore configuration
curl -X POST http://localhost:5100/api/orchestrator/config \
  -H "Content-Type: application/json" \
  -d @config-backup.json

# Restore metrics
tar xzf metrics-backup.tar.gz
```

## Streaming and Handoff Limitations

### OpenAI Completions Streaming Handoff

When a streaming request to an OpenAI completions endpoint (`/v1/completions`) stalls, the orchestrator cannot perform stream handoff to a different server. This is because the completions endpoint does not support continuation — there is no accumulated context (like the Ollama context array or the OpenAI chat message history) that can be replayed on another server.

**Affected endpoint:** `POST /v1/completions` (streaming)

**What happens:** If a streaming completions request stalls, the request fails with the stalled response rather than failover to another server.

**Affected protocols:** OpenAI completions only. Chat completions (`/v1/chat/completions`) and Ollama endpoints (`/api/generate`, `/api/chat`) support full stream handoff.

**Workaround:** Use `/v1/chat/completions` for streaming requests that require failover support, or implement client-side retry logic for completions streaming requests.

If OpenAI completions streaming handoff is required, it can be implemented by adding a `buildOpenAICompletionsContinuation()` function that replays the accumulated text as a new completion request.

## Emergency Procedures

### Service Completely Down

1. Check Docker status: `docker-compose ps`
2. Check logs: `docker-compose logs orchestrator`
3. Restart service: `docker-compose restart orchestrator`
4. If restart fails, check system resources
5. Last resort: Full redeploy

### Data Loss

1. Check if metrics persistence is enabled
2. Restore from backup if available
3. Metrics will be rebuilt from current operations

### Security Incident

1. Isolate affected components
2. Check access logs for suspicious activity
3. Rotate any exposed credentials
4. Update and redeploy with security patches

## Rate Limiting in Multi-Process Deployments

The orchestrator's rate limiter uses `express-rate-limit` with the default in-memory store. This works correctly for single-process deployments (e.g., direct systemd).

### When This Is a Problem

If you deploy the orchestrator in:

- PM2 cluster mode (`pm2 start ecosystem.config.js` with `instances: N`)
- Kubernetes with multiple replicas
- Multiple Node.js processes behind a load balancer

Each process maintains its own counter, so a client hitting 3 replicas gets 3 × the configured limit (e.g., 300 requests instead of 100 per 15 minutes).

### Solution: Shared Redis Store

For multi-process deployments, configure a shared Redis store:

```bash
npm install rate-limit-redis redis
```

In `src/middleware/rate-limiter.ts`:

```typescript
import RedisStore from 'rate-limit-redis';
import { createClient } from 'redis';

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
await redisClient.connect();

const store = new RedisStore({
  sendCommand: (...args) => redisClient.sendCommand(args),
});

// Use `store` in the rateLimit() options
```

### Current Deployment

The reference deployment is single-process systemd. Multi-process scaling is a separate concern.

## Metrics Database Retention

The orchestrator uses SQLite for metrics storage at `data/metrics.db`. Without intervention, this file can grow large (observed 27.6 GB in production).

### Recommended Retention

- **Hot data**: 7 days (in-database, fast queries)
- **Warm data**: 30 days (compressed, slower queries)
- **Cold data**: 90 days (archived, off-DB)

### Manual Cleanup

Prune old metrics directly via SQLite:

```bash
sqlite3 data/metrics.db "DELETE FROM request_metrics WHERE timestamp < strftime('%s', 'now', '-7 days') * 1000"
```

## Log Rotation

The orchestrator dual-writes logs to:

- `logs/app-*.log` (200-300 MB/day)
- stdout (captured by systemd)

The install script sets up logrotate (see `/etc/logrotate.d/ollama-orchestrator`) to:

- Rotate daily
- Compress after 1 day
- Keep 7 days
- Missing files are OK

To change retention: edit `/etc/logrotate.d/ollama-orchestrator`.

## Systemd Service Management

The orchestrator runs as a systemd service.

**Status**: `systemctl status ollama-orchestrator`
**Start**: `systemctl start ollama-orchestrator`
**Stop**: `systemctl stop ollama-orchestrator`
**Logs**: `journalctl -u ollama-orchestrator -f`

The service runs as user `orchestrator` (not root) per the hardened service file.
