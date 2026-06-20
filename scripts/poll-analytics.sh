#!/bin/bash
# Poll analytics endpoints every 15s during load test

URL="http://localhost:5100"
INTERVAL=15

while true; do
  ts=$(date +%H:%M:%S)
  echo "=== [$ts] Analytics Snapshot ==="

  echo "--- Summary ---"
  curl -s "$URL/api/orchestrator/analytics/summary" | jq '{rps: .summary.requestsPerSecond, errorRate: .summary.errorRate, totalRequests: .summary.totalRequests, totalErrors: .summary.totalErrors, avgLatency: .summary.avgLatency, uniqueServers: .summary.uniqueServers}' 2>/dev/null || echo "summary failed"

  echo "--- Selection Stats (top 5 servers) ---"
  curl -s "$URL/api/orchestrator/analytics/selection-stats?hours=1" | jq '[.stats | sort_by(-.totalSelections) | .[0:5] | .[] | {serverId, totalSelections, models: (.byModel | keys), avgScore}]' 2>/dev/null || echo "selection-stats failed"

  echo "--- Algorithm Usage ---"
  curl -s "$URL/api/orchestrator/analytics/algorithms" | jq '{algorithms: .algorithms}' 2>/dev/null || echo "algorithms failed"

  echo "--- In-Flight ---"
  curl -s "$URL/api/orchestrator/in-flight" | jq '{total: .total, inFlightCount: (.inFlight | length)}' 2>/dev/null || echo "in-flight failed"

  echo "--- Circuit Breakers ---"
  curl -s "$URL/api/orchestrator/circuit-breakers" | jq '{byState, totalCBs: (.circuitBreakers | length)}' 2>/dev/null || echo "circuit-breakers failed"

  echo ""
  sleep $INTERVAL
done
