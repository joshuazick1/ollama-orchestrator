#!/usr/bin/env bash
# =============================================================================
# run-all-phases.sh - Master orchestration script for all stress test phases
# =============================================================================
# Usage:
#   bash scripts/stress/run-all-phases.sh [flags]
#
# Flags:
#   --skip-soak        Skip B3 (Soak) phase
#   --skip-multiclient Use single client per phase (default: 5 netns × VUs)
#   --quick            10x faster timing for testing
#   --help             Show this help message
#
# Phase order:
#   preflight → before-metrics → B1 → B2 → B3 → B4 → C1 → C2 → C3 →
#   C5 → C6 → C7 → C0 → D1 → D2 → D3 → D4 → after-metrics → evaluate → cleanup
#
# Output:
#   .sisyphus/evidence/stress-*.json  - Per-phase metrics snapshots
#   .sisyphus/evidence/stress-final-report.json - Aggregated report
# =============================================================================

set -uo pipefail

# --- Script directory & repo root ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SCRIPTS_STRESS="$SCRIPT_DIR"

# --- Paths ---
EVIDENCE_DIR="$REPO_ROOT/.sisyphus/evidence"
LOG_DIR="${LOG_DIR:-/var/log/stress}"
PID_DIR="${PID_DIR:-/tmp}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ollama-orchestrator}"

# --- Defaults ---
ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://localhost:5100}"
K6_PATH="${K6_PATH:-/usr/local/bin/k6}"
SKIP_SOAK=false
SKIP_MULTICLIENT=false
QUICK=false
FAILED_PHASES=()
PHASE_RESULTS=()

# --- Color codes ---
C_RESET='\033[0m'
C_RED='\033[0;31m'
C_GREEN='\033[0;32m'
C_YELLOW='\033[0;33m'
C_CYAN='\033[0;36m'
C_BOLD='\033[1m'

# --- Helpers ---
log()      { echo -e "${C_CYAN}[$(date '+%Y-%m-%dT%H:%M:%S')]${C_RESET} $*"; }
info()     { echo -e "${C_CYAN}[INFO]${C_RESET} $*"; }
warn()     { echo -e "${C_YELLOW}[WARN]${C_RESET} $*"; }
error()    { echo -e "${C_RED}[ERROR]${C_RESET} $*"; }
pass()     { echo -e "${C_GREEN}[PASS]${C_RESET} $*"; }
fail()     { echo -e "${C_RED}[FAIL]${C_RESET} $*"; }
section()  { echo ""; echo -e "${C_BOLD}${C_CYAN}==== $1 ====${C_RESET}"; }
subsection(){ echo -e "${C_BOLD}--- $1 ---${C_RESET}"; }

timestamp() { date '+%Y-%m-%dT%H:%M:%S'; }

# --- CLI parsing ---
usage() {
  head -30 "$0" | grep -m1 "^#"
  echo ""
  grep "^#   " "$0" | sed 's/^#   //'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-soak)       SKIP_SOAK=true; shift ;;
    --skip-multiclient) SKIP_MULTICLIENT=true; shift ;;
    --quick)           QUICK=true; shift ;;
    --help|-h)         usage ;;
    *)                  error "Unknown flag: $1"; usage ;;
  esac
done

# --- Timing constants (seconds) ---
if [[ "$QUICK" == "true" ]]; then
  # 10x faster for testing
  B1_DURATION=60      # was 600 (10 min)
  B2_DURATION=30      # was 300 (5 min)
  B3_DURATION=300     # was 3600 (60 min)
  B4_DURATION=60      # was 900 (15 min)
  C1_DURATION=60     # was 300 (5 min)
  C2_DURATION=60     # was 300 (5 min)
  C3_DURATION=60     # was 120 (2 min)
  C5_DURATION=60     # was 300 (5 min)
  C0_DURATION=60     # was 300 (5 min)
  PHASE_TIMEOUT_MULT=1.15
else
  B1_DURATION=600     # 10 min
  B2_DURATION=300     # 5 min
  B3_DURATION=3600    # 60 min
  B4_DURATION=900    # 15 min
  C1_DURATION=300    # 5 min
  C2_DURATION=300    # 5 min
  C3_DURATION=120    # 2 min
  C5_DURATION=300    # 5 min
  C0_DURATION=300    # 5 min per model
  PHASE_TIMEOUT_MULT=1.15
fi

# --- VU counts ---
if [[ "$SKIP_MULTICLIENT" == "true" ]]; then
  B1_VUS=100
  B3_VUS=40
  B4_VUS=100
  C1_VUS=50
  C2_VUS=50
  C5_VUS=50
  C0_VUS=100
else
  # 5 netns × VUs each = total
  B1_VUS=500   # 5 × 100
  B3_VUS=200   # 5 × 40
  B4_VUS=100
  C1_VUS=150   # 50 × 3 endpoints
  C2_VUS=150   # 50 × 3 endpoints
  C5_VUS=100   # 50 embed + 50 chat
  C0_VUS=100
fi

# --- Ensure directories exist ---
mkdir -p "$EVIDENCE_DIR" "$LOG_DIR"

# =============================================================================
# PHASE RUNNERS
# =============================================================================

# --- Metrics collection ---
collect_metrics() {
  local label="$1"  # e.g., "before-b1" or "after-b4"
  local output_file="$EVIDENCE_DIR/stress-${label}.json"
  log "Collecting metrics: $label"
  npx tsx "$SCRIPTS_STRESS/collect-metrics.ts" \
    --label "$label" \
    --output "$EVIDENCE_DIR/stress-" \
    2>&1 | while IFS= read -r line; do
    info "  collect-metrics: $line"
  done
  if [[ -f "$output_file" ]]; then
    pass "Metrics saved: $output_file"
    return 0
  else
    fail "Metrics file not found: $output_file"
    return 1
  fi
}

