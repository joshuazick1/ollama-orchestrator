#!/bin/bash
SCREEN_NAME="ollama-orchestrator"
PROJECT_DIR="/root/ollama-orchestrator"
LOG_FILE="${PROJECT_DIR}/logs/orchestrator.log"

cd "${PROJECT_DIR}"

# Kill existing screen session if running
screen -S "${SCREEN_NAME}" -X quit 2>/dev/null || true
sleep 0.5

# Ensure deps and build
test -d node_modules || npm install
test -d dist || npm run build

# Start in screen detached mode
# Use -Logfile to specify log file directly, -L enables logging
exec screen -S "${SCREEN_NAME}" -L -Logfile "${LOG_FILE}" -dm npm start