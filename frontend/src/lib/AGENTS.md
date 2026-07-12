# Library Wrappers — `frontend/src/lib/`

Thin wrappers around third-party libraries. Holds small utilities that don't fit anywhere else.

## Purpose

Centralizes glue code for third-party libraries (WebSocket, formatting, class-name composition) so the rest of the frontend can import a stable surface.

## Directory Map

```
lib/
└── utils.ts                       # cn() class-name helper (clsx + tailwind-merge)
```

Currently minimal — most third-party wrappers are colocated with their consumers (e.g. `useWebSocket` is in [`../hooks/`](../hooks/)).

## Local Contracts

- No business logic. If something knows about a domain entity, it does not belong here.
- `utils.ts` exports `cn(...)` — the canonical class-name composition helper. Use it everywhere instead of inline `clsx(...)` or template strings.

## Verification

No dedicated tests — `utils.ts` is exercised through its consumers.