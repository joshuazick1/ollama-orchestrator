# src/storage/

Persistence layer: SQLite-backed stores for metrics, operational state, users, and error events; JSON file stores for the server list and request/decision history.

## Purpose

Owns every byte that survives a process restart. Centralizes the choice of backend (SQLite via `better-sqlite3` vs JSON file) per data type and the recovery semantics for each store.

Files of record:

- [metrics-store.ts](metrics-store.ts) — `MetricsStore` (singleton via `getMetricsStore`). Long-term SQLite storage of requests, decisions, failovers, with hourly and daily rollups and the JSON file fallback for the hot 24h window. Used by [src/analytics/](../analytics/) for windows > 24h.
- [operational-store.ts](operational-store.ts) — `OperationalStore` (singleton via `getOperationalStore`). SQLite store for circuit-breaker state, in-flight accounting, ban sets, timeout state, and similar runtime-only-but-persisted data.
- [user-store.ts](user-store.ts) — `UserStore` (singleton via `getUserStore`). SQLite store for user accounts (bcrypt-hashed passwords), roles, sessions, and access records. Backs [src/routes/auth.routes.ts](../routes/auth.routes.ts) and [src/routes/user.routes.ts](../routes/user.routes.ts).
- [error-event-store.ts](error-event-store.ts) — `ErrorEventStore` (singleton via `getErrorEventStore`). NDJSON file store with daily rotation under `data/error-events/`. Backed by [json-file-store.ts](json-file-store.ts).
- [json-file-store.ts](json-file-store.ts) — Abstract `JsonFileStore<T>` and `NdjsonFileStore<T>` for typed file persistence.
- [schema.ts](schema.ts) — `applySchema` migrations and DDL for the SQLite stores.
- [types.ts](types.ts) — `DEFAULT_STORAGE_CONFIG` and shared row types.

## Ownership

- Owns the choice of backend (SQLite vs JSON) per data type. The schema lives here and is applied at startup.
- Hot-path code reads/writes through the singleton getters; raw SQL or raw file I/O from controllers, middleware, or utils is not allowed.
- Migrations are applied in [schema.ts](schema.ts) at startup; the schema version is the source of truth for which tables exist.

## Local Contracts

- All stores expose a singleton accessor (`getMetricsStore`, `getOperationalStore`, `getUserStore`, `getErrorEventStore`).
- The hot 24h window is read from JSON via [src/metrics/metrics-persistence.ts](../metrics/metrics-persistence.ts); longer windows are read from SQLite rollups. Both must agree on the row shape.
- The `data/` directory at the repo root is the default persistence path; override via the storage config in [src/config/](../config/).
- Error event store writes one NDJSON line per event; reads scan the file(s) for the requested date range. Daily rotation is the file-system's job, not a timer.

## Work Guidance

- New persistence must declare a schema migration in [schema.ts](schema.ts) and a typed store module. Do not open new SQLite databases or new JSON files from other folders.
- New tables must have explicit indexes for the dominant query patterns (per server, per model, per time window). The metrics and operational stores have established index patterns to follow.
- The metrics store uses a write buffer that flushes on a batch interval or batch size. Changes to flush semantics belong here and must be tested under load (`npm run test:load:quick`).
- The user store is the only place that imports `bcrypt`; do not hash passwords elsewhere.

## Verification

- `npm test` — covers `metrics-store.test.ts`, `operational-store.test.ts`, `user-store.test.ts`, `error-event-store.test.ts`, `json-file-store.test.ts` in [tests/unit/](../../tests/unit/).
- `npm run test:integration` — covers `storage-corrupt-state.test.ts`, `recovery-cycle.test.ts`, and other integration tests that exercise persistence.
- Manual: delete the contents of `data/` (or use a temp dir) and confirm the orchestrator starts cleanly and creates the expected files.
