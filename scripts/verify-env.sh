#!/usr/bin/env bash
# verify-env.sh — Validates required environment variables before starting production services.
# Usage: ./scripts/verify-env.sh

set -euo pipefail

ERRORS=0

require_var() {
  local var_name="$1"
  local description="${2:-}"
  if [ -z "${!var_name:-}" ]; then
    echo "ERROR: $var_name is not set. $description" >&2
    ERRORS=$((ERRORS + 1))
  fi
}

echo "Verifying production environment variables..."

# Required for Grafana (S-6)
require_var "GRAFANA_ADMIN_PASSWORD" "Required for Grafana admin access. Do NOT use 'admin'."

# Optional but recommended checks
if [ "${GRAFANA_ADMIN_PASSWORD:-}" = "admin" ]; then
  echo "WARNING: GRAFANA_ADMIN_PASSWORD is set to 'admin'. Use a strong password in production." >&2
fi

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "FAILED: $ERRORS required variable(s) missing. See above." >&2
  exit 1
fi

echo "All required environment variables are set."
