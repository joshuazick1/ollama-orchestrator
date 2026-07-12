# Styles — `frontend/src/styles/`

Global CSS and design tokens.

## Purpose

Holds the design-token CSS (custom properties) that the rest of the frontend references for colors, spacing, and surface ladder. Tailwind utility classes consume these via the theme config.

## Directory Map

```
styles/
└── tokens.css                     # CSS custom properties (oklch colors, surface ladder, fonts)
```

## Local Contracts

- `tokens.css` is the only file in this directory.
- Color names use the surface ladder: `--canvas`, `--surface`, `--surface-raised`, `--surface-overlay`.
- Tailwind config in `tailwind.config.ts` consumes these tokens — do not duplicate the values in JS.

## Verification

No tests — visual verification only. E2E: `tests/e2e/auth-flow.spec.ts` exercises the styled login screen.