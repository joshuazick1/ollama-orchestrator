# src/circuit-breaker/

Legacy compatibility shim. NOT a durable boundary.

## Purpose

Provides the `CircuitBreaker` and `CircuitBreakerRegistry` exports that previously lived here before the probe refactor (commit 5ac7b09). The actual circuit-breaker state machine now lives in [src/probe/](../probe/AGENTS.md). This directory exists only to satisfy existing test imports that reference the old path.

## Ownership

- Owns: the single file [circuit-breaker.ts](circuit-breaker.ts).
- Does NOT own: any state machine, recovery logic, or breaker configuration. Those live in [src/probe/](../probe/AGENTS.md).

## Local Contracts

- Re-exports `CircuitState`, `CircuitBreakerStats`, `CircuitBreaker`, and `CircuitBreakerRegistry` symbols.
- Backed by `ErrorClassifier` in [src/utils/](../utils/AGENTS.md). Behavior is read-only passthrough.

## Work Guidance

- Do not add new circuit-breaker logic here. Add it to [src/probe/](../probe/AGENTS.md) instead.
- If a new test or caller references the old path, prefer updating them to import from `src/probe/` directly.
- Remove this directory once all callers migrate.

## Verification

- Type check: `npx tsc --noEmit` (must remain clean).
- Test suites under `tests/chaos/circuit-breaker-chaos.test.ts` and `tests/integration/probe-state-machine.test.ts` exercise the live behavior; both import from `src/probe/`.

## Child DOX Index

None. This directory owns no further subdomains.
