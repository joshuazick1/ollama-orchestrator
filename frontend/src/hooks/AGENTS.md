# frontend/src/hooks/

React hooks: auth, data table, hotkeys, model pulls, server events, theme, websocket.

## Purpose

Encapsulate the data and interaction logic that pages and components share. Hooks are the only place where WebSocket subscriptions, long polling, and global UI state should live.

Files of record:

- [useAuth.ts](useAuth.ts) — Re-exports `useAuth` from the [contexts/AuthContext.tsx](../contexts/AuthContext.tsx) for convenience.
- [useDataTable.ts](useDataTable.ts) — Generic data-table state (sort, filter, pagination).
- [useGlobalSearch.ts](useGlobalSearch.ts) — Global search state and queries.
- [useHotkeys.ts](useHotkeys.ts) — Keyboard shortcut registration.
- [useModelPulls.tsx](useModelPulls.tsx) — Provider for the in-progress model pulls and a hook to consume it.
- [useServerEvents.ts](useServerEvents.ts) — Server-side event subscription (SSE) used by the app shell.
- [useTheme.ts](useTheme.ts) — Theme state and toggle.
- [useWebSocket.ts](useWebSocket.ts) — WebSocket connection with reconnect/backoff.
- [**tests**/](__tests__) — Hook-level Vitest tests.

## Ownership

- Owns all subscription logic. Pages do not open WebSockets or SSE connections directly.
- The `useModelPulls` provider is a single-instance context (mounted in [frontend/src/App.tsx](../App.tsx)); child pages read from it.

## Local Contracts

- Every hook that opens a connection must clean up on unmount and on dependency change.
- `useWebSocket` is the only allowed WebSocket entry point. `useServerEvents` is the only allowed SSE entry point. Hooks must not bypass these.
- Hooks that depend on auth must read it through `useAuth`.

## Work Guidance

- New hook: place it at the top of [frontend/src/hooks/](.) unless it is a context provider, in which case it lives in [frontend/src/contexts/](../contexts/).
- New subscription: route it through `useWebSocket` or `useServerEvents` rather than opening a parallel connection.
- New shared state: prefer a context in [frontend/src/contexts/](../contexts/) over a module-level singleton.

## Verification

- `npm run test` (in `frontend/`) — covers [**tests**/](__tests__) and any hook tests at the top of [frontend/src/hooks/](.).
- `npm run typecheck` and `npm run lint` must pass.
- Manual: every hook should be exercised in at least one page.
