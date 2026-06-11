# frontend/src/constants/

Frontend constants: app metadata, color palette, navigation, time formatting.

## Purpose

Avoid magic strings and magic numbers in the UI. The constants here are imported wherever a label, color, route, or time format is needed.

Files of record:

- [app.ts](app.ts) — App name, version, default page title, etc.
- [colors.ts](colors.ts) — Color palette used by charts and badges.
- [navigation.ts](navigation.ts) — Sidebar navigation entries (label, path, icon).
- [time.ts](time.ts) — Time formatting constants (date format strings, refresh intervals).

## Ownership

- Owns the string/number catalog for the UI. Pages, components, and hooks import from here.
- Color changes: edit [colors.ts](colors.ts) and the Tailwind theme in [tailwind.config.js](../../tailwind.config.js) together.

## Local Contracts

- The navigation entries must match the routes in [frontend/src/App.tsx](../App.tsx). Adding a route without a navigation entry (or vice versa) is a bug.
- Time format strings are used by [frontend/src/utils/formatting.ts](../utils/formatting.ts) and by date pickers across the app.

## Work Guidance

- New constant: add it to the most specific file in this folder. If a constant is a route, it belongs in [navigation.ts](navigation.ts). If a constant is a color, it belongs in [colors.ts](colors.ts).
- New page: add a navigation entry in [navigation.ts](navigation.ts) before or alongside the page file.

## Verification

- `npm run typecheck` and `npm run lint` must pass.
- Manual: every navigation entry must point to a real, working route.
