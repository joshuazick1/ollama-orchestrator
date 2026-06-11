# tests/

Test suite root. Owns all test kinds, fixtures, and shared utilities for the backend. The frontend has its own test suite under [frontend/src/](../frontend/src/).

## Purpose

Verify every behavior contract owned by [src/AGENTS.md](../src/AGENTS.md). The test tree mirrors the source tree's domain concerns, not its file structure.

Layout:

- [unit/](unit/) — Vitest unit tests. One file per module under [src/](../src/). The vast majority of tests live here.
- [integration/](integration/) — Vitest integration tests using the live orchestrator and mocked upstream servers.
- [e2e/](e2e/) — Playwright end-to-end tests against the running orchestrator + frontend.
- [chaos/](chaos/) — Vitest chaos engineering tests, run with a separate config (`vitest.chaos.config.ts`).
- [performance/](performance/) — k6 load/soak/stress tests.
- [fixtures/](fixtures/) — Shared test data: factories, real Ollama responses.
- [utils/](utils/) — Shared test utilities: mock server factory, test helpers.
- [setup.ts](setup.ts) — Global Vitest setup. Loaded by all configs.

## Ownership

- Owns the verification side of every backend contract. A code change without a corresponding test update is incomplete unless the change is documented and reviewed.
- Mirrors domain concerns, not file paths. Tests for the load balancer live under [unit/](unit/) named `load-balancer.test.ts` (and `load-balancer-weights.test.ts`, etc.), not under any subfolder.
- The frontend test suite is owned by [frontend/src/](../frontend/src/) (see [frontend/AGENTS.md](../frontend/AGENTS.md)).

## Local Contracts

- Vitest is the test runner. Unit and integration share the default `vitest.config.ts`; chaos tests use `vitest.chaos.config.ts`; Playwright uses [playwright.config.ts](../playwright.config.ts).
- Each test file must reset the relevant singletons (config manager, metrics aggregator, in-flight manager, orchestrator instance) in `beforeEach`/`afterEach` to avoid cross-test pollution.
- Test helpers and mock servers live in [utils/](utils/) and [fixtures/](fixtures/). New helpers belong there, not inlined into a single test.
- The mock Ollama server in [e2e/mock-ollama-server.ts](e2e/mock-ollama-server.ts) is the canonical mock for end-to-end tests; use it (or extend it) rather than introducing a parallel mock.

## Work Guidance

- New backend module under [src/](../src/): add a `*.test.ts` next to its test-area peer (most often [unit/](unit/)) and, if it has integration surface, an integration test under [integration/](integration/).
- New behavior contract (e.g. new scoring factor in the load balancer): add a unit test that exercises the factor, an integration test that exercises it under real request flow, and a chaos test if it interacts with failures.
- New HTTP endpoint: add an integration test that hits the endpoint via the live orchestrator (the patterns in [integration/api.test.ts](integration/api.test.ts) and [integration/api-edge-cases.test.ts](integration/api-edge-cases.test.ts) are the templates).
- New configuration option: add coverage in the config unit tests and an integration test that exercises the hot-reload path.
- Reuse fixtures from [fixtures/](fixtures/); do not redefine Ollama response shapes inline.

## Verification

- `npm run test:unit` — Vitest unit suite.
- `npm run test:integration` — Vitest integration suite.
- `npm run test:chaos` — Vitest chaos suite.
- `npm run test:coverage` — Vitest with coverage.
- `npm run test:e2e` — Playwright e2e suite.
- `npm run test:performance` — k6 performance suite.
- `npm run test:load` / `npm run test:load:quick` / `npm run test:load:spike` / `npm run test:load:full` — TS load tests under [scripts/](../scripts/).
- `npm run test:circuit-breaker` — Circuit-breaker dedicated load test.
- CI runs lint, format, typecheck, and test on push and PR (see [../.github/workflows/ci.yml](../.github/workflows/ci.yml)).

## Child DOX Index

This folder has no further child docs. Subdirectories ([unit/](unit/), [integration/](integration/), [e2e/](e2e/), [chaos/](chaos/), [performance/](performance/), [fixtures/](fixtures/), [utils/](utils/)) are siblings under this doc; their scope is described above.
