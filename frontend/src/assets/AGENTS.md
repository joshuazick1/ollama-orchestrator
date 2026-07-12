# Assets — `frontend/src/assets/`

Static assets bundled by Vite.

## Purpose

Holds images, icons, and other binary assets imported by components. Vite hashes these and serves them from `dist/assets/`.

## Directory Map

```
assets/
└── react.svg                      # default Vite React logo (used in initial setup screen)
```

Most assets today live in `frontend/public/` instead. This directory is reserved for assets that need to be processed by Vite (imported as modules).

## Local Contracts

- Import assets as ES modules: `import logo from '@/assets/logo.svg'`.
- For files that should be served verbatim, use [`../../public/`](../../public/).

## Verification

No tests.