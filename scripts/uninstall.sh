#!/usr/bin/env bash
set -euo pipefail

PURGE=false
if [[ "${1:-}" == "--purge" ]]; then
  PURGE=true
fi

if [[ $EUID -ne 0 ]]; then
  echo "This script must be run as root (use sudo)" >&2
  exit 1
fi

if systemctl list-unit-files ollama-orchestrator.service >/dev/null 2>&1; then
  systemctl stop ollama-orchestrator || true
  systemctl disable ollama-orchestrator || true
fi

rm -f /etc/systemd/system/ollama-orchestrator.service
systemctl daemon-reload

rm -f /etc/logrotate.d/ollama-orchestrator

if [[ "$PURGE" == true ]]; then
  userdel orchestrator || true
  echo "Removed orchestrator user"
fi

if [[ "$PURGE" == true ]]; then
  rm -rf /opt/ollama-orchestrator/data
  rm -rf /opt/ollama-orchestrator/logs
  rm -rf /var/log/ollama-orchestrator
  rm -f /etc/ollama-orchestrator/orchestrator.env
  echo "Purged all data and logs"
else
  echo "Preserved data and logs (use --purge to remove)"
fi

echo "Uninstallation complete."