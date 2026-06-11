#!/usr/bin/env bash
set -euo pipefail

# Ollama Orchestrator Installation Script
# Idempotent: safe to run multiple times

if [[ $EUID -ne 0 ]]; then
  echo "This script must be run as root (use sudo)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 1. Node.js and npm version checks
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is not installed" >&2
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//')
REQUIRED_NODE="20.0.0"
if ! printf '%s\n%s\n' "$REQUIRED_NODE" "$NODE_VERSION" | sort -V -C; then
  echo "Error: Node.js v$REQUIRED_NODE or higher is required (found v$NODE_VERSION)" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed" >&2
  exit 1
fi

NPM_VERSION=$(npm -v)
echo "Found Node.js v$NODE_VERSION and npm v$NPM_VERSION"

# 2. Create orchestrator user (if missing)
if ! id -u orchestrator >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin orchestrator
  echo "Created orchestrator user"
else
  echo "orchestrator user already exists"
fi

# 3. Create required directories (all idempotent via mkdir -p)
echo "Creating directories..."
mkdir -p /etc/ollama-orchestrator
mkdir -p /opt/ollama-orchestrator/data
mkdir -p /opt/ollama-orchestrator/logs
mkdir -p /var/log/ollama-orchestrator
echo "Directories created"

# 4. Copy .env.example to /etc/ollama-orchestrator/orchestrator.env (if not present)
if [[ ! -f /etc/ollama-orchestrator/orchestrator.env ]]; then
  if [[ -f "$REPO_ROOT/.env.example" ]]; then
    cp "$REPO_ROOT/.env.example" /etc/ollama-orchestrator/orchestrator.env
    echo "Created /etc/ollama-orchestrator/orchestrator.env (edit to configure)"
  else
    echo "Warning: .env.example not found, skipping env file creation" >&2
  fi
else
  echo "orchestrator.env already exists, preserving"
fi

# 5. Copy application files to /opt/ollama-orchestrator (if they exist in dist)
if [[ -d "$REPO_ROOT/dist" ]]; then
  echo "Copying application files to /opt/ollama-orchestrator..."
  # Only copy if source exists - preserve existing if not
  cp -rn "$REPO_ROOT/dist/." /opt/ollama-orchestrator/ 2>/dev/null || true
  # Copy package.json and package-lock.json if they exist
  [[ -f "$REPO_ROOT/package.json" ]] && cp -n "$REPO_ROOT/package.json" /opt/ollama-orchestrator/ 2>/dev/null || true
  [[ -f "$REPO_ROOT/package-lock.json" ]] && cp -n "$REPO_ROOT/package-lock.json" /opt/ollama-orchestrator/ 2>/dev/null || true
  echo "Application files copied"
else
  echo "Warning: dist/ directory not found. Build with 'npm run build' before running install." >&2
fi

# 6. Install the systemd service (conditional - only if source exists)
if [[ -f "$REPO_ROOT/scripts/ollama-orchestrator.service" ]]; then
  cp "$REPO_ROOT/scripts/ollama-orchestrator.service" /etc/systemd/system/ollama-orchestrator.service
  chmod 644 /etc/systemd/system/ollama-orchestrator.service
  echo "Installed systemd service"
else
  echo "Warning: ollama-orchestrator.service not found, skipping service installation" >&2
fi

# 7. Install the logrotate config (conditional - only if source exists)
if [[ -f "$REPO_ROOT/scripts/logrotate-ollama-orchestrator" ]]; then
  cp "$REPO_ROOT/scripts/logrotate-ollama-orchestrator" /etc/logrotate.d/ollama-orchestrator
  chmod 644 /etc/logrotate.d/ollama-orchestrator
  echo "Installed logrotate config"
else
  echo "Warning: logrotate config not found, skipping" >&2
fi

# 8. Set ownership
chown -R orchestrator:orchestrator /opt/ollama-orchestrator /var/log/ollama-orchestrator
echo "Set ownership to orchestrator user"

# 9. Reload systemd
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload
  echo "Reloaded systemd daemon"
fi

# 10. Verify logrotate config
if command -v logrotate >/dev/null 2>&1 && [[ -f "$REPO_ROOT/scripts/logrotate-ollama-orchestrator" ]]; then
  logrotate --debug "$REPO_ROOT/scripts/logrotate-ollama-orchestrator" || true
fi

echo ""
echo "=========================================="
echo "Installation complete!"
echo "=========================================="
echo ""
echo "NEXT STEPS:"
echo "  1. Edit /etc/ollama-orchestrator/orchestrator.env to configure your Ollama servers"
echo "  2. Ensure the application is built: cd $REPO_ROOT && npm run build"
echo "  3. Start the service: systemctl enable --now ollama-orchestrator"
echo "  4. Check status: systemctl status ollama-orchestrator"
echo "  5. View logs: journalctl -u ollama-orchestrator -f"
echo ""
echo "HEALTHCHECK: The service uses ExecStartPost to wait up to 30s for /health/ready."
echo "If the endpoint returns 503 (no healthy servers), the service will fail to start."
echo "This prevents silent restart loops on init failure."
echo ""
echo "To uninstall: sudo $SCRIPT_DIR/uninstall.sh"
echo "=========================================="