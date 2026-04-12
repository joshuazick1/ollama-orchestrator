# Frontend Visual Design Enhancement

## TL;DR

> **Quick Summary**: Fix inconsistent design token usage across the Ollama Orchestrator frontend, create reusable Button/Badge components, add custom typography, and utilize the existing animation library.
> 
> **Deliverables**:
> - Token-consistent components (no more `bg-gray-800` hardcoding)
> - New `Button.tsx` and `Badge.tsx` components
> - Custom typography (JetBrains Mono + Outfit fonts)
> - Stagger animations applied to dashboard cards
> 
> **Estimated Effort**: Large (37 files with hardcoded colors, 241+ occurrences)
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Token audit → Core components → Typography → Animations

---

## Context

### Original Request
Enhance frontend visual design: fix inconsistent design tokens (~60% hardcoded), create Button/Badge components, improve typography with custom fonts, utilize existing animations.

### Audit Findings

| Metric | Count | Files |
|--------|-------|-------|
| `bg-gray-(800\|900\|700)` matches | 241 | 37 |
| `text-white` matches | 257 | 36 |
| `hover:bg-gray-750` matches (invalid) | 5 | 4 |
| Design tokens defined | 15 | index.css |

### Scope Expansion (from Metis review)
The initial estimate of "7 core files" was too optimistic. Grep reveals:
- 37 files contain `bg-gray-*` hardcoded values
- 36 files contain `text-white` instead of semantic tokens
- Actual scope is ~3x larger than originally scoped

---

## Work Objectives

### Core Objective
Achieve 90%+ design token usage consistency across the frontend by replacing hardcoded Tailwind color values with semantic tokens.

### Concrete Deliverables
- [ ] No `bg-gray-800`, `bg-gray-900`, `bg-gray-700` in component files (use `bg-surface`, `bg-surface-raised`)
- [ ] No `text-white` in component files (use `text-text-base`)
- [ ] `Button.tsx` component with primary/secondary/danger/ghost variants
- [ ] `Badge.tsx` component with success/warning/danger/info/neutral variants
- [ ] Custom fonts: JetBrains Mono (mono) + Outfit (sans) via Google Fonts
- [ ] Stagger animations on dashboard stat cards
- [ ] Fix `hover:bg-gray-750` invalid class in 4 files

### Must Have
- All existing components maintain visual appearance (no regression)
- Button/Badge work in both dark and light themes
- Animations respect `prefers-reduced-motion`
- No FOIT for font loading (use `font-display: swap`)
- **Centralized color constants** in `frontend/src/constants/colors.ts` for future maintainability

### Must NOT Have (Guardrails)
- MUST NOT introduce new design tokens — use EXISTING tokens only
- MUST NOT modify authentication flows or form validation
- MUST NOT change component prop APIs of existing components
- MUST NOT add new dependencies without explicit approval
- MUST NOT modify backend API contracts
- MUST NOT remove existing CSS variables
- MUST NOT modify `node_modules` or `package-lock.json`
- MUST NOT change build configuration
- MUST NOT touch test files (unless verifying existing tests pass)

---

## Verification Strategy

**ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### QA Policy
Every task includes agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/`.

| Check Type | Tool | Command |
|------------|------|---------|
| Hardcoded colors removed | Bash | `grep -rE 'bg-gray-(800\|900\|700)' --include='*.tsx' frontend/src/components frontend/src/pages` |
| text-white removed | Bash | `grep -r 'text-white' --include='*.tsx' frontend/src/components frontend/src/pages` |
| Invalid class fixed | Bash | `grep -r 'hover:bg-gray-750' --include='*.tsx' frontend/src` |
| TypeScript passes | Bash | `cd frontend && npx tsc --noEmit` |
| Build passes | Bash | `cd frontend && npm run build` |
| Visual smoke test | Playwright | Screenshot key pages |

---

## Execution Strategy

### Parallelization Notes
- Wave 1: Scaffolding (token audit, new components) — can parallelize 3 agents
- Wave 2: Core fixes across files — single deep agent for safety
- Wave 3: Typography + animations — single agent
- HIGH RISK: 37 files × multiple changes = HIGH regression risk

### Dependency Matrix
```
TokenAudit (T1)
  └── Wave 1: CentralizedColors (T2) ── Button (T3) ── Badge (T4) ── Fonts/Shadows (T5) ── Tailwind (T6)
                                          │                │              │
                                          └────────────────┴────────────────┘
                                                                   │
                                                                   ▼
                                              Wave 2: TokenFixes (T7) ── Wave 3: Typography+Animations (T12-T15) ── FinalQA (F1-F4)
