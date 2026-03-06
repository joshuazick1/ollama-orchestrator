# Phase 4 Implementation Plan: Cleanup & Migration to SQLite-Only

## Overview

Phase 4 removes in-memory arrays and JSON file persistence for data that is now stored in SQLite (MetricsStore). This completes the migration from JSON-based storage to SQLite.

## Testing Gate Protocol

**MANDATORY: Run tests AFTER each subtask completion**

| Gate | Action                  | Pass Criteria     |
| ---- | ----------------------- | ----------------- |
| G1   | `npm run typecheck`     | ✅ No type errors |
| G2   | `npm run lint -- --fix` | ✅ No lint errors |
| G3   | `npm test --silent`     | ✅ All tests pass |

**CRITICAL:** Do NOT proceed to next subtask if any gate fails. Fix the issue before continuing.

---

## Subtask Breakdown

### Phase 4.1: Remove in-memory requestHistory/errorHistory from AnalyticsEngine

**Files:** `src/analytics/analytics-engine.ts`

**Steps:**

1. Remove `private requestHistory: RequestContext[]` property
2. Remove `private errorHistory` property
3. Remove `addRequest()` method that pushes to arrays
4. Update `getRequestHistory()`, `getErrorAnalysis()` to read from MetricsStore
5. Remove `loadFromDisk()` / `saveToDisk()` references to these arrays
6. Remove JSON file loading for these fields

**Testing Gate:** Run full test suite after completion

---

### Phase 4.2: Remove in-memory Map from RequestHistory

**Files:** `src/request-history.ts`

**Steps:**

1. Remove `private requests: Map<string, RequestRecord[]>` property
2. Update all read methods to query MetricsStore instead
3. Remove any in-memory filtering/sorting logic that was used as fallback

**Testing Gate:** Run full test suite after completion

---

### Phase 4.3: Remove in-memory events array from DecisionHistory

**Files:** `src/decision-history.ts`

**Steps:**

1. Remove `private events: DecisionEvent[]` property
2. Update `getDecisions()` to read from MetricsStore
3. Remove any in-memory filtering

**Testing Gate:** Run full test suite after completion

---

### Phase 4.4: Remove JSON Persistence for Migrated Data

**Files:**

- `src/analytics/analytics-engine.ts` (remove analytics-engine.json writes)
- `src/request-history.ts` (remove request-history.json writes)
- `src/decision-history.ts` (remove decision-history.json writes)

**Steps:**

1. Remove JSON file path constants for these files
2. Remove `saveToDisk()` calls for these data types
3. Remove `loadFromDisk()` calls on startup for these data types
4. Keep JSON persistence for: servers, bans, timeouts, circuit-breakers

**Testing Gate:** Run full test suite after completion

---

### Phase 4.5: Config Cleanup

**Files:**

- `src/config/config.ts`
- `src/config/schema.ts`
- `src/config/envMapper.ts`
- `src/controllers/configController.ts`

**Steps:**

1. Add/update config schema for `storage.*` settings (dbPath, retention, performance, temporal)
2. Remove `metrics.historyWindowMinutes` dead config
3. Update environment variable mappings

**Testing Gate:** Run full test suite after completion

---

## Risk Mitigation

1. **Backup Strategy:** All changes committed to branch before merge to main
2. **Incremental Testing:** Each subtask runs full test suite before proceeding
3. **Fallback Prevention:** Ensure MetricsStore reads work before removing in-memory fallbacks
4. **Rollback Plan:** Git history allows easy rollback if issues arise

## Success Criteria

- [ ] Phase 4.1 complete + tests pass
- [ ] Phase 4.2 complete + tests pass
- [ ] Phase 4.3 complete + tests pass
- [ ] Phase 4.4 complete + tests pass
- [ ] Phase 4.5 complete + tests pass
- [ ] All 2500+ tests pass
- [ ] No typecheck or lint errors
