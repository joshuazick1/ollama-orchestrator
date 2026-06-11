# docs/

Long-form design docs, audits, runbooks, and reference material. Not user-facing README docs (those live at the repo root: `README.md`, `CHANGES.md`, `CONTRIBUTING.md`, `LICENSE`).

## Purpose

Capture the design history, audits, and operational reference material for the orchestrator. The README is the entry point for users; this folder is the entry point for engineers and operators who need depth.

Files of record (indexed by topic):

**User & operator guides**

- [API.md](API.md) — API reference (consumed by both backend and frontend).
- [DEPLOYMENT.md](DEPLOYMENT.md) — Production deployment guide.
- [OPERATIONS.md](OPERATIONS.md) — Day-2 operations: monitoring, recovery, common tasks.
- [EXAMPLES.md](EXAMPLES.md) — Usage examples (curl, OpenAI client, Anthropic client).
- [ERROR-EVENT-SCHEMA.md](ERROR-EVENT-SCHEMA.md) — Authoritative contract for the `ErrorEvent` type. Pair with [src/types/error-event.ts](../src/types/error-event.ts).

**Design docs (live alongside DESIGN-\*.md at the repo root)**

- [DESIGN-anthropic.md](../DESIGN-anthropic.md), [DESIGN-context-window.md](../DESIGN-context-window.md), [DESIGN-long-term-metrics.md](../DESIGN-long-term-metrics.md) — repo-root design docs for the Anthropic proxy, context window management, and long-term metrics. (Some DESIGN-\*.md docs also live at the repo root; the two locations are equivalent.)
- [DESIGN-backend-metrics-centralization.md](DESIGN-backend-metrics-centralization.md), [DESIGN-ban-manager.md](DESIGN-ban-manager.md), [DESIGN-code-consolidation.md](DESIGN-code-consolidation.md), [DESIGN-code-review-findings.md](DESIGN-code-review-findings.md), [DESIGN-frontend-streaming-metrics.md](DESIGN-frontend-streaming-metrics.md), [DESIGN-in-flight-manager.md](DESIGN-in-flight-manager.md), [DESIGN-model-aggregator.md](DESIGN-model-aggregator.md), [DESIGN-openai-servers.md](DESIGN-openai-servers.md), [DESIGN-recovery-testing.md](DESIGN-recovery-testing.md), [DESIGN-resilience-timeout-circuitbreaker.md](DESIGN-resilience-timeout-circuitbreaker.md), [DESIGN-settings-enhancement.md](DESIGN-settings-enhancement.md), [DESIGN-stall-detection-and-handoff-review.md](DESIGN-stall-detection-and-handoff-review.md), [DESIGN-streaming-chunk-tracking.md](DESIGN-streaming-chunk-tracking.md), [DESIGN-streaming.md](DESIGN-streaming.md), [DESIGN-timeout-management.md](DESIGN-timeout-management.md) — Subsystem design docs.

**Audits & reviews**

- [ACTIVE-TESTING-TIMEOUT-ANALYSIS.md](ACTIVE-TESTING-TIMEOUT-ANALYSIS.md), [AUDIT-IMPLEMENTATION-PLAN.md](AUDIT-IMPLEMENTATION-PLAN.md), [CIRCUIT-BREAKER-REVIEW.md](CIRCUIT-BREAKER-REVIEW.md), [CIRCUIT-BREAKER-REVIEW-2026-04-06.md](CIRCUIT-BREAKER-REVIEW-2026-04-06.md), [CODEBASE-AUDIT-2026-04-01.md](CODEBASE-AUDIT-2026-04-01.md), [LOAD-BALANCER-ANALYSIS.md](LOAD-BALANCER-ANALYSIS.md), [TIMEOUT-ARCHITECTURE-AUDIT-2026-04-07.md](TIMEOUT-ARCHITECTURE-AUDIT-2026-04-07.md), [TIMEOUT-TUNING-TELEMETRY-PLAN.md](TIMEOUT-TUNING-TELEMETRY-PLAN.md) — Cross-cutting audits and reviews.

**Implementation plans**

- [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md), [OPENAI-SUPPORT-IMPLEMENTATION.md](OPENAI-SUPPORT-IMPLEMENTATION.md) — Multi-phase implementation plans.

## Ownership

- Owns long-form reference material. The README is the entry point; this folder is the depth.
- New design docs land here (or at the repo root as `DESIGN-*.md`, matching the existing pattern).
- Audits and reviews live here.

## Local Contracts

- Operator guides (DEPLOYMENT, OPERATIONS, API, EXAMPLES) are the only docs that may need to be updated when public behavior changes. Implementation plans, audits, and design docs are historical; do not retroactively rewrite them.
- The `ErrorEvent` schema in [ERROR-EVENT-SCHEMA.md](ERROR-EVENT-SCHEMA.md) is the authoritative contract for the type. The TypeScript shape in [src/types/error-event.ts](../src/types/error-event.ts) must match.

## Work Guidance

- Public behavior change: update the README, the relevant operator guide in this folder, and the matching `*.ts` type/contract.
- New design doc: place it in this folder (preferred) or at the repo root with a `DESIGN-` prefix. Link it from the relevant [src/](../src/) or [tests/](../tests/) AGENTS.md doc.
- Historical audits and plans: append to them or add a new dated file rather than rewriting.

## Verification

- Operator guides (DEPLOYMENT, OPERATIONS, API, EXAMPLES) are validated by the [tests/](../tests/) suite at the protocol level (the docs describe behavior; the tests enforce it).
- The `ErrorEvent` schema is validated by [tests/unit/error-event-store.test.ts](../tests/unit/error-event-store.test.ts) and [tests/unit/error-events-controller.test.ts](../tests/unit/error-events-controller.test.ts).
- No build step is required for docs in this folder.

## Child DOX Index

This folder has no further child docs. Files in this folder are siblings under this doc; their scope is described above.