```

### Agent Dispatch Summary
- **Wave 1**: 6 parallel agents (T2-T6) - new infrastructure components
- **Wave 2**: 1 deep agent (T7) for incremental token fixes
- **Wave 3**: 2 agents (T12-T13) for remaining polish
- **Final**: 4 parallel agents (F1-F4) for verification

---

## TODOs

- [x] 1. **Token Audit Baseline** — `ultrabrain`
- [x] 2. **Create Centralized Color Constants** — `quick`
- [x] 3. **Create Button Component** — `quick`
- [x] 4. **Create Badge Component** — `quick`
- [x] 5. **Update index.css - Fonts + Shadows** — `quick`
- [x] 6. **Update tailwind.config.js - Font Family** — `quick`
  
  **What to do**:
  - Add fontFamily configuration
  - fontFamily: { sans: ['Outfit', ...], mono: ['JetBrains Mono', ...] }
  
  **Must NOT do**:
  - MUST NOT change color tokens
  - MUST NOT change existing config structure
  
  **Acceptance Criteria**:
  - [ ] tailwind.config.js updated with fontFamily
  - [ ] Build still passes: cd frontend && npm run build → PASS

- [x] 7. **Token Fix: Settings Pages** — `deep`
- [x] 8. **Token Fix: Analytics Pages** — `deep`
- [x] 9. **Token Fix: Main Pages** — `deep`
- [x] 10. **Token Fix: Components Part 1** — `deep`
- [x] 11. **Token Fix: Components Part 2** — `deep`
  
  **Files** (HIGH COUNT):
  - `frontend/src/components/Layout.tsx` (11 bg-gray, 9 text-white)
  - `frontend/src/components/CircuitDetailModal.tsx` (23 bg-gray, 41 text-white)
  - `frontend/src/components/skeletons/index.tsx` (10 bg-gray, 0 text-white)
  - `frontend/src/components/ErrorLog.tsx` (8 bg-gray, 14 text-white, + 1 hover:bg-gray-750)
  - `frontend/src/components/ModelManagerModal.tsx` (7 bg-gray, 9 text-white)
  - `frontend/src/components/DataToolbar.tsx` (5 bg-gray, 3 text-white)
  - `frontend/src/components/GlobalSearch.tsx` (5 bg-gray, 2 text-white)
  - `frontend/src/components/ProtectedRoute.tsx` (2 bg-gray, 2 text-white)
  - `frontend/src/components/ErrorBoundary.tsx` (3 bg-gray, 2 text-white)
  - `frontend/src/components/SearchResultGroup.tsx` (1 bg-gray, 1 text-white)
  
  **What to do**: Standard replacements. Layout.tsx line 31 nav state needs special attention.
  
  **QA Scenarios**:
  ```
  Scenario: Components Part 2 token fix
    Tool: Bash
    Preconditions: Files modified
    Steps:
      1. grep -r 'hover:bg-gray-750' frontend/src/components/ → 0 matches
      2. grep -c 'bg-gray-800' frontend/src/components/CircuitDetailModal.tsx → check if reduced from 23
      3. cd frontend && npm run build → PASS
    Expected Result: Build passes
    Evidence: .sisyphus/evidence/task-10-components2-tokens.txt
  ```

- [x] 12. **Update Servers.tsx to use Button + Badge** — `quick`
  
  **What to do**:
  - Import Button and Badge components
  - Replace inline status badges with `<Badge variant="success|danger|...">`
  - Replace inline button styles with `<Button variant="...">`
  - Remove hardcoded status badge patterns
  
  **References**:
  - `Servers.tsx:327` - Current inline status badge pattern
  - `Servers.tsx:292` - Add Server button
  
  **Acceptance Criteria**:
  - [ ] Badge component used for server health status
  - [ ] Button component used for action buttons
  - [ ] grep 'bg-green-500/20\|bg-red-500/20' → fewer matches

- [x] 13. **Apply Stagger Animations to Dashboard** — `quick`
  
  **What to do**:
  - Apply `animate-slide-up` + stagger classes to StatCard components
  - Apply `stagger-1` through `stagger-4` to the 4 main stat cards
  - Apply `stagger-5` through `stagger-8` to secondary streaming stats
  
  **References**:
  - `frontend/src/pages/Dashboard.tsx:99-158` - StatCard grid location
  - `frontend/src/index.css:171-180,232-249` - slideUp animation + stagger classes
  
  **Acceptance Criteria**:
  - [ ] StatCards have stagger classes applied
  - [ ] Animation still works when prefers-reduced-motion is set

- [ ] 14. **Final Verification: Grep Audit** — `deep`
  
  **What to do**:
  - Run final grep for all hardcoded patterns
  - Document any legitimate exceptions (rare cases where hardcoded is needed)
  - Verify TypeScript build passes
  - Verify all tests pass
  - Verify centralized colors file exists and is importable
  
  **QA Scenarios**:
  ```
  Scenario: Final grep verification
    Tool: Bash
    Preconditions: All tasks complete
    Steps:
      1. grep -rE 'bg-gray-(800|900|700)' --include='*.tsx' frontend/src/components frontend/src/pages > final-bg.txt
      2. grep -r 'text-white' --include='*.tsx' frontend/src/components frontend/src/pages > final-text.txt
      3. grep -r 'hover:bg-gray-750' --include='*.tsx' frontend/src > final-hover.txt
      4. Count and compare to baseline
      5. node -e "require('./frontend/src/constants/colors.ts')" → should not error
    Expected Result: 80%+ reduction in matches, colors module loads
    Evidence: .sisyphus/evidence/task-14-final-audit.txt
  ```

- [x] 15. **Update skeletons for shimmer consistency** — `quick`
  
  **What to do**:
  - Update skeleton loading states to use `animate-shimmer` class
  - Replace any remaining `animate-pulse` with shimmer
  
  **References**:
  - `frontend/src/index.css:83-114` - shimmer definitions
  - `frontend/src/components/skeletons/index.tsx` - current skeleton implementations
  
  **Acceptance Criteria**:
  - [ ] All skeletons use shimmer, not pulse

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** — `oracle` ✅ APPROVE (metrics pass: 33 bg-gray < 50, 10 text-white < 50)
   
   Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search for forbidden patterns.

- [x] F2. **Code Quality Review** — `unspecified-high` ✅ APPROVE
   
   Run `tsc --noEmit` + linter + build. Check for `as any`, `@ts-ignore`, empty catches, console.log in production.

- [x] F3. **Real Manual QA** — `unspecified-high` + `playwright` ✅ APPROVE
   
   Start frontend dev server. Take screenshots of key pages. Verify no visual regression.

- [x] F4. **Scope Fidelity Check** — `deep` ⚠️ CONDITIONAL PASS (core FE work complete; cross-cont from other sessions noted)
   
   For each task: verify task was completed as specified. Detect any cross-task contamination.

---

## Success Criteria

### Metric Targets
| Metric | Before | After |
|--------|--------|-------|
| `bg-gray-*` in components | 241 matches | < 50 matches |
| `text-white` in components | 257 matches | < 50 matches |
| `hover:bg-gray-750` | 5 matches | 0 matches |
| Design system coherence | 6/10 | 8/10 |

### Verification Commands
```bash
# Should return 0 after full implementation
grep -rE 'bg-gray-(800|900|700)' --include='*.tsx' frontend/src/components frontend/src/pages | wc -l
grep -r 'text-white' --include='*.tsx' frontend/src/components frontend/src/pages | wc -l
grep -r 'hover:bg-gray-750' --include='*.tsx' frontend/src | wc -l

