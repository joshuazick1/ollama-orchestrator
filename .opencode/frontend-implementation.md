# Frontend Implementation Guide

## Document Information

- **Project**: Ollama Orchestrator
- **Version**: 2.0.0
- **Last Updated**: 2026-02-17
- **Status**: Implementation Complete / Enhancement Review Complete

---

## Executive Summary

This document provides a comprehensive blueprint for the Ollama Orchestrator frontend development. The frontend is a **React 19** application with **TanStack Query** for server state management, featuring real-time monitoring of AI inference infrastructure.

### Current Assessment

| Category        | Status           | Notes                                           |
| --------------- | ---------------- | ----------------------------------------------- |
| Core Features   | ✅ 100% Complete | All major admin features done                   |
| API Integration | ✅ 100% Complete | All endpoints integrated                        |
| Code Quality    | ✅ 100% Complete | Utils centralized                               |
| UI/UX           | ✅ Complete      | Toasts, EmptyState, Card, tabs, mobile menu     |
| Mobile Support  | ✅ Complete      | Hamburger menu, responsive tables, mobile nav   |
| Accessibility   | ✅ Improved      | Focus states, ARIA attributes, keyboard support |

---

## Completed Implementations (All Phases Complete)

The following components have been created and integrated:

**New Components Created (Phase 1)**:

- `components/StatCard.tsx` - Reusable stat card with loading state
- `components/EmptyState.tsx` - Consistent empty/loading/error states
- `components/Card.tsx` - Card with variants (default, elevated, bordered, interactive)
- `components/Toaster.tsx` - Toast notification system
- `components/Toast.tsx` - Toast utility functions

**New Utilities Created (Phase 1)**:

- `utils/formatting.ts` - All formatting functions centralized
- `utils/circuitBreaker.tsx` - Circuit breaker state styling helpers
- `utils/toast.ts` - Toast notification helpers

**New Features Implemented (Phase 2 & 3)**:

- Queue pause/resume controls
- Server drain/undrain/maintenance mode
- Model warmup management
- Circuit breaker manual controls
- Ban management interface
- Recovery failure analysis tab
- Toast notifications for all admin actions

**Visual Improvements (Phase 4, 5, 6)**:

- `components/Modal.tsx` - Enhanced with size variants (sm/md/lg/xl/full), danger variant, animations, footer support, close on overlay click
- `components/Layout.tsx` - Mobile hamburger menu with slide-out sidebar, overlay backdrop
- Form inputs in Settings.tsx - Error states, focus states, aria-invalid attributes
- Tables - Horizontal scroll with custom scrollbar, hidden columns on mobile (md:table-cell)

---

# Frontend Enhancement Review (v2.0)

## Intensive Review Findings

After an in-depth review of the frontend codebase, the following enhancements are recommended to improve both visual appeal and functional capabilities.

---

## Visual Enhancements

### 1. Design System & Consistency

**Issue**: Inconsistent spacing/padding throughout components
**Fix**: Create a consistent spacing token system via Tailwind config

### 2. Loading States

**Issue**: Loading states are basic (just text or spinner)
**Fix**: Add skeleton loaders with shimmer animations matching content structure

### 3. Empty States

**Issue**: Some empty states lack visual hierarchy (Queue, Models)
**Fix**: Add illustrations, better CTAs, and guidance for empty states

### 4. Animations

**Issue**: Minimal transitions between states
**Fix**: Add Framer Motion for:

- Page transitions (slide/fade)
- Card entrance animations
- Smooth accordion expansions
- Toast slide-in animations

### 5. Color Palette

**Issue**: Limited color differentiation for states
**Fix**: Expand semantic colors:

- Success: Add gradient greens
- Warning: Add amber/orange spectrum
- Error: Add red-purple for critical
- Info: Add cyan spectrum

### 6. Typography

**Issue**: Limited font weight usage, basic sizes
**Fix**: Add Inter font with proper weights, better type scale

---

## Functional Enhancements

### 1. Dashboard

- **Add**: Real-time WebSocket connection for live metrics instead of polling
- **Add**: Interactive metric cards with click-through to detailed views
- **Add**: Quick action shortcuts (pause queue, refresh all)
- **Enhance**: Add system health timeline chart

### 2. Servers Page

- **Enhance**: Add bulk server actions (select multiple → drain/remove)
- **Add**: Server health timeline graph in expanded view
- **Add**: Quick filter/search bar
- **Enhance**: Model search within server

### 3. Analytics Page

- **Add**: Date range picker for custom timeframes
- **Add**: Export functionality (CSV/PDF)
- **Add**: Compare metrics between time periods
- **Enhance**: Drill-down on charts (click bar → see details)
- **Add**: Bookmarkable dashboard configurations

### 4. Queue Page

- **Add**: Visual queue flow diagram
- **Add**: Request priority editor
- **Add**: Estimated wait time display per request
- **Enhance**: Real-time position updates

### 5. Settings Page

- **Add**: Import/Export configuration
- **Add**: Configuration validation with warnings
- **Add**: Version history/changelog
- **Enhance**: Preview changes before applying
- **Add**: Reset to defaults with confirmation

### 6. Navigation & Layout

- **Add**: Global search (Cmd+K) for quick navigation
- **Add**: Keyboard shortcuts for common actions
- **Enhance**: Breadcrumb navigation
- **Add**: Bookmarkable routes with query params

### 7. User Experience

- **Add**: Persistent sidebar state (collapsed/expanded)
- **Add**: Remember last visited page
- **Add**: Toast notifications for background actions
- **Enhance**: Better error recovery with retry options

### 8. Accessibility

