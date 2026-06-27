# Audit Remediation Implementation Plan

**Date:** 2026-04-01
**Source:** [Codebase Audit Report](./CODEBASE-AUDIT-2026-04-01.md)
**Covers:** 37 findings across 6 waves
**Status:** Ready for Execution

---

## Table of Contents

1. [Overview](#1-overview)
2. [Branch & PR Strategy](#2-branch--pr-strategy)
3. [Testing Gate Protocol](#3-testing-gate-protocol)
4. [Dependency Graph](#4-dependency-graph)
5. [Wave 0: Quick Wins & Documentation](#5-wave-0-quick-wins--documentation)
6. [Wave 1: Security Hardening](#6-wave-1-security-hardening)
7. [Wave 2: Error Handling & Observability](#7-wave-2-error-handling--observability)
8. [Wave 3: Infrastructure & CI/CD](#8-wave-3-infrastructure--cicd)
9. [Wave 4: Code Consistency & Structure](#9-wave-4-code-consistency--structure)
10. [Wave 5: Frontend Integration & Testing](#10-wave-5-frontend-integration--testing)
11. [Execution Timeline](#11-execution-timeline)
12. [Risk Register](#12-risk-register)
13. [Rollback Strategy](#13-rollback-strategy)

---

## 1. Overview

This plan outlines the systematic resolution of 37 findings identified in the April 2026 codebase audit. The remediation is structured into 6 logical waves to minimize disruption and ensure stable delivery of security and architectural improvements.

- **Total Findings:** 37
- **Waves:** 6
- **Primary Focus Areas:** Security, Error Handling, Code Consistency, Frontend-Backend Integration, Test Coverage, Documentation

### Effort Summary

| Wave | Theme                          | Estimated Effort |
| ---- | ------------------------------ | ---------------- |
| 0    | Quick Wins & Documentation     | 1-2 hours        |
| 1    | Security Hardening             | 3-4 hours        |
| 2    | Error Handling & Observability | 4-6 hours        |
| 3    | Infrastructure & CI/CD         | 2-3 hours        |
| 4    | Code Consistency & Structure   | 6-8 hours        |
| 5    | Frontend Integration & Testing | 8-12 hours       |

---

## 2. Branch & PR Strategy

### 2.1 Branch Naming Convention

```
audit/wave-<N>-<short-description>
```

### 2.2 PR Workflow Per Wave

Each wave is a single PR to `main`. The workflow for each:

1. Create branch from latest main
   ```bash
   git checkout main && git pull origin main
   git checkout -b audit/wave-<N>-<description>
   ```
2. Implement changes following the wave checklist.
3. Run local validation before push (see [Testing Gate Protocol](#3-testing-gate-protocol)).
4. Commit with conventional commits (enforced by `.commitlintrc.js`).
5. Push and open PR

   ```bash
   git push -u origin audit/wave-<N>-<description>
   gh pr create --title "fix(audit): wave N - <description>" --body "$(cat <<'EOF'
   ## Summary
   Resolution of findings in Wave N.

   ## Findings Covered
   - ID-X: Description
   - ID-Y: Description
   EOF
   )"
   ```

6. CI runs automatically (lint, typecheck, unit tests, integration tests).
7. After merge, tag if completing a milestone wave.

### 2.3 Commit Conventions

| Change Type          | Commit Prefix      | Example                                       |
| -------------------- | ------------------ | --------------------------------------------- |
| Bug fix (production) | `fix(scope):`      | `fix(security): remove query param api key`   |
| New feature          | `feat(scope):`     | `feat(frontend): add queue management page`   |
| Documentation        | `docs(scope):`     | `docs(readme): fix node version mismatch`     |
| Refactoring          | `refactor(scope):` | `refactor(structure): move orchestrator core` |
| Testing              | `test(scope):`     | `test(queue): add controller unit tests`      |
| Build/CI             | `ci(scope):`       | `ci(docker): add trivy scanning`              |
| Maintenance          | `chore(scope):`    | `chore(config): update env example`           |

### 2.4 Tagging Strategy

| Tag           | When                 | Trigger |
| ------------- | -------------------- | ------- |
| `v1.1.0-rc.1` | After Wave 0+1 merge | Manual  |
| `v1.1.0-rc.2` | After Wave 2+3 merge | Manual  |
| `v1.1.0`      | After Wave 4+5 merge | Manual  |

---

## 3. Testing Gate Protocol

Every task must pass the following gates before being considered complete.

| Gate | Action                          | Pass Criteria  |
| ---- | ------------------------------- | -------------- |
| G1   | `npm run typecheck`             | No type errors |
| G2   | `npm run lint:fix`              | No lint errors |
| G3   | `npm run test:unit -- --silent` | All tests pass |
| G4   | `npm run test:integration`      | All tests pass |

**CRITICAL:** Do NOT proceed to next task if any gate fails.

---

## 4. Dependency Graph

```
Wave 0 (Quick Wins) ──────────┐
      (Parallel)              │
Wave 1 (Security) ───────────┐│
      │                      ││
      ▼                      ││
Wave 2 (Error Handling)      ││
      │                      ││
      ▼                      │▼
Wave 4 (Code Consistency) ◄──Wave 3 (Infrastructure)
      │
      ▼
Wave 5 (Frontend/Tests)
```

- Waves 0 and 1 can run in parallel.
- Wave 2 depends on Wave 1 (Security middleware).
- Wave 3 depends on Wave 0 (Documentation/Config fixes).
- Wave 4 depends on Waves 2 + 3.
- Wave 5 depends on Wave 4 (New structure/Types).

---

## 5. Wave 0: Quick Wins & Documentation

| Summary      | Details                                                     |
| ------------ | ----------------------------------------------------------- |
| **Branch**   | `audit/wave-0-quick-wins`                                   |
| **Effort**   | 1-2 hours                                                   |
| **PR Title** | `fix(audit): wave 0 - quick wins and documentation fixes`   |
| **Findings** | E-1, E-6, C-4, S-2, D-1, D-2, D-3, D-4, D-5, T-10, F-6, F-7 |

### 5.1 Prerequisites

- None.

### 5.2 Implementation Checklist

1. [ ] **E-1: Global Error Handlers**
   - File: `src/index.ts`
   - Action: Add `unhandledRejection` and `uncaughtException` listeners.
   - Commit: `fix(error-handling): add global process error listeners`
2. [ ] **S-2: Secure API Key Extraction**
   - File: `src/middleware/auth.ts`
   - Action: Remove query parameter extraction. Only use headers.
   - Commit: `fix(security): remove api key extraction from query params`
3. [ ] **E-6: Logger Standardization**
   - File: `src/utils/json-utils.ts`
   - Action: Replace `console.error` with `logger.error`.
   - Commit: `fix(error-handling): use logger instead of console in json-utils`
4. [ ] **C-4: Cleanup Dead Directories**
   - Action: `rm -rf src/pages/`
   - Commit: `refactor(cleanup): remove orphaned pages directory`
5. [ ] **D-5: Version Sync**
   - File: `README.md`
   - Action: Update Node.js requirement to 20+.
   - Commit: `docs(readme): sync node version with package.json`
6. [ ] **D-3/T-10: Remove Ghost References**
   - Files: `README.md`, `docs/*.md`
   - Action: Remove all references to `intelligent-recovery-manager.ts`.
   - Commit: `docs(cleanup): remove references to non-existent recovery manager`
7. [ ] **F-6/F-7: Frontend Proxy Fixes**
   - File: `frontend/vite.config.ts`
   - Action: Make target URL configurable via `process.env.VITE_PROXY_TARGET`. Add `/health` to proxy.
   - Commit: `fix(frontend): improve vite proxy configuration`
8. [ ] **D-1/D-2: Sync README with Reality**
   - File: `README.md`
   - Action: Remove non-existent Queue endpoints and `Queue.tsx` from feature list.
   - Commit: `docs(readme): remove unimplemented queue features`
9. [ ] **D-4: Configuration Completeness**
   - File: `.env.example`
   - Action: Add missing environment variables based on `src/config/schema.ts`.
   - Commit: `docs(config): expand .env.example with all available variables`

### 5.3 Verification

- [ ] Verify `npm start` works without immediate crashes.
- [ ] Verify `/health` is accessible via frontend proxy.

### 5.4 Git Workflow

```bash
git checkout -b audit/wave-0-quick-wins
# ... changes ...
git add .
git commit -m "fix(audit): wave 0 implementation"
gh pr create --title "fix(audit): wave 0 - quick wins and documentation fixes" --body "Resolves 12 low-hanging fruit findings."
```

---

## 6. Wave 1: Security Hardening

| Summary      | Details                                   |
| ------------ | ----------------------------------------- |
| **Branch**   | `audit/wave-1-security-hardening`         |
| **Effort**   | 3-4 hours                                 |
| **PR Title** | `fix(audit): wave 1 - security hardening` |
| **Findings** | S-1, S-3, S-4, S-5, S-8, S-10, S-11, S-12 |

### 6.1 Prerequisites

- None.

### 6.2 Implementation Checklist

1. [ ] **S-1: Inference Rate Limiting (Critical)**
   - File: `src/middleware/rateLimiter.ts`, `src/index.ts`
   - Action: Create `createInferenceRateLimiter()` and apply to `/api` and `/v1`.
   - Code Example:
     ```typescript
     export const createInferenceRateLimiter = () =>
       rateLimit({
         windowMs: 15 * 60 * 1000,
         max: 100,
         message: { error: 'Too many inference requests' },
       });
     ```
   - Commit: `fix(security): implement rate limiting for inference endpoints`
2. [ ] **S-3: CORS Hardening**
   - File: `src/config/config.ts`
   - Action: Change `corsOrigins` default to `[]`.
   - Commit: `fix(security): change default cors origins to empty list`
3. [ ] **S-4: Auth Default Secure**
   - File: `.env.example`, `src/index.ts`
   - Action: Set `ORCHESTRATOR_ENABLE_AUTH` default to `true`. Add startup warning if `false`.
   - Commit: `fix(security): enable auth by default and add startup warning`
4. [ ] **S-5: CSP Nonce Support**
   - File: `src/index.ts`
   - Action: Implement nonce generation middleware. Update `helmet` config to use nonces.
   - Commit: `fix(security): implement nonce-based CSP to remove unsafe-inline`
5. [ ] **S-8: Enable HSTS**
   - File: `src/index.ts`
   - Action: Configure `hsts` in helmet: `{ maxAge: 31536000, includeSubDomains: true }`.
   - Commit: `fix(security): enable HSTS with 1 year max age`
6. [ ] **S-10: IP Restriction for Prometheus**
   - File: `src/index.ts`
   - Action: Wrap the Prometheus endpoint in the IP restriction middleware.
   - Commit: `fix(security): restrict prometheus metrics to internal IPs`
7. [ ] **S-11: Dependency Auditing**
   - File: `.github/workflows/release.yml`
   - Action: Add `npm audit --audit-level=high`.
   - Commit: `ci(security): add blocking npm audit to release workflow`
8. [ ] **S-12: Hot Reload Secrets**
   - File: `src/config/configManager.ts`
   - Action: Add listener for environment changes to re-read API keys.
   - Commit: `feat(security): implement hot-reloading for api keys`

### 6.3 Verification

- [ ] `curl -v localhost:5100/api/tags` returns 401 if no key provided.
- [ ] Response headers include `Strict-Transport-Security`.
- [ ] Response headers include `Content-Security-Policy` with a nonce.

### 6.4 Git Workflow

```bash
git checkout -b audit/wave-1-security-hardening
# ... changes ...
git add .
git commit -m "fix(security): wave 1 implementation"
gh pr create --title "fix(audit): wave 1 - security hardening" --body "Resolves 8 high-severity security findings."
```

---

## 7. Wave 2: Error Handling & Observability

| Summary      | Details                                                 |
| ------------ | ------------------------------------------------------- |
| **Branch**   | `audit/wave-2-error-handling`                           |
| **Effort**   | 4-6 hours                                               |
| **PR Title** | `fix(audit): wave 2 - error handling and observability` |
| **Findings** | E-2, E-3, E-4, E-5, E-7                                 |

### 7.1 Prerequisites

- Wave 1 merged.

### 7.2 Implementation Checklist

1. [ ] **E-2/E-3: Standardize Catch Blocks**
   - Action: Replace empty `catch {}` and `.catch(() => null)` with `logger.debug`.
   - Files to update:
     - `src/streaming.ts`
     - `src/analytics/analytics-engine.ts`
     - `src/health-check-scheduler.ts`
     - `src/orchestrator.ts`
   - Commit: `fix(error-handling): standardize silent error catching with debug logging`
2. [ ] **E-4: Domain-Specific Error Classes**
   - File: `src/utils/domain-errors.ts`
   - Action: Create specific classes.
   - Code Example:
     ```typescript
     export class OrchestratorError extends Error {
       constructor(
         message: string,
         public status: number = 500
       ) {
         super(message);
       }
     }
     export class ServerNotFoundError extends OrchestratorError {
       constructor(id: string) {
         super(`Server ${id} not found`, 404);
       }
     }
     ```
   - Commit: `refactor(error-handling): implement domain-specific error classes`
3. [ ] **E-5: Standardize Error Response (RFC 7807)**
   - File: `src/index.ts`, `src/utils/ollamaError.ts`
   - Action: Add `type` and `status` to internal API error responses.
   - Commit: `fix(error-handling): adopt RFC 7807 error format for internal routes`
4. [ ] **E-7: Controller Refactoring**
   - Action: Update `serversController.ts`, `modelController.ts` to use `getErrorMessage()`.
   - Commit: `refactor(error-handling): use error helpers in controllers`

### 7.3 Verification

- [ ] Trigger 404 error and verify JSON response contains `type` and `status`.
- [ ] Verify logs show debug messages for transient failures.

---

## 8. Wave 3: Infrastructure & CI/CD

| Summary      | Details                                                  |
| ------------ | -------------------------------------------------------- |
| **Branch**   | `audit/wave-3-infrastructure`                            |
| **Effort**   | 2-3 hours                                                |
| **PR Title** | `ci(audit): wave 3 - infrastructure and CI/CD hardening` |
| **Findings** | S-6, S-7, S-9                                            |

### 8.1 Prerequisites

- Wave 0 merged.

### 8.2 Implementation Checklist

1. [ ] **S-6: Hardened Grafana Credentials**
   - File: `docker-compose.prod.yml`
   - Action: Remove default password fallback. Add startup check script to `scripts/verify-env.sh`.
   - Commit: `ci(docker): enforce grafana admin password in production`
2. [ ] **S-7: Network Isolation**
   - File: `docker-compose.prod.yml`
   - Action: Define `frontend`, `backend`, and `monitoring` networks.
   - Commit: `ci(docker): implement tiered network isolation`
3. [ ] **S-9: Container Scanning**
   - File: `.github/workflows/docker-build.yml`
   - Action: Add Trivy scanning step.
   - Code Example:
     ```yaml
     - name: Run Trivy vulnerability scanner
       uses: aquasecurity/trivy-action@master
       with:
         image-ref: 'ollama-orchestrator:${{ github.sha }}'
         format: 'table'
         exit-code: '1'
         ignore-unfixed: true
         severity: 'CRITICAL,HIGH'
     ```
   - Commit: `ci(security): add trivy image scanning to build pipeline`

### 8.3 Verification

- [ ] Run `docker-compose -f docker-compose.prod.yml config` to verify network structure.

---

## 9. Wave 4: Code Consistency & Structure

| Summary      | Details                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| **Branch**   | `audit/wave-4-code-consistency`                                            |
| **Effort**   | 6-8 hours                                                                  |
| **PR Title** | `refactor(audit): wave 4 - code consistency and structural reorganization` |
| **Findings** | C-1, C-2, C-3, C-5, C-6, C-7, C-8                                          |

### 9.1 Prerequisites

- Wave 2 and Wave 3 merged.

### 9.2 Implementation Checklist

1. [ ] **C-1: Singleton Standardization**
   - Action: Migrate `*-instance.ts` to `get*()` pattern. Update all imports.
   - Commit: `refactor(structure): standardize on getSingleton() pattern`
2. [ ] **C-2/C-3: Project Reorganization**
   - Action: `git mv` core logic to subdirectories.
   - Table of Moves:
     | Current Path | New Path |
     |--------------|----------|
     | `src/orchestrator.ts` | `src/orchestrator/orchestrator.ts` |
     | `src/circuit-breaker.ts` | `src/circuit-breaker/circuit-breaker.ts` |
     | `src/load-balancer.ts` | `src/load-balancer/load-balancer.ts` |
   - Commit: `refactor(structure): migrate core logic to domain-specific directories`
3. [ ] **C-6: Split Routes**
   - Action: Split `src/routes/orchestrator.ts` into `admin.routes.ts`, `monitoring.routes.ts`, `inference.routes.ts`.
   - Commit: `refactor(routes): decompose monolithic route registration`
4. [ ] **C-5: Centralize API Types**
   - File: `src/types/api-request.types.ts`
   - Action: Move inline controller types here.
   - Commit: `refactor(types): centralize api request/response definitions`
5. [ ] **C-7/C-8: Naming & Export Polish**
   - Action: `git mv` files to kebab-case. Switch to named exports.
   - Commit: `style(cleanup): enforce kebab-case and named exports`

### 9.3 Verification

- [ ] `npm run typecheck` must pass without errors (critical after large move).
- [ ] `npm run test:unit` must pass.

---

## 10. Wave 5: Frontend Integration & Testing

| Summary      | Details                                                              |
| ------------ | -------------------------------------------------------------------- |
| **Branch**   | `audit/wave-5-frontend-testing`                                      |
| **Effort**   | 8-12 hours                                                           |
| **PR Title** | `feat(audit): wave 5 - frontend integration and test coverage`       |
| **Findings** | F-1, F-2, F-3, F-4, F-5, T-1, T-2, T-3, T-4, T-5, T-6, T-7, T-8, T-9 |

### 10.1 Prerequisites

- Wave 4 merged.

### 10.2 Implementation Checklist

1. [ ] **F-1: Type Synchronization**
   - Action: Create `scripts/sync-types.sh` to copy `src/types/*.ts` to `frontend/src/types/`. Add to `package.json` pre-build.
   - Commit: `chore(types): implement automated type synchronization`
2. [ ] **F-2/F-3: Queue Management**
   - Action: Implement `frontend/src/pages/Queue.tsx` and endpoints in `queueController.ts`.
   - Commit: `feat(queue): implement queue management UI and backend control`
3. [ ] **F-5: SSE Wrapper**
   - File: `frontend/src/utils/stream-fetch.ts`
   - Action: Create unified fetch wrapper for streaming.
   - Commit: `refactor(frontend): implement streamFetch helper for sse`
4. [ ] **T-1/T-3: Frontend Test Suite**
   - Action: Setup Vitest + RTL + MSW in `frontend/`. Add tests for `Models.tsx`.
   - Commit: `test(frontend): add integration tests for critical pages`
5. [ ] **T-2/T-4: Backend Test Gaps**
   - Action: Create `tests/unit/queue-controller.test.ts` and `tests/unit/circuit-breaker-persistence.test.ts`.
   - Commit: `test(backend): bridge coverage gaps for queue and cb persistence`
6. [ ] **T-5/T-6/T-7: Coverage Hardening**
   - File: `vitest.config.ts`
   - Action: Set thresholds to 70%. Include `src/index.ts`. Add reporters to integration config.
   - Commit: `chore(test): raise coverage thresholds and include entry points`
7. [ ] **T-9: Integration Decoupling**
   - File: `tests/integration/client-metrics.test.ts`
   - Action: Use `supertest` instead of importing frontend code.
   - Commit: `test(integration): decouple backend tests from frontend code`

---

## 11. Execution Timeline

| Wave | Milestone      | Est. Date | Milestone Tag |
| ---- | -------------- | --------- | ------------- |
| 0    | Quick Wins     | Day 1     | -             |
| 1    | Security       | Day 2     | `v1.1.0-rc.1` |
| 2    | Error Handling | Day 3     | -             |
| 3    | Infrastructure | Day 4     | `v1.1.0-rc.2` |
| 4    | Structure      | Day 6     | -             |
| 5    | Frontend/Tests | Day 10    | `v1.1.0`      |

---

## 12. Risk Register

| Risk                         | Impact | Mitigation                                                               |
| ---------------------------- | ------ | ------------------------------------------------------------------------ |
| Wave 4 import breakage       | High   | Run `typecheck` after every single `git mv`.                             |
| Wave 1 auth breaking clients | High   | Communicate API key requirement; provide 24h overlap window if possible. |
| Test coverage regression     | Medium | Enforce "no coverage decrease" rule in CI.                               |

---

## 13. Rollback Strategy

Each wave is contained within a single Pull Request. In the event of a critical failure:

1. Revert the merge commit on the `main` branch.
2. Tag the revert with `v1.x.x-fix`.
3. Fix the issue in the wave branch and re-submit.
