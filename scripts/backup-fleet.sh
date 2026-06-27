#!/usr/bin/env bash
set -euo pipefail

LABEL="${1:-manual}"
SRC="/root/ollama-orchestrator/data/servers.json"
BACKUP_DIR="${BACKUP_DIR:-/root/ollama-orchestrator/data}"
TIMESTAMP="$(date +%s%3N)"
BACKUP="${BACKUP_DIR}/servers.json.backup.${TIMESTAMP}_${LABEL}"
LOG_PREFIX="[backup-fleet]"

if [[ ! -s "$SRC" ]]; then
  echo "$LOG_PREFIX ERROR: source file $SRC is missing or empty"
  echo "$LOG_PREFIX Backup aborted"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

SRC_SIZE="$(stat -c%s "$SRC")"
cp "$SRC" "$BACKUP"
BACKUP_SIZE="$(stat -c%s "$BACKUP")"

if [[ "$BACKUP_SIZE" -ne "$SRC_SIZE" ]]; then
  echo "$LOG_PREFIX ERROR: backup size mismatch (source=$SRC_SIZE, backup=$BACKUP_SIZE)"
  echo "$LOG_PREFIX Backup aborted"
  rm -f "$BACKUP"
  exit 1
fi

echo "$LOG_PREFIX Source: $SRC ($SRC_SIZE bytes)"
echo "$LOG_PREFIX Backup: $BACKUP ($BACKUP_SIZE bytes)"
echo "$LOG_PREFIX Success"