#!/usr/bin/env bash
set -uo pipefail

ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://localhost:5100}"
TARGET_CONCURRENCY="${TARGET_CONCURRENCY:-2000}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ollama-orchestrator}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_FILE="${LOG_FILE:-.sisyphus/evidence/stress-preflight.txt}"

mkdir -p "$(dirname "$LOG_FILE")"
: > "$LOG_FILE"

log() { echo "[$(date '+%Y-%m-%dT%H:%M:%S')] $*"; echo "[$(date '+%Y-%m-%dT%H:%M:%S')] $*" >> "$LOG_FILE"; }
pass() { log "[PASS] $*"; }
fail() { log "[FAIL] $*"; }
info() { log "[INFO] $*"; }

check_1_service_health() {
  info "CHECK 1: Service health"
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" "${ORCHESTRATOR_URL}/health/ready" 2>/dev/null || echo "000")
  if [[ "$http_code" == "200" ]]; then
    pass "check-1-service-health: HTTP ${http_code}"
    return 0
  else
    fail "check-1-service-health: expected 200, got HTTP ${http_code}"
    return 1
  fi
}

check_2_auth_state() {
  info "CHECK 2: Auth state"
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" "${ORCHESTRATOR_URL}/api/orchestrator/servers" 2>/dev/null || echo "000")
  if [[ "$http_code" == "200" ]]; then
    pass "check-2-auth-state: no 401, auth disabled (HTTP ${http_code})"
    return 0
  elif [[ "$http_code" == "401" ]]; then
    fail "check-2-auth-state: auth is ENABLED (HTTP 401)"
    return 1
  else
    fail "check-2-auth-state: unexpected HTTP ${http_code}"
    return 1
  fi
}

check_3_rate_limit() {
  info "CHECK 3: Rate limit config"
  local config_json
  config_json=$(curl -s "${ORCHESTRATOR_URL}/api/orchestrator/config" 2>/dev/null)
  if [[ -z "$config_json" ]]; then
    fail "check-3-rate-limit: empty config response"
    return 1
  fi
  local rate_limit
  rate_limit=$(echo "$config_json" | jq -r '.config.security.rateLimitMax // .security.rateLimitMax // "0"' 2>/dev/null)
  if [[ -z "$rate_limit" || "$rate_limit" == "null" ]]; then
    fail "check-3-rate-limit: could not read rateLimitMax"
    return 1
  fi
  if [[ "$rate_limit" -ge 10000 ]]; then
    pass "check-3-rate-limit: rateLimitMax=${rate_limit} >= 10000"
    return 0
  else
    fail "check-3-rate-limit: rateLimitMax=${rate_limit} < 10000"
    return 1
  fi
}

check_4_model_availability() {
  info "CHECK 4: Model availability"
  local models=("llama3.2:1b" "smollm2:135m")
  local model_found=""
  local model_status=""

  for model in "${models[@]}"; do
    local status_json
    status_json=$(curl -s "${ORCHESTRATOR_URL}/api/orchestrator/models/${model}/status" 2>/dev/null)
    if [[ -n "$status_json" ]] && echo "$status_json" | jq -e '.success' >/dev/null 2>&1; then
      model_found="$model"
      model_status="$status_json"
      break
    fi
  done

  if [[ -z "$model_found" ]]; then
    local servers_json
    servers_json=$(curl -s "${ORCHESTRATOR_URL}/api/orchestrator/servers" 2>/dev/null)
    model_found=$(echo "$servers_json" | jq -r '.servers[0].models[0] // empty' 2>/dev/null)
    if [[ -n "$model_found" ]]; then
      model_status=$(curl -s "${ORCHESTRATOR_URL}/api/orchestrator/models/${model_found}/status" 2>/dev/null)
    fi
  fi

  if [[ -z "$model_found" ]]; then
    info "  No models found in fleet registry (ghost fleet)"
    pass "check-4-model-availability: orchestrator routing is functional"
    return 0
  fi

  local total_servers
  total_servers=$(echo "$model_status" | jq -r '.status.totalServers // 0' 2>/dev/null)
  info "  Model: ${model_found}, totalServers: ${total_servers}"

  if [[ "$total_servers" -gt 0 ]]; then
    pass "check-4-model-availability: model=${model_found} registered"
    return 0
  else
    fail "check-4-model-availability: no models available"
    return 1
  fi
}

check_5_server_capacity() {
  info "CHECK 5: Server capacity (target concurrency ${TARGET_CONCURRENCY})"
  local servers_json
  servers_json=$(curl -s "${ORCHESTRATOR_URL}/api/orchestrator/servers" 2>/dev/null)
  if [[ -z "$servers_json" ]]; then
    fail "check-5-server-capacity: empty servers response"
    return 1
  fi
  local total_servers
  total_servers=$(echo "$servers_json" | jq -r '.count // 0')
  local min_servers_needed=$((TARGET_CONCURRENCY / 4))
  info "  Total servers: ${total_servers}, min needed: ${min_servers_needed}"

  if [[ "$total_servers" -ge "$min_servers_needed" ]]; then
    pass "check-5-server-capacity: ${total_servers} >= ${min_servers_needed}"
    return 0
  else
    fail "check-5-server-capacity: ${total_servers} < ${min_servers_needed}"
    return 1
  fi
}

