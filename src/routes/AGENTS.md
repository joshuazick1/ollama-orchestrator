# src/routes/

Express router composition and middleware chain wiring. Owns how controllers, auth, and rate limiting are bound to URL prefixes.

## Purpose

Composes the routers mounted by [src/index.ts](../index.ts) and applies the per-router middleware chain (auth, rate limiting, validation).

Files of record:

- [orchestrator.ts](orchestrator.ts) — Barrel that composes the per-area routers and re-exports them as a single object.
- [admin.routes.ts](admin.routes.ts) — Admin operations (server add/remove, drain, undrain, maintenance, config, ban management, breaker controls).
- [inference.routes.ts](inference.routes.ts) — Standard `/api/generate`, `/api/chat`, `/api/embeddings`, `/api/ps`, `/api/version` plus the `--:serverId` bypass variants.
- [monitoring.routes.ts](monitoring.routes.ts) — Health, stats, metrics, logs, in-flight, model status, circuit-breaker read.
- [v1.routes.ts](v1.routes.ts) — OpenAI-compatible `/v1/*` (chat/completions, completions, embeddings, models) plus the `--:serverId` bypass variants.
- [anthropic.routes.ts](anthropic.routes.ts) — Anthropic-compatible `/v1/messages`.
- [auth.routes.ts](auth.routes.ts) — `/api/auth/*` — login, logout, refresh, session check.
- [user.routes.ts](user.routes.ts) — `/api/users/*` — user CRUD (admin), password change, role management.

## Ownership

- Owns the URL space and which middleware applies to which group.
- Public URL paths and prefixes are listed in [src/constants/api-endpoints.ts](../constants/api-endpoints.ts).
- Auth and rate-limit semantics are owned by [src/middleware/](../middleware/). This folder wires them; it does not redefine them.

## Local Contracts

- Admin routes require `requireAdmin`; monitoring routes require `requireAuth` (when auth is enabled); inference and v1 routes have their own rate limiter (see `createInferenceRateLimiter`).
- All routers are mounted under `/` and the path prefix is established here, not in [src/index.ts](../index.ts).
- Server-specific bypass routes use the path suffix `--:serverId`; the matching controller must extract the serverId from `req.params` (the param is registered here, not in the controller).

## Work Guidance

- When adding a new endpoint, add the path constant to [api-endpoints.ts](../constants/api-endpoints.ts), bind the route in the right router file, and confirm the middleware chain (auth + rate limit + validation) is correct.
- Path patterns must use Express path-to-regexp syntax. The `--:serverId` suffix convention is documented in the README and must be preserved for all bypass routes.
- Do not mount controllers directly from [src/index.ts](../index.ts) — only the composed router in [orchestrator.ts](orchestrator.ts) is exposed to the entry point.

## Verification

- `npm test` — covers `routes.test.ts`, `auth.routes.test.ts`, `user.routes.test.ts`, `server-specific-routes.test.ts` in [tests/unit/](../../tests/unit/).
- `npm run test:integration` — `api.test.ts`, `api-admin.test.ts`, `api-edge-cases.test.ts`, `auth-smoke.test.ts` (e2e) exercise the route wiring.
