#!/usr/bin/env bash
set -euo pipefail

# Locate repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Check sqlite3 availability
if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "ERROR: sqlite3 CLI not found." >&2
  echo "Install with: sudo apt-get install -y sqlite3" >&2
  exit 1
fi

# Tables to clear across DBs
TABLES=(
  "circuit_breaker_state"
  "circuit_breaker_transitions"
  "probe_state_wal"
  "probe_state_snapshots"
)

# DB files to check (in order)
DB_FILES=(
  "$REPO_ROOT/data/operational.db"
  "$REPO_ROOT/data/metrics.db"
)

any_cleared=0

for db in "${DB_FILES[@]}"; do
  if [[ ! -f "$db" ]]; then
    echo "=== $(basename "$db") ==="
    echo "  (file not present - skipping)"
    echo ""
    continue
  fi

  echo "=== $(basename "$db") ==="
  for t in "${TABLES[@]}"; do
    # Check if table exists in this DB
    exists=$(sqlite3 "$db" "SELECT name FROM sqlite_master WHERE type='table' AND name='$t';" 2>/dev/null || true)
    if [[ -z "$exists" ]]; then
      echo "  $t: (table not present)"
      continue
    fi

    before=$(sqlite3 "$db" "SELECT COUNT(*) FROM $t;" 2>/dev/null || echo "?")
    sqlite3 "$db" "DELETE FROM $t;" 2>/dev/null || true
    after=$(sqlite3 "$db" "SELECT COUNT(*) FROM $t;" 2>/dev/null || echo "?")
    echo "  $t: $before → $after"
    any_cleared=1
  done
  echo ""
done

if [[ $any_cleared -eq 0 ]]; then
  echo "No probe/CB state tables found - nothing to clear"
else
  echo "Notes:"
  echo "  - probe_state_wal and probe_state_snapshots in metrics.db ARE cleared by this script"
  echo "  - circuit_breaker_state and circuit_breaker_transitions are checked in both operational.db and metrics.db"
  echo "  - In-memory CB state in ProbeOrchestrator.states is NOT cleared by this script"
  echo "    (requires service restart: systemctl restart ollama-orchestrator)"
  echo ""
  echo "OK: persisted probe state cleared"
fi