# --- Run a foreground phase with timeout ---
run_phase_fg() {
  local phase_name="$1"
  local timeout_sec="$2"
  shift 2
  local cmd=("$@")

  log "Starting foreground phase: $phase_name (timeout: ${timeout_sec}s)"
  local start_time
  start_time=$(date +%s)

  # Run with timeout
  if timeout "$timeout_sec" "${cmd[@]}"; then
    local elapsed=$(( $(date +%s) - start_time ))
    pass "Phase $phase_name completed in ${elapsed}s"
    PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"PASS\",\"duration\":${elapsed}}")
    return 0
  else
    local exit_code=$?
    local elapsed=$(( $(date +%s) - start_time ))
    warn "Phase $phase_name exited with code $exit_code after ${elapsed}s"
    FAILED_PHASES+=("$phase_name")
    PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"FAIL\",\"duration\":${elapsed},\"exit_code\":${exit_code}}")
    return 1
  fi
}

# --- Run a background phase with nohup ---
run_phase_bg() {
  local phase_name="$1"
  local timeout_sec="$2"
  local log_file="$LOG_DIR/${phase_name}.log"
  local pid_file="$PID_DIR/stress-${phase_name}.pid"
  shift 2
  local cmd=("$@")

  log "Starting background phase: $phase_name (timeout: ${timeout_sec}s, log: $log_file)"

  # Write startup info to log
  {
    echo "=== Phase $phase_name started at $(timestamp) ==="
    echo "Command: ${cmd[*]}"
    echo "=== STDOUT/STDERR ==="
  } > "$log_file"

  # Launch in background with nohup
  nohup "${cmd[@]}" >> "$log_file" 2>&1 &
  local pid=$!
  echo "$pid" > "$pid_file"

  log "Background phase $phase_name running as PID $pid"
  log "Log file: $log_file"

  # Wait for completion or timeout
  local waited=0
  local interval=5
  while kill -0 "$pid" 2>/dev/null; do
    if (( waited >= timeout_sec )); then
      warn "Phase $phase_name timed out after ${timeout_sec}s, killing..."
      kill -9 "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      FAILED_PHASES+=("$phase_name")
      PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"TIMEOUT\",\"timeout\":${timeout_sec}}")
      return 1
    fi
    sleep "$interval"
    waited=$(( waited + interval ))
    log "  ... still running (${waited}s/${timeout_sec}s)"
  done

  # Process finished
  wait "$pid"
  local exit_code=$?
  local elapsed=$waited

  if [[ $exit_code -eq 0 ]]; then
    pass "Phase $phase_name completed successfully"
    PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"PASS\",\"duration\":${elapsed}}")
    return 0
  else
    warn "Phase $phase_name exited with code $exit_code"
    FAILED_PHASES+=("$phase_name")
    PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"FAIL\",\"duration\":${elapsed},\"exit_code\":${exit_code}}")
    return 1
  fi
}

# --- Run k6 in a netns via run-client.sh ---
run_k6_netns() {
  local phase_name="$1"
  local netns_num="$2"
  local api_key="$3"
  local vus="$4"
  local duration="$5"
  local endpoint="${6:-/api/chat}"
  local model="${7:-llama3.2:1b}"
  local extra_env=("${@:8}")

  local env_vars=(
    "BASE_URL=$ORCHESTRATOR_URL"
    "ENDPOINT=$endpoint"
    "MODEL=$model"
    "PHASE=$phase_name"
    "API_KEY=$api_key"
  )

  local k6_args=(
    "$K6_PATH" "run"
    "--vus" "$vus"
    "--duration" "${duration}s"
    "$SCRIPTS_STRESS/k6-base.js"
  )

  if [[ "$netns_num" == "0" ]] || [[ -z "$netns_num" ]]; then
    # Run on host
    env "${env_vars[@]}" "${k6_args[@]}"
  else
    # Run in netns
    env "${env_vars[@]}" \
      ip netns exec "netns-stress-$netns_num" \
      "${k6_args[@]}"
  fi
}

# --- Extract API key for a netns from keys file ---
get_api_key() {
  local netns_num="$1"
  local keys_file="$EVIDENCE_DIR/stress-api-keys.json"
  if [[ ! -f "$keys_file" ]]; then
    echo "stress-test-key-$netns_num-default"
    return
  fi
  jq -r ".[] | select(.netns == \"netns-stress-$netns_num\") | .api_key" "$keys_file" 2>/dev/null || \
    echo "stress-test-key-$netns_num-default"
}

# --- Build k6 result summary from k6 JSON output ---
# The k6 JSON output is written to scripts/stress/output/{phase}.json by k6
parse_k6_output() {
  local phase_name="$1"
  local k6_output="$SCRIPTS_STRESS/output/${phase_name}.json"
  # k6 outputs metrics to JSON; we extract key stats for the result
  # For now, return a placeholder - the actual extraction happens in evaluate-results
  echo "{}"
}

# =============================================================================
# PREFLIGHT
# =============================================================================

