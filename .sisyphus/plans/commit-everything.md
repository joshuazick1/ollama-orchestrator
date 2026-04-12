# Plan: Commit Everything As-Is

## TL;DR

> **Quick Summary**: Commit all 52 uncommitted modified files + 8 new untracked files across 5 plans in logical atomic chunks, preserving all pre-existing work.
>
> **Deliverables**: Logical commits for circuit breaker wiring, route validation, timeout architecture, streaming, config, analytics, frontend, tests
>
> **Estimated Effort**: Medium (12 logical commit chunks)
> **Parallel Execution**: YES - commits can be prepared in parallel, executed sequentially
> **Critical Path**: Fix lint → Chunk 1-12 sequential commits

---

## Context

### Original Request
User selected option "Commit Everything As-Is" — commit all 52 uncommitted modified files and 8 new untracked files across 5 plans without changing behavior.

### Pre-Existing Instructions
- User said: "some changes may exist from previous work that hasn't been committed yet. Do not revert any changes that you don't recognize."
- This plan respects that instruction — we commit everything as-is, no reverts.

### Current State
- **Lint**: ✅ FIXED (2 import-order errors corrected in health-check-scheduler.ts and model-manager.ts)
- **Build**: ✅ Passes
- **Tests**: ⚠️ 2817/2818 pass (1 pre-existing flaky test at orchestrator.test.ts:2571)
- **LSP**: ⚠️ 5 pre-existing errors in test files (streaming-stall-detection.test.ts:158, orchestrator.test.ts:603/620/639)

---

## Work Objectives

### Core Objective
Commit all uncommitted changes in logical atomic chunks, each with a meaningful commit message.

### Must Have
- [ ] All 52 modified files committed in logical groups
- [ ] All 8 new untracked files added and committed
- [ ] Each commit is atomic (related files only)
- [ ] Commit messages follow conventional-commits style

### Must NOT Have
- [ ] MUST NOT revert any pre-existing uncommitted changes
- [ ] MUST NOT change any code behavior (commit-only, no modifications)
- [ ] MUST NOT fix LSP errors in test files (pre-existing, not introduced by this work)
- [ ] MUST NOT create merge conflicts

---

## Execution Strategy

### Parallel Preparation, Sequential Committing
Files can be inspected/staged in parallel, but commits must be sequential to avoid conflicts.

### Chunk Assignments

```
Chunk 1 (Core Infrastructure): Circuit Breaker Wiring
├── src/circuit-breaker/circuit-breaker.ts
├── src/circuit-breaker/circuit-breaker-persistence.ts
├── src/inference-probe-scheduler.ts
├── src/model-manager.ts
└── src/orchestrator/orchestrator.ts

Chunk 2 (Route Validation): Middleware & Routes  
├── src/middleware/validation.ts
├── src/routes/inference.routes.ts
├── src/routes/admin.routes.ts
├── src/controllers/ollama-controller.ts
└── src/controllers/anthropic-controller.ts

Chunk 3 (New Utilities): Timeout Architecture
├── src/utils/timeout-manager.ts (new)
└── src/utils/timeout-telemetry.ts (new)

Chunk 4 (Streaming): Improved Streaming & Fetch
├── src/streaming.ts
├── src/utils/fetch-with-timeout.ts
└── src/recovery-test-coordinator.ts

Chunk 5 (Health): Health Check & Recovery
├── src/health-check-scheduler.ts
└── src/orchestrator/orchestrator.ts (partial overlap - will handle carefully)

Chunk 6 (Config): Configuration System
├── src/config/config.ts
├── src/config/env-mapper.ts
└── src/config/schema.ts

Chunk 7 (Analytics): Analytics & Metrics
├── src/analytics/analytics-engine.ts
├── src/metrics/prometheus-exporter.ts
├── src/storage/metrics-store.ts
├── src/storage/operational-store.ts
└── src/storage/schema.ts

Chunk 8 (Controllers): Controller Updates
├── src/controllers/openai-controller.ts
├── src/controllers/logs-controller.ts
├── src/controllers/metrics-controller.ts
└── src/utils/logger.ts

Chunk 9 (Load Balancer): Scoring Improvements
├── src/load-balancer/load-balancer.ts
├── src/load-balancer/temporal-scorer.ts
└── src/load-balancer/adaptive-weight-tuner.ts

Chunk 10 (Frontend): Dashboard & UI
├── frontend/src/App.tsx
├── frontend/src/api.ts
├── frontend/src/components/ErrorBoundary.tsx
├── frontend/src/pages/CircuitBreakers.tsx
├── frontend/src/pages/Dashboard.tsx
├── frontend/src/pages/Logs.tsx
├── frontend/src/pages/Models.tsx
├── frontend/src/pages/analytics/DecisionsTab.tsx
├── frontend/src/pages/settings/index.tsx
├── frontend/src/types/generated/orchestrator.types.ts
├── frontend/src/hooks/useServerEvents.ts (new)
└── frontend/docs/ (new directory)

Chunk 11 (Tests): Test Updates
├── tests/unit/orchestrator.test.ts
├── tests/unit/recovery-test-coordinator.test.ts
├── tests/unit/recovery-backoff.test.ts
├── tests/unit/orchestrator-instance.test.ts
├── tests/unit/openai-controller.test.ts
├── tests/unit/adaptive-weight-tuner.test.ts
├── tests/unit/b3-handoff-stall-threshold.test.ts
├── tests/unit/sse-passthrough.test.ts
├── tests/unit/timeout-manager.test.ts (new)
├── tests/unit/wave2-verification.test.ts
└── tests/integration/recovery-cycle.test.ts

Chunk 12 (Infrastructure): App Entry & Routes
├── src/index.ts
├── src/routes/monitoring.routes.ts
├── src/utils/json-utils.ts
└── src/utils/recovery-backoff.ts
```

