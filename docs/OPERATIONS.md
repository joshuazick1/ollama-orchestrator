# Operations Guide

This guide provides operational procedures, troubleshooting steps, and runbook for the Ollama Orchestrator.

## Health Checks

### Quick Health Verification

```bash
# Basic connectivity
curl -f http://localhost:5100/health

# Detailed health status
curl http://localhost:5100/api/orchestrator/health

# Queue status
curl http://localhost:5100/api/orchestrator/queue

# Server status
curl http://localhost:5100/api/orchestrator/servers
```

### Health Check Fields

- `status`: "healthy" or "unhealthy"
- `uptime`: Service uptime in seconds
- `version`: Current version
- `servers`: Count of healthy/total servers
- `queue`: Current queue depth

### Extended Monitoring

```bash
# Queue status
curl http://localhost:5100/api/orchestrator/queue

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

# Check queue status
curl http://localhost:5100/api/orchestrator/queue

# Check circuit breaker status
curl http://localhost:5100/api/orchestrator/metrics | grep circuit_breaker
```

**Solutions:**

1. Add more Ollama servers
2. Reduce maxConcurrency per server
3. Check Ollama server resources (CPU/memory)
4. Enable queue timeout reduction

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

### Queue Backlog

**Symptoms:**

- Queue size > 100
- New requests rejected
- High memory usage

**Solutions:**

```bash
# Temporarily increase queue size
curl -X PATCH http://localhost:5100/api/orchestrator/config/queue \
  -H "Content-Type: application/json" \
  -d '{"maxSize": 2000}'

# Pause queue if needed
curl -X POST http://localhost:5100/api/orchestrator/queue/pause

# Add more servers to handle load
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

# Wait for queue to drain
watch curl http://localhost:5100/api/orchestrator/queue

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

      - alert: QueueFull
        expr: orchestrator_queue_size / orchestrator_queue_max_size > 0.9
        for: 2m
        labels:
          severity: warning
```

## Performance Tuning

### Load Testing

```bash
# Run performance tests
npm run test:performance

# Monitor during test
watch curl http://localhost:5100/api/orchestrator/metrics
```

### Configuration Tuning

Based on load testing results:

```yaml
# High throughput
queue:
  maxSize: 5000
  timeout: 60000

circuitBreaker:
  failureThreshold: 0.3
  recoveryTimeout: 15000

# Low latency
queue:
  maxSize: 100
  timeout: 10000

circuitBreaker:
  failureThreshold: 0.1
  recoveryTimeout: 5000
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
