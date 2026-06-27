#!/usr/bin/env bash
# =============================================================================
# monitor.sh - Read-only stress phase monitor
# =============================================================================
# Displays status of background stress phases: process state, recent logs,
# service health, and quick orchestrator stats.
# Usage: bash scripts/stress/monitor.sh <phase-tag>
#   e.g.: bash scripts/stress/monitor.sh b1-sustained
#         bash scripts/stress/monitor.sh smoke-test
#         bash scripts/stress/monitor.sh active   # summary of all stress-* phases
# =============================================================================

set -uo pipefail

# --- Configuration ------------------------------------------------------------
ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://localhost:5100}"
PID_DIR="${PID_DIR:-/tmp}"
LOG_DIR="${LOG_DIR:-/var/log/stress}"
TAG="${1:-stress-active}"

# --- Helpers ------------------------------------------------------------------

# Color codes (no -e needed with printf)
readonly C_RESET='\033[0m'
readonly C_RED='\033[0;31m'
readonly C_GREEN='\033[0;32m'
readonly C_YELLOW='\033[0;33m'
readonly C_BLUE='\033[0;34m'
readonly C_MAGENTA='\033[0;35m'
readonly C_CYAN='\033[0;36m'

tag() { printf '%s' "$*"; }
info() { printf '%s[INFO]%s %s\n' "$C_BLUE" "$C_RESET" "$*"; }
warn() { printf '%s[WARN]%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
error() { printf '%s[ERROR]%s %s\n' "$C_RED" "$C_RESET" "$*"; }
ok() { printf '%s[OK]%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }

section() {
  printf '\n%s========================================%s\n' "$C_CYAN" "$C_RESET"
  printf '%s  %s%s\n' "$C_CYAN" "$*" "$C_RESET"
  printf '%s========================================%s\n' "$C_CYAN" "$C_RESET"
}

subsection() {
  printf '\n%s--- %s ---%s\n' "$C_MAGENTA" "$*" "$C_RESET"
}

# Try jq, degrade gracefully if missing
jq_try() {
  local expr="$1"
  local data="$2"
  if command -v jq >/dev/null 2>&1; then
    echo "$data" | jq -r "$expr" 2>/dev/null
  else
    # Fallback: extract with sed (crude but works)
    echo "$data" | sed -n "s/.*\"$expr\"[[:space:]]*:[[:space:]]*\([^,}]*\).*/\1/p" | head -1
  fi
}

# --- Process check for a single tag ---
monitor_phase() {
  local phase_tag="$1"
  local pid_file="${PID_DIR}/stress-${phase_tag}.pid"
  local log_file="${LOG_DIR}/${phase_tag}.log"

  subsection "Phase: $phase_tag"

  # PID / Process status
  if [[ -f "$pid_file" ]]; then
    local pid
    pid=$(cat "$pid_file" 2>/dev/null | tr -d '[:space:]')
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      ok "Process RUNNING (PID $pid)"
    else
      warn "PID file exists (PID $pid) but process is not running (EXITED)"
    fi
  else
    warn "No PID file at $pid_file (process not running)"
  fi

  # Log tail
  if [[ -f "$log_file" ]]; then
    # Ensure log directory exists for rotation purposes (no-op write)
    if [[ ! -d "$LOG_DIR" ]]; then
      mkdir -p "$LOG_DIR" 2>/dev/null || true
    fi
    subsection "Last 30 lines of $log_file"
    tail -30 "$log_file" 2>/dev/null || warn "Could not read log file"
  else
    warn "No log file at $log_file"
  fi
}

# --- Summary mode: active ---
monitor_active_summary() {
  section "Summary: All Stress Phases"

  local found=0
  for pid_file in "$PID_DIR"/stress-*.pid; do
    [[ -f "$pid_file" ]] || continue
    found=1
    local basename
    basename=$(basename "$pid_file")
    local phase_tag="${basename#stress-}"
    local pid
    pid=$(cat "$pid_file" 2>/dev/null | tr -d '[:space:]')
    local status="EXITED"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      status="RUNNING"
    fi
    local log_file="${LOG_DIR}/${phase_tag}.log"
    local log_lines=0
    if [[ -f "$log_file" ]]; then
      log_lines=$(wc -l < "$log_file" 2>/dev/null || echo 0)
    fi
    printf '%s[%s]%s %-20s PID=%-6s Log lines=%s\n' \
      "$C_CYAN" "$status" "$C_RESET" "$phase_tag" "${pid:-none}" "${log_lines:-0}"
  done

  if [[ $found -eq 0 ]]; then
    warn "No stress-*.pid files found in $PID_DIR"
  fi
}

# =============================================================================
# MAIN
# =============================================================================

main() {
  local start_time
  start_time=$(date '+%Y-%m-%dT%H:%M:%S')

  printf '\n%s========================================%s\n' "$C_CYAN" "$C_RESET"
  printf '%s  Stress Monitor  |  Tag: %-15s%s\n' "$C_CYAN" "$TAG" "$C_RESET"
  printf '%s  Started: %-29s%s\n' "$C_CYAN" "$start_time" "$C_RESET"
  uptime | sed 's/^/  /'
  printf '%s========================================%s\n' "$C_CYAN" "$C_RESET"

  # --- Section 1: Process status ---
  section "Process Status"

  if [[ "$TAG" == "active" ]]; then
    monitor_active_summary
  else
    monitor_phase "$TAG"
  fi

  # --- Section 2: Service Health ---
  section "Service Health"

  local health_response
  health_response=$(curl -s -m 5 "$ORCHESTRATOR_URL/health/ready" 2>/dev/null || echo '{}')

  if [[ -z "$health_response" ]]; then
    error "No response from $ORCHESTRATOR_URL/health/ready"
  else
    local health_status healthy_servers
    health_status=$(echo "$health_response" | jq -r '.status // empty' 2>/dev/null)
    healthy_servers=$(echo "$health_response" | jq -r '.healthyServers // empty' 2>/dev/null)

    if [[ "$health_status" == "ready" ]] || [[ "$health_status" == "healthy" ]]; then
      ok "Service $health_status (healthyServers=$healthy_servers)"
    elif [[ "$health_status" == "degraded" ]]; then
      warn "Service degraded (healthyServers=$healthy_servers)"
    else
      warn "Service status: $health_status (healthyServers=$healthy_servers)"
    fi

    # Show full response as info
    if command -v jq >/dev/null 2>&1; then
      info "Full /health/ready response:"
      echo "$health_response" | jq '.' 2>/dev/null || echo "$health_response"
    else
      info "Response: $health_response"
    fi
  fi

  # --- Section 3: Quick Stats ---
  section "Orchestrator Stats"

  local stats_response
  stats_response=$(curl -s -m 5 "$ORCHESTRATOR_URL/api/orchestrator/stats" 2>/dev/null || echo '{}')

  if [[ -z "$stats_response" ]] || [[ "$stats_response" == "{}" ]]; then
    warn "No response from $ORCHESTRATOR_URL/api/orchestrator/stats"
  else
    if command -v jq >/dev/null 2>&1; then
      local healthy_count in_flight total_servers uptime_ms
      healthy_count=$(echo "$stats_response" | jq -r '.stats.healthyServers // 0' 2>/dev/null)
      in_flight=$(echo "$stats_response" | jq -r '.stats.inFlightRequests // 0' 2>/dev/null)
      total_servers=$(echo "$stats_response" | jq -r '.stats.totalServers // 0' 2>/dev/null)
      uptime_ms=$(echo "$stats_response" | jq -r '.stats.uptime // 0' 2>/dev/null)

      info "healthyServers=$healthy_count  inFlight=$in_flight  totalServers=$total_servers"

      subsection "Stats fields"
      echo "$stats_response" | jq '{healthyServers: .stats.healthyServers, inFlightRequests: .stats.inFlightRequests, totalServers: .stats.totalServers, totalModels: .stats.totalModels, uptimeMs: .stats.uptime, circuitBreakerStates: .stats.circuitBreakersByState}' 2>/dev/null
    else
      info "Response: $stats_response"
    fi
  fi

  # --- Section 4: System Resources ---
  section "System Resources"

  subsection "Memory"
  free -h | grep -v '^$' | head -3 | sed 's/^/  /'

  subsection "Disk"
  df -h / | grep -v '^Filesystem' | sed 's/^/  /'

  subsection "Load / Uptime"
  uptime | sed 's/^/  /'

  # --- Footer ---
  section "Monitor Complete"
  printf '  %s%s\n' "Tag: " "$TAG"
  printf '  %s%s\n' "PID dir: " "$PID_DIR"
  printf '  %s%s\n' "Log dir: " "$LOG_DIR"
  printf '\n'

  return 0
}

main