# Build verification
cd frontend && npm run build

# Type check
cd frontend && npx tsc --noEmit
```

---

## Commit Strategy

| Task | Commit Message |
|------|----------------|
| 1 | `chore(frontend): baseline token audit` |
| 2 | `feat(frontend): add centralized color constants` |
| 3 | `feat(frontend): add Button component` |
| 4 | `feat(frontend): add Badge component` |
| 5-6 | `feat(frontend): add custom fonts and shadow scale` |
| 7 | `fix(frontend): token consistency in settings pages` |
| 8 | `fix(frontend): token consistency in analytics pages` |
| 9 | `fix(frontend): token consistency in main pages` |
| 10-11 | `fix(frontend): token consistency in components` |
| 12 | `refactor(frontend): use Button/Badge in Servers page` |
| 13 | `feat(frontend): apply stagger animations to Dashboard` |
| 14 | `chore(frontend): final audit and skeleton polish` |

---

## Appendix: Token Mapping Reference

| Hardcoded | Semantic Token | Centralized Constant |
|-----------|---------------|---------------------|
| `bg-gray-800` | `bg-surface` | `colors.surface` |
| `bg-gray-900` | `bg-surface-raised` | `colors.surfaceRaised` |
| `bg-gray-700` | `bg-surface` (hover) | `colors.hoverSurface` |
| `text-white` | `text-text-base` | `colors.textBase` |
| `text-gray-400` | `text-text-muted` | `colors.textMuted` |
| `text-gray-500` | `text-text-subtle` | `colors.textSubtle` |
| `hover:bg-gray-700` | `hover:bg-surface` | `colors.hoverSurface` |
| `hover:bg-gray-800` | `hover:bg-surface-raised` | `colors.hoverSurfaceRaised` |
| `hover:bg-gray-600` | `hover:bg-surface-border` | `colors.hoverSurfaceBorder` |
| `border-gray-700` | `border-surface-border` | `colors.surfaceBorder` |
| `border-gray-600` | `border-surface-border` | `colors.surfaceBorder` |

---

## Appendix: Token Mapping Reference

| Hardcoded | Semantic Token |
|-----------|---------------|
| `bg-gray-800` | `bg-surface` |
| `bg-gray-900` | `bg-surface-raised` |
| `bg-gray-700` | `bg-surface` (hover) |
| `text-white` | `text-text-base` |
| `text-gray-400` | `text-text-muted` |
| `text-gray-500` | `text-text-subtle` |
| `hover:bg-gray-700` | `hover:bg-surface` |
| `hover:bg-gray-800` | `hover:bg-surface-raised` |
| `hover:bg-gray-600` | `hover:bg-surface-border` |
| `border-gray-700` | `border-surface-border` |
| `border-gray-600` | `border-surface-border` |
