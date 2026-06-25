# src/controllers/

Express request handlers for every HTTP surface. One controller per major API area.

## Purpose

Translates HTTP requests into orchestrator, storage, and analytics calls. Does not own routing — wiring lives in [src/routes/](../routes/). Does not own validation — schemas and middleware live in [src/middleware/validation.ts](../middleware/validation.ts).

Files of record (current):

- [analytics-controller.ts](analytics-controller.ts) — `/api/orchestrator/analytics/*` (trends, top models, server performance, errors, capacity, decision/request history, summary).
- [anthropic-controller.ts](anthropic-controller.ts) — Anthropic-compatible `/v1/messages` proxy.
- [circuit-breaker-controller.ts](circuit-breaker-controller.ts) — Read, reset, force-open/close/half-open for circuit breakers.
- [config-controller.ts](config-controller.ts) — Read/update/reload/save the orchestrator config.
- [error-events-controller.ts](error-events-controller.ts) — Read error event history.
- [honeypot-stats-controller.ts](honeypot-stats-controller.ts) — `GET /api/orchestrator/honeypot-stats` — Returns honeypot probe results summary (clean/suspicious/flagged counts), latest results, and distribution stats.
- [logs-controller.ts](logs-controller.ts) — Read and clear the in-memory log buffer.
- [quarantine-controller.ts](quarantine-controller.ts) — Tarpit quarantine pool management: list quarantined servers, quarantine a server, unquarantine a server.
- [metrics-controller.ts](metrics-controller.ts) — Metrics dashboard JSON, per-server:model metrics, Prometheus export.
- [model-controller.ts](model-controller.ts) — Model map, fleet stats, model status, warmup, unload, cancel, recommendations.
- [ollama-controller.ts](ollama-controller.ts) — Ollama-compatible `/api/tags`, `/api/generate`, `/api/chat`, `/api/embeddings`, `/api/ps`, `/api/version` plus server-specific bypass variants.
- [openai-controller.ts](openai-controller.ts) — OpenAI-compatible `/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`, `/v1/models` plus bypass variants.
- [recovery-failure-controller.ts](recovery-failure-controller.ts) — Recovery failure summary, history, per-server analysis, reset.
- [server-models-controller.ts](server-models-controller.ts) — Per-server model list, pull, copy, delete.
- [servers-controller.ts](servers-controller.ts) — Add, remove, update, list servers, drain/undrain/maintenance.

## Ownership

- Owns HTTP-shaped request/response bodies for the routes that mount these handlers.
- Public request types live in [src/types/api-request.types.ts](../types/api-request.types.ts) and [src/orchestrator/orchestrator.types.ts](../orchestrator/orchestrator.types.ts) — controllers must consume them, not redefine them.
- Never reads or writes persistence directly; goes through the orchestrator or storage singletons.

## Local Contracts

- One controller per API area. Keep the file small enough to scan; extract helpers to [src/utils/](../utils/) if a controller starts handling cross-cutting concerns.
- Every error path must use a domain error class from [src/utils/domain-errors.ts](../utils/domain-errors.ts) so [src/middleware/](../middleware/) can map it to a stable response.
- All response shapes are part of the public API. Changing a response is a breaking change and must be reflected in [frontend/src/types/](../../frontend/src/types/) (see [frontend/AGENTS.md](../../frontend/AGENTS.md)).
- Endpoint paths are listed in [src/constants/api-endpoints.ts](../constants/api-endpoints.ts) when reused elsewhere; ad-hoc strings are not allowed in `res.json` payloads or `req.originalUrl` checks.

## Work Guidance

- Prefer the established controller template: validate inputs (often via [validation.ts](../middleware/validation.ts) Zod schemas), invoke orchestrator/store methods, translate errors via `isOrchestratorError` or the domain-errors mapper, return JSON.
- Streaming controllers (Ollama, OpenAI, Anthropic) must use [src/streaming.ts](../streaming.ts) and the per-provider SSE formatters in [src/utils/formatters/](../utils/formatters/). Do not hand-roll SSE encoding.
- Server-specific bypass routes are mounted alongside the standard routes; the route path embeds the serverId after a `--` suffix (e.g. `/api/generate--:serverId`).
- If a new endpoint is added, add it to the matching controller, the route file, and `api-endpoints.ts` if it is referenced elsewhere.

## Verification

- `npm test` — unit tests in [tests/unit/](../../tests/unit/) cover most controllers (e.g. `ollama-controller.test.ts`, `openai-controller.test.ts`, `analytics-controller.test.ts`, `servers-controller.test.ts`, `metrics-controller.test.ts`, `error-events-controller.test.ts`, `logs-controller.test.ts`, `config-controller.test.ts`, `server-models-controller.test.ts`, `model-controller.test.ts`, `recovery-failure-controller.test.ts`, `circuit-breaker-controller.test.ts`, `anthropic-controller.test.ts`).
- `npm run test:integration` — covers the cross-controller integration tests under [tests/integration/](../../tests/integration/) (`api.test.ts`, `api-edge-cases.test.ts`, `api-admin.test.ts`, `api-health.test.ts`, `api-ollama.test.ts`, `api-openai.test.ts`, `anthropic.test.ts`, `servers-api.test.ts`, `metrics-endpoints.test.ts`).
- `npm run test:e2e` — Playwright tests under [tests/e2e/](../../tests/e2e/) (api.test.ts, auth-smoke.test.ts, exhaustive-evaluation.test.ts).