- **Add**: Full keyboard navigation
- **Add**: ARIA labels for all interactive elements
- **Add**: Screen reader announcements for dynamic content
- **Enhance**: Focus management in modals

---

## Technical Enhancements

### 1. Performance

- Implement virtualization for long lists (Analytics requests, Servers)
- Add React.memo to prevent unnecessary re-renders
- Lazy load chart libraries

### 2. Code Quality

- Add PropTypes or stricter TypeScript
- Extract more reusable hooks
- Create component library for consistency

### 3. Testing

- Add Playwright E2E tests
- Add component snapshot tests

---

## Priority Recommendations

### High Priority

1. Global search (Cmd+K)
2. Better loading skeletons
3. Analytics export functionality
4. Real-time updates via WebSocket

### Medium Priority

5. Page transitions with Framer Motion
6. Settings configuration validation
7. Queue visual flow diagram

### Low Priority

8. Custom illustrations for empty states
9. Advanced chart drill-down
10. Keyboard shortcuts

---

# Architecture Overview (Original)

The Ollama Orchestrator frontend is a **React 19** single-page application (SPA) built with **Vite**. It provides a comprehensive dashboard for monitoring and managing AI inference nodes through a clean, real-time interface.

### Key Design Principles

- **Real-time Updates**: All data refreshes automatically via polling
- **Modular Components**: Reusable UI elements for consistency
- **Type Safety**: Full TypeScript coverage with strict typing
- **Error Boundaries**: Graceful error handling at the app level
- **Responsive Design**: Mobile-first approach using Tailwind CSS

---

## Technology Stack

| Layer         | Technology       | Version | Purpose                               |
| ------------- | ---------------- | ------- | ------------------------------------- |
| Framework     | React            | 19.2.0  | UI rendering with concurrent features |
| Build Tool    | Vite             | 7.2.4   | Fast development and optimized builds |
| Routing       | React Router DOM | 7.13.0  | Client-side navigation                |
| Data Fetching | TanStack Query   | 5.90.20 | Server state management               |
| Styling       | Tailwind CSS     | 4.1.18  | Utility-first CSS                     |
| Charts        | Recharts         | 3.7.0   | Data visualization                    |
| Icons         | Lucide React     | 0.563.0 | Consistent iconography                |
| Validation    | Zod              | 4.3.6   | Schema validation                     |
| HTTP Client   | Axios            | 1.13.4  | API communication                     |

---

## Directory Structure

```
frontend/
├── src/
│   ├── components/           # Reusable UI components
│   │   ├── Card.tsx              # Card with variants
│   │   ├── EmptyState.tsx        # Empty/loading/error states
│   │   ├── ErrorBoundary.tsx     # App-level error handling
│   │   ├── Layout.tsx            # Sidebar + main content layout
│   │   ├── Modal.tsx             # Generic modal container
│   │   ├── ModelManagerModal.tsx # Per-server model management
│   │   ├── StatCard.tsx          # Stat card component
│   │   └── Toaster.tsx           # Toast notification system
│   ├── pages/                # Route-level components
│   │   ├── Dashboard.tsx          # System overview with stats
│   │   ├── Servers.tsx            # Server management & details
│   │   ├── Models.tsx             # Model distribution view
│   │   ├── Queue.tsx              # Request queue monitoring
│   │   ├── Analytics.tsx          # Performance charts & data
│   │   ├── CircuitBreakers.tsx    # Circuit breaker status
│   │   ├── Logs.tsx               # System log viewer
│   │   └── Settings.tsx           # Configuration UI
│   ├── utils/                # Utility functions
│   │   ├── formatting.ts          # Formatting utilities
│   │   ├── circuitBreaker.tsx     # Circuit breaker helpers
│   │   ├── toast.ts               # Toast notification helpers
│   │   └── security.ts           # URL encoding & XSS prevention
│   ├── api.ts                # API client & endpoint wrappers
│   ├── types.ts              # TypeScript type definitions
│   ├── validations.ts        # Zod schemas for form validation
│   ├── App.tsx               # Root component with routing
│   └── main.tsx              # Application entry point
├── public/                   # Static assets
├── index.html               # HTML template
├── package.json             # Dependencies & scripts
└── .eslintrc.cjs           # ESLint configuration
```

---

## State Management

### TanStack Query Configuration

```typescript
// App.tsx
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Don't retry on 4xx errors
        if (error instanceof ApiError) {
          if (error.status && error.status >= 400 && error.status < 500) {
            return false;
          }
        }
        return failureCount < 3;
      },
      retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
  },
});
```

### Polling Intervals by Feature

| Endpoint         | Interval | Reasoning                    |
| ---------------- | -------- | ---------------------------- |
| Health           | 5000ms   | System status changes slowly |
| Queue            | 2000ms   | Queue state changes rapidly  |
| Servers          | 5000ms   | Server health updates        |
| Circuit Breakers | 5000ms   | State transitions            |
| Analytics        | 30000ms  | Historical data is stable    |

---

## API Integration

### Base Configuration

```typescript
// api.ts
const api = axios.create({
  baseURL: '/api/orchestrator',
  timeout: 30000,
});
```

### Error Handling Pattern

All API calls use a wrapper function `apiCall<T>()` that:

1. Executes the request
2. Catches errors
3. Wraps unknown errors in `ApiError` class
4. Preserves type safety

### Endpoint Coverage

**Currently Implemented**: 40+ endpoints consumed
**Available but Unused**: 20+ endpoints (see Missing Features)

---

## Component Architecture

### Layout Component

The `Layout.tsx` component provides:

