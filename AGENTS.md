# DOX framework

- DOX is highly performant AGENTS.md hierarchy installed here
- Agent must follow DOX instructions across any edits
- This project is a sibling of `project_chronicle` under the workspace umbrella at [`/root/project/AGENTS.md`](../AGENTS.md). Read that file first when a change touches both projects.

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it

## Read Before Editing

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md found along each route
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

## Hierarchy

- Root AGENTS.md is the DOX rail: project-wide instructions, global preferences, durable workflow rules, and the top-level Child DOX Index
- Child AGENTS.md files own domain-specific instructions and their own Child DOX Index
- Each parent explains what its direct children cover and what stays owned by the parent
- The closer a doc is to the work, the more specific and practical it must be

## Child Doc Shape

- Create a child AGENTS.md when a folder becomes a durable boundary with its own purpose, rules, responsibilities, workflow, materials, or quality standards
- Work Guidance must reflect the current standards of the project or user instructions; if there are no specific standards or instructions yet, leave it empty
- Verification must reflect an existing check; if no verification framework exists yet, leave it empty and update it when one exists

Default section order:

- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child DOX Index

## Style

- Keep docs concise, current, and operational
- Document stable contracts, not diary entries
- Put broad rules in parent docs and concrete details in child docs
- Prefer direct bullets with explicit names
- Do not duplicate rules across many files unless each scope needs a local version
- Delete stale notes instead of explaining history
- Trim obvious statements, repeated rules, misplaced detail, and warnings for risks that no longer exist

## Closeout

1. Re-check changed paths against the DOX chain
2. Update nearest owning docs and any affected parents or children
3. Refresh every affected Child DOX Index
4. Remove stale or contradictory text
5. Run existing verification when relevant
6. Report any docs intentionally left unchanged and why

## User Preferences

When the user requests a durable behavior change, record it here or in the relevant child AGENTS.md

### Service Runtime

- **The orchestrator runs as a systemd service**: `ollama-orchestrator.service` on port 5100 (managed by `systemctl start/stop/restart ollama-orchestrator`).
- **Live verification** is mandatory for every change: build with `npx tsc`, restart with `systemctl restart ollama-orchestrator`, then `curl http://localhost:5100/health/ready` before running live API checks.
- **Fleet backup is critical**: `data/servers.json` may be wiped by tests. The primary restore source is `data/servers.json.prune_backup` (1087 servers). Before any test run, verify fleet state via `curl /api/orchestrator/servers | jq 'length'` (expect > 1000); if < 1000, restore from backup and restart service.
- **Do NOT run `npm test` against the live system** without first backing up `data/servers.json` to a timestamped file under `/var/backups/ollama-orchestrator/`.
- **Install `sqlite3` CLI if missing**: `apt-get install -y sqlite3`

### Preflight

- **Clear CB + probe state**: `bash scripts/clear-probe-state.sh`

### Performance Probe Scheduler

The daily randomized perf-probe scheduler uses these env vars:

- `PERF_PROBE_ENABLED` — Whether the scheduler runs (default: `true`)
- `PERF_PROBE_INTERVAL_MS` — Cycle interval in ms (default: `86400000` = 24h)
- `PERF_PROBE_JITTER_MS` — Max jitter per probe delay in ms (default: `300000` = 5min)
- `PERF_PROBE_MAX_CONCURRENT` — Global concurrency cap (default: `max(2, min(16, floor(serverCount / 100)))` — e.g., 10 for 1000 servers)
- `PERF_PROBE_COOLDOWN_MS` — Skip window if same (server, model) was probed recently (default: `300000` = 5min)
- `PERF_PROBE_MODEL_COUNT` — Max probe models selected by greedy set cover (default: `50`)
- `PERF_PROBE_TIMEOUT_MS` — Per-probe timeout in ms (default: `30000` = 30s)