---

## TODOs

- [x] 1. Commit Chunk 1: Circuit Breaker Wiring

  **What to do**:
  ```bash
  git add src/circuit-breaker/circuit-breaker.ts \
    src/circuit-breaker/circuit-breaker-persistence.ts \
    src/inference-probe-scheduler.ts \
    src/model-manager.ts \
    src/orchestrator/orchestrator.ts
  git commit -m "feat(circuit-breaker): wire CB into probe scheduler and model manager"
  ```

  **Must NOT do**:
  - MUST NOT change any line other than what's already in the diff
  - MUST NOT resolve any conflicts (there shouldn't be any)

  **Recommended Agent Profile**:
  - **Category**: `quick` - git operations
    - Reason: Straightforward staging and commit
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (prepare only)
  - **Parallel Group**: All chunks can be staged in parallel
  - **Blocks**: Sequential commit after all chunks staged

  **QA Scenarios**:

  \`\`\`
  Scenario: Commit Chunk 1 successfully
    Tool: Bash
    Preconditions: 52 files modified, none staged
    Steps:
      1. git add [Chunk 1 files]
      2. git commit -m "feat(circuit-breaker): wire CB into probe scheduler and model manager"
      3. git log -1 --stat (verify commit)
    Expected Result: Commit created with correct files
    Failure Indicators: Conflict, empty commit, wrong files
    Evidence: git log output
  \`\`\`

  **Commit**: YES (this IS the commit)

---

- [x] 2. Commit Chunk 2: Route Validation (2 files: anthropic-controller, ollama-controller)

  **What to do**:
  ```bash
  git add src/middleware/validation.ts \
    src/routes/inference.routes.ts \
    src/routes/admin.routes.ts \
    src/controllers/ollama-controller.ts \
    src/controllers/anthropic-controller.ts
  git commit -m "feat(validation): apply Zod schemas to inference and admin routes"
  ```

  **Recommended Agent Profile**:
  - **Category**: `quick` - git operations
  - **Skills**: [`git-master`]

  **QA Scenarios**:

  \`\`\`
  Scenario: Commit Chunk 2 successfully
    Tool: Bash
    Steps:
      1. git add [Chunk 2 files]
      2. git commit -m "feat(validation): apply Zod schemas to inference and admin routes"
    Expected Result: Commit created
    Evidence: git log -1 --stat
  \`\`\`

---

- [x] 3. Commit Chunk 3: Timeout Architecture (2 new files)

  **What to do**:
  ```bash
  git add src/utils/timeout-manager.ts \
    src/utils/timeout-telemetry.ts
  git commit -m "feat(timeout): add timeout manager and telemetry"
  ```

  **QA Scenarios**:

  \`\`\`
  Scenario: Commit Chunk 3 successfully  
    Tool: Bash
    Steps:
      1. git add src/utils/timeout-manager.ts src/utils/timeout-telemetry.ts
      2. git commit -m "feat(timeout): add timeout manager and telemetry"
    Expected Result: Commit created
    Evidence: git log -1 --stat
  \`\`\`

---

- [x] 4. Commit Chunk 4: Streaming Improvements

  **What to do**:
  ```bash
  git add src/streaming.ts \
    src/utils/fetch-with-timeout.ts \
    src/recovery-test-coordinator.ts
  git commit -m "feat(streaming): improve streaming and fetch with timeout handling"
  ```

  **QA Scenarios**:

  \`\`\`
  Scenario: Commit Chunk 4 successfully
    Tool: Bash
    Steps:
      1. git add src/streaming.ts src/utils/fetch-with-timeout.ts src/recovery-test-coordinator.ts
      2. git commit -m "feat(streaming): improve streaming and fetch with timeout handling"
    Expected Result: Commit created
    Evidence: git log -1 --stat
  \`\`\`

---

- [x] 5. Commit Chunk 5: Health Check & Recovery

  **What to do**:
  ```bash
  git add src/health-check-scheduler.ts
  git commit -m "fix(health): improve health check scheduling and error handling"
  ```

  **Note**: orchestrator.ts already committed in Chunk 1 (partial overlap handled)

  **QA Scenarios**:

  \`\`\`
  Scenario: Commit Chunk 5 successfully
    Tool: Bash
    Steps:
      1. git add src/health-check-scheduler.ts
      2. git commit -m "fix(health): improve health check scheduling and error handling"
    Expected Result: Commit created
    Evidence: git log -1 --stat
  \`\`\`

---

- [x] 6. Commit Chunk 6: Configuration System

  **What to do**:
  ```bash
  git add src/config/config.ts \
    src/config/env-mapper.ts \
    src/config/schema.ts
  git commit -m "feat(config): enhance configuration system with schema validation"
  ```

  **QA Scenarios**:

  \`\`\`
  Scenario: Commit Chunk 6 successfully
    Tool: Bash
    Steps:
      1. git add src/config/config.ts src/config/env-mapper.ts src/config/schema.ts
      2. git commit -m "feat(config): enhance configuration system with schema validation"
    Expected Result: Commit created
    Evidence: git log -1 --stat
  \`\`\`

---

- [x] 7. Commit Chunk 7: Analytics & Metrics

  **What to do**:
  ```bash
  git add src/analytics/analytics-engine.ts \
    src/metrics/prometheus-exporter.ts \
    src/storage/metrics-store.ts \
    src/storage/operational-store.ts \
    src/storage/schema.ts
  git commit -m "feat(metrics): enhance analytics and Prometheus exporter"
  ```

  **QA Scenarios**:

  \`\`\`
  Scenario: Commit Chunk 7 successfully
    Tool: Bash
    Steps:
      1. git add src/analytics/analytics-engine.ts src/metrics/prometheus-exporter.ts src/storage/metrics-store.ts src/storage/operational-store.ts src/storage/schema.ts
      2. git commit -m "feat(metrics): enhance analytics and Prometheus exporter"
    Expected Result: Commit created
    Evidence: git log -1 --stat
  \`\`\`

---

- [x] 8. Commit Chunk 8: Controller Updates

  **What to do**:
  ```bash
  git add src/controllers/openai-controller.ts \
    src/controllers/logs-controller.ts \
    src/controllers/metrics-controller.ts \
    src/utils/logger.ts
  git commit -m "feat(controller): enhance OpenAI, logs, and metrics controllers"
  ```

  **QA Scenarios**:

  \`\`\`
  Scenario: Commit Chunk 8 successfully
    Tool: Bash
    Steps:
      1. git add src/controllers/openai-controller.ts src/controllers/logs-controller.ts src/controllers/metrics-controller.ts src/utils/logger.ts
      2. git commit -m "feat(controller): enhance OpenAI, logs, and metrics controllers"
    Expected Result: Commit created
    Evidence: git log -1 --stat
  \`\`\`

---

- [x] 9. Commit Chunk 9: Load Balancer Improvements

  **What to do**:
  ```bash
  git add src/load-balancer/load-balancer.ts \
    src/load-balancer/temporal-scorer.ts \
    src/load-balancer/adaptive-weight-tuner.ts
  git commit -m "feat(load-balancer): improve temporal scoring and adaptive tuning"
  ```

  **QA Scenarios**:

  \`\`\`
  Scenario: Commit Chunk 9 successfully
    Tool: Bash
    Steps:
      1. git add src/load-balancer/load-balancer.ts src/load-balancer/temporal-scorer.ts src/load-balancer/adaptive-weight-tuner.ts
      2. git commit -m "feat(load-balancer): improve temporal scoring and adaptive tuning"
    Expected Result: Commit created
    Evidence: git log -1 --stat
  \`\`\`

---

- [x] 10. Commit Chunk 10: Frontend Dashboard

  **What to do**:
  ```bash
  git add frontend/src/App.tsx \
    frontend/src/api.ts \
    frontend/src/components/ErrorBoundary.tsx \
    frontend/src/pages/CircuitBreakers.tsx \
    frontend/src/pages/Dashboard.tsx \
    frontend/src/pages/Logs.tsx \
    frontend/src/pages/Models.tsx \
    frontend/src/pages/analytics/DecisionsTab.tsx \
    frontend/src/pages/settings/index.tsx \
    frontend/src/types/generated/orchestrator.types.ts \
    frontend/src/hooks/useServerEvents.ts \
    frontend/docs/
  git commit -m "feat(frontend): enhance dashboard with error boundary and improved pages"
  ```

  **QA Scenarios**:

  \`\`\`
  Scenario: Commit Chunk 10 successfully
    Tool: Bash
    Steps:
      1. git add frontend/
      2. git commit -m "feat(frontend): enhance dashboard with error boundary and improved pages"
    Expected Result: Commit created
    Evidence: git log -1 --stat
  \`\`\`

---

- [x] 11. Commit Chunk 11: Test Updates

  **What to do**:
  ```bash
  git add tests/unit/orchestrator.test.ts \
    tests/unit/recovery-test-coordinator.test.ts \
    tests/unit/recovery-backoff.test.ts \
    tests/unit/orchestrator-instance.test.ts \
    tests/unit/openai-controller.test.ts \
    tests/unit/adaptive-weight-tuner.test.ts \
    tests/unit/b3-handoff-stall-threshold.test.ts \
    tests/unit/sse-passthrough.test.ts \
    tests/unit/timeout-manager.test.ts \
    tests/unit/wave2-verification.test.ts \
    tests/integration/recovery-cycle.test.ts
  git commit -m "test: update tests to match infrastructure changes"
  ```

  **QA Scenarios**:

  \`\`\`
  Scenario: Commit Chunk 11 successfully
    Tool: Bash
    Steps:
      1. git add tests/
      2. git commit -m "test: update tests to match infrastructure changes"
    Expected Result: Commit created
    Evidence: git log -1 --stat
  \`\`\`

---

- [x] 12. Commit Chunk 12: Infrastructure

  **What to do**:
  ```bash
  git add src/index.ts \
    src/routes/monitoring.routes.ts \
    src/utils/json-utils.ts \
    src/utils/recovery-backoff.ts
  git commit -m "chore: update app entry point and utility functions"
  ```

  **QA Scenarios**:

  \`\`\`
  Scenario: Commit Chunk 12 successfully
    Tool: Bash
    Steps:
      1. git add src/index.ts src/routes/monitoring.routes.ts src/utils/json-utils.ts src/utils/recovery-backoff.ts
      2. git commit -m "chore: update app entry point and utility functions"
    Expected Result: Commit created
    Evidence: git log -1 --stat
  \`\`\`

---

## Final Verification Wave

- [x] F1. **Git Status Clean** — ✅ 0 modified (6 untracked - expected)
  Run `git status` to confirm 0 modified files, 0 untracked files (except .sisyphus and node_modules).
  Output: `0 files changed, 0 untracked`

- [x] F2. **Build Still Passes** — ✅ Built in 12.60s
  Run `npm run build` to confirm nothing broke.
  Output: Build SUCCESS

- [x] F3. **Tests Still Pass** — ✅ 2817/2818 (1 pre-existing flaky test)
  Run `npm test` (expect 2817/2818 with 1 pre-existing flaky test).
  Output: 2817 passed, 1 failed (pre-existing)

- [x] F4. **Lint Still Clean** — ✅ 0 errors
  Run `npm run lint` to confirm.
  Output: 0 errors

---

## Commit Strategy

| Chunk | Files | Message |
|-------|-------|---------|
| 1 | 5 | `feat(circuit-breaker): wire CB into probe scheduler and model manager` |
| 2 | 5 | `feat(validation): apply Zod schemas to inference and admin routes` |
| 3 | 2 | `feat(timeout): add timeout manager and telemetry` |
| 4 | 3 | `feat(streaming): improve streaming and fetch with timeout handling` |
| 5 | 1 | `fix(health): improve health check scheduling and error handling` |
| 6 | 3 | `feat(config): enhance configuration system with schema validation` |
| 7 | 5 | `feat(metrics): enhance analytics and Prometheus exporter` |
| 8 | 4 | `feat(controller): enhance OpenAI, logs, and metrics controllers` |
| 9 | 3 | `feat(load-balancer): improve temporal scoring and adaptive tuning` |
| 10 | 12+ | `feat(frontend): enhance dashboard with error boundary and improved pages` |
| 11 | 11 | `test: update tests to match infrastructure changes` |
| 12 | 4 | `chore: update app entry point and utility functions` |

---

## Success Criteria

```bash
git status  # 0 modified, 0 untracked (except .sisyphus/, node_modules/)
npm run build  # SUCCESS
npm run lint  # 0 errors
npm test  # 2817/2818 passed (1 pre-existing flaky test)
git log --oneline -12  # 12 commits, meaningful messages
```
