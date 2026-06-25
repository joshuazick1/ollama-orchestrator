#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
EVIDENCE_DIR="$REPO_ROOT/.sisyphus/evidence"
ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://localhost:5100}"
KEYS_FILE="$EVIDENCE_DIR/stress-api-keys.json"

for cmd in ip jq curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: Required tool '$cmd' not found." >&2
    exit 1
  fi
done

echo "=== Stress Test Network Namespace Teardown ==="
echo ""

if [[ ! -f "$KEYS_FILE" ]]; then
  echo "Keys file not found: $KEYS_FILE"
  echo "Assuming nothing to teardown."
else
  echo "Removing API keys from orchestrator..."
  while IFS= read -r entry; do
    API_KEY=$(echo "$entry" | jq -r '.api_key' 2>/dev/null || true)
    NETNS=$(echo "$entry" | jq -r '.netns' 2>/dev/null || true)

    if [[ -n "$API_KEY" ]] && [[ "$API_KEY" != "null" ]]; then
      echo "  Removing key for $NETNS: ${API_KEY:0:30}..."

      CURL_RESP=$(curl -sf -X PATCH "$ORCHESTRATOR_URL/api/orchestrator/config/security" \
        -H "Content-Type: application/json" \
        -d "{\"apiKeys\": [\"$API_KEY\"], \"_action\": \"remove\"}" 2>/dev/null || true)

      if [[ -z "$CURL_RESP" ]]; then
        echo "    NOTE: Could not reach orchestrator at $ORCHESTRATOR_URL"
      else
        echo "    Key removal attempted"
      fi
    fi
  done < <(jq -c '.[]' "$KEYS_FILE" 2>/dev/null || echo "")

  rm -f "$KEYS_FILE"
  echo "  Keys file removed"
fi

echo ""
echo "Cleaning up network namespaces..."

for i in $(seq 1 5); do
  VETH_H="veth-stress-${i}-h"
  if ip link show "$VETH_H" &>/dev/null; then
    ip link del "$VETH_H" 2>/dev/null || true
    echo "  Deleted veth interface $VETH_H"
  fi
done

for i in $(seq 1 5); do
  NS_FILE="/run/netns/netns-stress-${i}"
  if [[ -f "$NS_FILE" ]]; then
    umount "$NS_FILE" 2>/dev/null || true
    rm -f "$NS_FILE"
    echo "  Removed stale $NS_FILE"
  fi
done

for i in $(seq 1 5); do
  NETNS_NAME="netns-stress-$i"
  HOST_IP="127.0.0.$((i + 1))"

  if ip netns list 2>/dev/null | grep -q "^$NETNS_NAME$"; then
    echo "  Deleting namespace $NETNS_NAME..."
    ip netns delete "$NETNS_NAME" 2>/dev/null && echo "    Deleted" || echo "    Could not delete (may already be gone)"
  else
    echo "  Namespace $NETNS_NAME not present"
  fi

  if ip addr show lo | grep -q "$HOST_IP/32"; then
    echo "  Removing IP alias $HOST_IP from lo..."
    ip addr del "$HOST_IP/32" dev lo 2>/dev/null && echo "    Removed" || echo "    Could not remove (may already be gone)"
  else
    echo "  IP alias $HOST_IP not present on lo"
  fi
done

echo ""
echo "=== Verification ==="
REMAINING=$(ip netns list 2>/dev/null | grep "netns-stress" || true)
if [[ -z "$REMAINING" ]]; then
  echo "All stress namespaces removed."
else
  echo "WARNING: Some namespaces may remain:"
  echo "$REMAINING" >&2
fi

echo ""
echo "OK: teardown complete"
exit 0