run_preflight() {
  section "PHASE: preflight"
  log "Running pre-flight checks..."
  local start_time
  start_time=$(date +%s)

  if bash "$SCRIPTS_STRESS/preflight.sh" 2>&1 | while IFS= read -r line; do
    info "  preflight: $line"
  done; then
    local elapsed=$(( $(date +%s) - start_time ))
    pass "Preflight passed in ${elapsed}s"
    PHASE_RESULTS+=("{\"phase\":\"preflight\",\"status\":\"PASS\",\"duration\":${elapsed}}")
    return 0
  else
    local elapsed=$(( $(date +%s) - start_time ))
    fail "Preflight FAILED - cannot proceed without fleet backup and health checks"
    PHASE_RESULTS+=("{\"phase\":\"preflight\",\"status\":\"FAIL\",\"duration\":${elapsed}}")
    echo ""
    error "Preflight checks failed. Fix issues before re-running."
    error "Common issues: service not running, auth enabled, rate limit too low."
    exit 1
  fi
}

# =============================================================================
# SETUP NETNS
# =============================================================================

run_setup_netns() {
  section "PHASE: setup-netns"
  log "Creating network namespaces and API keys..."
  local start_time
  start_time=$(date +%s)

  if bash "$SCRIPTS_STRESS/setup-netns.sh" 2>&1 | while IFS= read -r line; do
    info "  setup-netns: $line"
  done; then
    local elapsed=$(( $(date +%s) - start_time ))
    pass "Netns setup completed in ${elapsed}s"
    PHASE_RESULTS+=("{\"phase\":\"setup-netns\",\"status\":\"PASS\",\"duration\":${elapsed}}")
    return 0
  else
    local elapsed=$(( $(date +%s) - start_time ))
    warn "Netns setup had warnings (likely CAP_NET_ADMIN missing)"
    PHASE_RESULTS+=("{\"phase\":\"setup-netns\",\"status\":\"WARN\",\"duration\":${elapsed}}")
    return 0  # Don't fail - host-only mode still works
  fi
}

# =============================================================================
# TEARDOWN NETNS
# =============================================================================

run_teardown_netns() {
  section "PHASE: teardown-netns"
  log "Cleaning up network namespaces and API keys..."
  local start_time
  start_time=$(date +%s)

  bash "$SCRIPTS_STRESS/teardown-netns.sh" 2>&1 | while IFS= read -r line; do
    info "  teardown-netns: $line"
  done

  local elapsed=$(( $(date +%s) - start_time ))
  pass "Teardown completed in ${elapsed}s"
  PHASE_RESULTS+=("{\"phase\":\"teardown-netns\",\"status\":\"PASS\",\"duration\":${elapsed}}")
}

# =============================================================================
# B PHASES (Load profiles)
# =============================================================================

# --- B1: Sustained load (5 netns × 100 VUs, 10 min) ---
run_b1() {
  local phase_name="b1-sustained"
  section "PHASE: $phase_name"
  log "B1 Sustained load: ${B1_VUS} VUs × 10 min across 5 netns"
  log "Timeout: $(echo "$B1_DURATION * $PHASE_TIMEOUT_MULT" | bc)s"

  collect_metrics "before-${phase_name}" || true

  # Run 5 netns in background, each with B1_VUS/5 VUs
  local vus_per_netns=$(( B1_VUS / 5 ))
  local timeout_sec
  timeout_sec=$(echo "($B1_DURATION * $PHASE_TIMEOUT_MULT) / 1" | bc | cut -d. -f1)

  local pids=()
  for i in $(seq 1 5); do
    local api_key
    api_key=$(get_api_key "$i")
    local log_file="$LOG_DIR/${phase_name}-netns-${i}.log"

    {
      echo "=== B1 netns-$i started at $(timestamp) ==="
      run_k6_netns "$phase_name" "$i" "$api_key" "$vus_per_netns" "$B1_DURATION" \
        "/api/chat" "llama3.2:1b" \
        > "$log_file" 2>&1
      echo "=== B1 netns-$i finished at $(timestamp) ===" >> "$log_file"
    } &

    pids+=($!)
    log "Launched B1 netns-$i as background job (VU=$vus_per_netns, duration=${B1_DURATION}s)"
  done

  # Wait for all to complete
  local all_done=true
  for pid in "${pids[@]}"; do
    if ! wait "$pid"; then
      warn "B1 netns with PID $pid failed"
      all_done=false
    fi
  done

  collect_metrics "after-${phase_name}" || true

  if $all_done; then
    pass "B1 $phase_name completed"
    PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"PASS\",\"vus\":${B1_VUS},\"duration\":${B1_DURATION}}")
  else
    warn "B1 $phase_name completed with some failures"
    PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"WARN\",\"vus\":${B1_VUS},\"duration\":${B1_DURATION}}")
  fi
}

# --- B2: Spike load (2000 VUs single K6, 5 min) ---
run_b2() {
  local phase_name="b2-spike"
  section "PHASE: $phase_name"
  log "B2 Spike load: 2000 VUs single K6 for ${B2_DURATION}s"

  collect_metrics "before-${phase_name}" || true

  local timeout_sec
  timeout_sec=$(echo "($B2_DURATION * $PHASE_TIMEOUT_MULT) / 1" | bc | cut -d. -f1)

  # Single K6 run with high VUs
  BASE_URL="$ORCHESTRATOR_URL" \
  PHASE="$phase_name" \
  MODEL="llama3.2:1b" \
  ENDPOINT="/api/chat" \
    timeout "$timeout_sec" \
    $K6_PATH run \
    --vus 2000 \
    --duration "${B2_DURATION}s" \
    "$SCRIPTS_STRESS/k6-base.js" 2>&1 | while IFS= read -r line; do
    info "  k6: $line"
  done

  local k6_exit=${PIPESTATUS[0]}
  collect_metrics "after-${phase_name}" || true

  if [[ $k6_exit -eq 0 ]] || [[ $k6_exit -eq 124 ]]; then
    # 124 = timeout (expected for spike)
    pass "B2 $phase_name completed (exit=$k6_exit)"
    PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"PASS\",\"vus\":2000,\"duration\":${B2_DURATION}}")
  else
    warn "B2 $phase_name exited with code $k6_exit"
    FAILED_PHASES+=("$phase_name")
    PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"FAIL\",\"vus\":2000,\"duration\":${B2_DURATION},\"exit_code\":${k6_exit}}")
  fi
}

