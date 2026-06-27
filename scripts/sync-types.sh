#!/usr/bin/env bash
# sync-types.sh — Copy shared backend types to frontend generated directory.
# Run from repo root: bash scripts/sync-types.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_ROOT/src/orchestrator/orchestrator.types.ts"
DEST_DIR="$REPO_ROOT/frontend/src/types/generated"
DEST="$DEST_DIR/orchestrator.types.ts"

mkdir -p "$DEST_DIR"

# Write header, inline-redefine any types that come from backend-only relative
# imports, then dump the source with those imports stripped. Keeping the bodies
# of the file unmodified means backend and frontend stay structurally identical
# for review, with the only divergence being the inlined type aliases at the top.
{
  echo "// AUTO-GENERATED — do not edit. Run scripts/sync-types.sh to update."
  echo ""
  cat <<'EOF'
/**
 * Frontend-side mirror of backend-only types referenced by orchestrator.types.ts.
 * Keep these aligned with the source-of-truth in src/**\/*.ts.
 */
export type ProbeEndpoint =
  | 'ollama_chat'
  | 'ollama_generate'
  | 'ollama_embeddings'
  | 'openai_chat'
  | 'openai_completions'
  | 'openai_embeddings'
  | 'anthropic_messages';

EOF
  grep -vE "^import .* from ['\"]\\.\\.?/" "$SRC"
} > "$DEST"

echo "✓ Synced $SRC → $DEST"
