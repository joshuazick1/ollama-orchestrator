#!/usr/bin/env bash
# sync-types.sh — Copy shared backend types to frontend generated directory.
# Run from repo root: bash scripts/sync-types.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_ROOT/src/orchestrator/orchestrator.types.ts"
DEST_DIR="$REPO_ROOT/frontend/src/types/generated"
DEST="$DEST_DIR/orchestrator.types.ts"

mkdir -p "$DEST_DIR"

# Write header then the source file contents (stripping any backend-only imports if present)
{
  echo "// AUTO-GENERATED — do not edit. Run scripts/sync-types.sh to update."
  echo ""
  # Strip lines that are JS/TS imports (none currently exist in orchestrator.types.ts,
  # but guard against future additions of backend-only imports like '../streaming.js')
  grep -v "^import " "$SRC"
} > "$DEST"

echo "✓ Synced $SRC → $DEST"
