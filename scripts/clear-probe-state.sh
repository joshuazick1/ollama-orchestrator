#!/usr/bin/env bash
set -euo pipefail

# Locate metrics DB
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
METRICS_DB="${METRICS_DB:-$REPO_ROOT/data/metrics.db}"

# Check sqlite3 availability
if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "ERROR: sqlite3 CLI not found." >&2
  echo "Install with: sudo apt-get install -y sqlite3" >&2
  exit 1
fi

# Check DB exists
if [[ ! -f "$METRICS_DB" ]]; then
  echo "ERROR: metrics DB not found at $METRICS_DB" >&2
  exit 1
fi

# Tables to clear
ALL_TABLES=(
  "circuit_breaker_state"
  "circuit_breaker_transitions"
  "probe_state_wal"
  "probe_state_snapshots"
)

# Filter to only tables that actually exist
TABLES=()
for t in "${ALL_TABLES[@]}"; do
  if sqlite3 "$METRICS_DB" "SELECT name FROM sqlite_master WHERE type='table' AND name='$t';" 2>/dev/null | grep -q "^$t$"; then
    TABLES+=("$t")
  fi
done

if [[ ${#TABLES[@]} -eq 0 ]]; then
  echo "No probe/CB state tables found - nothing to clear"
  exit 0
fi

# Print counts before
echo "Before:"
for t in "${TABLES[@]}"; do
  count=$(sqlite3 "$METRICS_DB" "SELECT COUNT(*) FROM $t;")
  echo "  $t: $count"
done

# Clear (single transaction)
TXN="BEGIN;"
for t in "${TABLES[@]}"; do
  TXN+="DELETE FROM $t;"
done
TXN+="COMMIT;"
sqlite3 "$METRICS_DB" "$TXN"

# Print counts after
echo "After:"
for t in "${TABLES[@]}"; do
  count=$(sqlite3 "$METRICS_DB" "SELECT COUNT(*) FROM $t;")
  echo "  $t: $count"
done

echo "OK: probe state cleared"