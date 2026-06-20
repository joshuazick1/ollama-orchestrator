#!/bin/bash
set -e

MIN_FLEET_SIZE="${MIN_FLEET_SIZE:-1000}"
BACKUP_FILE="/root/ollama-orchestrator/data/servers.json.prune_backup"
SERVICE_NAME="ollama-orchestrator"
ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://localhost:5100}"
RESTART_WAIT_SECONDS="${RESTART_WAIT_SECONDS:-5}"

FLEET_ENDPOINT="${ORCHESTRATOR_URL}/api/orchestrator/stats"
HEALTH_ENDPOINT="${ORCHESTRATOR_URL}/health/ready"

echo "[verify-fleet] Orchestrator reachable at ${ORCHESTRATOR_URL}"

if ! curl -sf --max-time 5 "${FLEET_ENDPOINT}" > /dev/null 2>&1; then
    echo "[verify-fleet] ERROR: orchestrator not reachable at ${ORCHESTRATOR_URL}"
    echo "[verify-fleet] Aborted"
    exit 1
fi

FLEET_COUNT=$(curl -sf --max-time 5 "${FLEET_ENDPOINT}" | jq '.stats.totalServers')
echo "[verify-fleet] Current fleet: ${FLEET_COUNT} servers"

if [ "${FLEET_COUNT}" -ge "${MIN_FLEET_SIZE}" ]; then
    echo "[verify-fleet] Fleet OK (>= ${MIN_FLEET_SIZE})"
    HEALTHY_COUNT=$(curl -sf --max-time 5 "${HEALTH_ENDPOINT}" | jq '.healthyServers')
    echo "[verify-fleet] Healthy: ${HEALTHY_COUNT}"
    echo "[verify-fleet] Success"
    exit 0
fi

echo "[verify-fleet] WARNING: Fleet degraded (< ${MIN_FLEET_SIZE})"
echo "[verify-fleet] Restoring from ${BACKUP_FILE}"

if [ ! -f "${BACKUP_FILE}" ]; then
    echo "[verify-fleet] ERROR: Backup file not found at ${BACKUP_FILE}"
    exit 1
fi

cp "${BACKUP_FILE}" "/root/ollama-orchestrator/data/servers.json"
echo "[verify-fleet] Restarting ${SERVICE_NAME} service..."
systemctl restart "${SERVICE_NAME}"
echo "[verify-fleet] Waiting ${RESTART_WAIT_SECONDS} seconds for service to restart..."
sleep "${RESTART_WAIT_SECONDS}"

FLEET_COUNT=$(curl -sf --max-time 5 "${FLEET_ENDPOINT}" | jq '.stats.totalServers')
echo "[verify-fleet] Current fleet: ${FLEET_COUNT} servers"

if [ "${FLEET_COUNT}" -lt "${MIN_FLEET_SIZE}" ]; then
    echo "[verify-fleet] ERROR: Fleet still degraded after restore"
    exit 1
fi

HEALTHY_COUNT=$(curl -sf --max-time 5 "${HEALTH_ENDPOINT}" | jq '.healthyServers')
echo "[verify-fleet] Healthy: ${HEALTHY_COUNT}"
echo "[verify-fleet] Success"
exit 0
