# src/

Backend application source for the Ollama Orchestrator. Owns the entire `src/` subtree.

## Purpose

Production-ready Express.js + TypeScript API gateway that routes Ollama and OpenAI-compatible inference requests across a fleet of upstream model servers. Provides intelligent load balancing, automatic failover, per-server and per-model circuit breakers, model warmup, long-term metrics, analytics, and Prometheus export.

Entry point: [src/index.ts](index.ts) wires Express, helmet (with CSP nonce), CORS, body parsing, rate limiting, routers, and graceful shutdown.

## Ownership

- Authoritative for all backend runtime behavior.
- Owns the `src/` subtree; every child folder here defers to this doc for repo-wide backend rules.
- Frontend consumes this layer over HTTP — see [frontend/AGENTS.md](../frontend/AGENTS.md).
- TypeScript path: `tsconfig.json` (root) compiles this subtree to `dist/`.

## Local Contracts

- Language: TypeScript (ESM, `"type": "module"` in root `package.json`).
- Runtime: Node.js ≥ 20 (see `engines` in `package.json`).
- Default HTTP port: `5100` (overridable via `PORT` env). Prometheus sidecar port: `9090`.
- Public surface is REST under `/api/*` (orchestrator), `/v1/*` (OpenAI-compat), and `/api/*` (Anthropic-compat under `src/routes/anthropic.routes.ts`). See [src/routes/AGENTS.md](routes/AGENTS.md) for the full route map and [src/constants/AGENTS.md](constants/AGENTS.md) for endpoint path constants.
- Cross-cutting types: AIServer, ServerModelMetrics, GlobalMetrics, RequestContext, StreamingMetrics — defined in [src/orchestrator/orchestrator.types.ts](orchestrator/orchestrator.types.ts) and re-exported from [src/shared-types.ts](shared-types.ts).
- Storage: SQLite via `better-sqlite3` for metrics, operational state, users, and error events. JSON files for server list, request history, and decision history. See [src/storage/AGENTS.md](storage/AGENTS.md).
- Configuration: Zod-validated, env-mapped, hot-reloadable from JSON. See [src/config/AGENTS.md](config/AGENTS.md).
- Logging: structured JSON lines via [src/utils/logger.ts](utils/logger.ts) and an in-memory ring buffer surfaced at `/api/orchestrator/logs`.

## Work Guidance

- Match the existing module style: TypeScript ES modules with explicit `.js` import extensions (project convention for ESM/Node 20+).
- Keep the orchestrator hot path lean — `src/orchestrator/orchestrator.ts` is large by design; new routing rules go there only when they touch failover, persistence, or fleet-wide state. Algorithm-level scoring changes belong in [src/load-balancer/](load-balancer/) and breaker state changes in [src/circuit-breaker/](circuit-breaker/).
- Never suppress type errors (`as any`, `@ts-ignore`, `@ts-expect-error`). If a type is wrong upstream, fix it at the source.
- No direct `console.log`; use `logger` from [src/utils/logger.ts](utils/logger.ts) so the in-memory log buffer picks entries up.
- Side-effecting singletons live in `*Instance.ts` modules and are accessed through getters (e.g. `getOrchestratorInstance`, `getConfigManager`, `getMetricsStore`).
- New persistence must go through [src/storage/](storage/) — do not open ad-hoc SQLite or JSON files from elsewhere.
- New cross-cutting types belong in [src/types/](types/) or [src/orchestrator/orchestrator.types.ts](orchestrator/orchestrator.types.ts) when they are part of the public domain model.
- New endpoints must add their path to [src/constants/api-endpoints.ts](constants/api-endpoints.ts) and wire through the matching router in [src/routes/](routes/).

## Verification

- `npm run typecheck` — `tsc --noEmit` over the entire `src/` subtree. Must pass.
- `npm run lint` — ESLint with `@typescript-eslint`, `eslint-plugin-import`, `eslint-plugin-security`. Must pass.
- `npm run format:check` — Prettier formatting check. Must pass.
- `npm test` — Vitest unit + integration suite (configured at the repo root).
- `npm run test:chaos` — Chaos tests using a separate Vitest config.
- `npm run validate-types` — Validates the backend↔frontend type mirror.
- CI: see `.github/workflows/ci.yml` (lint, format, typecheck, test, security audit).

## Child DOX Index

- [src/orchestrator/AGENTS.md](orchestrator/AGENTS.md) — Core routing engine: server fleet, request routing, persistence, types, models subsystem.
- [src/load-balancer/AGENTS.md](load-balancer/AGENTS.md) — Server selection algorithms, weighted scoring, temporal scorer, adaptive weight tuner.
- [src/circuit-breaker/AGENTS.md](circuit-breaker/AGENTS.md) — Per-server and per-server:model circuit breaker state machine with persistence.
- [src/controllers/AGENTS.md](controllers/AGENTS.md) — HTTP request handlers (Express controllers) for every API surface.
- [src/routes/AGENTS.md](routes/AGENTS.md) — Express router composition and middleware chain wiring.
- [src/middleware/AGENTS.md](middleware/AGENTS.md) — Cross-cutting Express middleware: auth, rate-limit, CSRF, validation.
- [src/analytics/AGENTS.md](analytics/AGENTS.md) — Analytics engine, recovery-failure tracker, decision/request history aggregations.
- [src/metrics/AGENTS.md](metrics/AGENTS.md) — In-memory metrics aggregator with sliding windows, Prometheus exporter, TTFT tracker.
- [src/config/AGENTS.md](config/AGENTS.md) — Runtime configuration: Zod schema, env mapper, JSON file handler, config manager, hot reload.
- [src/storage/AGENTS.md](storage/AGENTS.md) — Persistence: SQLite stores (metrics, operational, users, error events) and JSON file stores.
- [src/types/AGENTS.md](types/AGENTS.md) — Cross-cutting TypeScript types: API request shapes, error events, Ollama response types.
- [src/utils/AGENTS.md](utils/AGENTS.md) — Pure helpers: classification, timeouts, in-flight tracking, bans, JWT, fetch, logging, streaming helpers, formatters.
- [src/constants/AGENTS.md](constants/AGENTS.md) — Centralized API endpoint paths and error message keys.
