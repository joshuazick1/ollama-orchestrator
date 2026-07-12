# Setup Wizard — `frontend/src/setup/`

First-time setup wizard UI. Shown when the orchestrator has no admin user yet (and auth is enabled).

## Purpose

Hosts the three-step wizard that creates the initial admin user and bootstraps the orchestrator fleet. Rendered at `/setup` only when the backend reports setup mode.

## Directory Map

```
setup/
├── WelcomeStep.tsx                # step 1 — welcome + explanation
├── AdminStep.tsx                  # step 2 — create initial admin user
└── ServerStep.tsx                 # step 3 — add the first orchestrator server (optional)
```

Each step is a self-contained component. The orchestrator's setup route (`/api/orchestrator/setup`) is called at the end of the wizard.

## Local Contracts

- Only rendered when backend reports setup mode (no admin exists + `ENABLE_AUTH=true`).
- Calls [`../api/setup.ts`](../api/setup.ts) for the admin-user creation request.
- After successful setup, redirects to `/login`.

## Verification

Manual: stop the orchestrator, clear the users table, restart with `ENABLE_AUTH=true`, navigate to `/setup`. E2E coverage: `tests/e2e/auth-flow.spec.ts`.