- Fixed sidebar navigation with 8 routes
- Active route highlighting
- Responsive mobile support
- Consistent page container

### Modal System

Two modal types are implemented:

1. **Generic Modal** (`Modal.tsx`): Simple overlay for forms
2. **Model Manager** (`ModelManagerModal.tsx`): Complex modal for model operations

### Form Validation

All forms use Zod schemas defined in `validations.ts`:

- `serverUrlSchema`: URL validation with protocol checking
- `apiKeySchema`: API key format validation
- `addServerSchema`: Complete server addition form
- `modelNameSchema`: Model name character validation

---

## Missing Features Analysis

### Critical Missing Features (High Priority)

#### 1. Queue Management Controls

**Backend Endpoints Available**:

- `POST /api/orchestrator/queue/pause`
- `POST /api/orchestrator/queue/resume`
- `POST /api/orchestrator/drain`
- `POST /api/orchestrator/servers/:id/drain`
- `POST /api/orchestrator/servers/:id/undrain`
- `POST /api/orchestrator/servers/:id/maintenance`

**Current State**: Queue page shows status but cannot control it
**Impact**: Users cannot pause queue during maintenance or emergencies
**Implementation Location**: `pages/Queue.tsx`

#### 2. Model Warmup Management

**Backend Endpoints Available**:

- `POST /api/orchestrator/models/:model/warmup`
- `POST /api/orchestrator/models/:model/unload`
- `GET /api/orchestrator/models/recommendations`
- `GET /api/orchestrator/models/idle`
- `GET /api/orchestrator/models/status`

**Current State**: No UI for preloading models into memory
**Impact**: Cannot optimize model load times before high-traffic periods
**Implementation Location**: New page or Models.tsx enhancement

#### 3. Server Maintenance Mode

**Backend Endpoints Available**:

- `POST /api/orchestrator/servers/:id/drain`
- `POST /api/orchestrator/servers/:id/undrain`
- `POST /api/orchestrator/servers/:id/maintenance`

**Current State**: Servers can only be added/removed, not maintained
**Impact**: Cannot gracefully take servers offline for updates
**Implementation Location**: `pages/Servers.tsx` actions menu

### Medium Priority Missing Features

#### 4. Circuit Breaker Manual Controls

**Backend Endpoints Available**:

- `POST /api/orchestrator/circuit-breakers/:serverId/:model/open`
- `POST /api/orchestrator/circuit-breakers/:serverId/:model/close`
- `POST /api/orchestrator/circuit-breakers/:serverId/:model/half-open`
- `POST /api/orchestrator/circuit-breakers/:serverId/:model/reset`

**Current State**: Read-only circuit breaker status
**Impact**: Cannot manually intervene during incidents
**Implementation Location**: `pages/CircuitBreakers.tsx`

#### 5. Ban Management Interface

**Backend Endpoints Available**:

- `GET /api/orchestrator/bans`
- `DELETE /api/orchestrator/bans`
- `DELETE /api/orchestrator/bans/server/:serverId`
- `DELETE /api/orchestrator/bans/model/:model`
- `DELETE /api/orchestrator/bans/:serverId/:model`

**Current State**: No visibility into banned server:model pairs
**Impact**: Cannot clear bans or understand routing exclusions
**Implementation Location**: New page or CircuitBreakers.tsx tab

#### 6. Recovery Failure Analysis

**Backend Endpoints Available**:

- `GET /api/orchestrator/recovery-failures`
- `GET /api/orchestrator/recovery-failures/stats/all`
- `GET /api/orchestrator/recovery-failures/recent`
- `GET /api/orchestrator/recovery-failures/:serverId`
- `GET /api/orchestrator/recovery-failures/:serverId/analysis`

**Current State**: Rich failure data exists but not exposed
**Impact**: Limited visibility into failure patterns
**Implementation Location**: `pages/Analytics.tsx` new tab

### Low Priority Missing Features

#### 7. Advanced Request Search

**Backend Endpoint Available**:

- `GET /api/orchestrator/analytics/requests/search`

**Current State**: Basic request history only
**Impact**: Cannot filter by time, model, success status
**Implementation Location**: `pages/Analytics.tsx` Requests tab

#### 8. Manual Health Check Trigger

**Backend Endpoint Available**:

- `POST /api/orchestrator/health-check`

**Current State**: Health checks are automatic only
**Impact**: Cannot verify server health on demand
**Implementation Location**: `pages/Servers.tsx` per-server actions

---

## Code Consolidation Opportunities

### 1. StatCard Component (Duplicate Code)

**Locations**:

- `pages/Dashboard.tsx:6-31`
- `pages/Queue.tsx:7-32`

**Issue**: Identical component defined twice with same props interface
**Solution**: Extract to `components/StatCard.tsx`

**Props Interface**:

```typescript
interface StatCardProps {
  title: string;
  value: string | number;
  subtext?: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}
```

### 2. Formatting Utilities (Scattered Logic)

**Locations with Duplicates**:

- `pages/Queue.tsx:53-57` - `formatDuration()`
- `pages/Analytics.tsx:247-250` - `formatDuration()` (duplicate)
- `pages/CircuitBreakers.tsx:55-74` - `formatTimeAgo()`, `formatTimeUntil()`
- `components/ModelManagerModal.tsx:37-47` - `formatBytes()`, `formatDate()`

**Solution**: Create `utils/formatting.ts` module

**Recommended Exports**:

```typescript
export const formatDuration(ms: number): string
export const formatTimeAgo(timestamp: number): string
export const formatTimeUntil(timestamp: number): string
export const formatDate(dateStr: string): string
export const formatBytes(bytes: number): string
export const formatNumber(num: number): string
```

