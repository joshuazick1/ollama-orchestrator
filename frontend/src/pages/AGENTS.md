# frontend/src/pages/

Page-level React components. Each page corresponds to a top-level route in [frontend/src/App.tsx](../App.tsx) and an entry in the navigation constant.

## Purpose

Page-level state, layout, and composition. Pages consume data via React Query and the API client; they delegate reusable UI to [frontend/src/components/](../components/).

Files of record:

- [Dashboard.tsx](Dashboard.tsx) — System health, totals, recent activity.
- [Servers.tsx](Servers.tsx) — Server list, add/remove/drain/maintenance, per-server metrics.
- [Models.tsx](Models.tsx) — Fleet model status, warmup, unload, recommendations.
- [InFlight.tsx](InFlight.tsx) — Active in-flight request monitoring.
- [CircuitBreakers.tsx](CircuitBreakers.tsx) — Circuit breaker list, detail modal, force state changes, recovery test.
- [Logs.tsx](Logs.tsx) — Application log viewer, search, clear.
- [Login.tsx](Login.tsx) — Public login form.
- [analytics/](analytics/) — Analytics page (multi-tab).
- [settings/](settings/) — Settings page (multi-tab). Settings sub-components in [settings/components/](settings/components/), settings tabs in [settings/tabs/](settings/tabs/).
- [circuit-breakers/](circuit-breakers/) — Circuit breaker sub-components: CircuitBreakerCard, BansTab, detail/.
- [servers/](servers/) — Server sub-components: ServerCard, ServerFilters, AddServerModal, ServerActionsMenu.
- [**tests**/](__tests__) — Page-level Vitest tests.

## Ownership

- Owns the page-level state and the React Query keys used by each page. Components are dumb; pages are smart.
- Page-local subcomponents live in the page file until they are reused; reusable pieces are extracted to [frontend/src/components/](../components/).

## Local Contracts

- Every page (except `Login`) is mounted inside `<ProtectedRoute>` in [frontend/src/App.tsx](../App.tsx). Pages must not perform their own auth checks; that is the route guard's job.
- Data fetching: use React Query via the hooks defined in [frontend/src/api.ts](../api.ts) or via custom hooks in [frontend/src/hooks/](../hooks/).
- Toast on user actions: use [frontend/src/utils/toast.ts](../utils/toast.ts).

## Work Guidance

- New page: create the file, add a route in [frontend/src/App.tsx](../App.tsx), add a navigation entry in [frontend/src/constants/navigation.ts](../constants/navigation.ts), and add tests under [**tests**/](__tests__) (or a new sibling folder for multi-tab pages).
- Pages must be lazy-loaded if they exceed ~50 KB; the bundle hint is the existing pattern in [Servers.tsx](Servers.tsx) and [CircuitBreakers.tsx](CircuitBreakers.tsx).
- Sub-tab pages (analytics, settings) follow the multi-tab pattern visible in [analytics/](analytics/) and [settings/](settings/).

## Verification

- `npm run test` (in `frontend/`) — covers [**tests**/](__tests__) and the analytics/settings sub-tests.
- `npm run typecheck` and `npm run lint` (in `frontend/`) must pass.
- Manual: start the orchestrator and the frontend dev server, then exercise each page end-to-end.
- Playwright e2e tests under [tests/e2e/](../../../tests/e2e/) cover the API surface, not the UI layout.