For testing, set `PERF_PROBE_INTERVAL_MS=60000` (1-minute cycle) and `PERF_PROBE_JITTER_MS=5000` (5s jitter).

### Git Workflow

- **Remote**: `origin` points at `https://github.com/joshuazick1/ollama-orchestrator.git` (Joshua Zick's public repo).
- **Local is intentionally ahead**: The local `main` is a snapshot that diverges from `origin/main` with substantial local evolution (code added, refactors, file churn). Treat the local commit as the source of truth until you choose to push.
- **Branch tracking is OFF by default**: `main` does not have `branch.main.remote` or `branch.main.merge` set. This means `git pull` will refuse with "no upstream" rather than silently merging public commits. Verify state explicitly with `git status -sb` and `git rev-list --left-right --count main...origin/main`.
- **Never run `git pull`, `git fetch` followed by merge, or `git reset --hard origin/main`** without confirming the divergence cost. If you need public commits, prefer `git fetch origin main && git log origin/main..main` (read-only inspection) first.
- **Push protocol**: When ready to publish, use `git push -u origin main` (sets tracking on first push) or `git push origin main` (subsequent). Do not force-push unless explicitly told.
- **Initial commit hash**: `86e3776` — `chore: import from transfer tarball`. The first commit intentionally used `--no-verify` because the snapshot includes config files (`vitest.*.config.ts`, `playwright.config.ts`, `tsconfig.tsbuildinfo`, `scripts/verify-lb-uses-probe-data.ts`) that the typed-eslint config does not include; those pre-existing failures are not caused by this commit. Subsequent commits should run hooks normally.
- **Identity**: Repo-local `user.name`/`user.email` are set to `Joshua Zick <joshuazick1@users.noreply.github.com>` to match the public repo. These are NOT global git config and only affect this repo.
- **Husky hooks**: `commit-msg` runs commitlint, `pre-commit` runs lint-staged (`eslint --fix` + `prettier --write` on staged `*.ts`). Both must pass on subsequent commits.
- **Hook limitations on Node 20**: `commitlint@18` has an ESM/CJS cycle that fails to load under Node 20 with `ERR_REQUIRE_CYCLE_MODULE`. If you see this error on commit, the runtime Node version is too old for commitlint. Use `git commit --no-verify` after visually confirming the message conforms to conventional commits, and document why in the commit body if non-obvious. The orchestrator's own engines field requires `>=20.0.0`, but commitlint needs `>=22`.

## Child DOX Index

The DOX tree is rooted at these child docs. Each child owns a durable boundary and links to its own children. See the linked doc for scope, contracts, work guidance, and verification.

### Backend (Node.js / TypeScript)

- [src/AGENTS.md](src/AGENTS.md) — Backend application source. Owns the entire `src/` subtree.
  - [src/orchestrator/AGENTS.md](src/orchestrator/AGENTS.md) — Core routing engine: server fleet, request routing, persistence, types, models subsystem.
  - [src/load-balancer/AGENTS.md](src/load-balancer/AGENTS.md) — Server selection algorithms, weighted scoring, temporal scorer, adaptive weight tuner.
  - [src/probe/AGENTS.md](src/probe/AGENTS.md) — Health checking, circuit breaker state machine, and recovery orchestration.
  - [src/circuit-breaker/AGENTS.md](src/circuit-breaker/AGENTS.md) — Legacy compatibility shim that re-exports the historical `CircuitBreaker` symbols; real logic lives in `src/probe/`.
  - [src/controllers/AGENTS.md](src/controllers/AGENTS.md) — HTTP request handlers (Express controllers) for every API surface.
  - [src/routes/AGENTS.md](src/routes/AGENTS.md) — Express router composition and middleware chain wiring.
  - [src/middleware/AGENTS.md](src/middleware/AGENTS.md) — Cross-cutting Express middleware: auth, rate-limit, CSRF, validation.
  - [src/analytics/AGENTS.md](src/analytics/AGENTS.md) — Analytics engine, recovery-failure tracker, decision/request history aggregations.
  - [src/metrics/AGENTS.md](src/metrics/AGENTS.md) — In-memory metrics aggregator with sliding windows, Prometheus exporter, TTFT tracker.
  - [src/config/AGENTS.md](src/config/AGENTS.md) — Runtime configuration: Zod schema, env mapper, JSON file handler, config manager, hot reload.
  - [src/storage/AGENTS.md](src/storage/AGENTS.md) — Persistence: SQLite stores (metrics, operational, users, error events) and JSON file stores.
  - [src/types/AGENTS.md](src/types/AGENTS.md) — Cross-cutting TypeScript types: API request shapes, error events, Ollama response types.
  - [src/utils/AGENTS.md](src/utils/AGENTS.md) — Pure helpers: classification, timeouts, in-flight tracking, bans, JWT, fetch, logging, streaming helpers, formatters.
  - [src/constants/AGENTS.md](src/constants/AGENTS.md) — Centralized API endpoint paths and error message keys.

### Frontend (React / TypeScript / Vite)

- [frontend/AGENTS.md](frontend/AGENTS.md) — React dashboard. Owns the entire `frontend/src/` subtree.
  - [frontend/src/pages/AGENTS.md](frontend/src/pages/AGENTS.md) — Page-level components (Dashboard, Servers, Models, Analytics, CircuitBreakers, Logs, Settings, InFlight, Login).
  - [frontend/src/components/AGENTS.md](frontend/src/components/AGENTS.md) — Reusable UI primitives, modals, layout, error boundaries, skeletons.
  - [frontend/src/hooks/AGENTS.md](frontend/src/hooks/AGENTS.md) — React hooks: auth, data table, hotkeys, model pulls, server events, theme, websocket.
  - [frontend/src/contexts/AGENTS.md](frontend/src/contexts/AGENTS.md) — React contexts (auth state).
  - [frontend/src/utils/AGENTS.md](frontend/src/utils/AGENTS.md) — Frontend helpers: circuit-breaker UI, config validation, export, formatting, security, stream fetch, toast.
  - [frontend/src/constants/AGENTS.md](frontend/src/constants/AGENTS.md) — Frontend constants: app metadata, color palette, navigation, time formatting.
  - [frontend/src/types/AGENTS.md](frontend/src/types/AGENTS.md) — Frontend type definitions and the auto-generated `generated/` mirror of backend types.

### Tests (Vitest + Playwright)

- [tests/AGENTS.md](tests/AGENTS.md) — Test suite root. Owns all test kinds, fixtures, and shared utilities.

### Operations & Tooling

- [scripts/AGENTS.md](scripts/AGENTS.md) — Repo-root operational scripts: install/uninstall, logrotate, systemd unit, sync-types, env verify, load/chaos tests.
- [docs/AGENTS.md](docs/AGENTS.md) — Long-form design docs, audits, runbooks, and reference material (not user-facing README docs).

### Top-level files (no child doc; see root AGENTS.md for behavior)

- `package.json`, `tsconfig.json`, `.eslintrc.json`, `.prettierrc`, `.commitlintrc.js`, `playwright.config.ts`, `vitest*.config.ts`, `Dockerfile`, `docker-compose*.yml`, `.env.example`, `.env` — Build/lint/runtime config.
- `README.md`, `CHANGES.md`, `CONTRIBUTING.md`, `LICENSE` — Repo-level human docs.
- `DESIGN-*.md`, `IMPLEMENTATION_PLAN.md`, `PHASE4-IMPLEMENTATION-PLAN.md`, `REMAINING_GAP_FIXES_PLAN.md` — Working design/plan documents (some live under `docs/`; see `docs/AGENTS.md` for index).
- `.github/workflows/`, `.husky/`, `.sisyphus/`, `.opencode/`, `skills/`, `data/` — Tooling, hooks, and runtime data directories (no child doc unless a future change makes one a durable boundary).