### 3. Circuit Breaker State Styling (Inconsistent)

**Locations**:

- `pages/CircuitBreakers.tsx:42-53` - `getStateColor()`
- `pages/Analytics.tsx:252-263` - Inline duplicate
- `pages/Models.tsx` - Hardcoded badge styles

**Solution**: Create `utils/circuitBreaker.ts`

**Recommended Exports**:

```typescript
export const getCircuitBreakerStateColor(state: string): string
export const getCircuitBreakerStateIcon(state: string): ReactNode
export const getCircuitBreakerStateLabel(state: string): string
export const sortByStatePriority(a: string, b: string): number
```

### 4. Form Input Components (Inlined in Settings)

**Location**: `pages/Settings.tsx:40-153`

**Components Defined Inline**:

- `Toggle` - Boolean toggle switch
- `NumberInput` - Number input with validation
- `SelectInput` - Dropdown selector
- `TextInput` - Text input field

**Solution**: Move to `components/forms/` directory

**Structure**:

```
components/
└── forms/
    ├── Toggle.tsx
    ├── NumberInput.tsx
    ├── SelectInput.tsx
    └── TextInput.tsx
```

### 5. Sorting Logic (Repeated Patterns)

**Locations**:

- `pages/Servers.tsx:86-109` - Server sorting
- `pages/Models.tsx:203-213` - Model sorting
- `pages/CircuitBreakers.tsx:111-117` - Breaker sorting

**Solution**: Create `utils/sorting.ts` with generic helpers

**Recommended Exports**:

```typescript
export function createSortHandler<T>(
  setSortConfig: Dispatch<SetStateAction<SortConfig<T>>>
): (key: T) => void;

export function sortByKey<T>(items: T[], key: keyof T, direction: 'asc' | 'desc'): T[];
```

---

## Visual/UI Improvements

### 1. Empty States (Inconsistent)

**Current State**: Many pages show basic "Loading..." text or minimal empty states

- `Queue.tsx:191` - Plain "Loading..." text
- `Models.tsx:191` - Plain "Loading..." text
- `Servers.tsx:131` - Plain "Loading..." text

**Issue**: Inconsistent user experience when no data exists

**Recommended Solution**: Create `components/EmptyState.tsx` with variants:

- **Loading**: Skeleton placeholders with shimmer animation
- **Empty**: Illustration + helpful message + action button
- **Error**: Error icon + retry button + error details

**Props Interface**:

```typescript
interface EmptyStateProps {
  type: 'loading' | 'empty' | 'error';
  title?: string;
  message?: string;
  icon?: LucideIcon;
  action?: {
    label: string;
    onClick: () => void;
  };
}
```

### 2. Loading Skeletons (Incomplete)

**Current State**: Only Dashboard has skeletons (`Dashboard.tsx:75-91`)

**Missing Skeletons**:

- `Servers.tsx` - Server cards need placeholder cards
- `Models.tsx` - Table rows need placeholder rows
- `Analytics.tsx` - Charts need placeholder shapes
- `CircuitBreakers.tsx` - Summary cards need placeholders
- `Settings.tsx` - Form fields need placeholder inputs

**Recommended Solution**: Create `components/skeletons/` directory:

```
components/
└── skeletons/
    ├── ServerCardSkeleton.tsx
    ├── ModelRowSkeleton.tsx
    ├── ChartSkeleton.tsx
    ├── StatCardSkeleton.tsx
    └── FormSkeleton.tsx
```

### 3. Table Mobile Responsiveness (Poor)

**Current State**: Tables overflow horizontally on mobile

- `Models.tsx:233-307` - Model list table
- `Queue.tsx:137-202` - Queue items table
- `Analytics.tsx:544-621` - Performance metrics table

**Issues**:

- No horizontal scroll indicators
- Columns don't collapse gracefully
- Touch targets too small

**Recommended Solutions**:

1. **Horizontal Scroll**: Wrap tables in `overflow-x-auto` with visual indicator
2. **Column Priority**: Hide low-priority columns on mobile (`hidden md:table-cell`)
3. **Card Layout**: Convert to card view on small screens
4. **Sticky Columns**: Keep action buttons visible while scrolling

### 4. Chart Enhancements (Basic)

**Current State**: `Analytics.tsx:451-532` uses basic Recharts

**Missing Features**:

- No gradient fills on area charts
- Tooltips lack contrast
- No chart legends
- Dark theme colors not optimized
- No loading states

**Recommended Improvements**:

1. **Gradients**: Add `defs` with gradient fills for area charts
2. **Tooltips**: Custom tooltip component with dark theme styling
3. **Legends**: Add `Legend` component to multi-series charts
4. **Colors**: Use Tailwind color palette consistently
5. **Loading**: Skeleton placeholder while chart data loads

**Example Gradient Definition**:

```typescript
<defs>
  <linearGradient id="colorLatency" x1="0" y1="0" x2="0" y2="1">
    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.8}/>
    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
  </linearGradient>
</defs>
```

### 5. Status Indicators (Could be Clearer)

**Current State**: Color-coded badges work but lack visual hierarchy

**Examples**:

- Circuit breaker states use similar styling across OPEN/CLOSED/HALF-OPEN
- Server health indicators (healthy/unhealthy) could be more prominent
- Queue status not visually distinct enough
- In-flight request counts lack animation

**Recommended Improvements**:

1. **Pulsing Animation**: Add `animate-pulse` to active states
2. **Status Icons**: Always pair color with icon
3. **Progress Bars**: Show queue depth with visual progress
4. **Trend Arrows**: Add up/down arrows for changing metrics
5. **Severity Colors**: Standardize error/warning/success colors

