#!/bin/bash
# Phase 2: Spike (20 seconds)
# 50 concurrent, 3 models, all streaming

URL="http://localhost:5100"
DURATION=20
CONCURRENCY=50
MODELS=("llama3.2:1b-instruct-q4_K_M" "qwen2.5:7b-instruct-q4_K_M" "llama3.1:8b-instruct-q4_K_M")

end_time=$(($(date +%s) + DURATION))
request_count=0

> /tmp/phase2_results.txt

echo "[Phase 2] Starting spike: $DURATION seconds, concurrency $CONCURRENCY"

while [ $(date +%s) -lt $end_time ]; do
  active_jobs=$(jobs -r | wc -l)
  if [ $active_jobs -lt $CONCURRENCY ]; then
    model_idx=$((request_count % ${#MODELS[@]}))
    model="${MODELS[$model_idx]}"
    uuid=$(cat /dev/urandom | tr -dc 'a-f0-9' | head -c 8)
    curl -s -X POST "$URL/api/generate?debug=true" \
      -H "Content-Type: application/json" \
      -H "X-Include-Debug-Info: true" \
      -H "X-Request-Id: phase2-${uuid}" \
      -d "{\"model\":\"$model\",\"prompt\":\"Describe failover patterns in distributed systems.\",\"stream\":true,\"options\":{\"num_predict\":20}}" \
      -w "%{http_code} %{time_total}\n" -o /dev/null >> /tmp/phase2_results.txt &
    request_count=$((request_count + 1))
  fi
  sleep 0.02
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
  printf "[Phase 2] Results: 2xx=%d (%.1f%%) | 4xx=%d (%.1f%%) | 5xx=%d (%.1f%%) | conn_err=%d (%.1f%%) | avg_latency=%.0fms | error_rate=%.1f%%\n", \
    two_xx, (total>0?two_xx/total*100:0), \
    four_xx, (total>0?four_xx/total*100:0), \
    five_xx, (total>0?five_xx/total*100:0), \
    conn_err, (total>0?conn_err/total*100:0), \
    avg_latency, error_rate
}' /tmp/phase2_results.txt
echo "[Phase 2] Complete: $request_count requests sent"