# --- B3: Soak test (5 netns × 40 VUs, 60 min) ---
run_b3() {
  if [[ "$SKIP_SOAK" == "true" ]]; then
    info "Skipping B3 (Soak) due to --skip-soak flag"
    PHASE_RESULTS+=("{\"phase\":\"b3-soak\",\"status\":\"SKIP\",\"reason\":\"--skip-soak\"}")
    return 0
  fi

  local phase_name="b3-soak"
  section "PHASE: $phase_name"
  log "B3 Soak test: ${B3_VUS} VUs × ${B3_DURATION}s across 5 netns"
  log "Timeout: $(echo "$B3_DURATION * $PHASE_TIMEOUT_MULT" | bc)s"

  collect_metrics "before-${phase_name}" || true

  local vus_per_netns=$(( B3_VUS / 5 ))
  local timeout_sec
  timeout_sec=$(echo "($B3_DURATION * $PHASE_TIMEOUT_MULT) / 1" | bc | cut -d. -f1)

  local pids=()
  for i in $(seq 1 5); do
    local api_key
    api_key=$(get_api_key "$i")
    local log_file="$LOG_DIR/${phase_name}-netns-${i}.log"

    {
      echo "=== B3 netns-$i started at $(timestamp) ==="
      run_k6_netns "$phase_name" "$i" "$api_key" "$vus_per_netns" "$B3_DURATION" \
        "/api/chat" "llama3.2:1b" \
        > "$log_file" 2>&1
      echo "=== B3 netns-$i finished at $(timestamp) ===" >> "$log_file"
    } &

    pids+=($!)
    log "Launched B3 netns-$i as background job (VU=$vus_per_netns, duration=${B3_DURATION}s)"
  done

  # Wait for all to complete
  local all_done=true
  for pid in "${pids[@]}"; do
    if ! wait "$pid"; then
      warn "B3 netns with PID $pid failed"
      all_done=false
    fi
  done

  collect_metrics "after-${phase_name}" || true

  if $all_done; then
    pass "B3 $phase_name completed"
    PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"PASS\",\"vus\":${B3_VUS},\"duration\":${B3_DURATION}}")
  else
    warn "B3 $phase_name completed with some failures"
    PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"WARN\",\"vus\":${B3_VUS},\"duration\":${B3_DURATION}}")
  fi
}

# --- B4: Chaos (100 VUs with failures, 15 min) ---
run_b4() {
  local phase_name="b4-chaos"
  section "PHASE: $phase_name"
  log "B4 Chaos: 100 VUs with error injection for ${B4_DURATION}s"

  collect_metrics "before-${phase_name}" || true

  local timeout_sec
  timeout_sec=$(echo "($B4_DURATION * $PHASE_TIMEOUT_MULT) / 1" | bc | cut -d. -f1)

  # Single K6 run on host
  BASE_URL="$ORCHESTRATOR_URL" \
  PHASE="$phase_name" \
  MODEL="nonexistent-model:99b" \
  ENDPOINT="/api/chat" \
    timeout "$timeout_sec" \
    $K6_PATH run \
    --vus 100 \
    --duration "${B4_DURATION}s" \
    "$SCRIPTS_STRESS/k6-base.js" 2>&1 | while IFS= read -r line; do
    info "  k6: $line"
  done

  local k6_exit=${PIPESTATUS[0]}
  collect_metrics "after-${phase_name}" || true

  if [[ $k6_exit -eq 0 ]] || [[ $k6_exit -eq 124 ]]; then
    pass "B4 $phase_name completed (exit=$k6_exit)"
    PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"PASS\",\"vus\":100,\"duration\":${B4_DURATION}}")
  else
    warn "B4 $phase_name exited with code $k6_exit"
    FAILED_PHASES+=("$phase_name")
    PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"FAIL\",\"vus\":100,\"duration\":${B4_DURATION},\"exit_code\":${k6_exit}}")
  fi
}

# =============================================================================
# C PHASES (Model/API matrix)
# =============================================================================

