# Plan: Update CI to Run Flaky Test in Isolation

## TL;DR

Add a separate CI job to run the flaky `orchestrator.test.ts` test file in isolation, avoiding test pollution from async health checks.

**Estimated Effort**: Small (1 file modification)
**Test Impact**: Eliminates flaky test failure in CI

---

## Context

The test "should try all servers in phase 1 before moving to phase 2" in `tests/unit/orchestrator.test.ts`:
- Passes in isolation (3/3 runs confirmed)
- Fails when run with full suite due to async health check pollution
- Circuit breakers opened by health checks from earlier tests cannot be fully cleaned up

**Solution**: Run this test file in isolation as a separate CI job, before the full test suite.

---

## Work Objectives

### Must Have
- [ ] Add `flaky-test` job to `.github/workflows/ci.yml`
- [ ] Job runs orchestrator test in isolation using `-t "should try all servers"`

### Must NOT Have
- [ ] Don't modify test code further (cleanup already added)

---

## Execution Strategy

**Single task**: Modify CI configuration

---

## TODOs

- [ ] 1. Add flaky-test job to CI

  **What to do**:
  - Read `.github/workflows/ci.yml`
  - Add new `flaky-test` job after the `test` job
  - Job should:
    1. Depend on `[lint, format, typecheck]` (same as test job)
    2. Run `npm test -- tests/unit/orchestrator.test.ts -t "should try all servers in phase 1"`
    3. This test passes in isolation

  **References**:
  - `.github/workflows/ci.yml:80-99` - Existing test job structure
  - The flaky test passes when run in isolation with this command

  **Commit**: YES
  - Message: `ci: add flaky test isolation job to avoid test pollution`
  - Files: `.github/workflows/ci.yml`

---

## Final Verification Wave

- [ ] F1: Verify CI passes with new flaky-test job

---

## Success Criteria

```bash
# Local verification (test passes in isolation)
npm test -- tests/unit/orchestrator.test.ts -t "should try all servers in phase 1"
# Expected: 1 passed
```
