# scripts/

Repo-root operational scripts: install/uninstall, logrotate, systemd unit, sync-types, env verify, load/chaos tests.

## Purpose

Operational tooling that does not live in `package.json` scripts because it is run as a one-off process, an external cron, a systemd unit, or a long-running load test. Each script is self-contained and has its own purpose.

Files of record (grouped by concern):

**Install / uninstall / operations**

- [install.sh](install.sh) — Install the orchestrator as a systemd service. Used by production deployment.
- [uninstall.sh](uninstall.sh) — Remove the systemd service.
- [ollama-orchestrator.service](ollama-orchestrator.service) — systemd unit file installed by `install.sh`.
- [logrotate-ollama-orchestrator](logrotate-ollama-orchestrator) — logrotate config installed by `install.sh`.
- [verify-env.sh](verify-env.sh) — Validate the runtime environment (Node version, dependencies, env vars).
- [deploy-orchestrator-stability.sh](deploy-orchestrator-stability.sh) — Deploy / rollback script for the orchestrator-stability-release. Supports `--rollback` (full revert), `--soft-kill-switch` (toggle kill switch via API), `--status`. Idempotent; automatic rollback on health-check timeout.
- [DEPLOY-ORCHESTRATOR-STABILITY.md](DEPLOY-ORCHESTRATOR-STABILITY.md) — Step-by-step deploy and rollback procedure.
- [RUNBOOK-ORCHESTRATOR-STABILITY.md](RUNBOOK-ORCHESTRATOR-STABILITY.md) — Operational runbook: health checks, kill switch, SLO fallback, prefix-cache-aware routing, common failure modes.

**Type synchronization**

- [sync-types.sh](sync-types.sh) — Regenerates the frontend type mirror from the backend's `src/shared-types.ts`. Run by `prebuild`.
  - **Workflow**: after every type change in `src/orchestrator/orchestrator.types.ts`, run `bash scripts/sync-types.sh` (or `npm run prebuild`).
  - The script copies `src/orchestrator/orchestrator.types.ts` → `frontend/src/types/generated/orchestrator.types.ts`, stripping backend-only imports.
  - Generated files in `frontend/src/types/generated/` must never be edited manually — always run the script.
  - See also `npm run validate-types` which checks for drift between frontend and backend types.

**Type validation**

- [validate-types.mjs](validate-types.mjs) — Validates the backend↔frontend type mirror. Invoked by `npm run validate-types`.

**Load & chaos tests (TS)**

- [unified-load-test.ts](unified-load-test.ts) — The canonical load test (`npm run test:load`).
- [stress/preflight.sh](stress/preflight.sh) — Pre-flight checks for stress testing. Runs 8 checks: service health, auth disabled, rate limit >= 10000, model availability, server capacity (vs target concurrency), streaming support, connection limits (ulimit -n >= 4096), fleet backup. Exit 0 if all pass, 1 otherwise.
- [stress/k6-base.js](stress/k6-base.js) — Parameterized K6 load test for all stress phases (B1-B4, C1-C3, C5). Run via `k6 run --vus N --duration Ts scripts/stress/k6-base.js`. Supports env vars: `BASE_URL`, `MODEL`, `ENDPOINT`, `API_KEY`, `STAGES`, `PHASE`, `MAX_TOKENS`, `SLEEP_MIN`, `SLEEP_MAX`.
- [quick-load-test.sh](quick-load-test.sh) — Thin wrapper around the unified load test.
- [circuit-breaker-load-test.ts](circuit-breaker-load-test.ts) — Circuit-breaker dedicated load test (`npm run test:circuit-breaker`).
- [enhanced-circuit-breaker-load-test.ts](enhanced-circuit-breaker-load-test.ts) — Enhanced variant of the circuit-breaker load test.
- [direct-import-load-test.ts](direct-import-load-test.ts) — Direct-import variant of the load test (bypasses HTTP).
- [streaming-load-test.ts](streaming-load-test.ts) — Streaming-focused load test.
- [streaming-stall-test.ts](streaming-stall-test.ts) — Streaming stall-detection test.
- [rate-limit-failover-validation.cjs](rate-limit-failover-validation.cjs) — Rate-limit + failover validation script.
- [stream_test.mjs](stream_test.mjs) — Ad-hoc streaming smoke test.
- [test-circuit-breakers.ts](test-circuit-breakers.ts) — Ad-hoc circuit-breaker smoke test.

## Ownership

- Owns operational tooling. Changes to install/uninstall/service files must be tested on a clean machine; changes to load tests must be run end-to-end before merging.
- Load test scripts may import from [src/](../src/) and may depend on the orchestrator being running locally. The README documents the local dev workflow.

## Local Contracts

- Shell scripts are bash and target Linux (matches the systemd unit).
- TS scripts are run with `tsx` and target Node ≥ 20.
- The load tests assume the orchestrator is reachable at the default port (`5100`) unless `ORCHESTRATOR_URL` (or a script-specific env var) is set. Read the top of each script for the exact contract.
- `sync-types.sh` is the only script that may write into [frontend/src/types/generated/](../frontend/src/types/generated/). It is invoked by `prebuild`; do not run it from other scripts.
- `validate-types.mjs` must not modify files — it is a read-only check.

## Work Guidance

- New install/uninstall step: edit [install.sh](install.sh) and [uninstall.sh](uninstall.sh) together so they stay symmetric.
- New load scenario: add a new mode to [unified-load-test.ts](unified-load-test.ts) (preferred) or a new sibling script. Keep the canonical pattern (`--duration`, `--concurrency`, `--pattern`).
- New operational script: place it at the top of [scripts/](.) and document it here. If the script needs to be exposed as `npm run …`, also add it to the root `package.json`.

## Verification

- `npm run test:load:quick` — runs the quick load test.
- `npm run test:load:spike`, `npm run test:load:full` — spike and full load tests.
- `npm run test:circuit-breaker` — circuit-breaker dedicated load test.
- `npm run validate-types` — runs [validate-types.mjs](validate-types.mjs).
- Manual: `bash scripts/install.sh` on a clean Linux box should install the service cleanly; `bash scripts/uninstall.sh` should remove it cleanly.
