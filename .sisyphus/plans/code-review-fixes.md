# Code Review Fixes - Comprehensive Work Plan

## TL;DR

> **Quick Summary**: Address all findings from line-by-line code review of Ollama Orchestrator codebase
>
> **Deliverables**:
> - Error handling fixes (error swallowing, duplicate extraction)
> - Code deduplication (ErrorType, backoff calculations, sleep patterns)
> - Streaming improvements (buffer handling, handoff untangling)
> - Circuit breaker race condition fix
> - TypeScript technical debt (unused variables)
>
> **Estimated Effort**: Large (2-3 days)
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Error swallowing → Duplicate extraction → ErrorType consolidation → Backoff dedupe

---

## Context

### Original Request
User requested a comprehensive line-by-line code review of the entire Ollama Orchestrator codebase. Review identified multiple categories of issues requiring remediation.

### Codebase Profile
- Node.js/TypeScript Express application
- ~4,500 lines in orchestrator.ts
- 27 utility files in src/utils/
- 89 TypeScript files total
- Production-ready Ollama orchestrator with intelligent routing, circuit breakers, and metrics

### Architectural Strengths (PRESERVE)
- 3-phase failover strategy with exponential backoff
- Two-level circuit breakers (server + model) with coordinated recovery
- Intelligent load balancing with temporal scoring
- Streaming with seamless handoff capabilities

---

## Work Objectives

### Core Objective
Fix all identified code review findings while preserving existing behavior and ensuring no regression.

### Concrete Deliverables
- Error swallowing fix with proper logging/metrics in `openai-controller.ts`
- Dead code removal (duplicate model metadata extraction loop) in `orchestrator.ts`
- ErrorType enum consolidation to single source
- Backoff calculation deduplication
- Inline sleep pattern replacement with `async-helpers.ts sleep()`
- Streaming buffer documentation and untangling of handoff callback
- Circuit breaker race condition fix
- TypeScript unused variable fixes (underscore prefix)

### Definition of Done
- [ ] All critical issues fixed
- [ ] All high priority issues resolved
- [ ] All medium priority issues addressed or documented
- [ ] All TypeScript hints resolved
- [ ] Test suite passes after every task
- [ ] Zero behavioral regressions

### Must Have
- Error swallowing must NOT silently ignore errors - must log at minimum
- Duplicate code must be removed (not just commented)
- All fixes must pass linting and type checking

### Must NOT Have (Guardrails from Metis Review)
- MUST NOT consolidate ErrorType without verifying semantic equivalence
- MUST NOT fix "unused req" without checking if Express middleware pattern
- MUST NOT change backoff calculations without understanding why each location has its own
- MUST NOT refactor streaming without understanding the full handoff contract
- MUST NOT create new abstraction layers for "future flexibility"
- MUST NOT make "while I'm here" changes - fix only the reported issue

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: Tests-after (verify behavior preserved)
- **Framework**: bun test (inferred from project structure)

### QA Policy
Every task includes agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/`.

- **Backend/Logic**: Bash (run test commands, verify output)
- **Type checking**: `tsc --noEmit` after each task
- **Linting**: ESLint/Prettier checks

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Critical fixes - foundation):
├── Task 1: Fix error swallowing in openai-controller.ts
├── Task 2: Analyze duplicate metadata extraction loops (dead code or real?)
├── Task 3: Research ErrorType enums across files
├── Task 4: Research backoff calculations across files
└── Task 5: Map inline sleep patterns across codebase

Wave 2 (High priority deduplication):
├── Task 6: Remove dead code (duplicate loop) or deduplicate
├── Task 7: Consolidate ErrorType definitions
├── Task 8: Create unified backoff calculation module
├── Task 9: Replace inline sleeps with async-helpers.sleep()
└── Task 10: Dedup error parsing (ollama-error.ts vs fetch-with-timeout.ts)

Wave 3 (Medium priority and technical debt):
├── Task 11: Document streaming buffer behavior
├── Task 12: Untangle streaming handoff callback (extract helper)
├── Task 13: Fix circuit breaker race condition
├── Task 14: Document singleton pattern decision
└── Task 15: Fix unused variables across controllers

Wave FINAL (Verification - 4 parallel reviews):
├── Task F1: Plan compliance audit
├── Task F2: Code quality review
├── Task F3: Real manual QA
└── Task F4: Scope fidelity check
```

