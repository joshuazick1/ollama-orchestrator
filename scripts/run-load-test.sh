#!/usr/bin/env bash
set -e

SCRIPTS_DIR="${SCRIPTS_DIR:-/root/ollama-orchestrator/scripts}"
ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://localhost:5100}"
ANALYTICS_OUTPUT="${ANALYTICS_OUTPUT:-/tmp/load_test_analytics.txt}"
LOGS_OUTPUT="${LOGS_OUTPUT:-/tmp/load_test_logs.txt}"
HEALTH_ENDPOINT="${ORCHESTRATOR_URL}/health/ready"

START_TIME=$(date +%s)
START_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "[run-load-test] === Comprehensive Load Test Started at ${START_TIMESTAMP} ==="
echo ""

ANALYTICS_PID=""
LOGS_PID=""

cleanup() {
    echo "[run-load-test] Stopping background monitors..."
    if [ -n "$ANALYTICS_PID" ]; then
        kill "$ANALYTICS_PID" 2>/dev/null || true
    fi
    if [ -n "$LOGS_PID" ]; then
        kill "$LOGS_PID" 2>/dev/null || true
    fi
}

trap cleanup EXIT

echo "[run-load-test] Step 1/8: Verifying fleet..."
bash "${SCRIPTS_DIR}/verify-fleet.sh"
echo ""

echo "[run-load-test] Step 2/8: Backing up fleet..."
bash "${SCRIPTS_DIR}/backup-fleet.sh" pre-load-test
echo ""

INITIAL_SERVERS=$(curl -sf --max-time 5 "${HEALTH_ENDPOINT}" | jq '.healthyServers' || echo "0")
echo "[run-load-test] Step 3/8: Starting analytics polling (PID: ...)..."
nohup bash "${SCRIPTS_DIR}/poll-analytics.sh" > "${ANALYTICS_OUTPUT}" 2>&1 &
ANALYTICS_PID=$!
echo "[run-load-test] Analytics polling started (PID: ${ANALYTICS_PID})"
echo ""

echo "[run-load-test] Step 4/8: Starting log monitoring (PID: ...)..."
nohup tail -f /var/log/ollama-orchestrator/stderr.log > "${LOGS_OUTPUT}" 2>&1 &
LOGS_PID=$!
echo "[run-load-test] Log monitoring started (PID: ${LOGS_PID})"
echo ""

echo "[run-load-test] Step 5/8: Running Phase 1 (Uniform, 60s)..."
bash "${SCRIPTS_DIR}/phase1-uniform.sh"
echo ""

echo "[run-load-test] Step 6/8: Running Phase 2 (Spike, 20s)..."
bash "${SCRIPTS_DIR}/phase2-spike.sh"
echo ""

echo "[run-load-test] Step 7/8: Running Phase 3 (Embeddings, 30s)..."
bash "${SCRIPTS_DIR}/phase3-embeddings.sh"
echo ""

echo "[run-load-test] Step 8/8: Stopping background monitors..."
cleanup
echo ""

END_TIME=$(date +%s)
END_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
WALL_CLOCK=$((END_TIME - START_TIME))

FINAL_SERVERS=$(curl -sf --max-time 5 "${HEALTH_ENDPOINT}" | jq '.healthyServers' || echo "0")

echo "[run-load-test] === Load Test Complete at ${END_TIMESTAMP} ==="
echo "[run-load-test] Final fleet: ${INITIAL_SERVERS} servers at start, ${FINAL_SERVERS} healthy at end"
echo "[run-load-test] Total wall-clock: ${WALL_CLOCK}s"
echo "[run-load-test] Logs: ${LOGS_OUTPUT}"
echo "[run-load-test] Analytics: ${ANALYTICS_OUTPUT}"
