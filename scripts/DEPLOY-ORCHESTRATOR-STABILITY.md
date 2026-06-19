# Deploying the Orchestrator Stability Release

Step-by-step deployment of the `orchestrator-stability-release` build (Wave 9).

## TL;DR

```bash
# 1. Build
cd /root/ollama-orchestrator
npm run typecheck && npm run build

# 2. Deploy (with automatic rollback if health check fails)
sudo bash scripts/deploy-orchestrator-stability.sh

# 3. Verify
bash scripts/live-fleet-integration.sh   # see Wave 9.4
```

## Pre-Deployment

1. **Run all local quality checks** (the `9.2` task in this plan):
   ```bash
   cd /root/ollama-orchestrator
   npm run typecheck        # 0 errors
   npm run format:check     # 0 errors
   npm run validate-types   # PASS
   npx eslint "src/**/*.ts" # review any errors
   ```
2. **Build the binary**:
   ```bash
   npm run build
   ```
   Verify `dist/index.js` exists.
3. **Confirm baseline**: the live verification report at
   `.sisyphus/evidence/live-system-verification.md` should be recent.
4. **Notify the team / set a maintenance window** if your deployment impacts
   users.
5. **Have the rollback procedure open in another tab**.

## Deployment

The deployment script handles all the steps below idempotently and
automatically rolls back if the new binary does not become ready within 60s.

```bash
sudo bash scripts/deploy-orchestrator-stability.sh
```

If you prefer to do it manually:

```bash
# Stop
sudo systemctl stop ollama-orchestrator

# Back up current dist (so we can roll back)
sudo cp -a /root/ollama-orchestrator/dist /var/backups/ollama-orchestrator/dist.$(date -u +%Y%m%dT%H%M%SZ)

# Build (re-runs tsc; idempotent)
cd /root/ollama-orchestrator && npm run build

# Start
sudo systemctl start ollama-orchestrator

# Wait for ready
until curl -fsS http://localhost:5100/health/ready >/dev/null 2>&1; do
  sleep 1
done
```

## Post-Deployment Verification

Run the live fleet integration tests (Wave 9.4) — these exercise the new
behaviour against the live fleet:

```bash
bash scripts/live-fleet-integration.sh
```

Then check:

```bash
# Recent logs
journalctl -u ollama-orchestrator --since "5 minutes ago" | grep -E "ERROR|FATAL|LIFECYCLE"

# New metrics exposed?
curl -s http://localhost:5100/api/orchestrator/metrics/prometheus | grep -E "(itl|per_size|cold_start|token_weighted|error_type)"

# DecisionEvent breakdown has all 10 components?
curl -s "http://localhost:5100/api/orchestrator/analytics/decisions?limit=3" | jq '.decisions[0].scoreBreakdown | keys'

# Kill switch is in the schema and OFF by default
curl -s http://localhost:5100/api/orchestrator/config | jq '.config.loadBalancer.fallbackToFastestResponse'
```

## Rollback

### Soft rollback (no service restart)

Use the kill switch. This is the fastest, safest rollback and is **the
recommended first action** if you see any unexpected routing behaviour
post-deploy.

```bash
sudo bash scripts/deploy-orchestrator-stability.sh --soft-kill-switch
```

Or manually:

```bash
curl -X POST http://localhost:5100/api/orchestrator/config \
  -H "Content-Type: application/json" \
  -d '{"loadBalancer": {"fallbackToFastestResponse": true}}'
```

This causes **all** load-balancing algorithms (weighted, prefix-cache-aware,
etc.) to behave as `fastest-response` immediately, without restarting the
service. In-flight requests are not affected; new requests are routed
differently.

Verify the switch is on:

```bash
curl -s http://localhost:5100/api/orchestrator/config \
  | jq '.config.loadBalancer.fallbackToFastestResponse'
# expected: true
```

To disable again (after fixing the underlying issue):

```bash
curl -X POST http://localhost:5100/api/orchestrator/config \
  -H "Content-Type: application/json" \
  -d '{"loadBalancer": {"fallbackToFastestResponse": false}}'
```

### Hard rollback (full revert to previous binary)

If the soft rollback is not enough, or if the new binary has a fatal startup
issue, restore the previous binary:

```bash
sudo bash scripts/deploy-orchestrator-stability.sh --rollback
```

This:

1. Stops the service
2. Restores the most recent backup of `dist/` from `/var/backups/ollama-orchestrator/dist.*`
3. Starts the service with the prior binary
4. Waits for `/health/ready`

If automatic rollback is not enough (e.g. there is no good backup), manual
recovery:

```bash
# Find a known-good dist backup
ls -lt /var/backups/ollama-orchestrator/

# Restore
sudo systemctl stop ollama-orchestrator
sudo cp -a /var/backups/ollama-orchestrator/dist.20260619T120000Z /root/ollama-orchestrator/dist
sudo systemctl start ollama-orchestrator
```

## Monitoring Post-Deploy

Watch for the first 30 minutes after deploy:

```bash
# Errors and lifecycle events
journalctl -u ollama-orchestrator -f | grep -E "ERROR|FATAL|LIFECYCLE"

# Routing decisions
watch -n 5 'curl -s http://localhost:5100/api/orchestrator/analytics/algorithms'

# In-flight and error rate
watch -n 5 'curl -s http://localhost:5100/api/orchestrator/metrics/prometheus | grep -E "(error_rate|in_flight|p95_ttft)"'
```

## What changed in this release

- 36 bug fixes (B1–B36). The full list is in `CHANGES.md`.
- New algorithms: `prefix-cache-aware`, SLO fallback mode
- New metrics: ITL histogram, per-prompt-size TTFT buckets, error-type histogram,
  jitter / stddev, cache hit rate, cold-start magnitude, token-weighted load
- New config fields: `loadBalancer.fallbackToFastestResponse`,
  `prefixCacheAware`, `sloFallback`, `tokenWeightedLoad`, `coldStartMagnitude`
- New observability: lifecycle events, request ID middleware, logLevel wiring
- Plan: `.sisyphus/plans/orchestrator-stability-release.md`
- Runbook: `scripts/RUNBOOK-ORCHESTRATOR-STABILITY.md`
- Verification report: `.sisyphus/evidence/live-system-verification.md`
- Pre-deploy verification report: `.sisyphus/evidence/pre-deploy-verification.md`
