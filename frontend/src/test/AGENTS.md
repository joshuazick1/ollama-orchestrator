# Test Utilities — `frontend/src/test/`

Shared frontend test utilities and helpers.

## Purpose

Houses Vitest setup, custom render functions, and reusable mock factories used across the frontend test suite.

## Directory Map

```
test/
└── setup.ts                       # global Vitest setup (jsdom, @testing-library/jest-dom matchers)
```

`setup.ts` is referenced from the vitest config and runs before every test file.

## Local Contracts

- One file: `setup.ts`. Global setup only.
- Reusable render wrappers and mock factories live next to their consumers (e.g. mocks for a specific page).

## Verification

Setup is implicitly verified by every frontend test run.