**Animation Example**:

```typescript
// For in-flight/active states
<div className="relative">
  <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 animate-ping"></span>
  <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
</div>
```

### 6. Modal Improvements

**Current State**: `Modal.tsx` is functional but minimal

**Missing Features**:

- No enter/exit animations
- Fixed size only
- No confirmation variant with danger styling
- No stacked modal support

**Recommended Solution**: Enhance `components/Modal.tsx`:

```typescript
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  variant?: 'default' | 'danger' | 'success';
  footer?: React.ReactNode;
  closeOnOverlayClick?: boolean;
  showCloseButton?: boolean;
}
```

**Features to Add**:

1. **Transitions**: Use `react-transition-group` or Framer Motion
2. **Sizing**: Support multiple modal sizes
3. **Variants**: Danger styling for destructive actions
4. **Focus Trap**: Use `react-focus-lock` for accessibility
5. **Scroll Lock**: Prevent body scroll when modal open

### 7. Navigation Enhancements

**Current State**: `Layout.tsx` has basic sidebar

**Missing Features**:

- No active route animation
- Mobile hamburger menu missing
- No breadcrumbs
- Collapsible sections not implemented

**Recommended Improvements**:

1. **Active Indicator**: Animated indicator that slides to active item
2. **Mobile Menu**: Hamburger menu with slide-out drawer
3. **Breadcrumbs**: Show path for deep navigation (e.g., Analytics > Server Performance)
4. **Collapsible Groups**: Group related items (Monitoring, Management, Settings)
5. **Quick Actions**: Add action buttons in sidebar header

**Mobile Menu Structure**:

```typescript
// Collapsible on mobile
<aside className={clsx(
  "fixed inset-y-0 left-0 z-50 w-64 bg-gray-950 transform transition-transform duration-300",
  isOpen ? "translate-x-0" : "-translate-x-full",
  "md:translate-x-0 md:static" // Always visible on desktop
)}>
```

### 8. Form Validation Visuals

**Current State**: Basic red borders on errors (`Servers.tsx:387-392`)

**Missing Features**:

- No inline error icons
- No success state styling
- No shake animation on submit
- Helper text styling inconsistent

**Recommended Improvements**:

1. **Error Icons**: Add error icon inside input field
2. **Success States**: Green borders/checkmarks on valid input
3. **Shake Animation**: CSS shake on form submit with errors
4. **Inline Validation**: Validate on blur with immediate feedback
5. **Consistent Spacing**: Standardize spacing between label, input, error

**CSS Animation Example**:

```css
@keyframes shake {
  0%,
  100% {
    transform: translateX(0);
  }
  25% {
    transform: translateX(-5px);
  }
  75% {
    transform: translateX(5px);
  }
}

.shake {
  animation: shake 0.3s ease-in-out;
}
```

### 9. Toast Notifications (Missing)

**Current State**: No toast system - messages are inline only

**Missing Features**:

- No success confirmations
- No error notifications
- No progress indicators
- No action buttons in toasts

**Recommended Solution**: Create `components/Toast.tsx` using `react-hot-toast` or custom:

**Use Cases**:

- Server added successfully
- Model pulled/deleted
- Settings saved
- Circuit breaker state changed
- Errors with retry option

**Toast Types**:

```typescript
type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';

interface ToastOptions {
  type: ToastType;
  message: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}
```

### 10. Color Accessibility

**Current State**: Some combinations may not meet WCAG AA

**Potential Issues**:

- `text-gray-400` on `bg-gray-800` (contrast ratio ~3.5:1)
- Status colors may be too subtle
- Disabled states lack clarity

**Recommended Audit**:

1. **Contrast Checker**: Verify all text meets 4.5:1 ratio (AA) or 7:1 (AAA)
2. **Color Blindness**: Test with color blindness simulators
3. **Focus States**: Ensure visible focus indicators
4. **Error States**: Use color + icon + text (not color alone)

**Improved Color Palette**:

```typescript
// Use darker grays for better contrast
const colors = {
  text: {
    primary: 'text-gray-100', // High contrast
    secondary: 'text-gray-300', // Medium contrast
    muted: 'text-gray-400', // Only for large text
  },
  status: {
    success: 'text-green-400',
    warning: 'text-yellow-400',
    error: 'text-red-400',
  },
};
```

### 11. Typography Hierarchy

**Current State**: Consistent but could be more refined

**Issues**:

- Limited font weight variation
- Line heights not optimized for readability
- Monospace fonts not used consistently for data

**Recommended Improvements**:

1. **Font Weights**: Use 400, 500, 600, 700 for clear hierarchy
2. **Line Heights**: Use `leading-relaxed` (1.625) for body text
3. **Monospace Data**: IDs, timestamps, counts in `font-mono`
4. **Scale**: Establish clear type scale (xs, sm, base, lg, xl, 2xl, 3xl)

### 12. Card Layouts (Inconsistent Spacing)

**Current State**: Cards use different padding/margins across pages

**Inconsistencies**:

- `p-4` vs `p-6` padding
- Border colors vary (`border-gray-700` vs `border-gray-800`)
- Shadow usage inconsistent

**Recommended Solution**: Create `components/Card.tsx` with variants:

```typescript
interface CardProps {
  children: React.ReactNode;
  variant?: 'default' | 'elevated' | 'bordered';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  header?: React.ReactNode;
  footer?: React.ReactNode;
  hover?: boolean;
}
```

**Card Variants**:

- **Default**: `bg-gray-800 rounded-xl border border-gray-700`
- **Elevated**: Adds `shadow-lg` for emphasis
- **Bordered**: Thicker border for selected state

