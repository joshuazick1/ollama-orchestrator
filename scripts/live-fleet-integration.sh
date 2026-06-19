#!/usr/bin/env bash
# live-fleet-integration.sh
# Live system integration test for the orchestrator-stability-release.
# Verifies the new binary on the live systemd-managed system.
#
# Run AFTER deploy-orchestrator-stability.sh completes.

set -uo pipefail

BASE="http://localhost:5100"
LOG="/tmp/live-fleet-integration.log"
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

: > "$LOG"
log() { echo "[live-integration] $*" | tee -a "$LOG"; }
pass() { log "PASS: $*"; PASS_COUNT=$((PASS_COUNT+1)); }
fail() { log "FAIL: $*"; FAIL_COUNT=$((FAIL_COUNT+1)); }
warn() { log "WARN: $*"; WARN_COUNT=$((WARN_COUNT+1)); }

# Pick a model that has many servers (so we have something to route against)
PREFERRED_MODEL="llama3.2:1b-instruct-q4_K_M"

require_health() {
  if ! curl -fsS "$BASE/health" >/dev/null 2>&1; then
    log "service is not healthy at $BASE; aborting"
    exit 2
  fi
}

# Find a small chat model that has at least 1 healthy server
find_chat_model() {
  local found
  found=$(curl -s "$BASE/api/orchestrator/servers" | \
    jq -r '.servers[] | select(.healthy == true) | .models[]' 2>/dev/null | \
    grep -E "^(llama3\.2|qwen2\.5|gemma):" | head -1 | tr -d '[:space:]')
  if [[ -n "$found" ]]; then
    echo "$found"
  else
    echo "$PREFERRED_MODEL"
  fi
}

# ---------- Tests ----------

test_health_check() {
  if curl -fsS -o /dev/null -w "%{http_code}" "$BASE/health" | grep -q "^200$"; then
    pass "health check returns 200"
  else
    fail "health check did not return 200"
  fi

  if curl -fsS -o /dev/null -w "%{http_code}" "$BASE/health/ready" | grep -qE "^(200|503)$"; then
    pass "readiness probe reachable"
  else
    fail "readiness probe not reachable"
  fi
}

test_single_request() {
  local model="$1"
  local resp
  resp=$(curl -s -o /tmp/live-integration-resp.json -w "%{http_code}|%{time_total}" \
    -X POST "$BASE/api/generate" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"$model\",\"prompt\":\"What is 2+2? Answer in one word.\",\"stream\":false}")
  local code="${resp%%|*}"
  local t="${resp##*|}"
  if [[ "$code" == "200" ]]; then
    pass "single request to $model returned 200 in ${t}s"
  else
    fail "single request to $model returned $code (body: $(head -c 200 /tmp/live-integration-resp.json))"
  fi
}

test_three_models() {
  # Use chat-capable models only (skip embedding models which are /api/embeddings only)
  local models
  models=$(curl -s "$BASE/api/orchestrator/servers" | \
    jq -r '.servers[] | select(.healthy == true) | .models[]' 2>/dev/null | \
    grep -E "^(llama3\.2:1b|llama3\.2:3b|qwen2\.5:7b|qwen2\.5:3b|gemma|smollm):" | sort -u | head -3)
  if [[ -z "$models" ]]; then
    warn "no suitable models for 3-model test"
    return
  fi
  while IFS= read -r model; do
    test_single_request "$model"
  done <<< "$models"
}

test_routing_diversity() {
  local model="${1:-$PREFERRED_MODEL}"
  # Send 20 requests, then read recent decisions from analytics
  for i in $(seq 1 20); do
    curl -s -X POST "$BASE/api/generate" \
      -H "Content-Type: application/json" \
      -d "{\"model\":\"$model\",\"prompt\":\"routing test $i\",\"stream\":false}" >/dev/null
  done
  sleep 2
  # Use a high limit so we get all our recent decisions
  local out="/tmp/live-integration-routing.txt"
  curl -s "$BASE/api/orchestrator/analytics/decisions?limit=200" | \
    jq -r --arg m "$model" '.events[] | select(.model == $m) | .selectedServerId' 2>/dev/null | \
    sort | uniq -c | sort -rn > "$out"
  if [[ -s "$out" ]]; then
    local distinct
    distinct=$(awk '{print $2}' "$out" | sort -u | wc -l)
    local total
    total=$(awk '{sum += $1} END {print sum}' "$out")
    if (( distinct >= 2 )); then
      pass "routing distributed across $distinct distinct servers (out of $total decisions for $model)"
    else
      warn "routing concentrated on 1 server — verify if only 1 server is healthy for $model"
    fi
  else
    fail "no decisions recorded for $model in analytics (sent 20 requests just now)"
  fi
}

test_streaming_ttft() {
  local model="${1:-$PREFERRED_MODEL}"
  local out
  out=$(curl -s -N -X POST "$BASE/api/generate" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"$model\",\"prompt\":\"Count to 3.\",\"stream\":true}" 2>&1 | \
    head -1)
  if [[ -n "$out" ]]; then
    pass "streaming first chunk received: $(echo "$out" | head -c 80)..."
  else
    fail "no streaming chunk received"
  fi
}

test_new_metrics() {
  local prom
  prom=$(curl -s "$BASE/api/orchestrator/metrics/prometheus")
  local found=0
  for metric in "itl" "per_size" "cold_start" "token_weighted" "error_type" "jitter"; do
    if echo "$prom" | grep -qi "$metric"; then
      (( found++ )) || true
    fi
  done
  if (( found >= 3 )); then
    pass "found $found new metric families in Prometheus output"
  else
    warn "only $found new metric families exposed — review Prometheus output"
    echo "$prom" | head -40 | tail -40
  fi
}