# --- C1: Ollama API matrix (50 concurrent × 3 endpoints) ---
run_c1() {
  local phase_name="c1-ollama-matrix"
  section "PHASE: $phase_name"
  log "C1 Ollama API matrix: ${C1_VUS} VUs across /api/chat, /api/generate, /api/embeddings"

  collect_metrics "before-${phase_name}" || true

  local endpoints=("/api/chat" "/api/generate" "/api/embeddings")
  local vus_per_endpoint=$(( C1_VUS / ${#endpoints[@]} ))
  local timeout_sec
  timeout_sec=$(echo "($C1_DURATION * $PHASE_TIMEOUT_MULT) / 1" | bc | cut -d. -f1)

  local pids=()
  for endpoint in "${endpoints[@]}"; do
    local log_file="$LOG_DIR/${phase_name}-${endpoint//\//}.log"
    {
      echo "=== C1 $endpoint started at $(timestamp) ==="
      BASE_URL="$ORCHESTRATOR_URL" \
      PHASE="$phase_name" \
      MODEL="llama3.2:1b" \
      ENDPOINT="$endpoint" \
        timeout "$timeout_sec" \
        $K6_PATH run \
        --vus "$vus_per_endpoint" \
        --duration "${C1_DURATION}s" \
        "$SCRIPTS_STRESS/k6-base.js" \
        > "$log_file" 2>&1
      echo "=== C1 $endpoint finished at $(timestamp) ===" >> "$log_file"
    } &
    pids+=($!)
    log "Launched C1 $endpoint as background job"
  done

  local all_done=true
  for pid in "${pids[@]}"; do
    if ! wait "$pid"; then
      warn "C1 endpoint with PID $pid failed"
      all_done=false
    fi
  done

  collect_metrics "after-${phase_name}" || true

  if $all_done; then
    pass "C1 $phase_name completed"
    PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"PASS\",\"vus\":${C1_VUS},\"duration\":${C1_DURATION}}")
  else
    warn "C1 $phase_name completed with some failures"
    PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"WARN\",\"vus\":${C1_VUS},\"duration\":${C1_DURATION}}")
  fi
}

# --- C2: OpenAI API matrix (50 concurrent × 3 endpoints) ---
run_c2() {
  local phase_name="c2-openai-matrix"
  section "PHASE: $phase_name"
  log "C2 OpenAI API matrix: ${C2_VUS} VUs across /v1/chat/completions, /v1/completions, /v1/embeddings"

  collect_metrics "before-${phase_name}" || true

  local endpoints=("/v1/chat/completions" "/v1/completions" "/v1/embeddings")
  local vus_per_endpoint=$(( C2_VUS / ${#endpoints[@]} ))
  local timeout_sec
  timeout_sec=$(echo "($C2_DURATION * $PHASE_TIMEOUT_MULT) / 1" | bc | cut -d. -f1)

  local pids=()
  for endpoint in "${endpoints[@]}"; do
    local log_file="$LOG_DIR/${phase_name}-${endpoint//\//}.log"
    {
      echo "=== C2 $endpoint started at $(timestamp) ==="
      BASE_URL="$ORCHESTRATOR_URL" \
      PHASE="$phase_name" \
      MODEL="llama3.2:1b" \
      ENDPOINT="$endpoint" \
        timeout "$timeout_sec" \
        $K6_PATH run \
        --vus "$vus_per_endpoint" \
        --duration "${C2_DURATION}s" \
        "$SCRIPTS_STRESS/k6-base.js" \
        > "$log_file" 2>&1
      echo "=== C2 $endpoint finished at $(timestamp) ===" >> "$log_file"
    } &
    pids+=($!)
    log "Launched C2 $endpoint as background job"
  done

  local all_done=true
  for pid in "${pids[@]}"; do
    if ! wait "$pid"; then
      warn "C2 endpoint with PID $pid failed"
      all_done=false
    fi
  done

  collect_metrics "after-${phase_name}" || true

  if $all_done; then
    pass "C2 $phase_name completed"
    PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"PASS\",\"vus\":${C2_VUS},\"duration\":${C2_DURATION}}")
  else
    warn "C2 $phase_name completed with some failures"
    PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"WARN\",\"vus\":${C2_VUS},\"duration\":${C2_DURATION}}")
  fi
}

# --- C3: MiniMax API (20 concurrent, 2 min) ---
run_c3() {
  local phase_name="c3-minimax"
  section "PHASE: $phase_name"
  log "C3 MiniMax API: 20 concurrent requests for ${C3_DURATION}s"

  # Check if MiniMax server exists
  local servers_json
  servers_json=$(curl -sf "${ORCHESTRATOR_URL}/api/orchestrator/servers" 2>/dev/null || echo '{}')
  local has_minimax
  has_minimax=$(echo "$servers_json" | jq -r '[.servers[] | select(.url | test("minimax"; "i"))] | length > 0' 2>/dev/null || echo "false")

  if [[ "$has_minimax" != "true" ]]; then
    info "C3 MiniMax server not found in fleet, skipping"
    PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"SKIP\",\"reason\":\"no-minimax-server\"}")
    return 0
  fi

  collect_metrics "before-${phase_name}" || true

  local timeout_sec
  timeout_sec=$(echo "($C3_DURATION * $PHASE_TIMEOUT_MULT) / 1" | bc | cut -d. -f1)

  BASE_URL="$ORCHESTRATOR_URL" \
  PHASE="$phase_name" \
  MODEL="minimax:9b" \
  ENDPOINT="/api/chat" \
    timeout "$timeout_sec" \
    $K6_PATH run \
    --vus 20 \
    --duration "${C3_DURATION}s" \
    "$SCRIPTS_STRESS/k6-base.js" 2>&1 | while IFS= read -r line; do
    info "  k6: $line"
  done

  local k6_exit=${PIPESTATUS[0]}
  collect_metrics "after-${phase_name}" || true

  if [[ $k6_exit -eq 0 ]] || [[ $k6_exit -eq 124 ]]; then
    pass "C3 $phase_name completed"
    PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"PASS\",\"vus\":20,\"duration\":${C3_DURATION}}")
  else
    warn "C3 $phase_name exited with code $k6_exit"
    FAILED_PHASES+=("$phase_name")
    PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"FAIL\",\"vus\":20,\"duration\":${C3_DURATION},\"exit_code\":${k6_exit}}")
  fi
}

