# Plan: Fix 2 Remaining Test Issues

## TL;DR

Fix 2 pre-existing test issues:
1. **prometheus-exporter.ts**: Add missing TYPE/HELP declarations for 3 metrics
2. **orchestrator.test.ts**: Fix flaky test by adding proper isolation/cleanup

**Estimated Effort**: Small (2 straightforward fixes)
**Parallel Execution**: NO - sequential (T2 depends on understanding from T1 research)
**Tests**: 2818 total → 2818 passing after fixes

---

## Context

After fixing 12 of 14 failing tests, 2 remain:

### Issue 1: prometheus-exporter.test.ts
- Test expects TYPE/HELP declarations for `orchestrator_success_rate`, `orchestrator_throughput_per_min`, `orchestrator_avg_tokens_per_request`
- Implementation is **missing these declarations** - only outputs values, not the TYPE/HELP lines
- **This is a bug in the implementation, not the test**

### Issue 2: orchestrator.test.ts (flaky)
- Test "should try all servers in phase 1 before moving to phase 2"
- Passes in isolation (3/3 runs)
- Fails when run with full suite (0 serverAttempts recorded)
- **Root cause**: Test pollution - shared state from earlier tests persists (circuit breakers open, servers unhealthy, cooldown state)

---

## Work Objectives

### Must Have
- [ ] prometheus-exporter.ts: Add TYPE/HELP for 3 missing metrics
- [ ] orchestrator.test.ts: Add proper beforeEach cleanup to isolate test

### Must NOT Have
- [ ] Don't change test assertions (tests are correct)
- [ ] Don't add workarounds in tests without fixing root cause

---

## Execution Strategy

### Sequential (T2 depends on understanding shared state pollution)

**Wave 1:**
- T1: Fix prometheus-exporter.ts missing TYPE/HELP declarations
- T2: Fix orchestrator.test.ts flaky test with proper isolation

---

## TODOs

- [ ] 1. Fix prometheus-exporter.ts: Add missing TYPE/HELP declarations

  **What to do**:
  - Read `src/metrics/prometheus-exporter.ts` lines 54-88
  - Add TYPE/HELP declarations BEFORE the loop for:
    - `orchestrator_success_rate`
    - `orchestrator_throughput_per_min`
    - `orchestrator_avg_tokens_per_request`
  - Pattern to follow: Use same format as `orchestrator_in_flight_requests` (lines 54-56)

  **References**:
  - `src/metrics/prometheus-exporter.ts:54-56` - Pattern for TYPE/HELP declaration
  - `tests/unit/prometheus-exporter.test.ts:249-258` - Test expectations (source of truth)

  **QA Scenarios**:
  ```
  Scenario: prometheus-exporter outputs all required TYPE/HELP declarations
    Tool: Bash
    Steps:
      1. cd /root/ollama-orchestrator
      2. npm test -- tests/unit/prometheus-exporter.test.ts
    Expected Result: All 11 tests pass (1 previously failing + 10 other)
    Evidence: test output shows 11 passed
  ```

  **Commit**: YES (with T2 if done together)
  - Message: `fix(metrics): add missing TYPE/HELP declarations for per-model metrics`
  - Files: `src/metrics/prometheus-exporter.ts`

- [ ] 2. Fix orchestrator.test.ts: Add test isolation

  **What to do**:
  - Research: Identify which shared state is persisting (circuit breakers? cooldown? health?)
  - Add proper cleanup in `beforeEach` of "Complex failover scenarios" describe block
  - Options to consider:
    1. Reset circuit breaker states for all servers
    2. Clear cooldown state
    3. Reset health check state
    4. Call `vi.restoreAllMocks()` before test
  - Ensure servers are marked healthy and have models set in each beforeEach

  **References**:
  - `tests/unit/orchestrator.test.ts:2518-2547` - The failing test and its describe block
  - `src/orchestrator/orchestrator.ts` - Circuit breaker and cooldown management methods

  **Root Cause Hypothesis**:
  - Earlier test runs open circuit breakers for server-1, server-2, server-3
  - These remain open because cleanup doesn't reset CB state
  - `tryRequestWithFailover` skips unhealthy servers with open CBs
  - Result: 0 attempts because no servers pass the healthy/breaker check

  **QA Scenarios**:
  ```
  Scenario: orchestrator flaky test passes in isolation
    Tool: Bash
    Steps:
      1. cd /root/ollama-orchestrator
      2. npm test -- tests/unit/orchestrator.test.ts -t "should try all servers"
    Expected Result: Test passes (serverAttempts.length >= 3)
    Evidence: test output shows 1 passed

  Scenario: orchestrator flaky test passes with full suite
    Tool: Bash
    Steps:
      1. cd /root/ollama-orchestrator
      2. npm test 2>&1 | grep "should try all servers"
    Expected Result: Test passes when run with full suite
    Evidence: test output shows 2818 passed, 0 failed
  ```

  **Commit**: YES
  - Message: `fix(test): add proper isolation to fix flaky failover test`
  - Files: `tests/unit/orchestrator.test.ts`

---

## Final Verification Wave

- [ ] F1: Run `npm test` - expect 2818 passed, 0 failed
- [ ] F2: Run `npm run lint` - expect 0 errors
- [ ] F3: Run `npm run format` - expect clean
- [ ] F4: Run `npm run build` - expect success

---

## Success Criteria

```bash
npm test  # 2818 passed, 0 failed
npm run lint  # 0 errors
npm run build  # success
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| T2 fix doesn't fully isolate test | Medium | Test still flaky | Add more cleanup if needed |
| T1 introduces new bug | Low | Wrong TYPE/HELP format | Follow existing pattern exactly |

**Overall Risk**: LOW - Both are straightforward fixes following existing patterns.
