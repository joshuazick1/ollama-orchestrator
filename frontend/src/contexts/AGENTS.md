# frontend/src/contexts/

React contexts. Currently hosts the authentication state.

## Purpose

Provides React context for cross-cutting app state. Hooks consume these contexts; pages and components read state through the corresponding hook in [frontend/src/hooks/](../hooks/).

Files of record:

- [AuthContext.tsx](AuthContext.tsx) — `AuthProvider` and the `AuthContext` shape (current user, token, login/logout/refresh).
- (No other contexts at the time of writing; add new ones here when they become durable boundaries.)

## Ownership

- Owns the React context shape. The provider is mounted in [frontend/src/App.tsx](../App.tsx); consumers read it through `useAuth` from [frontend/src/hooks/useAuth.ts](../hooks/useAuth.ts).
- Auth tokens live in this context (and in the configured storage, e.g. `localStorage`). The exact storage is defined in this file.

## Local Contracts

- The provider must be mounted exactly once, at the top of [frontend/src/App.tsx](../App.tsx). Do not remount it in pages.
- The `useAuth` hook (in [frontend/src/hooks/](../hooks/)) is the only allowed consumer entry point.

## Work Guidance

- New context: create the provider here, expose a `useXxx` hook in [frontend/src/hooks/](../hooks/), and mount the provider in [frontend/src/App.tsx](../App.tsx).
- Auth is special: login, logout, and refresh are wired through the auth context and the auth routes; do not implement parallel auth flows.

## Verification

- `npm run test` (in `frontend/`) — covered by the App-level and Layout-level tests in [frontend/src/**tests**/](../__tests__/).
- `npm run typecheck` and `npm run lint` must pass.
- Manual: log in, log out, refresh — the context must restore the session on page reload.