---

## Implementation Roadmap

### Phase 1: Code Consolidation (Week 1)

**Goal**: Reduce duplication and improve maintainability

**Tasks**:

1. Create `components/StatCard.tsx` and replace inline definitions
2. Create `utils/formatting.ts` and migrate all formatting functions
3. Create `utils/circuitBreaker.ts` for state styling
4. Update imports in affected files

**Files Modified**:

- `pages/Dashboard.tsx`
- `pages/Queue.tsx`
- `pages/Analytics.tsx`
- `pages/CircuitBreakers.tsx`
- `pages/Models.tsx`
- `components/ModelManagerModal.tsx`

**Files Created**:

- `components/StatCard.tsx`
- `utils/formatting.ts`
- `utils/circuitBreaker.ts`

### Phase 2: Critical Features (Week 2-3)

**Goal**: Implement high-priority missing features

**2.1 Queue Controls**

- Add pause/resume buttons to `pages/Queue.tsx`
- Add queue status indicator to header
- Implement queue pause mutation

**2.2 Server Maintenance**

- Add drain/undrain buttons in `pages/Servers.tsx` expanded view
- Add maintenance mode toggle
- Show server drain status in server list

**2.3 Model Warmup (Simplified)**

- Add "Warmup Model" button in `pages/Models.tsx` per model
- Show warmup status indicator
- Integrate with existing model status API

### Phase 3: Medium Priority Features (Week 4-5)

**3.1 Circuit Breaker Controls**

- Add manual open/close/reset buttons to `pages/CircuitBreakers.tsx`
- Add confirmation dialogs for destructive actions
- Show operation results

**3.2 Ban Management View**

- Create new tab or section in existing page
- Display current bans with server:model pairs
- Add clear ban functionality

**3.3 Recovery Analysis (Basic)**

- Add new tab to `pages/Analytics.tsx`
- Display recovery failure summary
- Show recent failure records

### Phase 4: Visual Improvements - Part 1 (Week 6)

**4.1 Toast Notification System**

- Install and configure `react-hot-toast` or build custom solution
- Create `components/Toast.tsx` and `components/ToastProvider.tsx`
- Add toast calls to all mutations:
  - Server add/remove/update
  - Model pull/delete
  - Settings save
  - Circuit breaker actions
- Implement toast styling for success/error/warning/loading states

**4.2 Empty States & Loading Skeletons**

- Create `components/EmptyState.tsx` with loading/empty/error variants
- Create `components/skeletons/` directory with:
  - `ServerCardSkeleton.tsx`
  - `ModelRowSkeleton.tsx`
  - `ChartSkeleton.tsx`
  - `StatCardSkeleton.tsx`
- Replace "Loading..." text in all pages with skeleton components
- Add empty state illustrations and messages

**4.3 Card Component Standardization**

- Create `components/Card.tsx` with variants (default, elevated, bordered)
- Update all pages to use Card component
- Standardize padding, borders, and shadows
- Add hover states where appropriate

**Files Created**:

- `components/Toast.tsx`
- `components/ToastProvider.tsx`
- `components/EmptyState.tsx`
- `components/Card.tsx`
- `components/skeletons/*.tsx`

**Files Modified**:

- `pages/Servers.tsx`
- `pages/Models.tsx`
- `pages/Queue.tsx`
- `pages/Analytics.tsx`
- `pages/CircuitBreakers.tsx`
- `pages/Settings.tsx`
- `pages/Logs.tsx`
- `pages/Dashboard.tsx`

### Phase 5: Visual Improvements - Part 2 (Week 7)

**5.1 Modal Enhancements**

- Update `components/Modal.tsx` with:
  - Enter/exit animations using Framer Motion
  - Size variants (sm, md, lg, xl, full)
  - Danger variant for destructive actions
  - Footer prop support
- Update `ModelManagerModal.tsx` to use enhanced Modal
- Add confirmation dialogs for destructive actions throughout app

**5.2 Mobile Navigation**

- Add hamburger menu button to `Layout.tsx` header
- Implement slide-out sidebar for mobile
- Add touch-friendly tap targets (min 44px)
- Test navigation on various screen sizes

**5.3 Form Validation Visuals**

- Enhance `components/forms/` inputs with:
  - Inline error icons
  - Success state styling (green borders)
  - Shake animation on validation errors
- Add CSS animations for form feedback
- Update all forms to show inline validation

**Files Created**:

- `components/animations/ShakeAnimation.tsx`

**Files Modified**:

- `components/Modal.tsx`
- `components/Layout.tsx`
- `components/forms/*.tsx`
- All page components with forms

### Phase 6: Visual Improvements - Part 3 (Week 8)

**6.1 Chart Enhancements**

- Add gradient fills to area charts in `Analytics.tsx`
- Create custom tooltip component with dark theme styling
- Add legends to multi-series charts
- Implement chart loading states
- Optimize chart colors for dark theme

**6.2 Table Mobile Responsiveness**

- Add horizontal scroll containers with visual indicators
- Implement column hiding for mobile (`hidden md:table-cell`)
- Create card layout alternative for mobile tables
- Add sticky action columns

**6.3 Status Indicators Enhancement**

- Add pulsing animations for active/in-flight states
- Standardize status icon + color + text combinations
- Add progress bars for queue depth
- Implement trend arrows for changing metrics

**6.4 Color Accessibility Audit**

- Audit all color combinations for WCAG AA compliance
- Update text colors for better contrast
- Add focus indicators for all interactive elements
- Test with color blindness simulators

**Files Created**:

