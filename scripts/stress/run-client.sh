#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K6_PATH="${K6_PATH:-/usr/local/bin/k6}"
K6_SCRIPT="${K6_SCRIPT:-$SCRIPT_DIR/k6-base.js}"
K6_DEFAULTS="--vus 100 --duration 10m"

usage() {
  echo "Usage: $0 <netns-num> <api-key> [k6-args...]" >&2
  echo "  netns-num: 1-5 for specific namespace, 0 or empty for host" >&2
  echo "  api-key:   API key for this client" >&2
  echo "  k6-args:   Additional arguments passed to k6 (default: $K6_DEFAULTS)" >&2
  exit 1
}

NETNS_NUM="${1:-}"
API_KEY="${2:-}"

if [[ -z "$NETNS_NUM" ]] || [[ -z "$API_KEY" ]]; then
  usage
fi

shift 2 || true
K6_ARGS="${*:-$K6_DEFAULTS}"

NETNS_NAME="netns-stress-$NETNS_NUM"

echo "=== Running K6 stress client ==="
echo "Namespace: $NETNS_NAME"
echo "API Key:   ${API_KEY:0:20}..."
echo "K6 args:   $K6_ARGS"
echo ""

CLIENT_IP=""
if [[ "$NETNS_NUM" == "0" ]] || [[ -z "$NETNS_NUM" ]]; then
  echo "Running on host (no network namespace)"
  BASE_URL="http://localhost:5100"
  CLIENT_IP="127.0.0.1"
  export API_KEY="$API_KEY"
  export CLIENT_IP="$CLIENT_IP"
  export BASE_URL="$BASE_URL"
  echo "BASE_URL: $BASE_URL"
  echo ""
  $K6_PATH run $K6_ARGS "$K6_SCRIPT"
else
  if ip netns list 2>/dev/null | grep -q "^$NETNS_NAME "; then
    # netns 1-5 maps to host veth IP 192.168.42.10-14
    HOST_VETH_IP="192.168.42.$((NETNS_NUM + 9))"
    # netns IP for source tracking: 192.168.42.20-24
    CLIENT_IP="192.168.42.$((NETNS_NUM + 19))"
    BASE_URL="http://${HOST_VETH_IP}:5100"
    echo "Running inside namespace $NETNS_NAME"
    echo "  Source IP (CLIENT_IP):  $CLIENT_IP"
    echo "  Target IP (host veth):  $HOST_VETH_IP:5100"

    export API_KEY="$API_KEY"
    export CLIENT_IP="$CLIENT_IP"
    export BASE_URL="$BASE_URL"
    echo "BASE_URL: $BASE_URL"
    echo ""
    ip netns exec "$NETNS_NAME" "$K6_PATH" run $K6_ARGS "$K6_SCRIPT"
  else
    echo "WARNING: Namespace $NETNS_NAME not found. Running on host instead." >&2
    echo "         API key will still be used: ${API_KEY:0:20}..." >&2
    BASE_URL="http://localhost:5100"
    CLIENT_IP="127.0.0.1"
    export API_KEY="$API_KEY"
    export CLIENT_IP="$CLIENT_IP"
    export BASE_URL="$BASE_URL"
    echo "BASE_URL: $BASE_URL"
    echo ""
    $K6_PATH run $K6_ARGS "$K6_SCRIPT"
  fi
fi