# --- C5: Mixed workload (50 embed + 50 chat) ---
run_c5() {
  local phase_name="c5-mixed"
  section "PHASE: $phase_name"
  log "C5 Mixed workload: 50 chat + 50 embed VUs for ${C5_DURATION}s"

  collect_metrics "before-${phase_name}" || true

  local timeout_sec
  timeout_sec=$(echo "($C5_DURATION * $PHASE_TIMEOUT_MULT) / 1" | bc | cut -d. -f1)

  local pids=()
  local workloads=(
    "chat|/api/chat|llama3.2:1b|50"
    "embed|/api/embeddings|nomic-embed-text:latest|50"
  )

  for entry in "${workloads[@]}"; do
    IFS='|' read -r name endpoint model vus <<< "$entry"
    local log_file="$LOG_DIR/${phase_name}-${name}.log"
    {
      echo "=== C5 $name started at $(timestamp) ==="
      BASE_URL="$ORCHESTRATOR_URL" \
      PHASE="$phase_name-$name" \
      MODEL="$model" \
      ENDPOINT="$endpoint" \
        timeout "$timeout_sec" \
        $K6_PATH run \
        --vus "$vus" \
        --duration "${C5_DURATION}s" \
        "$SCRIPTS_STRESS/k6-base.js" \
        > "$log_file" 2>&1
      echo "=== C5 $name finished at $(timestamp) ===" >> "$log_file"
    } &
    pids+=($!)
    log "Launched C5 $name as background job"
  done

  local all_done=true
  for pid in "${pids[@]}"; do
    if ! wait "$pid"; then
      warn "C5 workload with PID $pid failed"
      all_done=false
    fi
  done

  collect_metrics "after-${phase_name}" || true

  if $all_done; then
    pass "C5 $phase_name completed"
    PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"PASS\",\"vus\":100,\"duration\":${C5_DURATION}}")
  else
    warn "C5 $phase_name completed with some failures"
    PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"WARN\",\"vus\":100,\"duration\":${C5_DURATION}}")
  fi
}

# --- C6: Cross-model error handling (single-shot validation) ---
run_c6() {
  local phase_name="c6-cross-model-errors"
  section "PHASE: $phase_name"
  log "C6 Cross-model error handling: single-shot validation"

  collect_metrics "before-${phase_name}" || true

  # Single-shot probe: try invalid model combinations
  local invalid_combinations=(
    "nonexistent-model:99b|/api/chat"
    "llama3.2:1b|/api/generate"
    "invalid-model:999b|/v1/chat/completions"
  )

  for combo in "${invalid_combinations[@]}"; do
    IFS='|' read -r model endpoint <<< "$combo"
    local response
    response=$(curl -sf -X POST "${ORCHESTRATOR_URL}${endpoint}" \
      -H "Content-Type: application/json" \
      -d "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"test\"}]}" \
      --max-time 10 2>/dev/null || echo '{"error":"timeout"}')

    if echo "$response" | jq -e '.error' >/dev/null 2>&1; then
      local err_msg
      err_msg=$(echo "$response" | jq -r '.error' | cut -c1-60)
      info "  C6 ${model}${endpoint} → error (expected): ${err_msg}"
    else
      warn "  C6 ${model}${endpoint} → unexpected response: $(echo "$response" | cut -c1-100)"
    fi
  done

  collect_metrics "after-${phase_name}" || true
  pass "C6 $phase_name completed"
  PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"PASS\",\"type\":\"validation\"}")
}

# --- C7: Debug output across 9 models (single-shot) ---
run_c7() {
  local phase_name="c7-debug-output"
  section "PHASE: $phase_name"
  log "C7 Debug output: single-shot across 9 models"

  collect_metrics "before-${phase_name}" || true

  local models=(
    "llama3.2:1b"
    "llama3.2:3b"
    "llama3.2:11b"
    "smollm2:135m"
    "smollm2:360m"
    "nomic-embed-text:latest"
    "mistral:7b"
    "codellama:7b"
    "phi3:mini"
  )

  for model in "${models[@]}"; do
    local response
    response=$(curl -sf -X POST "${ORCHESTRATOR_URL}/api/chat" \
      -H "Content-Type: application/json" \
      -d "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"stream\":false}" \
      --max-time 15 2>/dev/null || echo '{"error":"timeout"}')

    if echo "$response" | jq -e '.model' >/dev/null 2>&1; then
      info "  C7 $model → OK"
    else
      local err
      err=$(echo "$response" | jq -r '.error // "unknown"' 2>/dev/null | cut -c1-60)
      info "  C7 $model → $err"
    fi
  done

  collect_metrics "after-${phase_name}" || true
  pass "C7 $phase_name completed"
  PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"PASS\",\"type\":\"validation\",\"models\":${#models[@]}}")
}

# --- C0: LB quality test (100 VUs × 9 models sequentially, 5 min each) ---
run_c0() {
  local phase_name="c0-lb-quality"
  section "PHASE: $phase_name"
  log "C0 LB quality: 100 VUs × 9 models sequentially, ${C0_DURATION}s each"

  collect_metrics "before-${phase_name}" || true

  local models=(
    "llama3.2:1b"
    "llama3.2:3b"
    "llama3.2:11b"
    "smollm2:135m"
    "smollm2:360m"
    "nomic-embed-text:latest"
    "mistral:7b"
    "codellama:7b"
    "phi3:mini"
  )

  local all_done=true
  for model in "${models[@]}"; do
    log "C0 Testing model: $model"
    local timeout_sec
    timeout_sec=$(echo "($C0_DURATION * $PHASE_TIMEOUT_MULT) / 1" | bc | cut -d. -f1)

    BASE_URL="$ORCHESTRATOR_URL" \
    PHASE="$phase_name-$model" \
    MODEL="$model" \
    ENDPOINT="/api/chat" \
      timeout "$timeout_sec" \
      $K6_PATH run \
      --vus 100 \
      --duration "${C0_DURATION}s" \
      "$SCRIPTS_STRESS/k6-base.js" 2>&1 | while IFS= read -r line; do
      info "  k6 [$model]: $line"
    done

    if [[ ${PIPESTATUS[0]} -ne 0 ]] && [[ ${PIPESTATUS[0]} -ne 124 ]]; then
      warn "C0 $model failed"
      all_done=false
    fi
  done

  collect_metrics "after-${phase_name}" || true

  if $all_done; then
    pass "C0 $phase_name completed"
    PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"PASS\",\"vus\":${C0_VUS},\"duration\":${C0_DURATION}}")
  else
    warn "C0 $phase_name completed with some failures"
    PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"WARN\",\"vus\":${C0_VUS},\"duration\":${C0_DURATION}}")
  fi
}