### Dependency Matrix
- **Tasks 1-5**: Can run in parallel (research + analysis tasks)
- **Task 6**: Depends on Task 2 (need analysis before removal)
- **Task 7**: Depends on Task 3 (need equivalence verification)
- **Task 8**: Depends on Task 4 (need canonical identification)
- **Task 9**: Depends on Task 5 (need complete pattern map)
- **Task 10**: Can run in parallel after Wave 1
- **Tasks 11-15**: Can run in parallel after Wave 2
- **Final Wave**: Depends on ALL tasks complete

---

## TODOs

- [ ] 1. Fix Error Swallowing in openai-controller.ts

  **What to do**:
  - Read `src/controllers/openai-controller.ts` around line 138
  - Identify the `catch (_e) { /* Silently ignore - request already timed out */ }` block
  - Replace silent ignore with proper error logging using the project's logging mechanism
  - At minimum: log error message, timestamp, and relevant context (request ID if available)
  - Consider: emit metric for timeout failures to track failover attempts
  - DO NOT change the control flow - timeout should still not trigger retry (preserve behavior)

  **Must NOT do**:
  - MUST NOT remove the catch block entirely (could cascade errors)
  - MUST NOT add retry logic here (timeout handling is elsewhere)
  - MUST NOT change what exceptions are caught

  **Recommended Agent Profile**:
  - **Category**: `quick` - Simple error handling fix in single file
    - Reason: Single location, clear fix, no architectural implications
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `git-master`: Not needed for this simple fix

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2-5)
  - **Blocks**: None
  - **Blocked By**: None (can start immediately)

  **References**:
  - `src/controllers/openai-controller.ts:138` - Location of error swallowing
  - `src/utils/logger.ts` or similar - Project logging mechanism (find first)
  - `src/utils/metrics.ts` or similar - Project metrics mechanism (find first)

  **Acceptance Criteria**:
  - [ ] Error caught at line 138 is logged (not silently ignored)
  - [ ] Log includes error message and timestamp
  - [ ] `tsc --noEmit` passes
  - [ ] Existing tests pass

  **QA Scenarios**:

  \`\`\`
  Scenario: Error is logged instead of silently ignored
    Tool: Bash
    Preconditions: openai-controller.ts has the error swallowing code
    Steps:
      1. Grep for the error swallowing pattern to confirm location
      2. Read the surrounding context to understand logging mechanism
      3. Make the edit to add logging
      4. Run tsc --noEmit to verify no type errors
    Expected Result: Edit succeeds, type check passes
    Failure Indicators: Edit fails, type errors introduced
    Evidence: .sisyphus/evidence/task-1-error-logging.md
  \`\`\`

  **Commit**: YES
  - Message: `fix(openai): add logging for timeout errors instead of silent ignore`
  - Files: `src/controllers/openai-controller.ts`
  - Pre-commit: `npm run lint && npm run build`

---

- [ ] 2. Analyze Duplicate Metadata Extraction Loops

  **What to do**:
  - Read `src/orchestrator/orchestrator.ts` lines 381-410
  - Identify the duplicate 14-line `modelDetails` processing loop
  - Analyze the containing function `onHealthCheckResult()` to understand execution path
  - Determine: Is one loop dead code (unreachable)? Or are both executed?
  - Check git blame to see when each loop was added
  - Document findings: which loop should be kept, which is duplicate

  **Must NOT do**:
  - MUST NOT remove any code yet - this is analysis only
  - MUST NOT change any logic

  **Recommended Agent Profile**:
  - **Category**: `deep` - Requires code path analysis and git history
    - Reason: Need to understand execution flow and history before recommending removal
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `git-master`: Useful for git blame but not required for analysis

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3-5)
  - **Blocks**: Task 6 (removal depends on this analysis)
  - **Blocked By**: None

  **References**:
  - `src/orchestrator/orchestrator.ts:381-410` - First occurrence of duplicate loop
  - Find second occurrence in same function (search for `modelDetails` loop pattern)
  - `src/orchestrator/orchestrator.types.ts` - Type definitions for health check results

  **Acceptance Criteria**:
  - [ ] Both loops are identified with exact line numbers
  - [ ] Execution path analysis shows whether 0, 1, or 2 loops execute
  - [ ] Recommendation: keep loop X, remove loop Y
  - [ ] Rationale documented

  **QA Scenarios**:

  \`\`\`
  Scenario: Analyze duplicate loops and produce recommendation
    Tool: Bash
    Preconditions: orchestrator.ts exists with duplicate loops
    Steps:
      1. Read lines 381-410 to see first loop
      2. Search for similar pattern to find second occurrence
      3. Read both loops' context to understand execution path
      4. Git blame to understand when each was added
      5. Document findings and recommendation
    Expected Result: Clear recommendation with rationale
    Failure Indicators: Unable to determine which loop is duplicate
    Evidence: .sisyphus/evidence/task-2-loop-analysis.md
  \`\`\`

  **Commit**: NO (analysis task)

---

- [ ] 3. Research ErrorType Enum Equivalence

  **What to do**:
  - Read `src/utils/recovery-backoff.ts` line 6 to see ErrorType definition
  - Read `src/utils/error-classifier.ts` line 11 to see ErrorType definition
  - Compare the two enums: are they semantically identical? Different values? Subset/superset?
  - Check all usages of each ErrorType to understand which should be canonical
  - Document: Should they be consolidated? If so, which location is canonical?

  **Must NOT do**:
  - MUST NOT modify any code - research only
  - MUST NOT assume they should be merged

  **Recommended Agent Profile**:
  - **Category**: `deep` - Requires cross-file analysis
    - Reason: Need to compare definitions and their usages before recommending consolidation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-2, 4-5)
  - **Blocks**: Task 7 (consolidation depends on equivalence verification)
  - **Blocked By**: None

  **References**:
  - `src/utils/recovery-backoff.ts:6` - First ErrorType definition
  - `src/utils/error-classifier.ts:11` - Second ErrorType definition
  - Grep for all imports/usages of each

  **Acceptance Criteria**:
  - [ ] Both ErrorType definitions captured with exact values
  - [ ] All usages of each enumerated
  - [ ] Equivalence assessment: identical / partial overlap / different
  - [ ] Consolidation recommendation with rationale

  **QA Scenarios**:

  \`\`\`
  Scenario: Research ErrorType definitions and produce equivalence report
    Tool: Bash
    Preconditions: Two ErrorType definitions exist
    Steps:
      1. Read recovery-backoff.ts to get first ErrorType
      2. Read error-classifier.ts to get second ErrorType
      3. Grep for usages of recovery-backoff ErrorType
      4. Grep for usages of error-classifier ErrorType
      5. Document comparison and recommendation
    Expected Result: Clear equivalence assessment
    Failure Indicators: Unable to determine relationship
    Evidence: .sisyphus/evidence/task-3-errortype-research.md
  \`\`\`

  **Commit**: NO (research task)

---

- [ ] 4. Map All Backoff Calculation Locations

  **What to do**:
  - Find all backoff calculation implementations across the codebase:
    - `src/utils/math-helpers.ts`
    - `src/utils/recovery-backoff.ts`
    - `src/orchestrator/orchestrator.ts`
    - `src/model-manager.ts`
    - `src/health-check-scheduler.ts`
  - For each location: extract the formula/algorithm used
  - Compare: Are they mathematically identical? Different base? Different multiplier?
  - Identify which should be the canonical implementation
  - Document all locations that should import from canonical source

  **Must NOT do**:
  - MUST NOT modify any code - research only
  - MUST NOT assume they should all be the same

  **Recommended Agent Profile**:
  - **Category**: `deep` - Requires algorithm comparison
    - Reason: Backoff algorithms can have subtle differences that matter for timing
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-3, 5)
  - **Blocks**: Task 8 (deduplication depends on canonical identification)
  - **Blocked By**: None

  **References**:
  - Each file listed above with backoff logic
  - `src/utils/math-helpers.ts` - Likely contains base calculation utilities

  **Acceptance Criteria**:
  - [ ] All backoff locations identified with line numbers
  - [ ] Each algorithm/formula documented
  - [ ] Comparison matrix showing identical/different/similar
  - [ ] Canonical source identified

  **QA Scenarios**:

  \`\`\`
  Scenario: Map all backoff calculations and identify canonical source
    Tool: Bash
    Preconditions: Multiple backoff implementations suspected
    Steps:
      1. Search for backoff-related functions across codebase
      2. Read each implementation to extract formula
      3. Compare formulas side-by-side
      4. Identify which is most complete/generally useful
      5. Document which others should import from canonical
    Expected Result: Clear map of all locations with canonical identified
    Failure Indicators: Missing locations, unable to compare formulas
    Evidence: .sisyphus/evidence/task-4-backoff-map.md
  \`\`\`

  **Commit**: NO (research task)

---

- [ ] 5. Map Inline Sleep Patterns

  **What to do**:
  - Find all `setTimeout`, `setImmediate`, and `setInterval` usages that look like sleeps
  - Specifically look for patterns that could use `src/utils/async-helpers.ts sleep()` instead
  - Note the pattern used (Promise-based? Callback-based? await setTimeout?)
  - Document each location with the current pattern and context

  **Must NOT do**:
  - MUST NOT modify any code - research only
  - MUST NOT assume async-helpers.sleep is always the right replacement

  **Recommended Agent Profile**:
  - **Category**: `deep` - Requires pattern recognition across codebase
    - Reason: Need to see all sleep-like patterns before recommending replacements
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-4)
  - **Blocks**: Task 9 (replacement depends on complete pattern map)
  - **Blocked By**: None

  **References**:
  - `src/utils/async-helpers.ts` - The sleep function to use instead
  - All files using setTimeout as a sleep

  **Acceptance Criteria**:
  - [ ] All sleep-like patterns identified with exact locations
  - [ ] Each pattern documented (Promise vs callback)
  - [ ] async-helpers.sleep compatibility assessed per location
  - [ ] List of which should be migrated

  **QA Scenarios**:

  \`\`\`
  Scenario: Map all inline sleep patterns for async-helpers.sleep migration
    Tool: Bash
    Preconditions: Inline sleeps suspected across codebase
    Steps:
      1. Grep for setTimeout usage across src/
      2. Filter for sleep-like patterns (not true timers)
      3. Read async-helpers.sleep to understand its API
      4. For each sleep, assess compatibility
      5. Document findings
    Expected Result: Complete map of sleep locations with migration recommendations
    Failure Indicators: Missing patterns, incompatible replacements
    Evidence: .sisyphus/evidence/task-5-sleep-map.md
  \`\`\`

  **Commit**: NO (research task)

---

- [ ] 6. Remove Duplicate Metadata Loop (or Deduplicate)

  **What to do**:
  - Based on Task 2 analysis, either:
    - If one loop is dead code: Remove the dead loop, keep the one that executes
    - If both loops are needed but do different things: Rename variables to clarify purpose
  - Verify the function still works correctly after removal
  - Run tests to ensure no regression

  **Must NOT do**:
  - MUST NOT remove a loop that has side effects
  - MUST NOT change logic even if loops seem similar

  **Recommended Agent Profile**:
  - **Category**: `quick` - Targeted removal based on prior analysis
    - Reason: Analysis from Task 2 tells exactly what to do
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `git-master`: Useful for understanding history but not required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7-10)
  - **Blocks**: None
  - **Blocked By**: Task 2 (needs analysis before removal)

  **References**:
  - Task 2 analysis results: `.sisyphus/evidence/task-2-loop-analysis.md`
  - `src/orchestrator/orchestrator.ts` - Target file

  **Acceptance Criteria**:
  - [ ] Duplicate loop removed (or deduplicated if both needed)
  - [ ] Tests pass after change
  - [ ] `tsc --noEmit` passes

  **QA Scenarios**:

  \`\`\`
  Scenario: Remove duplicate loop from orchestrator.ts
    Tool: Bash
    Preconditions: Task 2 analysis complete with clear recommendation
    Steps:
      1. Read Task 2 analysis for recommendation
      2. Make the targeted edit to remove/deduplicate
      3. Run tests: npm test
      4. Verify tsc: tsc --noEmit
    Expected Result: Tests pass, type check passes
    Failure Indicators: Tests fail, type errors
    Evidence: .sisyphus/evidence/task-6-dedup-loop.md
  \`\`\`

  **Commit**: YES
  - Message: `refactor(orchestrator): remove duplicate model metadata extraction loop`
  - Files: `src/orchestrator/orchestrator.ts`
  - Pre-commit: `npm test && npm run lint`

---

- [ ] 7. Consolidate ErrorType Definitions

  **What to do**:
  - Based on Task 3 research:
    - If equivalent: Move all definitions to one canonical location, update imports
    - If different: Document why they're separate and close as "won't fix" or "design decision"
  - Update all usages to import from canonical source
  - Remove duplicate definition

  **Must NOT do**:
  - MUST NOT merge if they're intentionally different (per Task 3 recommendation)
  - MUST NOT break any imports

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` - Refactoring with cross-file impact
    - Reason: Multiple files may need import updates
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 8-10)
  - **Blocks**: None
  - **Blocked By**: Task 3 (needs equivalence verification)

  **References**:
  - Task 3 research: `.sisyphus/evidence/task-3-errortype-research.md`
  - All files importing ErrorType from old locations

  **Acceptance Criteria**:
  - [ ] ErrorType defined in single canonical location
  - [ ] All imports updated to canonical source
  - [ ] No duplicate definitions remain
  - [ ] `tsc --noEmit` passes
  - [ ] Tests pass

  **QA Scenarios**:

  \`\`\`
  Scenario: Consolidate ErrorType to single location
    Tool: Bash
    Preconditions: Task 3 confirmed ErrorTypes are equivalent
    Steps:
      1. Read Task 3 recommendation
      2. Identify canonical location
      3. Update all imports to canonical source
      4. Remove duplicate definition
      5. Run tsc --noEmit
      6. Run tests
    Expected Result: Single definition, all imports work, tests pass
    Failure Indicators: Import errors, test failures
    Evidence: .sisyphus/evidence/task-7-errortype-consolidate.md
  \`\`\`

  **Commit**: YES
  - Message: `refactor(types): consolidate ErrorType to shared location`
  - Files: `src/utils/error-classifier.ts`, `src/utils/recovery-backoff.ts`, + all importing files
  - Pre-commit: `npm test && npm run lint`

---

- [ ] 8. Extract Unified Backoff Calculation Module

  **What to do**:
  - Based on Task 4 mapping:
    - Identify the canonical backoff calculation
    - Ensure it's in `src/utils/math-helpers.ts` (or appropriate shared location)
    - Update all other locations to import from canonical source
  - Verify all usages still produce identical results

  **Must NOT do**:
  - MUST NOT change the backoff algorithm/timing (preserve behavior)
  - MUST NOT introduce breaking changes to function signatures

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` - Cross-file refactoring
    - Reason: Multiple files need import updates, algorithm must stay identical
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6-7, 9-10)
  - **Blocks**: None
  - **Blocked By**: Task 4 (needs canonical identification)

  **References**:
  - Task 4 map: `.sisyphus/evidence/task-4-backoff-map.md`
  - Canonical location identified in Task 4

  **Acceptance Criteria**:
  - [ ] Canonical backoff in shared location (math-helpers.ts)
  - [ ] All backoff usages import from canonical
  - [ ] Timing behavior identical (verify with tests)
  - [ ] `tsc --noEmit` passes

  **QA Scenarios**:

  \`\`\`
  Scenario: Extract and consolidate backoff calculations
    Tool: Bash
    Preconditions: Task 4 identified canonical source
    Steps:
      1. Read Task 4 canonical identification
      2. If canonical not in math-helpers, move it there
      3. Update all other locations to import from math-helpers
      4. Run tsc --noEmit
      5. Run tests to verify timing behavior preserved
    Expected Result: Single backoff impl, all import from it, tests pass
    Failure Indicators: Timing changes, import errors
    Evidence: .sisyphus/evidence/task-8-backoff-dedup.md
  \`\`\`

  **Commit**: YES
  - Message: `refactor(backoff): extract unified calculation to math-helpers.ts`
  - Files: `src/utils/math-helpers.ts`, `src/utils/recovery-backoff.ts`, `src/orchestrator/orchestrator.ts`, `src/model-manager.ts`, `src/health-check-scheduler.ts`
  - Pre-commit: `npm test && npm run lint`

---

- [ ] 9. Replace Inline Sleeps with async-helpers.sleep

  **What to do**:
  - Based on Task 5 mapping:
    - Replace each identified inline sleep pattern with `async-helpers.sleep()`
    - Use the same duration values (preserve timing behavior)
  - Ensure all replacements maintain the same async/await pattern

  **Must NOT do**:
  - MUST NOT change sleep duration (preserve behavior)
  - MUST NOT use async-helpers.sleep where it's inappropriate (e.g., true timers)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` - Cross-file replacement
    - Reason: Multiple locations need consistent replacement
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6-8, 10)
  - **Blocks**: None
  - **Blocked By**: Task 5 (needs complete pattern map)

  **References**:
  - Task 5 map: `.sisyphus/evidence/task-5-sleep-map.md`
  - `src/utils/async-helpers.ts` - sleep function to use

  **Acceptance Criteria**:
  - [ ] All identified sleeps replaced with async-helpers.sleep
  - [ ] Same duration values preserved
  - [ ] `tsc --noEmit` passes
  - [ ] Tests pass

  **QA Scenarios**:

  \`\`\`
  Scenario: Replace inline sleeps with async-helpers.sleep
    Tool: Bash
    Preconditions: Task 5 identified all sleep locations
    Steps:
      1. Read Task 5 migration list
      2. For each location, make the replacement
      3. Verify async/await pattern is correct
      4. Run tsc --noEmit
      5. Run tests
    Expected Result: All sleeps use helper, tests pass
    Failure Indicators: Type errors, test failures
    Evidence: .sisyphus/evidence/task-9-sleep-replace.md
  \`\`\`

  **Commit**: YES
  - Message: `refactor(async): replace inline sleeps with async-helpers.sleep()`
  - Files: All files with inline sleeps from Task 5
  - Pre-commit: `npm test && npm run lint`

---

- [ ] 10. Deduplicate Error Parsing Logic

  **What to do**:
  - Read `src/utils/ollama-error.ts` and `src/utils/fetch-with-timeout.ts`
  - Identify duplicate error parsing logic
  - Determine: Should one import from the other? Or extract to shared utility?
  - Consolidate to single source of truth for error parsing

  **Must NOT do**:
  - MUST NOT change error parsing behavior (preserve what exceptions map to what errors)
  - MUST NOT break any consuming code

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` - Logic deduplication
    - Reason: Need to understand error mapping before consolidating
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6-9)
  - **Blocks**: None
  - **Blocked By**: None (can start after Wave 1)

  **References**:
  - `src/utils/ollama-error.ts` - Error parsing
  - `src/utils/fetch-with-timeout.ts` - Error parsing duplication

  **Acceptance Criteria**:
  - [ ] Single source of truth for error parsing
  - [ ] No duplicate parsing logic
  - [ ] `tsc --noEmit` passes
  - [ ] Tests pass

  **QA Scenarios**:

  \`\`\`
  Scenario: Deduplicate error parsing between ollama-error.ts and fetch-with-timeout.ts
    Tool: Bash
    Preconditions: Two files with error parsing logic
    Steps:
      1. Read both files to understand error parsing
      2. Identify which has more complete/error handling
      3. Have the other import from that source
      4. Verify no functionality lost
      5. Run tsc --noEmit
      6. Run tests
    Expected Result: Single error parsing source, tests pass
    Failure Indicators: Error handling behavior changes, tests fail
    Evidence: .sisyphus/evidence/task-10-error-dedup.md
  \`\`\`

  **Commit**: YES
  - Message: `refactor(errors): deduplicate error parsing logic`
  - Files: `src/utils/ollama-error.ts`, `src/utils/fetch-with-timeout.ts`
  - Pre-commit: `npm test && npm run lint`

---

- [ ] 11. Document Streaming Buffer Behavior

  **What to do**:
  - Read `src/streaming.ts` to understand the 1MB buffer behavior
  - Document: What happens when buffer exceeds 1MB? Truncation? Error? Dropped chunks?
  - Assess: Should the 1MB cap be configurable? Or is current behavior correct?
  - Add inline code comments explaining the buffer behavior
  - If behavior is correct, close as "documented, no change needed"
  - If behavior should be configurable, note in documentation

  **Must NOT do**:
  - MUST NOT change buffer behavior without explicit approval
  - MUST NOT remove the buffer cap

  **Recommended Agent Profile**:
  - **Category**: `writing` - Documentation task
    - Reason: Primarily documentation, understanding current behavior
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 12-15)
  - **Blocks**: None
  - **Blocked By**: None (can start after Wave 2)

  **References**:
  - `src/streaming.ts` - Streaming implementation with buffer

  **Acceptance Criteria**:
  - [ ] Buffer behavior documented with exact 1MB threshold
  - [ ] Behavior assessment: correct / should be configurable / needs change
  - [ ] Inline comments added explaining behavior
  - [ ] No behavior changes (documentation only)

  **QA Scenarios**:

  \`\`\`
  Scenario: Document streaming buffer behavior
    Tool: Bash
    Preconditions: streaming.ts exists
    Steps:
      1. Read streaming.ts to find buffer handling
      2. Understand what happens at 1MB threshold
      3. Add inline comments explaining behavior
      4. Document in evidence file
    Expected Result: Clear documentation of buffer behavior
    Failure Indicators: Unable to understand buffer behavior
    Evidence: .sisyphus/evidence/task-11-streaming-docs.md
  \`\`\`

  **Commit**: YES
  - Message: `docs(streaming): document buffer behavior`
  - Files: `src/streaming.ts`
  - Pre-commit: `npm run lint`

---

- [ ] 12. Untangle Streaming Handoff Callback

  **What to do**:
  - Read `src/streaming.ts` to find the 144-line handoff callback
  - Identify logical sections within the callback
  - Extract inner sections into named helper functions (preserve logic, just organize)
  - Keep the main callback as orchestrator of calls to helpers
  - DO NOT change any logic - only refactor for readability

  **Must NOT do**:
  - MUST NOT change any logic inside the callback
  - MUST NOT change streaming behavior
  - MUST NOT add new abstractions beyond extraction

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` - Code organization refactor
    - Reason: Large callback needs careful untangling without changing behavior
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 11, 13-15)
  - **Blocks**: None
  - **Blocked By**: None (can start after Wave 2)

  **References**:
  - `src/streaming.ts` - The 144-line callback to untangle

  **Acceptance Criteria**:
  - [ ] Main callback reduced in size (extract helpers)
  - [ ] Logic unchanged (helpers do same things in same order)
  - [ ] `tsc --noEmit` passes
  - [ ] Tests pass

  **QA Scenarios**:

  \`\`\`
  Scenario: Extract helpers from streaming handoff callback
    Tool: Bash
    Preconditions: streaming.ts has 144-line callback
    Steps:
      1. Read the callback to identify logical sections
      2. Extract each section into a named helper function
      3. Main callback becomes orchestrator of helper calls
      4. Run tsc --noEmit
      5. Run tests
    Expected Result: Smaller callback, same behavior, tests pass
    Failure Indicators: Logic changes, test failures
    Evidence: .sisyphus/evidence/task-12-streaming-untangle.md
  \`\`\`

  **Commit**: YES
  - Message: `refactor(streaming): extract helpers from handoff callback`
  - Files: `src/streaming.ts`
  - Pre-commit: `npm test && npm run lint`

---

- [ ] 13. Fix Circuit Breaker Race Condition

  **What to do**:
  - Read `src/circuit-breaker/circuit-breaker.ts` to understand the check-then-act race
  - Identify the specific race window (where state is checked then acted upon non-atomically)
  - Fix by: Adding mutex/lock, using atomic operations, or reordering to eliminate window
  - The fix must not break the circuit breaker's async nature

  **Must NOT do**:
  - MUST NOT introduce deadlock potential
  - MUST NOT change circuit breaker thresholds or timing
  - MUST NOT make synchronous changes that hurt performance

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` - Concurrency fix
    - Reason: Race conditions are subtle and need careful analysis
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 11-12, 14-15)
  - **Blocks**: None
  - **Blocked By**: None (can start after Wave 2)

  **References**:
  - `src/circuit-breaker/circuit-breaker.ts` - The circuit breaker implementation

  **Acceptance Criteria**:
  - [ ] Race window eliminated
  - [ ] Circuit breaker still passes all tests
  - [ ] No deadlock potential introduced
  - [ ] `tsc --noEmit` passes

  **QA Scenarios**:

  \`\`\`
  Scenario: Fix race condition in circuit breaker
    Tool: Bash
    Preconditions: Circuit breaker has check-then-act race
    Steps:
      1. Analyze circuit-breaker.ts for race window
      2. Identify fix approach (lock, atomic, reorder)
      3. Implement the fix
      4. Run tsc --noEmit
      5. Run tests
    Expected Result: Race fixed, tests pass
    Failure Indicators: Deadlock, test failures
    Evidence: .sisyphus/evidence/task-13-cb-race-fix.md
  \`\`\`

  **Commit**: YES
  - Message: `fix(circuit-breaker): resolve race condition in check-then-act`
  - Files: `src/circuit-breaker/circuit-breaker.ts`
  - Pre-commit: `npm test && npm run lint`

---

- [ ] 14. Document Singleton Pattern Decision

  **What to do**:
  - Investigate: Is ModelAggregator intentionally not a singleton while others are?
  - Check: orchestrator-instance.ts for singleton patterns
  - Decision: Either make ModelAggregator a singleton, OR document why it's not
  - If making singleton: update all usages to use the singleton instance
  - If documenting: add architectural documentation explaining the difference

  **Must NOT do**:
  - MUST NOT make arbitrary changes to singleton status without understanding design
  - MUST NOT introduce breaking changes

  **Recommended Agent Profile**:
  - **Category**: `deep` - Architectural decision documentation
    - Reason: Need to understand design intent before changing patterns
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 11-13, 15)
  - **Blocks**: None
  - **Blocked By**: None (can start after Wave 2)

  **References**:
  - `src/orchestrator/orchestrator-instance.ts` - Singleton patterns
  - `src/model-manager.ts` (ModelAggregator) - The class in question

  **Acceptance Criteria**:
  - [ ] Decision documented: why singleton / why not
  - [ ] If singleton: all usages updated
  - [ ] `tsc --noEmit` passes
  - [ ] Tests pass

  **QA Scenarios**:

  \`\`\`
  Scenario: Document singleton pattern decision for ModelAggregator
    Tool: Bash
    Preconditions: ModelAggregator not singleton, others are
    Steps:
      1. Read orchestrator-instance.ts for singleton pattern
      2. Read ModelAggregator class
      3. Determine if intentional or oversight
      4. Either make singleton or document design decision
      5. Run tsc --noEmit
      6. Run tests
    Expected Result: Clear decision with implementation or documentation
    Failure Indicators: Confusion about design intent
    Evidence: .sisyphus/evidence/task-14-singleton-decision.md
  \`\`\`

  **Commit**: YES
  - Message: `docs(architecture): document singleton pattern decisions`
  - Files: `docs/ARCHITECTURE.md` or inline comments
  - Pre-commit: `npm run lint`

---

- [ ] 15. Fix Unused TypeScript Variables (Underscore Prefix)

  **What to do**:
  - Run `tsc --noEmit` to get the 53 unused variable hints
  - For each hint:
    - If truly unused (not middleware pattern): prefix with underscore
    - If Express middleware pattern (req, res, next): keep as-is OR use underscore
    - Check if route actually uses the parameter
  - Focus on controllers: servers-controller.ts (10), openai-controller.ts (6), others

  **Must NOT do**:
  - MUST NOT disable the lint rule
  - MUST NOT rename variables in way that breaks functionality
  - MUST NOT assume req is unused without checking Express patterns

  **Recommended Agent Profile**:
  - **Category**: `quick` - Systematic cleanup
    - Reason: Well-defined pattern, simple fixes
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 11-14)
  - **Blocks**: None
  - **Blocked By**: None (can start after Wave 2)

  **References**:
  - LSP diagnostics showing unused variables
  - Express middleware pattern (req, res, next often intentionally unused)

  **Acceptance Criteria**:
  - [ ] All unused variables either prefixed with underscore OR verified as intentional
  - [ ] `tsc --noEmit` shows zero unused variable hints
  - [ ] Tests pass

  **QA Scenarios**:

  \`\`\`
  Scenario: Fix unused TypeScript variables
    Tool: Bash
    Preconditions: 53 unused variable hints from tsc
    Steps:
      1. Run tsc --noEmit to list all hints
      2. For each, determine if truly unused or Express pattern
      3. Prefix truly unused with underscore
      4. Run tsc --noEmit again to verify
      5. Run tests
    Expected Result: Zero unused variable hints, tests pass
    Failure Indicators: Test failures, wrong underscore usage
    Evidence: .sisyphus/evidence/task-15-unused-vars.md
  \`\`\`

  **Commit**: YES
  - Message: `style(typescript): fix unused variable hints`
  - Files: All controller files with unused variables
  - Pre-commit: `npm test && npm run lint`

---

## Final Verification Wave

- [ ] F1. **Plan Compliance Audit** — `oracle`
- [ ] F2. **Code Quality Review** — `unspecified-high`
- [ ] F3. **Real Manual QA** — `unspecified-high`
- [ ] F4. **Scope Fidelity Check** — `deep`

---

## Commit Strategy

- **1**: `fix(openai): add logging for timeout errors` - src/controllers/openai-controller.ts
- **2**: `refactor(orchestrator): remove duplicate metadata extraction` - src/orchestrator/orchestrator.ts
- **3**: `refactor(types): consolidate ErrorType to shared location` - src/utils/error-classifier.ts, recovery-backoff.ts
- **4**: `refactor(backoff): extract unified calculation to math-helpers.ts` - multiple files
- **5**: `refactor(async): replace inline sleeps with async-helpers.sleep()` - multiple files
- **6**: `refactor(errors): deduplicate error parsing logic` - src/utils/ollama-error.ts, fetch-with-timeout.ts
- **7**: `docs(streaming): document buffer behavior and extract helper` - src/streaming.ts
- **8**: `fix(circuit-breaker): resolve race condition in check-then-act` - src/circuit-breaker/circuit-breaker.ts
- **9**: `docs(architecture): document singleton pattern decisions` - README or arch docs
- **10**: `style(typescript): fix unused variable hints` - multiple controller files

---

## Success Criteria

### Verification Commands
```bash
npm run build  # Must compile without errors
npm run lint  # Must pass linting
npm test      # All tests pass
```

### Final Checklist
- [ ] All critical issues fixed
- [ ] All high priority issues resolved
- [ ] All medium priority issues addressed or documented
- [ ] All 53 TypeScript hints resolved
- [ ] No new lint errors introduced
- [ ] Test suite passes 100%
