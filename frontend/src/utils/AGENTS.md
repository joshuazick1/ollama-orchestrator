# frontend/src/utils/

Frontend helpers: circuit-breaker UI logic, config validation, export, formatting, security, stream fetch, toast, and small utilities.

## Purpose

Pure or near-pure helpers used by pages, components, and hooks. The frontend's leaf layer.

Files of record:

- [circuitBreaker.tsx](circuitBreaker.tsx) — Color/icon helpers for circuit-breaker states in the UI.
- [configValidation.ts](configValidation.ts) — Zod schemas for client-side config validation (mirrors the backend shape).
- [eventEmitter.ts](eventEmitter.ts) — Lightweight event emitter for cross-component signaling.
- [export.ts](export.ts) — CSV/JSON export helpers.
- [formatting.ts](formatting.ts) — Bytes, percentages, duration formatters.
- [safeArray.ts](safeArray.ts) — Defensive `safeArray` helper for the dashboard's defensive rendering.
- [security.ts](security.ts) — Sanitization helpers for safely rendering user-controlled strings.
- [stream-fetch.ts](stream-fetch.ts) — Streamed fetch wrapper for server-sent events.
- [toast.ts](toast.ts) — `react-hot-toast` wrapper.
- [**tests**/](__tests__) — Vitest unit tests.

## Ownership

- Owns the leaf helper layer. Pages and components depend on this folder; this folder depends on [frontend/src/constants/](../constants/) and [frontend/src/types/](../types/) only.
- No business logic, no data fetching — these are pure helpers.

## Local Contracts

- Helpers here must be side-effect-free at import time.
- The toast wrapper in [toast.ts](toast.ts) is the only allowed toast entry point.
- The event emitter in [eventEmitter.ts](eventEmitter.ts) is shared across components but is not a global state store; use a context or React Query for that.

## Work Guidance

- New helper: place it at the top of [frontend/src/utils/](.) before considering a subfolder.
- Config validation schemas must mirror the backend; if the backend shape changes, update both sides in the same change.
- Sanitization: do not introduce `dangerouslySetInnerHTML` in pages/components — sanitize through [security.ts](security.ts) instead.

## Verification

- `npm run test` (in `frontend/`) — covers [**tests**/](__tests__) and any test files at the top of [frontend/src/utils/](.).
- `npm run typecheck` and `npm run lint` must pass.
