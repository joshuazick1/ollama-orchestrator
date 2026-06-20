#!/bin/bash
# Phase 1: Uniform Load (60 seconds)
# 15 concurrent, 3 models, 50/50 streaming

URL="http://localhost:5100"
DURATION=60
CONCURRENCY=15
MODELS=("llama3.2:1b-instruct-q4_K_M" "qwen2.5:7b-instruct-q4_K_M" "llama3.1:8b-instruct-q4_K_M")
PROMPTS=("Explain load balancing in distributed systems." "What are circuit breakers in microservices?" "Describe how streaming responses work in HTTP.")

end_time=$(($(date +%s) + DURATION))
request_count=0

> /tmp/phase1_results.txt

echo "[Phase 1] Starting uniform load: $DURATION seconds, concurrency $CONCURRENCY"

while [ $(date +%s) -lt $end_time ]; do
  active_jobs=$(jobs -r | wc -l)
  if [ $active_jobs -lt $CONCURRENCY ]; then
    model_idx=$((request_count % ${#MODELS[@]}))
    model="${MODELS[$model_idx]}"
    prompt_idx=$((request_count % ${#PROMPTS[@]}))
    prompt="${PROMPTS[$prompt_idx]}"
    is_stream=$((request_count % 2))
    uuid=$(cat /dev/urandom | tr -dc 'a-f0-9' | head -c 8)
    req_id="phase1-${uuid}"

    if [ $is_stream -eq 0 ]; then
      curl -s -X POST "$URL/api/generate?debug=true" \
        -H "Content-Type: application/json" \
        -H "X-Include-Debug-Info: true" \
        -H "X-Request-Id: $req_id" \
        -d "{\"model\":\"$model\",\"prompt\":\"$prompt\",\"stream\":false,\"options\":{\"num_predict\":20}}" \
        -w "%{http_code} %{time_total}\n" -o /dev/null >> /tmp/phase1_results.txt &
    else
      curl -s -X POST "$URL/api/generate?debug=true" \
        -H "Content-Type: application/json" \
        -H "X-Include-Debug-Info: true" \
        -H "X-Request-Id: $req_id" \
        -d "{\"model\":\"$model\",\"prompt\":\"$prompt\",\"stream\":true,\"options\":{\"num_predict\":20}}" \
        -w "%{http_code} %{time_total}\n" -o /dev/null >> /tmp/phase1_results.txt &
    fi
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
  printf "[Phase 1] Results: 2xx=%d (%.1f%%) | 4xx=%d (%.1f%%) | 5xx=%d (%.1f%%) | conn_err=%d (%.1f%%) | avg_latency=%.0fms | error_rate=%.1f%%\n", \
    two_xx, (total>0?two_xx/total*100:0), \
    four_xx, (total>0?four_xx/total*100:0), \
    five_xx, (total>0?five_xx/total*100:0), \
    conn_err, (total>0?conn_err/total*100:0), \
    avg_latency, error_rate
}' /tmp/phase1_results.txt
echo "[Phase 1] Complete: $request_count requests sent"
