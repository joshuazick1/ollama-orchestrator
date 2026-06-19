# Ollama Orchestrator — Operational Runbook

Operational guide for the Ollama Orchestrator (post `orchestrator-stability-release`).
This runbook is a companion to the deployment procedure in
[`DEPLOY-ORCHESTRATOR-STABILITY.md`](DEPLOY-ORCHESTRATOR-STABILITY.md).

## 1. Service Health

### Check service status

```bash
systemctl status ollama-orchestrator
```

### Quick health probe

```bash
curl -fsS http://localhost:5100/health
curl -fsS http://localhost:5100/health/ready
```

### Service runtime state

```bash
systemctl show ollama-orchestrator --property=ActiveEnterTimestamp,MainPID,MemoryCurrent
```

### Tail recent logs

```bash
journalctl -u ollama-orchestrator --since "1 hour ago" --no-pager | tail -200
```

## 2. Fleet Visibility

### Servers (summary)

```bash
curl -fsS http://localhost:5100/api/orchestrator/servers | jq '{count, success}'
```

### Per-server health

```bash
curl -s http://localhost:5100/api/orchestrator/servers | jq '.servers[] | {id, healthy, modelCount: (.models | length)}'
```

### Fleet model distribution

```bash
curl -s http://localhost:5100/api/orchestrator/servers \
  | jq '[.servers[] | .models[]] | group_by(.) | map({model: .[0], count: length}) | sort_by(.count) | reverse | .[0:20]'
```

### Live in-flight per server

```bash
watch -n 1 'curl -s http://localhost:5100/api/orchestrator/servers | jq "[.servers[] | {id, inFlight, healthy}]"'
```

## 3. Recent Routing Decisions

### Last 20 decisions

```bash
curl -s "http://localhost:5100/api/orchestrator/analytics/decisions?limit=20" | jq '.decisions[:5]'
```

### Per-algorithm stats

```bash
curl -s http://localhost:5100/api/orchestrator/analytics/algorithms
```

### Score timeline for a specific (server, model)

```bash
curl -s "http://localhost:5100/api/orchestrator/analytics/score-timeline?serverId=server-1&model=llama3.2:3b"
```

## 4. Kill Switch (`fallbackToFastestResponse`)

The kill switch is **safe by default**: it is `false`. When set to `true`, every load
balancer algorithm (`weighted`, `prefix-cache-aware`, `round-robin`, etc.) reverts
to `fastest-response` behavior **without a service restart**.

### Enable kill switch

```bash
curl -X POST http://localhost:5100/api/orchestrator/config \
  -H "Content-Type: application/json" \
  -d '{"loadBalancer": {"fallbackToFastestResponse": true}}'
```

### Disable kill switch

```bash
curl -X POST http://localhost:5100/api/orchestrator/config \
  -H "Content-Type: application/json" \
  -d '{"loadBalancer": {"fallbackToFastestResponse": false}}'
```

### Verify current state

```bash
curl -s http://localhost:5100/api/orchestrator/config | jq '.config.loadBalancer.fallbackToFastestResponse'
```

### When to use

- Unexpected routing behavior after upgrading
- New scoring components producing erratic decisions
- Sudden SLO breach correlated with the rollout
- During any active incident

### After the incident

1. Investigate root cause (metrics, logs, decisions)
2. Disable the kill switch once the cause is fixed
3. Verify routing normalizes via the decision analytics

## 5. SLO Fallback Mode

When SLO fallback is enabled and a server's P95 TTFT exceeds the configured
threshold, the load balancer routes to the server with the best recent
recovery rate.

### Enable

```bash
curl -X POST http://localhost:5100/api/orchestrator/config \
  -H "Content-Type: application/json" \
  -d '{"loadBalancer": {"sloFallback": {"enabled": true, "ttftThresholdMs": 2000, "p95WindowMs": 60000}}}'
```

### Verify

```bash
curl -s http://localhost:5100/api/orchestrator/config | jq '.config.loadBalancer.sloFallback'
```

## 6. Prefix-Cache-Aware Routing

When enabled, prompts are routed to the same upstream server based on a
consistent hash of the leading token prefix, maximizing cache hit rates.

### Enable

```bash
curl -X POST http://localhost:5100/api/orchestrator/config \
  -H "Content-Type: application/json" \
  -d '{
    "loadBalancer": {
      "algorithm": "prefix-cache-aware",
      "prefixCacheAware": {"enabled": true, "hashTokenCount": 512, "hashBuckets": 256}
    }
  }'
```

### Verify routing

Send the same prompt 10 times and confirm ≥ 8 land on the same server:

```bash
for i in $(seq 1 10); do
  curl -s -X POST http://localhost:5100/api/generate \
    -H "Content-Type: application/json" \
    -d '{"model": "llama3.2:1b-instruct-q4_K_M", "prompt": "What is 2+2?", "stream": false}' \
    | jq -r '.server_id // .server // "?"'
done | sort | uniq -c | sort -rn
```

## 7. Live Metrics

### Prometheus scrape

```bash
curl -fsS http://localhost:5100/api/orchestrator/metrics/prometheus
```

### Key metrics to watch post-deploy

- `orchestrator_avg_latency_ms` — should NOT stay pinned at the previous stale value
- `orchestrator_decision_total{selectionReason="..."}` — distribution sanity check
- `orchestrator_inflight_current{serverId="..."}` — should track active requests
- `orchestrator_request_errors_total{errorType="..."}` — error breakdown
- `orchestrator_circuit_breaker_state{serverId,model,state}` — fleet-wide breaker view

### Stream the metrics for a few minutes

```bash
watch -n 5 'curl -s http://localhost:5100/api/orchestrator/metrics/prometheus | grep -E "(error_rate|p95_latency|in_flight|decision_total)"'
```

## 8. Deploy a New Build

See [`DEPLOY-ORCHESTRATOR-STABILITY.md`](DEPLOY-ORCHESTRATOR-STABILITY.md) for the
full step-by-step procedure. The short form is:

```bash
# Pre-flight
npm run typecheck && npm test && npm run build

# Deploy (idempotent; soft-stop then start)
sudo bash scripts/install.sh
sudo systemctl restart ollama-orchestrator

# Wait for ready
until curl -fsS http://localhost:5100/health/ready >/dev/null 2>&1; do
  sleep 1
done
```

If the new build misbehaves, use the kill switch (Section 4). If that is not
enough, run the automated rollback:

```bash
bash scripts/deploy-orchestrator-stability.sh --rollback
```

## 9. Common Failure Modes

| Symptom                      | First action                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| All requests 503             | Check `/health/ready`; inspect in-flight; verify LB returns at least one healthy server   |
| High error rate on one model | Check circuit breakers for that model: `curl .../circuit-breakers?serverId=...&model=...` |
| Memory growth                | Tail logs for `LIFECYCLE_STREAM_ABORT` and in-flight cleanup errors                       |
| Slow TTFT                    | Check `p95_ttft_ms` per server; consider enabling SLO fallback                            |
| Stuck decisions / no routing | Confirm algorithm config; check `selectionReason` distribution                            |

## 10. Logs

```bash
# Live tail
journalctl -u ollama-orchestrator -f

# Errors only
journalctl -u ollama-orchestrator -f | grep -E "ERROR|FATAL"

# Specific request ID
journalctl -u ollama-orchestrator | grep "<request-id-here>"
```

Logs include `LIFECYCLE_*` events when `loadBalancer.fallbackToFastestResponse` or
related observability is enabled. Each request has a request ID propagated through
the response as `X-Request-Id`.
