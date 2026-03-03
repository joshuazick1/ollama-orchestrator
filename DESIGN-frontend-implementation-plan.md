# Frontend Enhancement Implementation Plan

> Comprehensive implementation roadmap for all frontend enhancements.
> Date: 2026-03-02

## Table of Contents

1. [Phase Overview](#1-phase-overview)
2. [Phase 1: Quick Wins & Bug Fixes](#2-phase-1-quick-wins--bug-fixes)
3. [Phase 2: Type Safety & Code Quality](#3-phase-2-type-safety--code-quality)
4. [Phase 3: UX Improvements](#4-phase-3-ux-improvements)
5. [Phase 4: Architecture Refactoring](#5-phase-4-architecture-refactoring)
6. [Phase 5: Accessibility](#5-phase-5-accessibility)
7. [Phase 6: Testing](#6-phase-6-testing)
8. [Phase 7: Theming & Polish](#7-phase-7-theming--polish)
9. [CI/CD Pipeline](#8-cicd-pipeline)
10. [Commit Strategy](#9-commit-strategy)

---

## 1. Phase Overview

| Phase | Focus Area                 | Duration | Priority |
| ----- | -------------------------- | -------- | -------- |
| 1     | Quick Wins & Bug Fixes     | 1-2 days | Critical |
| 2     | Type Safety & Code Quality | 2-3 days | High     |
| 3     | UX Improvements            | 2-3 days | High     |
| 4     | Architecture Refactoring   | 3-5 days | Medium   |
| 5     | Accessibility              | 2-3 days | Medium   |
| 6     | Testing                    | 3-5 days | Medium   |
| 7     | Theming & Polish           | 2-3 days | Low      |

---

## 2. Phase 1: Quick Wins & Bug Fixes

### 2.1 Fix Broken `useHotkeys` Hook

**Files:** `frontend/src/hooks/useHotkeys.ts`

**Steps:**

1. Read the current implementation
2. Rewrite the key parsing logic:
   - Split by `+`, extract last element as the key
   - Extract preceding elements as modifiers
   - Check each modifier against corresponding event property
3. Add test coverage for multiple key combinations
4. Verify Cmd+K global search still works

**Commit:** `fix(hooks): correct key parsing logic in useHotkeys`

### 2.2 Fix XSS in HTML Export

**Files:** `frontend/src/utils/export.ts`

**Steps:**

1. Read `utils/security.ts` to understand `sanitizeDisplayText`
2. Import `sanitizeDisplayText` into `export.ts`
3. Apply sanitization to all interpolated values in `generateReportHTML`:
   - `title`, `timeRange`, `section.title`
   - All cell values in tables
4. Add unit tests for XSS vectors

**Commit:** `fix(security): sanitize HTML export to prevent XSS`

### 2.3 Delete Dead Code

**Files:** `frontend/src/App.css`

**Steps:**

1. Verify `App.css` is not imported anywhere (`grep -r "App.css" frontend/src/`)
2. Delete the file
3. Verify build still works

**Commit:** `chore: remove unused App.css scaffold file`

### 2.4 Extract Hardcoded Version

**Files:** `frontend/src/components/Layout.tsx`

**Steps:**

1. Create `frontend/src/constants/app.ts`
2. Add `export const APP_VERSION = 'v1.0.0'` (or read from package.json)
3. Import in `Layout.tsx` and replace hardcoded strings
4. Update test to import the constant

**Commit:** `refactor: extract hardcoded version to constants`

### 2.5 Standardize Toast Feedback

**Files:** `frontend/src/pages/Servers.tsx`, `frontend/src/pages/Settings.tsx`, `frontend/src/pages/Logs.tsx`

**Steps:**

1. Add Server mutations in `Servers.tsx`:
   - `addServer` mutation: add success toast on line ~55
   - `removeServer` mutation: add error toast handling
2. Update `Settings.tsx` line ~291:
   - Replace inline "Saved successfully" text with `toast.success()`
3. Add toast to `Logs.tsx` clear logs action
4. Verify all mutations now have consistent feedback

**Commit:** `fix(ux): standardize toast notifications for all mutations`

### 2.6 Add Confirmation Dialogs for Destructive Actions

**Files:** `frontend/src/components/Layout.tsx` (new ConfirmationModal component)

**Steps:**

1. Create `frontend/src/components/ConfirmationModal.tsx`:
   ```typescript
   interface ConfirmationModalProps {
     isOpen: boolean;
     onClose: () => void;
     onConfirm: () => void;
     title: string;
     message: string;
     confirmLabel?: string;
     variant?: 'danger' | 'warning';
   }
   ```
2. Add to `Servers.tsx`: delete server action
3. Add to `Models.tsx`: delete model action
4. Add to `Logs.tsx`: clear logs action
5. Add to `CircuitBreakers.tsx`: clear all bans action

**Commit:** `feat(ux): add confirmation dialogs for destructive actions`

---

## 3. Phase 2: Type Safety & Code Quality

### 3.1 Replace `any` Types

**Files:**

- `frontend/src/components/CircuitDetailModal.tsx`
- `frontend/src/pages/Analytics.tsx`

**Steps:**

#### CircuitDetailModal.tsx

1. Read the file, identify all `any` usages (lines ~178, 286, 340, 515, 555)
2. Define interfaces:

   ```typescript
   interface MetricsData {
     totalRequests: number;
     successRate: number;
     avgLatency: number;
     errorRate: number;
     // ... other fields from API
   }

   interface RequestItem {
     id: string;
     server: string;
     model: string;
     timestamp: number;
     // ...
   }
   ```

3. Replace all `any` with proper types
4. Update component props to use the new interfaces

#### Analytics.tsx

1. Identify `[string, any]` destructuring (lines ~1654, 1656)
2. Define `ServerMetrics`, `ModelMetrics` interfaces
3. Replace `any` with proper types

**Commit:** `refactor(types): replace any types with proper interfaces`

### 3.2 Fix Unsafe Type Assertions

**Files:** `frontend/src/utils/configValidation.ts`

**Steps:**

1. Review all `as` casts (lines ~29, 31, 39, 58, 69, 226, 231, 236, 241, 246)
2. Rewrite validation functions to use Zod parsing:

   ```typescript
   const loadBalancerSchema = z.object({
     strategy: z.enum(['round-robin', 'least-connections', 'weighted']),
     weights: z.record(z.string(), z.number()),
   });

   function validateLoadBalancerConfig(config: unknown) {
     const result = loadBalancerSchema.safeParse(config);
     if (!result.success) {
       return { success: false, errors: result.error.flatten().fieldErrors };
     }
     return { success: true, errors: {} };
   }
   ```

3. Standardize return types across all validation functions
4. Add tests for valid/invalid configurations

**Commit:** `refactor(types): use Zod parsing instead of unsafe type assertions`

### 3.3 Untyped JSON Parsing

**Files:** `frontend/src/hooks/useWebSocket.ts`

**Steps:**

1. Define message type schemas with Zod
2. Parse incoming messages through Zod
3. Handle parse errors gracefully

**Commit:** `fix(types): add type safety to WebSocket message parsing`

### 3.4 Fix CircuitBreaker Type Signature

**Files:** `frontend/src/utils/circuitBreaker.tsx`

**Steps:**

1. Change all function signatures from `state: string` to `state: CircuitBreakerState`
2. Verify TypeScript compilation

**Commit:** `refactor(types): use CircuitBreakerState union type`

### 3.5 Fix Main.tsx Non-null Assertion

**Files:** `frontend/src/main.tsx`

**Steps:**

1. Add null check with fallback:
   ```typescript
   const root = document.getElementById('root');
   if (!root) {
     throw new Error('Root element not found');
   }
   createRoot(root).render(/* ... */);
   ```

**Commit:** `fix: add null check for root element`

### 3.6 Extract Magic Numbers

**Files:** Multiple (formatting.ts, toast.ts, configValidation.ts, Settings.tsx)

**Steps:**

1. Create `frontend/src/constants/time.ts`:

   ```typescript
   export const MS_PER_SECOND = 1000;
   export const MS_PER_MINUTE = 60000;
   export const MS_PER_HOUR = 3600000;
   export const MS_PER_DAY = 86400000;

   export const DEFAULT_TOAST_DURATION = 4000;
   export const ERROR_TOAST_DURATION = 5000;
   ```

2. Create `frontend/src/constants/defaults.ts` for config defaults
3. Update all files to import from constants
4. Update Settings.tsx with centralized defaults

**Commit:** `refactor: extract magic numbers to constants`

### 3.7 Consolidate Formatting Utilities

**Files:** `frontend/src/utils/formatting.ts`

**Steps:**

1. Create unified function with options:
   ```typescript
   interface DurationOptions {
     short?: boolean;
     unit?: 'ms' | 's';
     decimals?: number;
   }
   export function formatDuration(ms: number, opts: DurationOptions = {}): string;
   ```
2. Keep backward-compatible wrappers if needed
3. Fix edge cases (0, negative, NaN, Infinity)
4. Add tests

**Commit:** `refactor: consolidate formatting utilities`

### 3.8 Consolidate Download Logic

**Files:** `frontend/src/utils/export.ts`

**Steps:**

1. Extract shared download helper:
   ```typescript
   export function downloadBlob(blob: Blob, filename: string): void;
   ```
2. Refactor CSV, JSON, HTML exports to use the helper

**Commit:** `refactor: extract duplicated download logic`

### 3.9 Consolidate CircuitBreaker Switches

**Files:** `frontend/src/utils/circuitBreaker.tsx`

**Steps:**

1. Create config map:
   ```typescript
   const CIRCUIT_BREAKER_CONFIG: Record<CircuitBreakerState, {...}> = { ... }
   ```
2. Refactor functions to use the map
3. Remove duplicate switch statements

**Commit:** `refactor: consolidate circuit breaker config`

---

## 4. Phase 3: UX Improvements

### 3.1 Use Existing Skeleton Components

**Files:** All pages in `frontend/src/pages/`

**Steps:**

#### Dashboard.tsx (already done - use as reference)

- Already uses skeletons - verify pattern is correct

#### Servers.tsx

1. Import `SkeletonServerCard` from `components/skeletons`
2. Replace line ~191 "Loading..." with skeleton map
3. Render 3-5 skeleton cards while loading

#### Models.tsx

1. Import `SkeletonModelRow`
2. Replace loading state at ~320

#### Logs.tsx

1. Import `SkeletonTable`
2. Replace loading at ~16

#### InFlight.tsx

1. Import appropriate skeleton
2. Replace loading at ~73

#### Analytics.tsx

1. Import `SkeletonChart`, `SkeletonTabs`
2. Replace full-page loading with per-section skeletons
3. Show skeleton only for active tab data

**Commit:** `feat(ux): replace loading text with skeleton components`

### 3.2 Add Error States to Pages

**Files:** `Servers.tsx`, `Models.tsx`, `Logs.tsx`, `InFlight.tsx`, `CircuitBreakers.tsx`, `Analytics.tsx`

**Steps:**

1. For each page, add error handling:
   ```typescript
   if (isError) {
     return (
       <EmptyState
         type="error"
         title="Failed to load servers"
         message={error.message}
         actionLabel="Retry"
         onAction={() => refetch()}
       />
     );
   }
   ```
2. Use existing `EmptyState` component with `type="error"`
3. Wire up retry button to `refetch()`

**Commit:** `feat(ux): add error states with retry to all pages`

### 3.3 Add Focus Trapping to Modals

**Files:** `frontend/src/components/Modal.tsx`, `frontend/src/components/GlobalSearch.tsx`

**Steps:**

1. Install `focus-trap-react` (or implement manually):
   ```bash
   cd frontend && npm install focus-trap-react
   ```
2. Wrap Modal content in `<FocusTrap>`
3. Configure focus trap options (auto-initialization, return focus on close)
4. Test keyboard navigation: Tab should cycle within modal

**Commit:** `feat(a11y): add focus trapping to modals`

### 3.4 Add StaleTime to React Query

**Files:** `frontend/src/App.tsx`

**Steps:**

1. Read current QueryClient configuration
2. Add `staleTime` to default options:
   ```typescript
   const queryClient = new QueryClient({
     defaultOptions: {
       queries: {
         staleTime: 10_000, // 10 seconds
         // ...existing config
       },
     },
   });
   ```

**Commit:** `perf: add staleTime to React Query defaults`

### 3.5 Add React.memo to List Items

**Files:** Components used in lists

**Steps:**

1. Identify list-rendered components:
   - Server cards in `Servers.tsx`
   - Model rows in `Models.tsx`
   - Circuit breaker cards in `CircuitBreakers.tsx`
   - Log entries in `Logs.tsx`
2. Wrap each in `React.memo`:
   ```tsx
   const ServerCard = React.memo(function ServerCard({ server, ... }) {
     // ...
   });
   ```
3. Add custom comparison function where helpful (skip function prop equality)

**Commit:** `perf: add React.memo to frequently rendered list components`

### 3.6 Memoize Expensive Computations

**Files:** `frontend/src/pages/Analytics.tsx`

**Steps:**

1. Locate IIFE in trends tab (lines ~1711-1743)
2. Wrap in `useMemo`:
   ```typescript
   const trendPoints = useMemo(() => {
     // ... computation
   }, [snapshots, servers, models]);
   ```

**Commit:** `perf: memoize trends computation in Analytics`

---

## 5. Phase 4: Architecture Refactoring

### 4.1 Split Analytics Page

**Files:** `frontend/src/pages/Analytics.tsx`

**Steps:**

1. Create directory `frontend/src/pages/analytics/`
2. Create `index.tsx` - main layout with tab switching
3. Create sub-component files:
   - `OverviewTab.tsx`
   - `PerformanceTab.tsx`
   - `ModelsTab.tsx`
   - `ServersTab.tsx`
   - `ErrorsTab.tsx`
   - `CapacityTab.tsx`
   - `RequestsTab.tsx`
   - `TrendsTab.tsx`
4. Move each tab's JSX to its respective file
5. Keep shared types and utilities in `analytics/` directory
6. Update imports in `index.tsx`
7. Update router in `App.tsx` (if needed)

**Commit:** `refactor: split Analytics into per-tab components`

### 4.2 Split Settings Page

**Files:** `frontend/src/pages/Settings.tsx`

**Steps:**

1. Create directory `frontend/src/pages/settings/`
2. Create `index.tsx` - main layout with tab switching
3. Create component files:
   - `components/Toggle.tsx`
   - `components/NumberInput.tsx`
   - `components/SelectInput.tsx`
4. Create section files:
   - `GeneralSection.tsx`
   - `LoadBalancerSection.tsx`
   - `CircuitBreakerSection.tsx`
   - `StreamingSection.tsx`
   - `SecuritySection.tsx`
   - `ModelManagerSection.tsx`
5. Move each section's JSX to its file
6. Update imports in `index.tsx`

**Commit:** `refactor: split Settings into per-section components`

### 4.3 Refactor Modals to Use Reusable Component

**Files:** `frontend/src/components/ModelManagerModal.tsx`, `frontend/src/components/CircuitDetailModal.tsx`

**Steps:**

1. Read current `Modal.tsx` implementation (which now includes `focus-trap-react`).
2. Refactor `ModelManagerModal`:
   - Remove duplicate overlay/scroll-lock/ESC logic.
   - Compose on top of `<Modal>` while maintaining existing focus trapping and internal scroll areas.
   - Maintain the strict TypeScript interfaces implemented in Phase 2.
     ```tsx
     <Modal isOpen={isOpen} onClose={onClose} size="xl">
       <ModalHeader>...</ModalHeader>
       <ModalBody>...</ModalBody>
     </Modal>
     ```
3. Repeat for `CircuitDetailModal`, ensuring `CircuitMetricsData` and `DecisionHistoryItem` types are preserved.
4. Verify all functionality (tabs, scroll, close) still works without breaking `focus-trap-react`.

**Commit:** `refactor: use reusable Modal component in all modals`

### 4.4 Extract Navigation Items (✅ Completed)

**Files:** `frontend/src/components/Layout.tsx`

**Steps:**

1. Create `frontend/src/constants/navigation.ts`:
   ```typescript
   export const NAV_ITEMS = [
     { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
     { to: '/servers', icon: Server, label: 'Servers' },
     // ...
   ] as const;
   ```
2. Import and map in desktop sidebar (lines 77-101)
3. Import and map in mobile sidebar (lines 148-172)
4. Remove duplicate definitions

**Commit:** `refactor: extract navigation items to constants`

### 4.5 Move createEventEmitter to Utils (✅ Completed)

**Files:** `frontend/src/hooks/useWebSocket.ts`

**Steps:**

1. Create `frontend/src/utils/eventEmitter.ts`
2. Move `createEventEmitter` function
3. Update import in `useWebSocket.ts`

**Commit:** `refactor: move createEventEmitter to utils`

### 4.6 Fix useRealTimeUpdates to Wrap useWebSocket

**Files:** `frontend/src/hooks/useWebSocket.ts`

**Steps:**

1. Rewrite `useRealTimeUpdates` to compose `useWebSocket` rather than duplicating connection logic.
2. Use `useRef` to fix stale closure risks and properly manage the `onUpdate` callback without causing infinite re-renders or missed events.
   ```typescript
   const onUpdateRef = useRef(onUpdate);
   useEffect(() => {
     onUpdateRef.current = onUpdate;
   }, [onUpdate]);
   // use onUpdateRef.current in WebSocket message handler
   ```
3. Ensure no regression in type safety for WebSocket messages (implemented in Phase 2).

**Commit:** `refactor(hooks): compose useRealTimeUpdates with useWebSocket`

### 4.7 Splitting Monolithic Page Files

**Files:** `frontend/src/pages/Analytics.tsx`, `frontend/src/pages/Settings.tsx`

**Steps:**

1. Fully transition from single massive files (~1900 lines for Analytics, ~1400 lines for Settings) to directory-based modular structures.
2. Analytics: extract OverviewTab, PerformanceTab, ModelsTab, ServersTab, ErrorsTab, CapacityTab, RequestsTab, TrendsTab.
3. Settings: extract GeneralSection, LoadBalancerSection, CircuitBreakerSection, StreamingSection, SecuritySection, ModelManagerSection.
4. Integrate React components securely and check all TypeScript configurations (`tsc -b`).

**Commit:** `refactor(pages): split massive pages into modular directories`

### 4.7 Decide on WebSocket Integration

**Decision Point:**

- **Option A (Integrate):** Connect WebSocket to Dashboard/InFlight for live updates
- **Option B (Remove):** Delete unused hooks

**If Option A:**

1. Identify where live updates would help (Dashboard stats, InFlight request list)
2. Replace `refetchInterval` polling with WebSocket subscription
3. Update query cache on message receipt

**If Option B:**

1. Remove `useWebSocket.ts`, `useRealTimeUpdates` exports
2. Remove event emitter utility
3. Verify build passes

**Commit:** (depends on decision)

---

## 6. Phase 5: Accessibility

### 5.1 Label Form Controls

**Files:** `frontend/src/pages/analytics/RequestsTab.tsx`

**Steps:**

1. Find unlabeled `<select>` elements
2. Add `aria-label` attributes:
   ```tsx
   <select aria-label="Filter by time range">
   ```
3. Verify all form inputs have labels

**Commit:** `feat(a11y): add aria-labels to form controls`

### 5.2 Keyboard-Accessible Table Rows

**Files:** `frontend/src/pages/analytics/RequestsTab.tsx`

**Steps:**

1. Find interactive `<tr>` elements
2. Add accessibility attributes:
   ```tsx
   <tr
     tabIndex={0}
     role="button"
     onClick={() => toggleRow(id)}
     onKeyDown={(e) => {
       if (e.key === 'Enter' || e.key === ' ') {
         e.preventDefault();
         toggleRow(id);
       }
     }}
   >
   ```

**Commit:** `feat(a11y): make interactive table rows keyboard-accessible`

### 5.3 Screen Reader Text for Empty Headers

**Files:** `frontend/src/pages/analytics/RequestsTab.tsx`

**Steps:**

1. Find empty `<th>`
2. Add sr-only text:
   ```tsx
   <th className="w-8 py-3">
     <span className="sr-only">Expand row</span>
   </th>
   ```

**Commit:** `feat(a11y): add sr-only text to empty table headers`

### 5.4 Fix useHotkeys preventDefault

**Files:** `frontend/src/hooks/useHotkeys.ts`

**Steps:**

1. Only call `preventDefault()` for matched hotkeys, not unconditionally
2. Document which shortcuts may conflict with browser defaults

**Commit:** `fix(a11y): conditional preventDefault in useHotkeys`

### 5.5 Extract Search Result Components

**Files:** `frontend/src/components/GlobalSearch.tsx`

**Steps:**

1. Create `SearchResultGroup` component:
   ```tsx
   interface SearchResultGroupProps {
     title: string;
     items: SearchResult[];
     renderItem: (item: SearchResult) => ReactNode;
   }
   ```
2. Refactor the three duplicated sections to use the component

**Commit:** `refactor: extract SearchResultGroup component`

---

## 7. Phase 6: Testing

### 6.1 Set Up Proper Test Infrastructure

**Files:** `frontend/src/__tests__/`

**Steps:**

1. Add `QueryClientProvider` wrapper to test setup:

   ```typescript
   // test/setup.ts
   import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

   const queryClient = new QueryClient();

   wrapper: ({ children }) => (
     <QueryClientProvider client={queryClient}>
       {children}
     </QueryClientProvider>
   )
   ```

2. Update `Layout.test.tsx` to use the wrapper

**Commit:** `test: add QueryClientProvider to test setup`

### 6.2 Fix Existing Tests

**Files:** `frontend/src/__tests__/App.test.tsx`, `frontend/src/__tests__/Layout.test.tsx`

**Steps:**

1. Fix `App.test.tsx`:
   - Remove trivial `document.body` assertion
   - Add meaningful assertions (check for navigation links, page content)
2. Fix `Layout.test.tsx`:
   - Import version from constants instead of hardcoding
   - Add tests for active link highlighting
   - Add tests for mobile drawer toggle

**Commit:** `test: improve existing test assertions`

### 6.3 Add Utility Tests

**Files:** `frontend/src/utils/__tests__/`

**Steps:**

1. Create `formatting.test.ts`:
   - Test edge cases: 0, negative, NaN, Infinity, very large numbers
   - Test all formatting options
2. Create `security.test.ts`:
   - Test XSS prevention vectors
   - Test URL encoding/decoding
3. Create `configValidation.test.ts`:
   - Test valid configurations
   - Test invalid configurations
   - Test boundary values

**Commit:** `test: add utility function tests`

### 6.4 Add Hook Tests

**Files:** `frontend/src/hooks/__tests__/`

**Steps:**

1. Create `useHotkeys.test.ts`:
   - Test various key combinations
   - Test modifier detection
   - Test cleanup on unmount
2. Create `useWebSocket.test.ts` (if keeping the hook):
   - Test connection/reconnection
   - Test message parsing

**Commit:** `test: add hook tests`

### 6.5 Add Component Tests

**Files:** `frontend/src/components/__tests__/`

**Steps:**

1. Create `Modal.test.tsx`:
   - Test open/close
   - Test ESC key closes
   - Test overlay click closes
   - Test size variants
2. Create `EmptyState.test.tsx`:
   - Test all type variants (loading, empty, error)
   - Test action button callback
3. Create `ErrorBoundary.test.tsx`:
   - Test error catching
   - Test fallback rendering

**Commit:** `test: add component tests`

### 6.6 Add Page Tests

**Files:** `frontend/src/pages/__tests__/`

**Steps:**

1. Create test files for key pages:
   - `Dashboard.test.tsx`
   - `Servers.test.tsx`
   - `Settings.test.tsx`
2. Test:
   - Loading state rendering
   - Error state rendering
   - User interactions (if feasible with MSW)

**Commit:** `test: add page integration tests`

---

## 8. Phase 7: Theming & Polish

### 7.1 Add Light Mode Support

**Files:** `frontend/src/`, `frontend/tailwind.config.js`

**Steps:**

1. Update Tailwind config:
   ```javascript
   // tailwind.config.js
   export default {
     darkMode: 'class',
     // ...
   };
   ```
2. Create `frontend/src/hooks/useTheme.ts`:
   - Detect system preference with `prefers-color-scheme`
   - Allow override via localStorage
   - Provide toggle function
3. Update `index.css` with light mode variables:
   ```css
   @layer base {
     :root {
       --color-bg: #ffffff;
       --color-text: #1f2937;
       --color-border: #e5e7eb;
     }
     .dark {
       --color-bg: #111827;
       --color-text: #f3f4f6;
       --color-border: #374151;
     }
   }
   ```
4. Add theme toggle to Settings page
5. Update components with both light/dark classes

**Commit:** `feat(theme): add light mode support`

### 7.2 Establish Design Tokens

**Files:** `frontend/tailwind.config.js`, `frontend/src/index.css`

**Steps:**

1. Define CSS custom properties in `index.css`:
   ```css
   :root {
     --color-primary: #60a5fa;
     --color-success: #4ade80;
     --color-warning: #fbbf24;
     --color-danger: #f87171;
     --color-surface: #1f2937;
     --color-surface-hover: #374151;
   }
   ```
2. Extend Tailwind theme to use tokens:
   ```javascript
   // tailwind.config.js
   theme: {
     extend: {
       colors: {
         primary: 'var(--color-primary)',
         surface: 'var(--color-surface)',
       }
     }
   }
   ```
3. Gradually refactor components to use tokens

**Commit:** `feat(theme): establish design tokens system`

### 7.3 Integrate Animation Components

**Files:** `frontend/src/components/PageTransition.tsx`, pages

**Steps:**

1. Decide which animations to keep:
   - Page transitions: Use `FadeIn` on route change
   - List animations: Use `StaggeredList` for server/model lists
   - Number counters: Fix `AnimatedNumber` bug (start from previous value)
2. Remove unused animations from export
3. Integrate into pages

**Commit:** `feat(ux): integrate animation components`

---

## 9. CI/CD Pipeline

### 9.1 Current Pipeline (if exists)

Verify current CI configuration exists:

```bash
ls -la .github/workflows/
```

### 9.2 Enhanced Pipeline

Create `.github/workflows/frontend.yml`:

```yaml
name: Frontend CI

on:
  push:
    branches: [main]
    paths:
      - 'frontend/**'
  pull_request:
    paths:
      - 'frontend/**'

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
        working-directory: frontend
      - run: npm run lint

  typecheck:
    name: Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
        working-directory: frontend
      - run: npm run build

  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
        working-directory: frontend
      - run: npm run test -- --coverage

  build:
    name: Build
    runs-on: ubuntu-latest
    needs: [lint, typecheck, test]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
        working-directory: frontend
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: frontend/dist

  # Optional: Deploy to preview environment
  preview:
    name: Deploy Preview
    runs-on: ubuntu-latest
    needs: [build]
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: dist
          path: dist
      # Add deployment step for your hosting (Vercel, Netlify, etc.)
```

### 9.3 Pre-commit Hooks

Ensure `.husky/` exists or add via package.json scripts:

```json
{
  "scripts": {
    "prepare": "husky install",
    "lint-staged": "lint-staged"
  },
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "typescript-eslint --fix"]
  }
}
```

Install:

```bash
cd frontend
npm install --save-dev husky lint-staged
npx husky install
```

---

## 10. Commit Strategy

### 10.1 Branch Structure

```
main
├── feature/frontend/type-safety
├── feature/frontend/ux-improvements
├── feature/frontend/architecture-refactor
├── feature/frontend/accessibility
├── feature/frontend/testing
├── feature/frontend/theming
└── chore/frontend/cicd-pipeline
```

### 10.2 Suggested Commit History

#### Phase 1: Quick Wins

```
fix(hooks): correct key parsing logic in useHotkeys
fix(security): sanitize HTML export to prevent XSS
chore: remove unused App.css scaffold file
refactor: extract hardcoded version to constants
fix(ux): standardize toast notifications for all mutations
feat(ux): add confirmation dialogs for destructive actions
```

#### Phase 2: Type Safety

```
refactor(types): replace any types with proper interfaces
refactor(types): use Zod parsing instead of unsafe type assertions
fix(types): add type safety to WebSocket message parsing
refactor(types): use CircuitBreakerState union type
fix: add null check for root element
refactor: extract magic numbers to constants
refactor: consolidate formatting utilities
refactor: extract duplicated download logic
refactor: consolidate circuit breaker config
```

#### Phase 3: UX

```
feat(ux): replace loading text with skeleton components
feat(ux): add error states with retry to all pages
feat(a11y): add focus trapping to modals
perf: add staleTime to React Query defaults
perf: add React.memo to frequently rendered list components
perf: memoize trends computation in Analytics
```

#### Phase 4: Architecture

```
refactor: split Analytics into per-tab components
refactor: split Settings into per-section components
refactor: use reusable Modal component in all modals
refactor: extract navigation items to constants
refactor: move createEventEmitter to utils
refactor: compose useRealTimeUpdates with useWebSocket
```

#### Phase 5: Accessibility

```
feat(a11y): add aria-labels to form controls
feat(a11y): make interactive table rows keyboard-accessible
feat(a11y): add sr-only text to empty table headers
fix(a11y): conditional preventDefault in useHotkeys
refactor: extract SearchResultGroup component
```

#### Phase 6: Testing

```
test: add QueryClientProvider to test setup
test: improve existing test assertions
test: add utility function tests
test: add hook tests
test: add component tests
test: add page integration tests
```

#### Phase 7: Theming

```
feat(theme): add light mode support
feat(theme): establish design tokens system
feat(ux): integrate animation components
```

#### CI/CD

```
ci: add frontend GitHub Actions workflow
chore: add pre-commit hooks configuration
```

### 10.3 Merge Strategy

1. Each phase creates a feature branch
2. Branch is reviewed via PR
3. After all phases complete, create a meta-PR to merge all feature branches
4. Or: merge each phase incrementally as it completes

---

## Summary

| Phase              | Commits | Estimated Time  |
| ------------------ | ------- | --------------- |
| 1. Quick Wins      | 6       | 1-2 days        |
| 2. Type Safety     | 9       | 2-3 days        |
| 3. UX Improvements | 6       | 2-3 days        |
| 4. Architecture    | 7       | 3-5 days        |
| 5. Accessibility   | 5       | 2-3 days        |
| 6. Testing         | 6       | 3-5 days        |
| 7. Theming         | 3       | 2-3 days        |
| CI/CD              | 2       | 1 day           |
| **Total**          | **~44** | **~17-25 days** |

Each commit should be atomic, tested locally, and pass CI before pushing. Use `git rebase -i` to squash fixup commits before merging PRs.
