# API Client — `frontend/src/api/`

Typed API client modules. One file per backend API area.

## Purpose

Provides the typed wrappers around `fetch` that the rest of the frontend uses to talk to the orchestrator's REST API. Each module exports plain async functions returning typed responses; the React Query hooks in [`../hooks/`](../hooks/) wrap these.

## Directory Map

```
api/
├── client.ts                      # base fetch wrapper (auth headers, error normalization)
├── types.ts                       # shared API client types (Pagination, SortOptions, ...)
├── auth.ts                        # /api/auth/* (login, logout, refresh)
├── analytics.ts                   # /api/orchestrator/analytics/*
├── circuit-breakers.ts            # /api/orchestrator/circuit-breaker/*
├── config.ts                      # /api/orchestrator/config/*
├── errors.ts                      # /api/orchestrator/error-events/*
├── health.ts                      # /health/* (live + ready)
├── honeypot.ts                    # /api/orchestrator/honeypot-stats
├── hooks.ts                       # /api/orchestrator/hooks
├── logs.ts                        # /api/orchestrator/logs
├── metrics.ts                     # /api/orchestrator/metrics/*
├── models.ts                      # /api/orchestrator/models/*
├── perf-probe.ts                  # /api/orchestrator/perf-probe/*
├── servers.ts                     # /api/orchestrator/servers/*
├── setup.ts                       # /api/orchestrator/setup (first-time setup)
└── anthropic.ts                   # /v1/messages Anthropic-compat (optional client surface)
```

One file per backend area keeps the import graph narrow and the test surface small. New API area → new file.

## Local Contracts

- All functions return typed responses (no `any`); failures throw `ApiError`.
- Auth header injection is centralized in `client.ts` — individual functions do not add it.
- Streaming endpoints (SSE) live in [`../utils/stream-fetch.ts`](../utils/stream-fetch.ts), not here.

## Work Guidance

- New API area: add a new file, export typed functions, add a vitest mock.
- Do not introduce axios or another HTTP library. The fetch wrapper in `client.ts` is canonical.

## Verification

```bash
cd ollama-orchestrator/frontend && npx vitest run src/api/
```