# src/constants/

Centralized API endpoint paths and error message keys. The only place that owns the strings used to build URLs and error responses.

## Purpose

Avoid magic strings in controllers, routes, and middleware. The constants here are imported wherever a URL path or error key is needed.

Files of record:

- [api-endpoints.ts](api-endpoints.ts) — `API_ENDPOINTS` and the per-provider endpoint type aliases (`OllamaEndpoint`, `OpenAIEndpoint`, `AnthropicEndpoint`).
- [error-messages.ts](error-messages.ts) — `ERROR_MESSAGES` and the `ErrorMessageKey` type.
- [index.ts](index.ts) — Barrel re-export.

## Ownership

- Owns the URL strings and the error message catalog. Controllers, routes, and tests import from here.
- New endpoint paths must be added here, not inlined.
- New error message keys must be added here, not duplicated as string literals in controllers.

## Local Contracts

- The endpoint type unions (`OllamaEndpoint`, `OpenAIEndpoint`, `AnthropicEndpoint`) are exhaustive for their respective provider surfaces. Adding a new endpoint to the constant must keep the type union in sync.
- The `ErrorMessageKey` type is a closed union. Tests and the frontend may rely on its completeness.

## Work Guidance

- Adding an endpoint: add it to `API_ENDPOINTS`, ensure the type union is still correct, and use the constant in the controller/route.
- Adding an error message: add it to `ERROR_MESSAGES` with a key, add the key to the `ErrorMessageKey` union, and reference the key from controllers.
- The frontend mirrors endpoint paths in [frontend/src/api.ts](../../frontend/src/api.ts); if a public endpoint moves, both sides must be updated in the same change.

## Verification

- `npm test` — covers any `*api-endpoints*` or `*error-messages*` unit test (currently covered indirectly by controller tests).
- `npm run typecheck` — must pass; the type unions are the primary correctness check.
