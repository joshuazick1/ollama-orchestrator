#!/bin/bash
# Phase 3: Embeddings (30 seconds)
# 20 concurrent, nomic-embed-text:latest

URL="http://localhost:5100"
DURATION=30
CONCURRENCY=20
MODEL="nomic-embed-text:latest"
INPUTS=("Load balancing optimization" "Circuit breaker pattern recovery" "Distributed system fault tolerance" "Machine learning inference pipeline" "Streaming response chunk processing")

end_time=$(($(date +%s) + DURATION))
request_count=0

> /tmp/phase3_results.txt

echo "[Phase 3] Starting embeddings: $DURATION seconds, concurrency $CONCURRENCY, model $MODEL"

while [ $(date +%s) -lt $end_time ]; do
  active_jobs=$(jobs -r | wc -l)
  if [ $active_jobs -lt $CONCURRENCY ]; then
    input_idx=$((request_count % ${#INPUTS[@]}))
    input="${INPUTS[$input_idx]}"
    uuid=$(cat /dev/urandom | tr -dc 'a-f0-9' | head -c 8)
    curl -s -X POST "$URL/api/embeddings?debug=true" \
      -H "Content-Type: application/json" \
      -H "X-Include-Debug-Info: true" \
      -H "X-Request-Id: phase3-${uuid}" \
      -d "{\"model\":\"$MODEL\",\"prompt\":\"$input\"}" \
      -w "%{http_code} %{time_total}\n" -o /dev/null >> /tmp/phase3_results.txt &
    request_count=$((request_count + 1))
  fi
  sleep 0.05
done
wait
awk 'BEGIN {
  two_xx=0; four_xx=0; five_xx=0; conn_err=0; total=0; sum_time=0
}
{
  total++
  code=$1
  time=$2
  sum_time+=time
  if (code ~ /^2[0-9][0-9]$/) two_xx++
  else if (code ~ /^4[0-9][0-9]$/) four_xx++
  else if (code ~ /^5[0-9][0-9]$/) five_xx++
  else conn_err++
}
END {
  avg_latency = (total > 0) ? (sum_time / total) * 1000 : 0
  errors = four_xx + five_xx + conn_err
  error_rate = (total > 0) ? (errors / total) * 100 : 0
  printf "[Phase 3] Results: 2xx=%d (%.1f%%) | 4xx=%d (%.1f%%) | 5xx=%d (%.1f%%) | conn_err=%d (%.1f%%) | avg_latency=%.0fms | error_rate=%.1f%%\n", \
    two_xx, (total>0?two_xx/total*100:0), \
    four_xx, (total>0?four_xx/total*100:0), \
    five_xx, (total>0?five_xx/total*100:0), \
    conn_err, (total>0?conn_err/total*100:0), \
    avg_latency, error_rate
}' /tmp/phase3_results.txt
echo "[Phase 3] Complete: $request_count requests sent"
