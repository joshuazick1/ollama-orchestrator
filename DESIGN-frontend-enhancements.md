# DESIGN: Frontend Enhancement Opportunities

> Comprehensive audit of the React/TypeScript frontend codebase.
> Date: 2026-03-02

## Table of Contents

1. [Tech Stack Overview](#1-tech-stack-overview)
2. [Architecture & Component Structure](#2-architecture--component-structure)
3. [Type Safety](#3-type-safety)
4. [UX: Loading, Empty, & Error States](#4-ux-loading-empty--error-states)
5. [Accessibility](#5-accessibility)
6. [Performance](#6-performance)
7. [Data Fetching & State Management](#7-data-fetching--state-management)
8. [Security](#8-security)
9. [Code Quality & Consistency](#9-code-quality--consistency)
10. [Testing](#10-testing)
11. [Theming & Design System](#11-theming--design-system)
12. [Bugs](#12-bugs)
13. [Priority Summary](#13-priority-summary)

---

## 1. Tech Stack Overview

| Concern         | Technology                                          |
| --------------- | --------------------------------------------------- |
| Framework       | React 19.2                                          |
| Language        | TypeScript 5.9 (strict mode)                        |
| Build Tool      | Vite 7.2                                            |
| Routing         | React Router v7 (BrowserRouter, nested routes)      |
| Server State    | TanStack React Query v5 (polling, mutations, cache) |
| Local State     | React `useState` (no external store)                |
| HTTP Client     | Axios (interceptors, custom `ApiError` class)       |
| Real-time       | Native WebSocket (custom hook with reconnect)       |
| Styling         | Tailwind CSS v4 (utility classes, dark-only theme)  |
| Icons           | Lucide React                                        |
| Charts          | Recharts v3 (Bar, Line, Area, Pie)                  |
| Notifications   | react-hot-toast                                     |
| Validation      | Zod v4                                              |
| Class Utilities | clsx, tailwind-merge                                |
| Testing         | Vitest + Testing Library (React) + jsdom            |
| Linting         | ESLint v9 + typescript-eslint + react-hooks         |

### File Inventory

```
frontend/src/
  main.tsx                          Entry point
  App.tsx                           Root component (routing, providers)
  App.css                           Leftover Vite scaffold (dead code)
  index.css                         Global styles, Tailwind import, animations
  api.ts                            Axios client, 40+ API endpoint functions
  types.ts                          ~465 lines of TypeScript type definitions
  validations.ts                    Zod schemas for form validation

  components/
    Card.tsx                        Card, CardHeader, CardContent, CardFooter
    CircuitDetailModal.tsx          Multi-tab circuit breaker detail modal
    EmptyState.tsx                  Empty/loading/error state presets
    ErrorBoundary.tsx               React class-based error boundary
    GlobalSearch.tsx                Cmd+K search palette
    Layout.tsx                      App shell: sidebar + mobile drawer + Outlet
    Modal.tsx                       Reusable modal (sizes, variants, ESC/overlay)
    ModelManagerModal.tsx           Server model pull/delete/copy modal
    PageTransition.tsx              Animation wrappers (fade, slide, scale)
    StatCard.tsx                    Metric stat card with trend indicator
    Toaster.tsx                     react-hot-toast wrapper (dark theme)
    skeletons/index.tsx             Skeleton loaders (card, table, chart, etc.)

  hooks/
    useGlobalSearch.ts              Search modal toggle
    useHotkeys.ts                   Keyboard shortcut listener
    useWebSocket.ts                 WebSocket hook + event emitter utility

  pages/
    Analytics.tsx                   ~1913 lines; charts, tabs, decision history
    CircuitBreakers.tsx             ~804 lines; grouped by server, actions, bans
    Dashboard.tsx                   System health overview, stat cards
    InFlight.tsx                    Active requests monitor
    Logs.tsx                        Log viewer with clear/refresh
    Models.tsx                      ~473 lines; model map, warmup, detail
    Servers.tsx                     ~705 lines; add/remove, drain, maintenance
    Settings.tsx                    ~1455 lines; full config editor

  utils/
    circuitBreaker.tsx              State color/icon/label/sort helpers
    configValidation.ts             Zod-based config validation + suggestions
    export.ts                       CSV/JSON/HTML report export
    formatting.ts                   Duration, time, bytes, number formatters
    security.ts                     URL encoding, XSS sanitization
    toast.ts                        Toast convenience wrappers

  __tests__/
    App.test.tsx                    Basic smoke test (trivial)
    Layout.test.tsx                 Layout nav/title/version tests
```

---

## 2. Architecture & Component Structure

### 2.1 Monolithic Page Components

**Problem:** Two pages are excessively large and contain multiple concerns in a single file.

| File                  | Lines | Inline Sub-components                                                    |
| --------------------- | ----- | ------------------------------------------------------------------------ |
| `pages/Analytics.tsx` | ~1913 | 8 tab views, chart configs, request history table                        |
| `pages/Settings.tsx`  | ~1455 | `Toggle`, `NumberInput`, `SelectInput`, `ConfigSection`, 7 settings tabs |

**Suggestion:** Split each into a directory with per-tab components:

```
pages/
  analytics/
    index.tsx               Main layout, tab switching
    OverviewTab.tsx
    PerformanceTab.tsx
    ModelsTab.tsx
    ServersTab.tsx
    ErrorsTab.tsx
    CapacityTab.tsx
    RequestsTab.tsx
    TrendsTab.tsx
  settings/
    index.tsx               Main layout, tab switching
    GeneralSection.tsx
    LoadBalancerSection.tsx
    CircuitBreakerSection.tsx
    ...
    components/
      Toggle.tsx
      NumberInput.tsx
      SelectInput.tsx
```

### 2.2 Modals Bypass Reusable `Modal` Component

**Problem:** `ModelManagerModal.tsx` (line 149) and `CircuitDetailModal.tsx` each implement their own modal overlay from scratch, duplicating ESC-close, overlay-click, and scroll-lock logic that already exists in `Modal.tsx`.

**Suggestion:** Refactor both to compose on top of the reusable `Modal` component. This centralizes accessibility features (ARIA attributes, focus trapping) and reduces maintenance surface.

### 2.3 Duplicated Navigation Items

**Problem:** `Layout.tsx` defines the navigation items array twice -- once for the desktop sidebar (lines 77-101) and once for the mobile sidebar (lines 148-172).

**Suggestion:** Extract into a shared constant:

```typescript
const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/servers', icon: Server, label: 'Servers' },
  // ...
] as const;
```

Map over `NAV_ITEMS` in both desktop and mobile renderers.

### 2.4 Duplicated WebSocket Logic

**Problem:** `useRealTimeUpdates` in `hooks/useWebSocket.ts:135-193` duplicates most of the connection logic from `useWebSocket` rather than composing it.

**Suggestion:** Rewrite `useRealTimeUpdates` as a thin wrapper around `useWebSocket`:

```typescript
export function useRealTimeUpdates(onUpdate: (data: unknown) => void, enabled = true) {
  const { lastMessage } = useWebSocket('/api/ws', { enabled });
  useEffect(() => {
    if (lastMessage) onUpdate(lastMessage);
  }, [lastMessage]);
}
```

### 2.5 Misplaced Utility

**Problem:** `createEventEmitter` (a non-hook utility function) lives in `hooks/useWebSocket.ts:195-215`.

**Suggestion:** Move to `utils/eventEmitter.ts`.

---

## 3. Type Safety

### 3.1 Explicit `any` Types

| Location                             | Context                                    |
| ------------------------------------ | ------------------------------------------ |
| `CircuitDetailModal.tsx:178,286,340` | `metricsData` props typed as `any`         |
| `CircuitDetailModal.tsx:515,555`     | Request/decision list items typed as `any` |
| `Analytics.tsx:1654,1656`            | `[string, any]` in `.map()` destructuring  |

**Suggestion:** Define proper interfaces for metrics data shapes and request/decision items. Replace every `any` with a named type.

### 3.2 Unsafe Type Assertions

`configValidation.ts` uses `as` casts extensively without runtime validation:

```
Lines 29, 31, 39, 58, 69, 226, 231, 236, 241, 246
```

Example: `config.loadBalancer as Record<string, unknown> | undefined>` -- if `config.loadBalancer` is a number or string, the code silently misbehaves.

**Suggestion:** Use Zod parsing or type guards instead of `as` casts. The file already imports Zod but uses it inconsistently alongside manual validation.

### 3.3 Untyped JSON Parsing

`useWebSocket.ts:160` -- `JSON.parse(event.data)` returns implicit `any`.

**Suggestion:** Parse through a Zod schema or at minimum annotate with the expected message type and validate shape.

### 3.4 `string` Instead of Union Type

All functions in `circuitBreaker.tsx` (lines 6, 19, 32, 45, 58) accept `state: string` despite a `CircuitBreakerState` union type existing on line 4.

**Suggestion:** Change parameter types to `CircuitBreakerState`.

### 3.5 Non-null Assertion Without Fallback

`main.tsx:6` -- `document.getElementById('root')!` uses a non-null assertion.

**Suggestion:** Add a guard:

```typescript
const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');
createRoot(root).render(/* ... */);
```

---

## 4. UX: Loading, Empty, & Error States

### 4.1 Built Components That Are Never Used

The codebase contains well-built skeleton and empty-state components that are **not used by the pages that need them**:

- `skeletons/index.tsx` exports `SkeletonCard`, `SkeletonStatCard`, `SkeletonTable`, `SkeletonServerCard`, `SkeletonModelRow`, `SkeletonChart`, `SkeletonCircuitBreaker`, `SkeletonSettingsForm`, `SkeletonTabs` -- **none are used anywhere**.
- `EmptyState.tsx` supports types `loading`, `empty`, `error`, `no-servers`, `no-models`, `no-logs` -- **barely referenced**.

### 4.2 Pages With Minimal Loading States

| Page                    | Current State                               | Suggested Fix                                    |
| ----------------------- | ------------------------------------------- | ------------------------------------------------ |
| `Servers.tsx:191`       | `<div>Loading...</div>`                     | Use `SkeletonServerCard`                         |
| `Models.tsx:320-321`    | `<div>Loading...</div>`                     | Use `SkeletonModelRow`                           |
| `Logs.tsx:16`           | Bare loading text                           | Use `SkeletonTable` or `EmptyState` loading      |
| `InFlight.tsx:73`       | Loading text                                | Use skeleton or spinner                          |
| `Analytics.tsx:363-368` | Full-page block "Loading analytics data..." | Use per-section `SkeletonChart` / `SkeletonTabs` |

The Dashboard page (`Dashboard.tsx:36-62`) is the **only page** with proper skeleton loading -- it should serve as the pattern for all others.

### 4.3 Pages Missing Error States

| Page                  | Has Error Handling? |
| --------------------- | ------------------- |
| `Dashboard.tsx`       | Yes (retry button)  |
| `Settings.tsx`        | Yes (error message) |
| `Servers.tsx`         | No                  |
| `Models.tsx`          | No                  |
| `Logs.tsx`            | No                  |
| `InFlight.tsx`        | No                  |
| `CircuitBreakers.tsx` | No                  |
| `Analytics.tsx`       | No                  |

**Suggestion:** Add `if (isError)` blocks to every page using the existing `EmptyState` component with `type="error"` and an `onAction` retry callback.

### 4.4 No Confirmation Dialogs for Destructive Actions

The following actions execute immediately without user confirmation:

- Delete server
- Delete model
- Clear all logs
- Clear all bans
- Force-open / force-close circuit breakers

**Suggestion:** Add confirmation modals using the existing `Modal` component with `variant="danger"`. Pattern:

```tsx
<Modal isOpen={showConfirm} onClose={() => setShowConfirm(false)} variant="danger">
  <p>Are you sure you want to delete this server? This action cannot be undone.</p>
  <Button onClick={confirmDelete}>Delete</Button>
</Modal>
```

---

## 5. Accessibility

### 5.1 No Focus Trap in Modals

**Problem:** `Modal.tsx` and `GlobalSearch.tsx` handle ESC-close and overlay-click, but do not trap focus. Tab key allows focus to escape to elements behind the modal.

**Suggestion:** Implement a focus trap. Options:

- Use a lightweight library like `focus-trap-react`
- Implement manually by tracking first/last focusable elements and wrapping tab navigation

### 5.2 Unlabeled Form Controls

| Location                  | Element    | Issue                        |
| ------------------------- | ---------- | ---------------------------- |
| `Analytics.tsx:1239-1253` | `<select>` | No `aria-label` or `<label>` |

**Suggestion:** Add `aria-label="Filter by time range"` (or similar) to all standalone `<select>` and `<input>` elements.

### 5.3 Interactive Rows Not Keyboard-Accessible

`Analytics.tsx:1319-1348` -- Table rows have `onClick` and `cursor-pointer` but are not keyboard-focusable.

**Suggestion:** Add `tabIndex={0}`, `role="button"`, and an `onKeyDown` handler that triggers on Enter/Space:

```tsx
<tr
  tabIndex={0}
  role="button"
  onClick={() => toggleRow(id)}
  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleRow(id); }}
>
```

### 5.4 Empty Table Headers

`Analytics.tsx:1294` -- `<th className="w-8 py-3"></th>` has no content.

**Suggestion:** Add `<span className="sr-only">Expand row</span>` for screen readers.

### 5.5 Duplicated Search Result JSX

`GlobalSearch.tsx:239-351` -- Navigation, server, and model result groups use nearly identical markup.

**Suggestion:** Extract a `SearchResultGroup` component:

```tsx
<SearchResultGroup
  title="Pages"
  items={navigationResults}
  renderItem={item => <NavResult {...item} />}
/>
```

---

## 6. Performance

### 6.1 Missing `React.memo` on List Items

List-rendered sub-components (server cards, circuit breaker cards, model rows, log entries) are not memoized. When parent state changes (e.g., a filter toggle), every list item re-renders.

**Suggestion:** Wrap frequently rendered list-item components in `React.memo`:

```tsx
const ServerCard = React.memo(function ServerCard({ server }: Props) {
  // ...
});
```

### 6.2 Un-memoized Expensive Computation

`Analytics.tsx:1711-1743` -- The trends tab uses an IIFE inside JSX that performs nested loops over snapshots, servers, and models on every render.

**Suggestion:** Extract into a `useMemo`:

```tsx
const trendPoints = useMemo(() => {
  return snapshots.flatMap(/* ... */);
}, [snapshots]);
```

### 6.3 No `staleTime` Configured

`App.tsx` -- The `QueryClient` uses default `staleTime: 0`, meaning every component mount triggers a background refetch even if data was fetched milliseconds ago.

**Suggestion:** Set a sensible default:

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000, // 10 seconds
      // ...existing retry config
    },
  },
});
```

Pages with real-time needs already use `refetchInterval`, so this won't affect their freshness.

### 6.4 Unpaginated Lists

| List             | Location              | Risk                                                |
| ---------------- | --------------------- | --------------------------------------------------- |
| Servers          | `Servers.tsx`         | Moderate (typically <50 items)                      |
| Models           | `Models.tsx`          | Moderate                                            |
| Logs             | `Logs.tsx`            | **High** (unbounded, renders all into 600px scroll) |
| Circuit Breakers | `CircuitBreakers.tsx` | Low-moderate                                        |
| Bans             | `CircuitBreakers.tsx` | Moderate                                            |

Only the Analytics requests tab has pagination (`ITEMS_PER_PAGE = 50`).

**Suggestion:** Add pagination or virtual scrolling (e.g., `@tanstack/react-virtual`) to the Logs page at minimum, as log volume can grow unboundedly.

### 6.5 `AnimatedNumber` Always Starts From Zero

`PageTransition.tsx:121` -- `startValue` is hardcoded to `0`. When a metric updates from 42 to 45, it animates from 0 to 45 instead of 42 to 45.

**Suggestion:** Track the previous value with a ref and animate from it.

### 6.6 Fragile Dynamic Tailwind Class

`StatCard.tsx:65` -- `color.replace('text-', 'bg-')` relies on string manipulation to derive background classes from text color classes.

**Suggestion:** Use a mapping object:

```typescript
const bgFromText: Record<string, string> = {
  'text-blue-400': 'bg-blue-400',
  'text-green-400': 'bg-green-400',
  // ...
};
```

---

## 7. Data Fetching & State Management

### 7.1 No Optimistic Updates

All mutations wait for server response before updating the UI. For actions like drain/undrain, maintenance toggle, and circuit breaker resets, the delay is noticeable.

**Suggestion:** Implement optimistic updates with rollback for latency-sensitive mutations:

```typescript
useMutation({
  mutationFn: drainServer,
  onMutate: async (serverId) => {
    await queryClient.cancelQueries({ queryKey: ['servers'] });
    const previous = queryClient.getQueryData(['servers']);
    queryClient.setQueryData(['servers'], (old) => /* optimistic update */);
    return { previous };
  },
  onError: (_err, _vars, context) => {
    queryClient.setQueryData(['servers'], context?.previous);
  },
  onSettled: () => queryClient.invalidateQueries({ queryKey: ['servers'] }),
});
```

### 7.2 WebSocket Hook Built But Never Used

`useWebSocket.ts` and `useRealTimeUpdates` are fully implemented with auto-reconnect logic, but no component in the app actually calls them.

**Suggestion:** Either integrate into Dashboard/InFlight for live updates (replacing or supplementing polling), or remove the dead code.

### 7.3 Stale Closure Risk in `useRealTimeUpdates`

`useWebSocket.ts:190` -- The `useEffect` dependency array `[enabled, onUpdate]` will cause infinite reconnection loops if `onUpdate` is not memoized by the caller.

**Suggestion:** Use a ref to hold the latest callback:

```typescript
const onUpdateRef = useRef(onUpdate);
onUpdateRef.current = onUpdate;
// In effect, call onUpdateRef.current(data) instead of onUpdate(data)
```

### 7.4 Inconsistent Success Feedback

| Action        | Feedback Pattern                     | Consistent? |
| ------------- | ------------------------------------ | ----------- |
| Add server    | No toast (`Servers.tsx:47-58`)       | No          |
| Remove server | Toast                                | Yes         |
| Save settings | Inline text (`Settings.tsx:291-295`) | No          |
| Drain server  | Toast                                | Yes         |
| Clear logs    | No toast                             | No          |

**Suggestion:** Standardize on toast notifications for all mutation success/error feedback.

---

## 8. Security

### 8.1 XSS in HTML Export

**Severity: Medium-High**

`export.ts:139-186` -- The `generateReportHTML` function interpolates `title`, `timeRange`, `section.title`, and cell values directly into an HTML string via template literals. None are HTML-escaped.

```typescript
// Vulnerable pattern (current):
<h1>${title}</h1>
<td>${cell}</td>

// Safe pattern:
<h1>${sanitizeDisplayText(title)}</h1>
<td>${sanitizeDisplayText(String(cell))}</td>
```

The `sanitizeDisplayText` function already exists in `utils/security.ts` but is not used here.

**Suggestion:** Apply `sanitizeDisplayText` to all interpolated values in `generateReportHTML`.

### 8.2 URL Construction Without Error Handling

`security.ts:55` -- `new URL(baseUrl)` throws on invalid input. No try/catch.

**Suggestion:** Wrap in try/catch and return a meaningful error.

---

## 9. Code Quality & Consistency

### 9.1 Console Statements in Production Code

| Location               | Statement                                                |
| ---------------------- | -------------------------------------------------------- |
| `useWebSocket.ts:62`   | `console.error('Failed to parse WebSocket message:', e)` |
| `useWebSocket.ts:163`  | `console.error('Failed to parse real-time update:', e)`  |
| `export.ts:7`          | `console.warn('No data to export')`                      |
| `ErrorBoundary.tsx:26` | `console.error(error, errorInfo)`                        |

**Suggestion:** Replace with structured error reporting. For `ErrorBoundary`, the `console.error` is arguably acceptable but should integrate with an error tracking service in production. For others, use toast or silent error handling.

### 9.2 Duplicated Download Logic

`export.ts` repeats the create-blob / create-anchor / click / cleanup pattern three times (lines 36-46, 198-207, 212-221).

**Suggestion:** Extract a shared helper:

```typescript
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
```

### 9.3 Duplicated Switch Statements

`circuitBreaker.tsx` has four near-identical `switch` statements over circuit breaker state:

- `getCircuitBreakerStateColor` (lines 6-17)
- `getCircuitBreakerBadgeColor` (lines 19-30)
- `getCircuitBreakerStateIcon` (lines 32-43)
- `getCircuitBreakerStateLabel` (lines 45-56)

**Suggestion:** Consolidate into a single config map:

```typescript
const CIRCUIT_BREAKER_CONFIG: Record<CircuitBreakerState, {
  color: string;
  badgeColor: string;
  icon: ReactNode;
  label: string;
  priority: number;
}> = {
  closed: { color: 'text-green-400', badgeColor: '...', icon: <CheckCircle />, label: 'Closed', priority: 0 },
  // ...
};
```

### 9.4 Overlapping Utility Functions

`formatting.ts` has redundant functions:

| Functions                                                   | Overlap                                     |
| ----------------------------------------------------------- | ------------------------------------------- |
| `formatDuration`, `formatDurationMs`, `formatDurationShort` | Three duration formatters, subtly different |
| `formatTimeAgo`, `formatRelativeTime`                       | `formatRelativeTime` is a superset          |

**Suggestion:** Consolidate with options:

```typescript
function formatDuration(ms: number, opts?: { short?: boolean; unit?: 'ms' | 's' }): string;
```

### 9.5 Hardcoded Locale

`formatting.ts:54,67,93` -- `'en-US'` is hardcoded in `toLocaleString` calls.

**Suggestion:** Use `navigator.language` or accept locale as a parameter for i18n readiness.

### 9.6 Dead Code

| File                 | Issue                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `App.css`            | Entire file is leftover Vite scaffold (logo spin animation, `.read-the-docs` class). Not used by the app. Delete it.                                                         |
| `PageTransition.tsx` | `FadeIn`, `SlideIn`, `ScaleIn`, `StaggeredList`, `AnimatedCard` components are exported but never imported anywhere.                                                         |
| `toast.ts`           | `ToastType` and `ToastOptions` are exported but never imported. `export default toast` re-exports raw `react-hot-toast`, which is confusing alongside the wrapper functions. |

### 9.7 Hardcoded Version String

`Layout.tsx:103,174` -- The version `"v1.0.0"` is hardcoded in two places.

**Suggestion:** Read from `package.json` at build time (Vite supports `import.meta.env` or a define plugin), or extract to a shared constant.

### 9.8 Hardcoded Magic Numbers

Found across multiple files:

| File                  | Examples                                       |
| --------------------- | ---------------------------------------------- |
| `formatting.ts`       | `1000`, `60000`, `3600000`, `86400`            |
| `toast.ts`            | `4000`, `5000` (toast durations)               |
| `configValidation.ts` | `65535`, `0.01`, `5000`, `10000`, `600000`     |
| `Settings.tsx:1285+`  | `3`, `1000`, `60000`, `1800000`, `1.2`, `0.75` |
| `useWebSocket.ts:173` | `5000` (reconnect delay)                       |

**Suggestion:** Extract into named constants files (e.g., `constants/time.ts`, `constants/defaults.ts`).

### 9.9 Inconsistent Validation Approach

`configValidation.ts` imports Zod and uses it for `validateLoadBalancerConfig` and `validateCircuitBreakerConfig`, but the main `validateConfig` function uses manual if-else checks. Return shapes also differ across functions (some include `warnings`, some don't).

**Suggestion:** Standardize on Zod throughout with a consistent return type:

```typescript
interface ValidationResult {
  success: boolean;
  errors: Record<string, string>;
  warnings: Record<string, string>;
}
```

---

## 10. Testing

### 10.1 Current Coverage Is Minimal

Only 2 test files exist for ~20+ source files:

- `__tests__/App.test.tsx` -- 2 tests
- `__tests__/Layout.test.tsx` -- 3 tests

### 10.2 Existing Tests Have Issues

| File                   | Issue                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `App.test.tsx:7`       | `expect(document.body).toBeInTheDocument()` is trivially true; `document.body` always exists |
| `App.test.tsx:10-14`   | Second test has **no assertions** -- always passes                                           |
| `Layout.test.tsx:36`   | Hardcoded `'v1.0.0'` will break silently if version changes                                  |
| `Layout.test.tsx:7-13` | Missing `QueryClientProvider` wrapper -- will break if Layout uses React Query               |

### 10.3 Suggested Test Coverage Plan

**Priority 1 -- Utilities (pure functions, easy to test):**

- `utils/formatting.ts` -- edge cases (0, negative, NaN, Infinity, very large numbers)
- `utils/security.ts` -- XSS vectors, URL encoding edge cases
- `utils/configValidation.ts` -- valid configs, invalid configs, boundary values
- `utils/export.ts` -- CSV escaping, HTML generation

**Priority 2 -- Hooks:**

- `useHotkeys.ts` -- key combinations, modifier detection, cleanup
- `useWebSocket.ts` -- connection, reconnect, message parsing
- `useGlobalSearch.ts` -- toggle behavior

**Priority 3 -- Components:**

- `Modal.tsx` -- open/close, ESC key, overlay click, sizes
- `EmptyState.tsx` -- all type variants
- `ErrorBoundary.tsx` -- error catching, fallback rendering
- `GlobalSearch.tsx` -- keyboard navigation, result filtering

**Priority 4 -- Pages:**

- Loading, error, and empty state rendering
- User interactions (form submission, button clicks)
- Data display correctness

---

## 11. Theming & Design System

### 11.1 Dark-Only, No Light Mode

The app is hardcoded to a dark theme (`bg-gray-900` body in `index.css:5`). There is no light mode and no toggle. The `tailwind.config.js` has no `darkMode` setting.

**Suggestion:** At minimum, respect `prefers-color-scheme` for users who prefer light mode. Full implementation would involve:

1. Add `darkMode: 'class'` to Tailwind config
2. Create a theme context/hook
3. Add `dark:` variant classes alongside existing classes
4. Persist preference in `localStorage`

### 11.2 No Design Tokens

Colors are hardcoded as Tailwind utility classes throughout all components (`bg-gray-800`, `text-blue-400`, `border-gray-700`, etc.). `Toaster.tsx:10-14` hardcodes hex color values.

**Suggestion:** Define CSS custom properties as design tokens:

```css
:root {
  --color-surface: theme('colors.gray.800');
  --color-primary: theme('colors.blue.400');
  --color-border: theme('colors.gray.700');
}
```

Extend Tailwind config to reference these tokens, enabling easier theming.

### 11.3 Unused Animation Components

`PageTransition.tsx` exports `FadeIn`, `SlideIn`, `ScaleIn`, `StaggeredList`, and `AnimatedCard`. `index.css` defines corresponding keyframes (`shimmer`, `fadeIn`, `fadeOut`, `slideInLeft`, `slideInRight`, `scaleIn`, `slideUp`). None of these animation components are used in any page.

**Suggestion:** Either integrate them for page transitions and list animations to polish the UX, or remove the dead code.

---

## 12. Bugs

### 12.1 `useHotkeys` Key Parsing Is Broken

**Severity: High** -- This hook is used for the Cmd+K global search shortcut.

`useHotkeys.ts:14,20` -- The key parsing logic is incorrect:

```typescript
const parts = key.split('+');
const requiredKey = parts[0]; // BUG: for 'ctrl+k', this is 'ctrl', not 'k'
```

For the hotkey `ctrl+k`, `parts[0]` is `"ctrl"` (the modifier), but the code treats it as the required key. Line 20 has a hardcoded special case that only works for the letter `k` with `cmd`:

```typescript
pressedKey === 'k' && requiredKey === 'cmd' && isMeta;
```

This hook will silently fail for any hotkey combination other than `Cmd+K` / `Ctrl+K`.

**Fix:** Parse the last segment as the key and preceding segments as modifiers:

```typescript
const parts = key.toLowerCase().split('+');
const requiredKey = parts[parts.length - 1];
const modifiers = new Set(parts.slice(0, -1));

const modifierMatch =
  (!modifiers.has('ctrl') || event.ctrlKey) &&
  (!modifiers.has('shift') || event.shiftKey) &&
  (!modifiers.has('alt') || event.altKey) &&
  (!modifiers.has('cmd') || !modifiers.has('meta') || event.metaKey);

if (event.key.toLowerCase() === requiredKey && modifierMatch) {
  callback();
}
```

### 12.2 `formatting.ts` Edge Cases

- `formatBytes` (line 80): Negative bytes cause `Math.log(negative)` = `NaN`, resulting in `sizes[NaN]` = `undefined`.
- `formatTimeAgo` (line 23): `!timestamp` treats `0` as falsy (Unix epoch is a valid timestamp).
- Line 143: Redundant ternary -- both branches of `value === 1 ? (short ? '' : ' ago') : (short ? '' : ' ago')` produce identical results.

### 12.3 `configValidation.ts` Inconsistent Return Shapes

Different validation functions return different shapes:

- `validateConfig` line 148: `{ success: false, errors }` (no `warnings`)
- `validateConfig` line 159: `{ success: false, errors: {}, warnings: {...} }` (has `warnings`)
- `validateLoadBalancerConfig` line 220: `{ success: true, errors: {} as Record<string, string> }` (casted)

Consumers cannot reliably check for the `warnings` field.

---

## 13. Priority Summary

### High Impact / Quick Wins

| #   | Enhancement                                                    | Effort  |
| --- | -------------------------------------------------------------- | ------- |
| 1   | Use existing skeleton components instead of "Loading..." text  | Low     |
| 2   | Add error states to pages missing them (existing `EmptyState`) | Low     |
| 3   | Fix XSS in `export.ts` HTML generation                         | Low     |
| 4   | Fix `useHotkeys` key parsing bug                               | Low     |
| 5   | Add confirmation dialogs for destructive actions               | Low     |
| 6   | Delete dead `App.css`                                          | Trivial |
| 7   | Standardize success/error feedback on toasts                   | Low     |
| 8   | Extract hardcoded version to a constant                        | Trivial |

### Medium Impact / Moderate Effort

| #   | Enhancement                                                  | Effort |
| --- | ------------------------------------------------------------ | ------ |
| 9   | Split `Analytics.tsx` and `Settings.tsx` into sub-components | Medium |
| 10  | Refactor modals to use reusable `Modal` component            | Medium |
| 11  | Add focus trapping to modals                                 | Medium |
| 12  | Replace `any` types with proper interfaces                   | Medium |
| 13  | Configure `staleTime` in React Query                         | Low    |
| 14  | Add `React.memo` to list-rendered components                 | Low    |
| 15  | Add pagination / virtual scroll to Logs page                 | Medium |
| 16  | Consolidate duplicated code (downloads, switches, nav)       | Medium |
| 17  | Extract magic numbers into named constants                   | Medium |

### Lower Impact / Longer Term

| #   | Enhancement                                                    | Effort |
| --- | -------------------------------------------------------------- | ------ |
| 18  | Integrate or remove unused WebSocket/animation code            | Medium |
| 19  | Add comprehensive test coverage                                | High   |
| 20  | Implement light mode / theme toggle                            | High   |
| 21  | Establish a design token system                                | High   |
| 22  | Add i18n support (remove hardcoded locale)                     | High   |
| 23  | Implement optimistic updates for mutations                     | Medium |
| 24  | Improve keyboard accessibility across all interactive elements | High   |
