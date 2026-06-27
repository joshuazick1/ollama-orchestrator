# frontend/

React + TypeScript + Vite dashboard for the Ollama Orchestrator. Owns the entire `frontend/src/` subtree.

## Purpose

Web UI for monitoring and managing the orchestrator: server list, models, in-flight requests, analytics, circuit breakers, logs, settings, login, and the dashboard. The build is bundled by Vite and served as static assets; it consumes the backend over HTTP via the `ApiClient` defined in [frontend/src/api.ts](src/api.ts).

Entry points:

- [src/main.tsx](src/main.tsx) — Vite entry. Mounts `<App />`.
- [src/App.tsx](src/App.tsx) — Top-level providers (React Query, Auth, Model Pulls) and the React Router route table.

## Ownership

- Owns the user-facing UI. The backend is consumed only through the REST API.
- Public request/response types mirror the backend's [src/shared-types.ts](../src/shared-types.ts); the auto-generated mirror lives at [src/types/generated/](src/types/generated/).
- The Vite build output goes to `frontend/dist/` and is what production deployments serve (or what the orchestrator's static middleware serves, if configured).

## Local Contracts

- API base URL: `import.meta.env.VITE_API_BASE_URL` (default `http://localhost:5100`). Set per build.
- React Router v7 (`react-router-dom@^7`) for routing. `Login` is the only public route; every other route is wrapped in `<ProtectedRoute>`.
- React Query (`@tanstack/react-query`) is the only allowed data-fetching primitive for HTTP endpoints. Do not introduce a second data-fetching library.
- Tailwind CSS is the styling system. `clsx` + `tailwind-merge` are the only allowed class-name composition helpers.
- Design tokens defined in [src/styles/tokens.css](src/styles/tokens.css) using CSS custom properties with oklch color space. Surface ladder: canvas → surface → surface-raised → surface-overlay.
- shadcn/ui primitives in [src/components/ui/](src/components/ui/) (Button, Card, Badge, Dialog, Tabs, etc.).
- WebSocket / Server-Sent Events are consumed through dedicated hooks in [src/hooks/](src/hooks/) (`useWebSocket`, `useServerEvents`).
- TypeScript strict mode (per `tsconfig.app.json`).

## Work Guidance

- New page: add it under [src/pages/](src/pages/), add a route in [src/App.tsx](src/App.tsx), and add a nav entry in [src/constants/navigation.ts](src/constants/navigation.ts).
- New reusable component: add it under [src/components/](src/components/). Use the existing primitives (`Button`, `Card`, `Modal`, `Badge`, `EmptyState`, `StatCard`, `DataToolbar`).
- New dynamic-width bar: prefer extending [src/components/ProgressBar.tsx](src/components/ProgressBar.tsx). Do not introduce inline `style={{ width: '...' }}`.
- New API call: add a typed method to [src/api.ts](src/api.ts). Reuse `ApiError` for error normalization; do not throw raw axios errors from UI code.
- New type from the backend: regenerate the mirror with `npm run build` (which runs `prebuild` → `scripts/sync-types.sh`) — do not hand-edit the generated file.
- Avoid hardcoded colors outside [src/constants/colors.ts](src/constants/colors.ts). Use the palette or the Tailwind theme.
- Skeletons: use the primitives in [src/components/skeletons/](src/components/skeletons/) for loading states.
- Toast: use [src/utils/toast.ts](src/utils/toast.ts). No new toast library.

## Verification

- `npm run typecheck` (in `frontend/`) — TypeScript must compile.
- `npm run lint` (in `frontend/`) — ESLint (typescript-eslint, react-hooks, react-refresh) must pass.
- `npm run test` (in `frontend/`) — Vitest unit tests under [src/**tests**/](src/__tests__/), [src/components/**tests**/](src/components/__tests__/), [src/hooks/**tests**/](src/hooks/__tests__/), [src/pages/**tests**/](src/pages/__tests__/), [src/utils/**tests**/](src/utils/__tests__/), plus the [src/test/](src/test/) directory.
- `npm run build` (in `frontend/`) — `tsc -b && vite build`. Must produce `dist/`.
- `npm run typecheck:all` (at the repo root) — runs both backend and frontend typecheck.
- `npm run validate-types` (at the repo root) — validates the backend↔frontend type mirror.
- E2E: Playwright tests under [tests/e2e/](../tests/e2e/) consume the running frontend.

## Child DOX Index

- [frontend/src/pages/AGENTS.md](src/pages/AGENTS.md) — Page-level components (Dashboard, Servers, Models, Analytics, CircuitBreakers, Logs, Settings, InFlight, Login).
- [frontend/src/components/AGENTS.md](src/components/AGENTS.md) — Reusable UI primitives, modals, layout, error boundaries, skeletons.
- [frontend/src/hooks/AGENTS.md](src/hooks/AGENTS.md) — React hooks: auth, data table, hotkeys, model pulls, server events, theme, websocket.
- [frontend/src/contexts/AGENTS.md](src/contexts/AGENTS.md) — React contexts (auth state).
- [frontend/src/utils/AGENTS.md](src/utils/AGENTS.md) — Frontend helpers: circuit-breaker UI, config validation, export, formatting, security, stream fetch, toast.
- [frontend/src/constants/AGENTS.md](src/constants/AGENTS.md) — Frontend constants: app metadata, color palette, navigation, time formatting.
- [frontend/src/types/AGENTS.md](src/types/AGENTS.md) — Frontend type definitions and the auto-generated `generated/` mirror of backend types.