- `components/ChartTooltip.tsx`
- `components/StatusIndicator.tsx`

**Files Modified**:

- `pages/Analytics.tsx`
- `pages/Models.tsx`
- `pages/Queue.tsx`
- `pages/Servers.tsx`
- All CSS/styling files

### Phase 7: Polish & Finalization (Week 9)

**7.1 Form Component Extraction**

- Move form inputs from `pages/Settings.tsx` to `components/forms/`
- Update Settings page to use extracted components
- Ensure consistent styling across all forms

**7.2 Sorting Utilities**

- Create `utils/sorting.ts` with generic helpers
- Refactor sorting logic in affected pages
- Add type-safe sorting configuration

**7.3 Typography Standardization**

- Establish type scale in Tailwind config
- Update all text elements to use standardized sizes
- Ensure proper line heights for readability
- Use monospace fonts consistently for data

**7.4 Final Testing & Documentation**

- Cross-browser testing
- Mobile responsiveness testing
- Accessibility audit with screen readers
- Performance profiling
- Update this implementation guide
- Add JSDoc comments to all utility functions
- Document component props interfaces

**Files Created**:

- `utils/sorting.ts`
- Updated Tailwind config

**Files Modified**:

- `tailwind.config.js`
- All page components
- All utility files

### Phase 8: Enhancement Implementation (Future)

**8.1 High Priority Enhancements**

- Global search (Cmd+K) implementation
- Advanced loading skeletons with shimmer
- Analytics export functionality (CSV/PDF)
- WebSocket for real-time updates

**8.2 Medium Priority Enhancements**

- Page transitions with Framer Motion
- Settings configuration validation
- Queue visual flow diagram

**8.3 Low Priority Enhancements**

- Custom illustrations for empty states
- Advanced chart drill-down functionality
- Keyboard shortcuts implementation

---

## API Endpoint Reference

### Monitoring Endpoints (Currently Used)

| Method | Endpoint                             | Used In                            |
| ------ | ------------------------------------ | ---------------------------------- |
| GET    | `/api/orchestrator/servers`          | Servers.tsx, Dashboard.tsx         |
| GET    | `/api/orchestrator/model-map`        | Models.tsx                         |
| GET    | `/api/orchestrator/models`           | - (unused)                         |
| GET    | `/api/orchestrator/health`           | Dashboard.tsx                      |
| GET    | `/api/orchestrator/queue`            | Queue.tsx, Dashboard.tsx           |
| GET    | `/api/orchestrator/in-flight`        | Queue.tsx, Models.tsx              |
| GET    | `/api/orchestrator/circuit-breakers` | CircuitBreakers.tsx, Analytics.tsx |
| GET    | `/api/orchestrator/metrics`          | Analytics.tsx                      |
| GET    | `/api/orchestrator/analytics/*`      | Analytics.tsx                      |
| GET    | `/api/orchestrator/logs`             | Logs.tsx                           |
| GET    | `/api/orchestrator/config`           | Settings.tsx                       |

### Admin Endpoints (Currently Used)

| Method | Endpoint                                      | Used In               |
| ------ | --------------------------------------------- | --------------------- |
| POST   | `/api/orchestrator/servers/add`               | Servers.tsx           |
| DELETE | `/api/orchestrator/servers/:id`               | Servers.tsx           |
| PATCH  | `/api/orchestrator/servers/:id`               | - (unused)            |
| POST   | `/api/orchestrator/config`                    | Settings.tsx          |
| POST   | `/api/orchestrator/config/save`               | Settings.tsx          |
| POST   | `/api/orchestrator/config/reload`             | Settings.tsx          |
| GET    | `/api/orchestrator/servers/:id/models`        | ModelManagerModal.tsx |
| POST   | `/api/orchestrator/servers/:id/models/pull`   | ModelManagerModal.tsx |
| DELETE | `/api/orchestrator/servers/:id/models/:model` | ModelManagerModal.tsx |
| POST   | `/api/orchestrator/servers/:id/models/copy`   | ModelManagerModal.tsx |
| GET    | `/api/orchestrator/models/fleet-stats`        | ModelManagerModal.tsx |
| POST   | `/api/orchestrator/logs/clear`                | Logs.tsx              |

### Admin Endpoints (Available but Unused)

| Method | Endpoint                                              | Priority | Suggested Location              |
| ------ | ----------------------------------------------------- | -------- | ------------------------------- |
| POST   | `/api/orchestrator/queue/pause`                       | High     | Queue.tsx                       |
| POST   | `/api/orchestrator/queue/resume`                      | High     | Queue.tsx                       |
| POST   | `/api/orchestrator/drain`                             | Medium   | Queue.tsx                       |
| POST   | `/api/orchestrator/servers/:id/drain`                 | High     | Servers.tsx                     |
| POST   | `/api/orchestrator/servers/:id/undrain`               | High     | Servers.tsx                     |
| POST   | `/api/orchestrator/servers/:id/maintenance`           | High     | Servers.tsx                     |
| POST   | `/api/orchestrator/models/:model/warmup`              | High     | Models.tsx or new page          |
| POST   | `/api/orchestrator/models/:model/unload`              | High     | Models.tsx                      |
| POST   | `/api/orchestrator/models/:model/cancel`              | Medium   | Models.tsx                      |
| GET    | `/api/orchestrator/models/idle`                       | Medium   | Models.tsx                      |
| GET    | `/api/orchestrator/models/recommendations`            | Medium   | Models.tsx                      |
| GET    | `/api/orchestrator/bans`                              | Medium   | New page or CircuitBreakers.tsx |
| DELETE | `/api/orchestrator/bans/*`                            | Medium   | Ban management page             |
| POST   | `/api/orchestrator/circuit-breakers/:id/:model/reset` | Medium   | CircuitBreakers.tsx             |
| POST   | `/api/orchestrator/circuit-breakers/:id/:model/open`  | Medium   | CircuitBreakers.tsx             |
| POST   | `/api/orchestrator/circuit-breakers/:id/:model/close` | Medium   | CircuitBreakers.tsx             |
| GET    | `/api/orchestrator/recovery-failures/*`               | Low      | Analytics.tsx new tab           |