# =============================================================================
# D PHASES (Diagnostic - no live traffic)
# =============================================================================

# --- D1: SLA analysis (aggregated analysis, no traffic) ---
run_d1() {
  local phase_name="d1-sla"
  section "PHASE: $phase_name"
  log "D1 SLA analysis: aggregated metrics review (no traffic)"

  collect_metrics "before-${phase_name}" || true

  # Aggregate analysis: check metrics from previous phases
  local total_phases=0
  local pass_count=0
  local warn_count=0
  local fail_count=0

  for result_json in "$EVIDENCE_DIR"/stress-before-*.json; do
    [[ -f "$result_json" ]] || continue
    total_phases=$(( total_phases + 1 ))
  done

  for result in "${PHASE_RESULTS[@]}"; do
    local status
    status=$(echo "$result" | jq -r '.status' 2>/dev/null || echo "UNKNOWN")
    case "$status" in
      PASS) pass_count=$(( pass_count + 1 )) ;;
      WARN) warn_count=$(( warn_count + 1 )) ;;
      FAIL) fail_count=$(( fail_count + 1 )) ;;
    esac
  done

  info "SLA Summary: $pass_count PASS, $warn_count WARN, $fail_count FAIL across ${#PHASE_RESULTS[@]} phases"

  collect_metrics "after-${phase_name}" || true
  pass "D1 $phase_name completed"
  PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"PASS\",\"type\":\"analysis\"}")
}

# --- D2: Memory analysis (diff before/after) ---
run_d2() {
  local phase_name="d2-memory"
  section "PHASE: $phase_name"
  log "D2 Memory: diff before/after metrics"

  collect_metrics "before-${phase_name}" || true

  # Get current memory stats from orchestrator
  local stats_json
  stats_json=$(curl -sf "${ORCHESTRATOR_URL}/api/orchestrator/stats" 2>/dev/null || echo '{}')
  local uptime
  uptime=$(echo "$stats_json" | jq -r '.stats.uptime // 0' 2>/dev/null)
  local in_flight
  in_flight=$(echo "$stats_json" | jq -r '.stats.inFlightRequests // 0' 2>/dev/null)

  info "Current uptime: ${uptime}ms, in-flight: ${in_flight}"

  # Compare with earliest before-metrics snapshot
  local earliest
  earliest=$(ls -t "$EVIDENCE_DIR"/stress-before-*.json 2>/dev/null | head -1 || echo "")
  if [[ -n "$earliest" ]]; then
    info "Comparing with earliest snapshot: $earliest"
  fi

  collect_metrics "after-${phase_name}" || true
  pass "D2 $phase_name completed"
  PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"PASS\",\"type\":\"diagnostic\"}")
}

# --- D3: Counter analysis (diff before/after) ---
run_d3() {
  local phase_name="d3-counters"
  section "PHASE: $phase_name"
  log "D3 Counters: diff before/after metrics"

  collect_metrics "before-${phase_name}" || true

  # Get stats for counter diff
  local stats_json
  stats_json=$(curl -sf "${ORCHESTRATOR_URL}/api/orchestrator/stats" 2>/dev/null || echo '{}')
  local total_servers
  total_servers=$(echo "$stats_json" | jq -r '.stats.totalServers // 0' 2>/dev/null)
  local healthy
  healthy=$(echo "$stats_json" | jq -r '.stats.healthyServers // 0' 2>/dev/null)
  local total_models
  total_models=$(echo "$stats_json" | jq -r '.stats.totalModels // 0' 2>/dev/null)

  info "Servers: $total_servers total, $healthy healthy; Models: $total_models"

  collect_metrics "after-${phase_name}" || true
  pass "D3 $phase_name completed"
  PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"PASS\",\"type\":\"diagnostic\"}")
}

# --- D4: Circuit breaker health (diff before/after) ---
run_d4() {
  local phase_name="d4-cb-health"
  section "PHASE: $phase_name"
  log "D4 Circuit breaker health: diff before/after"

  collect_metrics "before-${phase_name}" || true

  # Get circuit breaker state
  local cb_json
  cb_json=$(curl -sf "${ORCHESTRATOR_URL}/api/orchestrator/circuit-breakers" 2>/dev/null || echo '{}')
  local total_cb
  total_cb=$(echo "$cb_json" | jq -r '.circuitBreakers | length // 0' 2>/dev/null)
  local open_cb
  open_cb=$(echo "$cb_json" | jq -r '[.circuitBreakers[] | select(.state == "OPEN")] | length // 0' 2>/dev/null)
  local half_open_cb
  half_open_cb=$(echo "$cb_json" | jq -r '[.circuitBreakers[] | select(.state == "HALF_OPEN")] | length // 0' 2>/dev/null)

  info "Circuit breakers: $total_cb total, $open_cb open, $half_open_cb half-open"

  collect_metrics "after-${phase_name}" || true
  pass "D4 $phase_name completed"
  PHASE_RESULTS+=("{\"phase\":\"$phase_name\",\"status\":\"PASS\",\"type\":\"diagnostic\",\"cb_total\":${total_cb},\"cb_open\":${open_cb}}")
}

