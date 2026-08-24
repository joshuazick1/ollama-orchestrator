#!/usr/bin/env bash
# sync-types.sh — Copy shared backend types to frontend generated directory.
# Run from repo root: bash scripts/sync-types.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$REPO_ROOT/src"
DEST_DIR="$REPO_ROOT/frontend/src/types/generated"
mkdir -p "$DEST_DIR"

# ── orchestrator.types.ts ────────────────────────────────────────────────────
SRC="$SRC_DIR/orchestrator/orchestrator.types.ts"
DEST="$DEST_DIR/orchestrator.types.ts"
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

# ── runtime-snapshot.ts ─────────────────────────────────────────────────────
SRC="$SRC_DIR/types/runtime-snapshot.ts"
DEST="$DEST_DIR/runtime-snapshot.ts"
{
  echo "// AUTO-GENERATED — do not edit. Run scripts/sync-types.sh to update."
  echo ""
  cat <<'EOF'
/**
 * Frontend-side mirror of backend-only types referenced by runtime-snapshot.ts.
 * Keep these aligned with the source-of-truth in src/**\/*.ts.
 */

/** Maps serverId:model:endpoint → circuit-breaker state (backend probe system). */
export type TupleKey = string;

/** Probe state machine states. */
export type ProbeState = 'HEALTHY' | 'SUSPECT' | 'UNHEALTHY' | 'RECOVERING';

/** Failure kind classification (partial — add remaining variants as needed). */
export type FailureKind =
  | 'timeout'
  | 'network'
  | 'server'
  | 'rate_limit'
  | 'model_not_found'
  | 'invalid_response'
  | 'unknown';

/** Rich per-tuple circuit-breaker state (mirrors backend TupleState). */
export interface TupleState {
  state: ProbeState;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  errorWindow: number[];
  lastTransition: number;
  lastProbeAt: number;
  nextProbeAt: number;
  recoveryAttempts: number;
  lastErrorKind?: FailureKind;
}

EOF
  grep -vE "^import .* from ['\"]\\.\\.?/" "$SRC"
} > "$DEST"
echo "✓ Synced $SRC → $DEST"