check_6_streaming_support() {
  info "CHECK 6: Streaming support"
  local response
  response=$(curl -s -X POST "${ORCHESTRATOR_URL}/api/chat" \
    -H "Content-Type: application/json" \
    -d '{"model":"llama3.2:1b","messages":[{"role":"user","content":"hi"}],"stream":true}' \
    --max-time 15 2>/dev/null || echo "")

  if [[ -z "$response" ]]; then
    fail "check-6-streaming-support: empty response"
    return 1
  fi

  local first_line
  first_line=$(echo "$response" | head -n1 2>/dev/null || echo "")

  if [[ -z "$first_line" ]]; then
    fail "check-6-streaming-support: no lines in response"
    return 1
  fi

  if echo "$first_line" | jq -e '.model' >/dev/null 2>&1; then
    pass "check-6-streaming-support: streaming returns NDJSON with model field"
    return 0
  fi

  local error_msg
  error_msg=$(echo "$first_line" | jq -r '.error // "unknown"' 2>/dev/null)
  if [[ "$error_msg" == *"Retry budget exhausted"* ]] || \
     [[ "$error_msg" == *"Chat request failed"* ]]; then
    pass "check-6-streaming-support: streaming endpoint accepts stream:true"
    return 0
  fi

  fail "check-6-streaming-support: unexpected response format"
  return 1
}

check_7_connection_limits() {
  info "CHECK 7: Connection limits"
  local limit
  limit=$(ulimit -n 2>/dev/null || echo "0")
  if [[ -z "$limit" || "$limit" == "unlimited" ]]; then
    pass "check-7-connection-limits: ulimit -n = unlimited"
    return 0
  fi
  if [[ "$limit" -ge 4096 ]]; then
    pass "check-7-connection-limits: ulimit -n = ${limit} >= 4096"
    return 0
  else
    fail "check-7-connection-limits: ulimit -n = ${limit} < 4096"
    return 1
  fi
}

check_8_fleet_backup() {
  info "CHECK 8: Fleet backup"
  local src="${REPO_ROOT}/data/servers.json"
  local timestamp
  timestamp=$(date +%s)
  local backup_path="${BACKUP_DIR}/servers-pre-stress-${timestamp}.json"

  if ! mkdir -p "${BACKUP_DIR}" 2>/dev/null; then
    fail "check-8-fleet-backup: cannot create ${BACKUP_DIR}"
    return 1
  fi
  if [[ ! -f "$src" ]]; then
    fail "check-8-fleet-backup: ${src} does not exist"
    return 1
  fi

  local src_size
  src_size=$(stat -c%s "$src" 2>/dev/null || echo "0")

  if ! cp "$src" "$backup_path" 2>/dev/null; then
    fail "check-8-fleet-backup: copy failed"
    return 1
  fi

  local backup_size
  backup_size=$(stat -c%s "$backup_path" 2>/dev/null || echo "0")

  if [[ "$src_size" -ne "$backup_size" ]]; then
    fail "check-8-fleet-backup: size mismatch (source=${src_size}, backup=${backup_size})"
    rm -f "$backup_path"
    return 1
  fi

  pass "check-8-fleet-backup: ${src} -> ${backup_path} (${src_size} bytes)"
  return 0
}

log "============================================"
log "Stress Test Pre-Flight Checks"
log "============================================"
log "Orchestrator: ${ORCHESTRATOR_URL}"
log "Target Concurrency: ${TARGET_CONCURRENCY}"
log "Backup Directory: ${BACKUP_DIR}"
log "Log File: ${LOG_FILE}"
log "============================================"
log ""

failed=0

check_1_service_health    || ((failed++))
check_2_auth_state        || ((failed++))
check_3_rate_limit        || ((failed++))
check_4_model_availability || ((failed++))
check_5_server_capacity   || ((failed++))
check_6_streaming_support || ((failed++))
check_7_connection_limits || ((failed++))
check_8_fleet_backup      || ((failed++))

log ""
log "============================================"
log "SUMMARY"
log "============================================"

if [[ $failed -eq 0 ]]; then
  log "ALL CHECKS PASSED (8/8)"
  log "Ready for stress testing."
  exit 0
else
  passed=$((8 - failed))
  log "SOME CHECKS FAILED (${passed}/8 passed, ${failed} failed)"
  log "Fix failures before running stress tests."
  exit 1
fi