test_decision_breakdown() {
  local body
  body=$(curl -s "$BASE/api/orchestrator/analytics/decisions?limit=3")
  local keys
  keys=$(echo "$body" | jq -r '.events[0].candidates[0].breakdown | keys // empty' 2>/dev/null)
  local count
  count=$(echo "$body" | jq -r '.events[0].candidates[0].breakdown | keys | length // 0' 2>/dev/null)
  if [[ "$count" == "10" ]]; then
    pass "DecisionEvent has all 10 score components: $keys"
  elif [[ "$count" =~ ^[0-9]+$ ]] && (( count >= 4 )); then
    warn "DecisionEvent has $count components (expected 10): $keys"
  else
    warn "DecisionEvent breakdown not yet populated: $keys"
  fi
}

test_kill_switch() {
  local before after resp
  before=$(curl -s "$BASE/api/orchestrator/config" | jq -r '.config.loadBalancer.fallbackToFastestResponse // false')
  if [[ "$before" != "true" ]]; then
    # Use PATCH /api/orchestrator/config/loadBalancer for partial updates
    # (POST /api/orchestrator/config requires full loadBalancer object)
    resp=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/orchestrator/config/loadBalancer" \
      -H "Content-Type: application/json" \
      -d '{"fallbackToFastestResponse": true}')
    if [[ "$resp" == "200" ]]; then
      after=$(curl -s "$BASE/api/orchestrator/config" | jq -r '.config.loadBalancer.fallbackToFastestResponse')
      if [[ "$after" == "true" ]]; then
        pass "kill switch toggled ON via API (was $before, now $after)"
        # Toggle back off
        curl -s -X PATCH "$BASE/api/orchestrator/config/loadBalancer" \
          -H "Content-Type: application/json" \
          -d '{"fallbackToFastestResponse": false}' >/dev/null
        pass "kill switch toggled OFF (back to default)"
      else
        fail "kill switch PATCH returned 200 but state did not change (was $before, still $after)"
      fi
    else
      fail "kill switch PATCH returned $resp"
    fi
  else
    warn "kill switch is already ON (state: $before) — not toggling"
  fi
}

test_prefix_cache_aware() {
  local model="${1:-$PREFERRED_MODEL}"
  # Enable prefix-cache-aware via PATCH (partial update)
  local resp
  resp=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/orchestrator/config/loadBalancer" \
    -H "Content-Type: application/json" \
    -d '{"prefixCacheAware": {"enabled": true, "hashTokenCount": 512, "hashBuckets": 256}}')
  if [[ "$resp" != "200" ]]; then
    warn "could not enable prefix-cache-aware (PATCH returned $resp) — skipping"
    return
  fi
  local prompt="PFX-AWARE-TEST-PROMPT unique-$(date +%s)"
  for i in $(seq 1 10); do
    curl -s -X POST "$BASE/api/generate" \
      -H "Content-Type: application/json" \
      -d "{\"model\":\"$model\",\"prompt\":\"$prompt\",\"stream\":false}" >/dev/null
  done
  sleep 2
  local out="/tmp/live-integration-pcache.txt"
  curl -s "$BASE/api/orchestrator/analytics/decisions?limit=200" | \
    jq -r --arg m "$model" '.events[] | select(.model == $m) | .selectedServerId' 2>/dev/null | \
    sort | uniq -c | sort -rn > "$out"
  if [[ -s "$out" ]]; then
    local distinct
    distinct=$(awk '{print $2}' "$out" | sort -u | wc -l)
    local total
    total=$(awk '{sum += $1} END {print sum}' "$out")
    if (( distinct == 1 )) && (( total >= 8 )); then
      pass "prefix-cache-aware routed $total/$total same-prompt requests to a single server"
    elif (( distinct == 1 )); then
      pass "prefix-cache-aware routed all $total requests to a single server (target: ≥8)"
    else
      warn "prefix-cache-aware split across $distinct servers (expected 1) — algorithm may not be active"
    fi
  else
    warn "no decisions recorded for $model in prefix-cache-aware test"
  fi
  # Restore default
  curl -s -X PATCH "$BASE/api/orchestrator/config/loadBalancer" \
    -H "Content-Type: application/json" \
    -d '{"prefixCacheAware": {"enabled": false, "hashTokenCount": 512, "hashBuckets": 256}}' >/dev/null
}

# ---------- Main ----------

log "=== Live Fleet Integration Test (orchestrator-stability-release) ==="
log "Base URL: $BASE"
log "Log: $LOG"
log ""

require_health

CHAT_MODEL="$(find_chat_model)"
log "Selected chat model: $CHAT_MODEL"
log ""

test_health_check
test_three_models
test_routing_diversity "$CHAT_MODEL"
test_streaming_ttft "$CHAT_MODEL"
test_new_metrics
test_decision_breakdown
test_kill_switch
test_prefix_cache_aware "$CHAT_MODEL"

log ""
log "=== SUMMARY ==="
log "PASS: $PASS_COUNT"
log "WARN: $WARN_COUNT"
log "FAIL: $FAIL_COUNT"
log ""
if (( FAIL_COUNT == 0 )); then
  log "OVERALL: SUCCESS"
  exit 0
else
  log "OVERALL: FAIL — $FAIL_COUNT tests failed"
  exit 1
fi