---

## Testing Recommendations

### Unit Tests

**Priority Components to Test**:

1. `utils/formatting.ts` - Pure functions with predictable output
2. `utils/circuitBreaker.ts` - State logic
3. `validations.ts` - Form validation schemas
4. `api.ts` - API error handling

**Testing Framework**: Vitest (already configured)

### Integration Tests

**Critical User Flows**:

1. Add server → View in list → Remove server
2. Pull model → View status → Delete model
3. Change settings → Save → Verify persistence
4. Navigate to analytics → Change time range → View charts

**Testing Framework**: React Testing Library + MSW (Mock Service Worker)

### E2E Tests

**Full User Journeys**:

1. Complete server setup workflow
2. Model management lifecycle
3. Configuration changes and verification
4. Circuit breaker observation during failures

**Testing Framework**: Playwright (already configured)

---

## Performance Considerations

### Current Optimizations

- **TanStack Query Caching**: Prevents redundant API calls
- **Lazy Loading**: Routes loaded on demand
- **Polling Intervals**: Tuned per endpoint importance
- **Error Boundaries**: Prevents full app crashes

### Recommended Improvements

1. **Virtual Scrolling**: For large server/model lists
2. **Debounced Search**: If implementing request search
3. **Memoization**: Use `React.memo` for expensive components
4. **Image Optimization**: If adding charts with many data points

---

## Security Considerations

### Current Implementation

- **API Key Redaction**: Server responses mask API keys
- **URL Validation**: Strict URL format checking
- **XSS Prevention**: React's built-in escaping + manual sanitization
- **Error Sanitization**: Generic error messages to users

### Recommendations

1. **CSRF Protection**: Add CSRF tokens for state-changing operations
2. **Input Sanitization**: Extend sanitization to all user inputs
3. **Rate Limit Feedback**: Show rate limit status to users
4. **Audit Logging**: Log admin actions in frontend

---

## Accessibility (a11y)

### Current Status

- Basic semantic HTML structure
- ARIA labels on interactive elements
- Keyboard navigation support in modals

### Improvements Needed

1. **Color Contrast**: Ensure WCAG 2.1 AA compliance
2. **Screen Reader Support**: Add aria-live regions for updates
3. **Focus Management**: Trap focus in modals
4. **Keyboard Shortcuts**: Add common action shortcuts

---

## Mobile Responsiveness

### Current Implementation

- Tailwind responsive prefixes used throughout
- Sidebar collapses on mobile (planned)
- Grid layouts adapt to screen size

### Known Issues

1. **Analytics Charts**: May overflow on small screens
2. **Tables**: Horizontal scrolling needed for data tables
3. **Modals**: Full-screen modals on mobile

### Recommendations

1. Add mobile-specific navigation (hamburger menu)
2. Implement swipe gestures for tab navigation
3. Optimize chart rendering for touch devices

---

## Notes for Future Developers

### Adding New Pages

1. Create component in `pages/`
2. Add route in `App.tsx`
3. Add navigation item in `Layout.tsx`
4. Add polling query with appropriate interval
5. Implement loading and error states
6. Add to this documentation

### Adding New API Endpoints

1. Add TypeScript types in `types.ts`
2. Create API wrapper in `api.ts`
3. Use `apiCall<T>()` wrapper for error handling
4. Implement in component with TanStack Query
5. Add to endpoint reference table above

### Code Style Guidelines

- Use functional components with hooks
- Prefer `const` over `let`
- Use optional chaining (`?.`) for nested properties
- Destructure props at component level
- Use meaningful variable names (avoid `data`, `item`)
- Add JSDoc for complex utility functions

---

## Contact & Maintenance

- **Primary Framework**: React 19
- **Build Tool**: Vite 7
- **State Management**: TanStack Query
- **Styling**: Tailwind CSS
- **Last Full Review**: 2026-02-17
- **Document Version**: 2.0.0

### Change Log

| Version | Date       | Changes                                                                                                                                                                 |
| ------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0.0   | 2026-02-17 | Initial document created                                                                                                                                                |
| 1.1.0   | 2026-02-17 | Added Visual/UI Improvements section, expanded roadmap to 9 weeks                                                                                                       |
| 1.2.0   | 2026-02-17 | **Phase 1 Complete**: Created StatCard, EmptyState, Card, Toast components; centralized formatting and circuitBreaker utilities                                         |
| 1.3.0   | 2026-02-17 | **Phase 2 Complete**: Added queue pause/resume controls, server drain/undrain/maintenance, model warmup; integrated toast notifications                                 |
| 1.4.0   | 2026-02-17 | **Phase 3 Complete**: Added circuit breaker manual controls, ban management, recovery analysis tabs                                                                     |
| 1.5.0   | 2026-02-17 | **All Phases Complete**: Modal enhancements (size variants, animations, danger variant), mobile navigation (hamburger menu), form validation visuals, responsive tables |
| 2.0.0   | 2026-02-17 | **Enhancement Review Complete**: Added comprehensive visual and functional enhancement recommendations after intensive code review                                      |
