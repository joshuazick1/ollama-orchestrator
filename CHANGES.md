
## 2026-04-11: Backend Schema Alignment with Frontend

### Changes to `src/config/schema.ts`

**serverConfigSchema:**
1. `maxConcurrency`: Changed max from `1000` to `100` to match frontend HTML input and Zod schema
2. `apiKey`: Added regex validation `/^(env:[A-Z_][A-Z0-9_]*|sk-[a-zA-Z0-9-_]*)?$/` to match frontend validation pattern

### Verification
- Build: **PASSED** (TypeScript compile + Vite frontend build)
- Tests: 108 test files, 2899 tests (5 failures are pre-existing, unrelated to schema changes)

### Notes
- Test failures are in `orchestrator.test.ts` related to circuit-breaker-persistence mock (store.saveCircuitBreakerState is not a function) - pre-existing issue
- Changes align backend validation with frontend for consistency
