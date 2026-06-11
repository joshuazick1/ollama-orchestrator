# src/middleware/

Cross-cutting Express middleware: auth, rate limiting, CSRF, validation.

## Purpose

Provides the request-pipeline concerns that apply to multiple routers without being owned by any one controller. Each file is a focused, single-concern middleware module.

Files of record:

- [auth.ts](auth.ts) — `requireAuth`, `requireAdmin`, `refreshAuthConfig`, `resolveApiKey`, `AuthConfig`. Constant-time comparison via `timingSafeEqual`.
- [rate-limiter.ts](rate-limiter.ts) — `createMonitoringRateLimiter`, `createAdminRateLimiter`, `createInferenceRateLimiter`. Built on `express-rate-limit` with window/max read from config.
- [csrf.ts](csrf.ts) — Double-submit-cookie CSRF protection. Applies to non-GET mutating routes.
- [validation.ts](validation.ts) — Zod-based request-body and request-params validation. Exports `ValidationError`.

## Ownership

- Owns the auth and rate-limit semantics. Routes wire them; controllers do not reimplement them.
- Validation schemas are co-owned with the controller that defines the request body. When a controller moves its request type to [src/types/](../types/), the corresponding Zod schema must move with it (or be re-exported from the type module).
- CSRF is the only middleware in this folder that is mounted globally inside the route wiring, not per-area; this is intentional and must be preserved.

## Local Contracts

- `requireAuth` and `requireAdmin` read their configuration from the config manager; call `refreshAuthConfig` after any config change so the middleware picks up new keys without restart.
- Rate limiters are factories. The config manager is read inside the factory, so changes to rate-limit config take effect when the limiter is recreated (e.g. on next config reload).
- `ValidationError` is a domain error; controllers and routes must let it propagate to the central error mapper, not catch it locally.

## Work Guidance

- New auth/role rules belong in [auth.ts](auth.ts) and must be reflected in [src/routes/auth.routes.ts](../routes/auth.routes.ts) and [src/routes/user.routes.ts](../routes/user.routes.ts) only if they change the route surface.
- New rate-limit profiles (e.g. for a new route family) belong in [rate-limiter.ts](rate-limiter.ts) and must be mounted from [src/routes/](../routes/).
- New request bodies must have a Zod schema co-located with the type definition in [src/types/api-request.types.ts](../types/api-request.types.ts) and a validation middleware applied at the route.
- CSRF exemptions are configured in [csrf.ts](csrf.ts) — do not bypass CSRF in the route file.

## Verification

- `npm test` — covers `auth.test.ts`, `auth-tests.test.ts`, `rateLimiter.test.ts`, `csrf.test.ts`, `validation.test.ts` in [tests/unit/](../../tests/unit/).
- `npm run test:integration` — covers `rate-limit-failover.test.ts` and the auth/edge-case API tests.
- `npm run test:e2e` — `auth-smoke.test.ts` covers the login + protected route flow.