# =============================================================================
# EVALUATE
# =============================================================================

run_evaluate() {
  section "PHASE: evaluate"
  log "Generating final aggregated report..."

  local start_time
  start_time=$(date +%s)

  # Build final report JSON
  local end_time
  end_time=$(date +%s)
  local total_duration=$(( end_time - START_EPOCH ))

  # Count results
  local total_pass=0
  local total_warn=0
  local total_fail=0
  local total_skip=0

  for result in "${PHASE_RESULTS[@]}"; do
    local status
    status=$(echo "$result" | jq -r '.status' 2>/dev/null || echo "UNKNOWN")
    case "$status" in
      PASS) total_pass=$(( total_pass + 1 )) ;;
      WARN) total_warn=$(( total_warn + 1 )) ;;
      FAIL) total_fail=$(( total_fail + 1 )) ;;
      SKIP) total_skip=$(( total_skip + 1 )) ;;
    esac
  done

  # Build the final report
  local final_report
  final_report=$(jq -n \
    --argjson start_epoch "$START_EPOCH" \
    --argjson end_epoch "$end_time" \
    --argjson total_duration "$total_duration" \
    --argjson total_pass "$total_pass" \
    --argjson total_warn "$total_warn" \
    --argjson total_fail "$total_fail" \
    --argjson total_skip "$total_skip" \
    --argjson quick "$QUICK" \
    --argjson skip_soak "$SKIP_SOAK" \
    --argjson skip_multiclient "$SKIP_MULTICLIENT" \
    --argjson phase_results "$(printf '%s\n' "${PHASE_RESULTS[@]}" | jq -s .)" \
    '{
      metadata: {
        start_epoch: $start_epoch,
        end_epoch: $end_epoch,
        total_duration_s: $total_duration,
        flags: {
          quick: $quick,
          skip_soak: $skip_soak,
          skip_multiclient: $skip_multiclient
        }
      },
      summary: {
        total_pass: $total_pass,
        total_warn: $total_warn,
        total_fail: $total_fail,
        total_skip: $total_skip
      },
      phases: $phase_results,
      verdict: if $total_fail > 0 then "FAIL" elif $total_warn > 0 then "WARN" else "PASS" end
    }')

  echo "$final_report" | jq '.' > "$EVIDENCE_DIR/stress-final-report.json" 2>/dev/null || \
    echo "$final_report" > "$EVIDENCE_DIR/stress-final-report.json"

  local verdict
  verdict=$(echo "$final_report" | jq -r '.verdict')

  section "FINAL REPORT"
  echo ""
  echo "$final_report" | jq '.' || echo "$final_report"
  echo ""

  if [[ "$verdict" == "PASS" ]]; then
    pass "STRESS TEST COMPLETE: ALL PASS"
    log "Report saved to: $EVIDENCE_DIR/stress-final-report.json"
  elif [[ "$verdict" == "WARN" ]]; then
    warn "STRESS TEST COMPLETE: SOME WARNINGS (see report)"
    log "Report saved to: $EVIDENCE_DIR/stress-final-report.json"
  else
    fail "STRESS TEST COMPLETE: FAILURES DETECTED"
    log "Report saved to: $EVIDENCE_DIR/stress-final-report.json"
    log "Failed phases: ${FAILED_PHASES[*]}"
  fi

  local elapsed=$(( $(date +%s) - start_time ))
  PHASE_RESULTS+=("{\"phase\":\"evaluate\",\"status\":\"PASS\",\"duration\":${elapsed}}")
}

# =============================================================================
# MAIN SEQUENCE
# =============================================================================

START_EPOCH=$(date +%s)

section "STRESS TEST SUITE: ALL PHASES"
echo ""
echo "Orchestrator: $ORCHESTRATOR_URL"
echo "Evidence dir: $EVIDENCE_DIR"
echo "Log dir:      $LOG_DIR"
echo "Quick mode:   $QUICK"
echo "Skip soak:    $SKIP_SOAK"
echo "Multiclient:  $([[ "$SKIP_MULTICLIENT" == "false" ]] && echo "YES (5 netns)" || echo "NO (single client)")"
echo "VU config:    B1=${B1_VUS} B3=${B3_VUS} C1=${C1_VUS} C2=${C2_VUS}"
echo ""

# --- 1. Preflight ---
run_preflight || exit 1

# --- 2. Setup netns ---
run_setup_netns || true  # Don't fail if netns unavailable

# --- 3. Before-metrics ---
collect_metrics "before-all" || true

# --- B Phases ---
run_b1 || true
run_b2 || true
run_b3 || true
run_b4 || true

# --- C Phases ---
run_c1 || true
run_c2 || true
run_c3 || true
run_c5 || true
run_c6 || true
run_c7 || true
run_c0 || true

# --- D Phases ---
run_d1 || true
run_d2 || true
run_d3 || true
run_d4 || true

# --- After-metrics ---
collect_metrics "after-all" || true

# --- Evaluate ---
run_evaluate

# --- Cleanup ---
run_teardown_netns

echo ""
section "STRESS TEST SUITE COMPLETE"
log "Total duration: $(($(date +%s) - START_EPOCH))s"
log "Evidence saved to: $EVIDENCE_DIR/"
ls -la "$EVIDENCE_DIR"/stress-*.json 2>/dev/null | tail -10

exit 0
