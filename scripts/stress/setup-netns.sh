#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
EVIDENCE_DIR="$REPO_ROOT/.sisyphus/evidence"
ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://localhost:5100}"
KEYS_FILE="$EVIDENCE_DIR/stress-api-keys.json"
EVIDENCE_FILE="$EVIDENCE_DIR/fix-b1-veth.txt"

# Network plan (eth1 is 192.168.42.0/24):
#   Host IP:  192.168.42.10, .11, .12, .13, .14  (i=1..5)
#   Netns IP: 192.168.42.20, .21, .22, .23, .24 (i=1..5)
#   Gateway:  <host_ip>

for cmd in ip openssl curl jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: Required tool '$cmd' not found." >&2
    exit 1
  fi
done

check_net_admin() {
  if [[ $EUID -ne 0 ]]; then
    echo "WARNING: Not running as root. Network namespaces may require CAP_NET_ADMIN." >&2
    return 1
  fi
  if ! ip netns add netns-caps-test 2>/dev/null; then
    echo "WARNING: Likely missing CAP_NET_ADMIN or privileges for network namespaces." >&2
    echo "         The orchestrator listens on 0.0.0.0 so localhost works without netns." >&2
    echo "         Proceeding in degraded mode (host-only stress testing)." >&2
    return 1
  fi
  ip netns delete netns-caps-test 2>/dev/null || true
  return 0
}

echo "=== Stress Test Network Namespace Setup (veth) ==="
echo ""

CAP_OK=true
check_net_admin || CAP_OK=false

mkdir -p "$EVIDENCE_DIR"
echo "[]" > "$KEYS_FILE"

echo "Creating 5 network namespaces with veth pairs on 192.168.42.0/24"
echo ""

for i in $(seq 1 5); do
  NETNS_NAME="netns-stress-$i"
  VETH_H="veth-stress-${i}-h"
  VETH_N="veth-stress-${i}-n"
  HOST_IP="192.168.42.$((9 + i))"
  NS_IP="192.168.42.$((19 + i))"
  API_KEY="stress-test-key-${i}-$(openssl rand -hex 8)"

  echo "--- Setting up $NETNS_NAME ---"
  echo "  Host veth: $VETH_H @ $HOST_IP"
  echo "  Netns veth: $VETH_N @ $NS_IP"
  echo "  Gateway: $HOST_IP"

  if [[ "$CAP_OK" == "true" ]]; then
    if ip netns list 2>/dev/null | grep -q "^$NETNS_NAME$"; then
      echo "  Namespace $NETNS_NAME already exists, deleting..."
      ip netns delete "$NETNS_NAME" 2>/dev/null || true
      ip link del "$VETH_H" 2>/dev/null || true
    fi

    if ip netns add "$NETNS_NAME" 2>/dev/null; then
      echo "  Created namespace $NETNS_NAME"
    else
      echo "  WARNING: Could not create namespace $NETNS_NAME" >&2
      continue
    fi

    ip link add "$VETH_H" type veth peer name "$VETH_N"
    ip link set "$VETH_N" netns "$NETNS_NAME"
    echo "  Created veth pair: $VETH_H <-> $VETH_N"

    ip addr add "${HOST_IP}/24" dev "$VETH_H"
    ip link set "$VETH_H" up

    ip netns exec "$NETNS_NAME" ip addr add "${NS_IP}/24" dev "$VETH_N"
    ip netns exec "$NETNS_NAME" ip link set "$VETH_N" up
    ip netns exec "$NETNS_NAME" ip link set lo up
    ip netns exec "$NETNS_NAME" ip route add default via "$HOST_IP"

    ip route replace "${NS_IP}" dev "$VETH_H" src "$HOST_IP" 2>/dev/null || \
      ip route add "${NS_IP}" dev "$VETH_H" src "$HOST_IP"
    echo "  Netns configured $VETH_N @ ${NS_IP}/24, default via $HOST_IP"
  else
    echo "  SKIP: No CAP_NET_ADMIN (namespace not created)"
  fi

  REGISTER_RESP=$(curl -sf -X PATCH "$ORCHESTRATOR_URL/api/orchestrator/config/security" \
    -H "Content-Type: application/json" \
    -d "{\"apiKeys\": [\"$API_KEY\"]}" 2>/dev/null || echo '{"error":"curl failed"}')

  if echo "$REGISTER_RESP" | grep -q '"error"'; then
    echo "  WARNING: Could not register API key (orchestrator may be unreachable): $REGISTER_RESP" >&2
  else
    echo "  Registered API key: ${API_KEY:0:40}..."
  fi

  KEY_ENTRY=$(jq -n \
    --arg netns "$NETNS_NAME" \
    --arg host_ip "$HOST_IP" \
    --arg netns_ip "$NS_IP" \
    --arg key "$API_KEY" \
    --arg client_ip "$NS_IP" \
    '{netns: $netns, host_ip: $host_ip, netns_ip: $netns_ip, api_key: $key, client_ip: $client_ip}')
  jq --argjson entry "$KEY_ENTRY" '. += [$entry]' "$KEYS_FILE" > "${KEYS_FILE}.tmp" && \
    mv "${KEYS_FILE}.tmp" "$KEYS_FILE"

  echo ""
done

echo "=== Setup Summary ==="
echo ""
echo "Network Namespaces:"
if [[ "$CAP_OK" == "true" ]]; then
  ip netns list 2>/dev/null | grep "netns-stress" || echo "  (none created)"
else
  echo "  CAP_NET_ADMIN not available - namespaces not created"
fi
echo ""
echo "Veth Interfaces (host):"
ip link show type veth 2>/dev/null | grep "veth-stress" || echo "  (none found)"
echo ""
echo "IP Addresses on veth-stress-*-h:"
ip addr show 2>/dev/null | grep -A1 "veth-stress.*-h" | grep "inet " || echo "  (none found)"
echo ""
echo "API Keys saved to: $KEYS_FILE"
jq '.[] | "\(.netns) host=\(.host_ip) netns=\(.netns_ip) key=\(.api_key[:30])..."' "$KEYS_FILE" 2>/dev/null || true
echo ""
echo "To run a client: $SCRIPT_DIR/run-client.sh <netns-num> <api-key> [k6-args...]"
echo "To teardown:     $SCRIPT_DIR/teardown-netns.sh"
echo ""

if [[ "$CAP_OK" == "false" ]]; then
  echo "NOTE: Running in degraded mode. Only API keys were configured."
  echo "      Host-based stress testing will still work."
fi

echo "OK: setup complete"
exit 0
