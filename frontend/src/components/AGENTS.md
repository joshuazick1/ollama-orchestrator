# frontend/src/components/

Reusable UI primitives, modals, layout, error boundaries, and skeletons.

## Purpose

Shared building blocks for pages. The closest the frontend comes to a design system: consistent buttons, modals, cards, search, toasts, and loading skeletons.

Files of record (non-exhaustive):

- [Layout.tsx](Layout.tsx) — App shell (header, sidebar, content).
- [ErrorBoundary.tsx](ErrorBoundary.tsx) — Top-level error boundary.
- [ProtectedRoute.tsx](ProtectedRoute.tsx) — Auth gate.
- [Toaster.tsx](Toaster.tsx) — Global toast host.
- [Modal.tsx](Modal.tsx), [ConfirmationModal.tsx](ConfirmationModal.tsx) — Modal primitives.
- [Button.tsx](Button.tsx), [Card.tsx](Card.tsx), [Badge.tsx](Badge.tsx), [StatCard.tsx](StatCard.tsx) — Atomic UI.
- [EmptyState.tsx](EmptyState.tsx) — Empty list state.
- [DataToolbar.tsx](DataToolbar.tsx) — Search + filter toolbar.
- [GlobalSearch.tsx](GlobalSearch.tsx), [SearchResultGroup.tsx](SearchResultGroup.tsx) — Global search.
- [CircuitDetailModal.tsx](CircuitDetailModal.tsx) — Per-breaker detail view.
- [ModelManagerModal.tsx](ModelManagerModal.tsx) — Model management modal.
- [ErrorLog.tsx](ErrorLog.tsx) — Error log renderer.
- [PageTransition.tsx](PageTransition.tsx) — Page transition wrapper.
- [skeletons/](skeletons/) — Loading skeletons.
- [ui/](ui/) — shadcn/ui primitives: Button, Card, Badge, Input, Label, Dialog, DropdownMenu, Tabs, Tooltip, Sheet, Separator, Skeleton, Alert, Select, Switch, Textarea, Table.
- [**tests**/](__tests__) — Component-level Vitest tests.

## Ownership

- Owns the design-system primitives. New UI primitives belong here before they appear in any page.
- Modal ownership: a modal is shared if it is referenced by more than one page; otherwise it is page-local.
- Skeletons: any component that fetches data should consume a skeleton from [skeletons/](skeletons/) instead of inventing its own spinner.

## Local Contracts

- Styling uses Tailwind CSS via `clsx` + `tailwind-merge`. Do not introduce inline styles or CSS-in-JS.
- Colors come from [frontend/src/constants/colors.ts](../constants/colors.ts) (or Tailwind theme). Hardcoded color values are not allowed.
- Icons come from `lucide-react` (already a dependency).
- Focus management: [Modal.tsx](Modal.tsx) uses `focus-trap-react`. Other overlays must trap focus too if they capture keyboard input.
- Accessibility: every interactive component must have an accessible name (`aria-label` or visible text) and must be reachable by keyboard.

## Work Guidance

- New primitive: place it at the top of [frontend/src/components/](.) and export it. Add a Vitest test under [**tests**/](__tests__) when the component is non-trivial.
- New modal: use [Modal.tsx](Modal.tsx) as the base. Confirmation modals use [ConfirmationModal.tsx](ConfirmationModal.tsx).
- New loading state: add or extend a skeleton in [skeletons/](skeletons/) rather than using a generic spinner.
- Page-level components that have grown too large to read should be split — page-local subcomponents live in the page file, shared ones migrate here.

## Verification

- `npm run test` (in `frontend/`) — covers [**tests**/](__tests__) and any test files at the top of [frontend/src/components/](.).
- `npm run typecheck` and `npm run lint` must pass.
- Manual visual check: every primitive should be exercised in at least one page.
