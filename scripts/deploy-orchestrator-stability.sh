#!/usr/bin/env bash
# deploy-orchestrator-stability.sh
# Deploy / rollback the orchestrator-stability-release build.
#
# Usage:
#   bash scripts/deploy-orchestrator-stability.sh           # Deploy new build
#   bash scripts/deploy-orchestrator-stability.sh --rollback # Revert to previous build
#   bash scripts/deploy-orchestrator-stability.sh --soft-kill-switch # Enable kill switch via API
#   bash scripts/deploy-orchestrator-stability.sh --status   # Show current state
#
# Idempotent. Safe to run multiple times.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVICE_NAME="ollama-orchestrator"
HEALTH_URL="http://localhost:5100/health/ready"
HEALTH_URL_LIVE="http://localhost:5100/health"
CONFIG_API="http://localhost:5100/api/orchestrator/config"
DIST_BACKUP_DIR="/var/backups/ollama-orchestrator"
LOG_PREFIX="[deploy-orchestrator-stability]"
MAX_WAIT_SECONDS=60
WAIT_INTERVAL=1

log() { echo "$LOG_PREFIX $*"; }
die() { log "ERROR: $*" >&2; exit 1; }

require_root() {
  if [[ $EUID -ne 0 ]]; then
    die "must run as root (use sudo)"
  fi
}

service_active() {
  systemctl is-active "$SERVICE_NAME" 2>/dev/null || true
}

wait_for_health() {
  local url="$1"
  local waited=0
  log "waiting for $url (max ${MAX_WAIT_SECONDS}s)..."
  while (( waited < MAX_WAIT_SECONDS )); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then
      log "service is healthy at $url after ${waited}s"
      return 0
    fi
    sleep "$WAIT_INTERVAL"
    waited=$(( waited + WAIT_INTERVAL ))
  done
  return 1
}

backup_dist() {
  local stamp
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  local dest="$DIST_BACKUP_DIR/dist.$stamp"
  mkdir -p "$DIST_BACKUP_DIR"
  if [[ -d "$REPO_ROOT/dist" ]]; then
    cp -a "$REPO_ROOT/dist" "$dest"
    log "backed up current dist/ to $dest"
    # Keep only the 3 most recent backups to avoid disk fill
    ls -1dt "$DIST_BACKUP_DIR"/dist.* 2>/dev/null | tail -n +4 | xargs -r rm -rf
    echo "$dest" > /tmp/ollama-orchestrator.last-backup
  else
    log "no existing dist/ to back up"
  fi
}

restore_last_backup() {
  local last
  last="$(cat /tmp/ollama-orchestrator.last-backup 2>/dev/null || true)"
  if [[ -z "$last" || ! -d "$last" ]]; then
    die "no previous backup recorded; cannot rollback automatically"
  fi
  log "restoring $last -> $REPO_ROOT/dist"
  rm -rf "$REPO_ROOT/dist"
  cp -a "$last" "$REPO_ROOT/dist"
}

build_binary() {
  log "running typecheck and build..."
  ( cd "$REPO_ROOT" && npm run typecheck && npm run build )
}

deploy_step() {
  log "DEPLOY step 1/5: pre-flight"
  require_root
  build_binary

  log "DEPLOY step 2/5: backing up current dist"
  backup_dist

  log "DEPLOY step 3/5: stopping service (graceful)"
  systemctl stop "$SERVICE_NAME" || true

  log "DEPLOY step 4/5: starting service with new binary"
  systemctl start "$SERVICE_NAME"

  log "DEPLOY step 5/5: waiting for service to be ready"
  if ! wait_for_health "$HEALTH_URL"; then
    log "service did not become ready in ${MAX_WAIT_SECONDS}s"
    log "attempting automatic rollback..."
    restore_last_backup
    systemctl restart "$SERVICE_NAME"
    if wait_for_health "$HEALTH_URL"; then
      die "service failed to start with new binary; automatic rollback succeeded"
    else
      die "service failed to start AND rollback failed; manual intervention required"
    fi
  fi

  log "DEPLOY COMPLETE"
  log "post-deploy checks: run scripts/live-fleet-integration.sh or see scripts/RUNBOOK-ORCHESTRATOR-STABILITY.md"
}

rollback_step() {
  log "ROLLBACK step 1/3: stopping service"
  require_root
  systemctl stop "$SERVICE_NAME" || true

  log "ROLLBACK step 2/3: restoring previous dist/"
  restore_last_backup

  log "ROLLBACK step 3/3: starting service with previous binary"
  systemctl start "$SERVICE_NAME"

  if wait_for_health "$HEALTH_URL"; then
    log "ROLLBACK COMPLETE"
  else
    die "rollback failed; service did not become ready"
  fi
}

soft_kill_switch_step() {
  log "SOFT KILL SWITCH: enabling loadBalancer.fallbackToFastestResponse via API"
  local current
  current="$(curl -fsS "$CONFIG_API" 2>/dev/null || true)"
  if [[ -z "$current" ]]; then
    die "cannot reach config API at $CONFIG_API; service may be down"
  fi
  curl -fsS -X POST "$CONFIG_API" \
    -H "Content-Type: application/json" \
    -d '{"loadBalancer": {"fallbackToFastestResponse": true}}' \
    > /dev/null
  log "kill switch is now ON — all algorithms will behave as fastest-response"
  log "verify: curl -s $CONFIG_API | jq '.config.loadBalancer.fallbackToFastestResponse'"
}

status_step() {
  echo "Service status:"
  systemctl status "$SERVICE_NAME" --no-pager | head -10 || true
  echo
  echo "Health probe:"
  curl -fsS "$HEALTH_URL_LIVE" 2>/dev/null | head -c 200 || echo "(unreachable)"
  echo
  echo
  echo "Kill switch state:"
  curl -fsS "$CONFIG_API" 2>/dev/null | jq '.config.loadBalancer.fallbackToFastestResponse // "n/a"' || true
  echo
  echo "Last dist backup: $(cat /tmp/ollama-orchestrator.last-backup 2>/dev/null || echo none)"
}

case "${1:-}" in
  --rollback) rollback_step ;;
  --soft-kill-switch) soft_kill_switch_step ;;
  --status) status_step ;;
  ""|--deploy) deploy_step ;;
  -h|--help)
    sed -n '2,15p' "$0"
    ;;
  *) die "unknown argument: $1 (use --rollback, --soft-kill-switch, --status, or no args for deploy)" ;;
esac
