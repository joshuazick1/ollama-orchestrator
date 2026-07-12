# Cross-Component Tests — `frontend/src/__tests__/`

Vitest tests that span multiple components or app-level concerns.

## Purpose

Houses end-to-end-ish frontend tests that don't fit into a single component's `__tests__/` folder — app shell, layout, route guards, cross-page state.

## Directory Map

```
__tests__/
├── App.test.tsx                   # app shell: providers, routing, layout
├── Layout.test.tsx                # layout shell: nav, sidebar, header
├── setup/                         # shared setup for cross-component tests
└── (other cross-component suites)
```

## Local Contracts

- Tests here may render the full `<App />` with providers — use sparingly (slower).
- For single-component tests, prefer colocating in the component's own `__tests__/` folder.

## Verification

```bash
cd ollama-orchestrator/frontend && npx vitest run src/__tests__/
```