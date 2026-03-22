# DESIGN: Anthropic Endpoint Support

**Overview**

- Add first-class Anthropic protocol capability detection and routing to the orchestrator.
- Anthropic protocol requests must only be routed to servers that explicitly advertise Anthropic support (no implicit conversion or fallback to Ollama/OpenAI servers).
- Conversion between Anthropic request/response formats and internal/Ollama formats is explicitly deferred: conversion work is listed as a later phase.

**Goals**

- Detect Anthropic-compatible servers during health checks and expose capability flags on AIServer objects.
- Route inbound Anthropic endpoint requests only to servers with Anthropic capability.
- Add a minimal Anthropic controller that proxies Anthropic request shapes (validation + forwarding) to the orchestrator using existing internal request paths. Streaming conversion and protocol translation are out of scope for this phase.
- Update health checks, orchestration routing, API routing, tests and documentation.

**Non-goals (this phase)**

- Implementing full request/response conversion between Anthropic and Ollama/OpenAI formats.
- Full support for Anthropic streaming event semantics, content block types, tools, web_search tool mapping, and token accounting. Those will be addressed in a later phase if requested.

## High-level approach

- Add capability detection for Anthropic in the HealthCheckScheduler probing flow: probe Anthropic endpoints in parallel with existing `/api` and `/v1` probes.
- Add `supportsAnthropic?: boolean` and `anthropicModels?: string[]` to `AIServer` type.
- Add Anthropic-specific endpoints to our router (e.g. `/v1/messages`, `/v1/models`, `/v1/count_tokens`) handled by a new `anthropicController.ts` which performs validation and forwards requests through the orchestrator API using existing leader/selection/failover logic.
- Require that when a request is received on an Anthropic endpoint, the orchestrator only considers servers with `supportsAnthropic !== false`. Do not add automatic conversion or fallback to other protocol servers for Anthropic requests.
- Add tests and documentation updates that describe supported endpoints and the capability constraint.

## Detailed changes (files)

The following files will be added or updated as part of the implementation. File paths are workspace-relative.

- Add: `src/controllers/anthropicController.ts` — new controller to accept Anthropic-style requests and forward them to orchestrator. This controller focuses on validation, request shape checks, header handling, and calling existing orchestrator `tryRequestWithFailover` semantics. It will NOT implement conversion between Anthropic streaming semantics and Ollama NDJSON; instead it will proxy requests to servers that natively speak Anthropic.

- Update: `src/constants/api-endpoints.ts` — add an `ANTHROPIC` entry with canonical paths we probe and expose as supported endpoints (e.g. `/v1/messages`, `/v1/models`, `/v1/count_tokens`).

- Update: `src/orchestrator.types.ts` — add `supportsAnthropic?: boolean;` and `anthropicModels?: string[];` on `AIServer` interface so capability is tracked in server objects.

- Update: `src/health-check-scheduler.ts` — extend `checkServerHealth()` probing to include Anthropic endpoint probes (prefer `GET ${server.url}/v1/models` and a small POST to `POST ${server.url}/v1/messages` optionally). Parse model lists and set `supportsAnthropic` and `anthropicModels` accordingly. Keep probes short and non-destructive.

- Update: `src/orchestrator.ts` — routing logic should consider `supportsAnthropic` when the request protocol is Anthropic. Where `requiredCapability` or requestProtocol is checked, add `anthropic` branch in the same style as existing `ollama`/`openai` checks. Ensure failover and handoff code excludes servers without Anthropic capability for Anthropic requests.

- Update: `src/controllers/serversController.ts` — include `supportsAnthropic` and `anthropicModels` in server listings / management endpoints so operators can see capability information in the API.

- Update: `src/routes/orchestrator.ts` — add routes mapping Anthropic endpoints to `anthropicController` (e.g. `router.post('/v1/messages', handleAnthropicMessages)` etc.). Prefer consistent middleware (auth, validation, rate limiting) used by existing controllers.

- Add tests: `tests/unit/anthropic-health.test.ts`, `tests/unit/anthropic-controller.test.ts`, and `tests/unit/dual-capability-server.test.ts` (or extend existing dual-capability tests) to validate: detection, routing only-to-capable-servers, basic proxying behaviors, and rejection when no Anthropic-capable server is available.

- Update docs: Add a new doc page and update repository docs referenced below. The design doc will be added to the repo root as `DESIGN-anthropic.md` (this file). Additional documentation changes described in Documentation section.

## Health check changes (detailed)

- Probe selection logic (existing): the scheduler currently probes Ollama (`/api/tags` and `/api/ps`) and OpenAI V1 (`/v1/models`) in parallel depending on server.type. Add Anthropic probes alongside these.
- Suggested probes (non-destructive & fast):
  1. GET `${server.url}/v1/models` with a short timeout (5000ms). If the response is OK (200) and the payload resembles { data: [ { id: "<model>" }, ... ] } or another standard model list, set `supportsAnthropic = true` and populate `anthropicModels` from listing.
  2. Optionally POST `${server.url}/v1/messages` with a minimal body and `stream=false` and a very short timeout (2000-3000ms) to confirm message endpoint behavior. This POST must be safe — small prompt and no side effects.
- Update `HealthCheckResult` type to include `supportsAnthropic?: boolean` and `anthropicModels?: string[]`.
- Update logging to capture capability changes (same style as `supportsOllama`/`supportsV1`).

## Capability detection heuristics (ambiguous /v1/models)

Because both OpenAI-compatible servers and Anthropic-compatible servers may respond on `/v1/models`, the health-check must use a multi-stage, non-invasive detection heuristic to determine whether a `/v1/models` response corresponds to OpenAI V1 semantics or Anthropic semantics without performing inference.

1. Prefer protocol-specific endpoints

- If `/api/tags` responds OK -> mark `supportsOllama=true` and skip further protocol ambiguity checks unless `server.type` indicates `auto` and other flags are set.

2. Inspect `/v1/models` payload (non-inferential)

- If GET `${server.url}/v1/models` responds OK, parse the payload and apply heuristics:
  - OpenAI-like shape: top-level `data` array of objects with fields like `id`, `object`, `created`, `owned_by` strongly indicates OpenAI-compatible API (set `supportsV1=true`). If `owned_by` or `id` contains `openai`/`openai-` mark as OpenAI.
  - Anthropic hints: model ids or names containing known Anthropic model tokens (e.g., `claude`, `anthropic/`, `claude-2`, `claude-instant`) indicate Anthropic (set `supportsAnthropic=true`). Also check for any `models` field or vendor-specific shape that differs from OpenAI's `data` array.
  - If model names include provider prefixes (e.g., `anthropic/claude-2` or `openai/gpt-4`), use the prefix to assign capability.

3. Probe method metadata (OPTIONS/HEAD)

- If the `/v1/models` payload is ambiguous, send an `OPTIONS` (or `HEAD`) request to `/v1/messages` (no body). This is non-invasive and should not trigger inference. Heuristics:
  - If `OPTIONS` returns `Allow: POST` and CORS headers consistent with a chat/messages endpoint, treat it as a positive signal for Anthropic support.
  - If `OPTIONS` is disallowed or absent, it is a weak signal only — do not make definitive conclusions from this alone.

4. Safe operator-controlled POST probe (last resort)

- If ambiguity persists and automatic routing is critical, optionally perform a safe POST probe to `/v1/messages` with a minimal, clearly labeled probe payload under a feature flag `enableAnthropicProbePost` and with a tight timeout (2s). This probe is considered an inference request by some servers; therefore it must be operator-configurable and disabled by default in conservative environments.
  - Example probe body: `{ "model": "<small-model>", "messages": [{ "role": "user", "content": "_health_check_probe_" }], "stream": false }`
  - If the probe returns a structured Anthropic-style response (or an error that indicates the endpoint exists but input validation failed), mark `supportsAnthropic=true`.
  - If the probe returns an OpenAI-style error/listing, mark `supportsV1=true`.

5. Admin override and `server.type`

- Always allow an admin override via server configuration: `type` can be set to `anthropic` explicitly. This takes precedence over heuristic detection and is surfaced in the UI. Use this for environments where autodetection is unreliable or prohibited.

6. Ambiguity policy

- If after all non-invasive checks ambiguity remains, default to `supportsV1=true` (OpenAI-compatible) only if model payload strongly matches OpenAI shape; otherwise leave both flags undefined and surface a visible warning in the servers list and the health-check logs. Require admin to confirm which protocol to use.

Logging and transparency

- Every decision must be logged with `healthProbeId`, the sequence of probes run, their HTTP status codes and responses (truncated), and the final capability result. This aids operators when a server is misidentified.

Security and compliance

- The optional POST probe is opt-in via `enableAnthropicProbePost` and must be disabled by default in sensitive environments. Document its behavior and provide an audit trail in logs so operators can review when such probes ran.

## Routing / orchestrator changes

- Requests that arrive at Anthropic endpoints must be labeled as `protocol: 'anthropic'` (or a `requiredCapability = 'anthropic'`) in routing context.
- When selecting candidate servers, only include servers where `supportsAnthropic !== false`.
- For multi-protocol servers (supportsOllama and supportsV1 and supportsAnthropic true), the orchestrator can route Anthropic requests to them. However, an Anthropic request must not be automatically converted and sent to an Ollama-only server.
- Modify failover logic: when searching for replacement servers during failover/hand-off for an Anthropic request, ensure the replacement supports Anthropic. Existing handoff flow already checks protocol compatibility for openai vs ollama; add the new check for anthropic.

## Controller & routing (detailed)

- Add `src/controllers/anthropicController.ts` with handlers:
  - `handleAnthropicMessages(req, res)` — validate body shape (model + messages), apply auth, then call orchestrator.tryRequestWithFailover(model, serverHandler) where serverHandler forwards request to the backend Anthropic server path (e.g. POST `${server.url}/v1/messages`) and proxies the response back to the client.
  - `handleAnthropicModels(req, res)` — proxy GET `${server.url}/v1/models` to return aggregated models (or use orchestrator aggregated view if available).
  - `handleCountTokens(req, res)` — optional: proxy to a backend `v1/count_tokens` if the server supports it.

- Use existing utilities for backend fetches: `fetchWithTimeout`/`fetchWithActivityTimeout`, `getInFlightManager()`, `performStreamHandoff()` for streaming only when servers speak Anthropic natively (streaming conversion is out-of-scope now). If streaming version of Anthropic request is received and backend server supports Anthropic streaming, proxy streaming directly (pass-through). If route receives streaming request but backend server does not support streaming, return 501/422 with clear message.

## Streaming & conversion (deferred)

- We will not implement Anthropic → Ollama conversions in this phase. If a request arrives on Anthropic endpoints and the selected server supports Anthropic natively and exposes Anthropic streaming, we will proxy the streaming chunks as-is (pass-through) to the client. If the selected server does not support Anthropic streaming semantics, reject or return an error.
- A later phase may implement translation between Anthropic streaming event shapes and internal/Ollama NDJSON streams. That phase will require careful unit + integration tests; it will be scoped independently.

## Feature flags & configuration

- Add config flags (default: enabled):
  - `featureFlags.enableAnthropicSupport` — toggles health probing and routing for Anthropic. Default `true` in new deploys, but helpful for staged rollouts.
- Add health-check probe timeouts and retry attempts configurable via `HealthCheckConfig` (existing pattern). Keep conservative defaults (v1/models 5s, messages small POST 2–3s).

## Testing

- Unit tests (new):
  1. `tests/unit/anthropic-health.test.ts`: verify health-check sets `supportsAnthropic` when probes respond and populates `anthropicModels` correctly; verify server remains healthy if at least one endpoint responds.
  2. `tests/unit/anthropic-controller.test.ts`: mock an Anthropic-capable backend server and test that `handleAnthropicMessages` forwards request and returns backend response; test auth header forwarding.
  3. `tests/unit/dual-capability-server.test.ts`: ensure when a server advertises multiple capabilities the routing honors required capability (anthropic requests go to anthro servers only).
- Integration-style tests (existing harness): create a simulated Anthropic server stub that returns typical /v1/models and /v1/messages payloads and wire it into existing orchestrator test suite (e.g., `tests/unit/integration.test.ts` or new test file) and validate failover behavior and handoff restrictions.

## Documentation updates

- Files to update (overview):
  1. `README.md` — add a short note describing Anthropic endpoint support and the capability-only routing rule.
  2. `docs/` (if present) or `API` docs — add a section describing supported Anthropic endpoints, known limitations, and expected status codes when no Anthropic servers are available (e.g., 503, or a 400 with message). If the repo contains an API reference, add the Anthropic endpoints and examples.
  3. `src/controllers/README` or any controller-level docs — document the `anthropicController` behavior and non-goals (no conversion yet).
  4. `DESIGN-anthropic.md` — this document (add to repo root). It must be kept in sync with the code changes and updated if we move to conversion phase.

- Documentation completeness checklist:
  - Endpoint list (paths accepted by the orchestrator) and what each does.
  - Capability semantics: anthopric endpoints route only to servers with capability flag.
  - Known limitations (streaming and conversion deferred).
  - Example requests and responses for `/v1/messages` and `/v1/models` proxying.
  - Troubleshooting: how to inspect server capability flags (`/api/servers` or admin APIs) and common error messages.

## Rollout plan

1. Implement code behind a feature flag `enableAnthropicSupport` defaulting to true for slow rollouts.
2. Run unit tests locally, then CI. Fix test failures.
3. Deploy to a staging environment that exposes at least one Anthropic-capable server to verify health checks detect capability and routing works.
4. Smoke tests: POST to `/v1/messages` on orchestrator and verify request lands on the Anthropic-capable server only. Confirm logs show selection of `supportsAnthropic` server and failover respects capability.
5. Gradual production rollout. Monitor errors and metrics for capability changes.

Timeline (estimate)

- Detection + types + health-checks: 0.5–1 day
- Controller + routing + unit tests (non-streaming): 1–2 days
- Documentation updates and tests integration: 0.5–1 day
- Staging QA and fixups: 0.5–1 day
- Total (MVP): ~3–5 working days

Acceptance criteria

- Health check sets `supportsAnthropic` and `anthropicModels` when backend responds.
- `POST /v1/messages` reaches only Anthropic-capable servers; if none available the orchestrator returns a clear error (503 or custom error) indicating no Anthropic servers available.
- Unit/integration tests cover detection and routing rules.
- Documentation updated describing limited support and how to enable/inspect Anthropic capability.

## Risks & mitigations

- Risk: Upstream Anthropic semantics vary (different payload shapes). Mitigation: keep probes and validators tolerant; treat model parsing as best-effort and log parsing failures.
- Risk: Operators expect conversion to occur automatically. Mitigation: Documentation must clearly state conversion is deferred and Anthropic requests will not be forwarded to non-Anthropic servers.
- Risk: Streaming behavior is inconsistent across backends. Mitigation: reject streaming Anthropic requests when backend doesn't advertise streaming support; document this behavior.

## Next phase (conversion)

- If the team wants full Anthropic compatibility in the future, the next phase includes porting the upstream `anthropic.go` conversion logic into `src/controllers/anthropicConverter.ts` and streaming converter utilities. This will require a separate DESIGN doc and additional tests for streaming, tools, and content block types.

## Contact / reviewers

- Suggested reviewers: maintainers familiar with routing, streaming, and health-check code (owners of `orchestrator.ts`, `health-check-scheduler.ts`, and `streaming.ts`).

## Change log

- Added: `DESIGN-anthropic.md` (this file).
- Planned: `src/controllers/anthropicController.ts`, `src/constants/api-endpoints.ts` (update), `src/orchestrator.types.ts` (update), `src/health-check-scheduler.ts` (update), `src/orchestrator.ts` (routing update), `src/routes/orchestrator.ts` (route wiring), docs updates, tests.

-- End

## Step-by-step review and checklist

Follow this checklist while implementing each step. Each item below corresponds to a change listed earlier; verify completion before moving to the next step.

1. Types & constants

- Files: `src/orchestrator.types.ts`, `src/constants/api-endpoints.ts`, `src/constants/index.ts` (if needed).
- Tasks:
  - Add `supportsAnthropic?: boolean` and `anthropicModels?: string[]` to `AIServer`.
  - Add `API_ENDPOINTS.ANTHROPIC` with canonical paths: `MESSAGES: '/v1/messages'`, `MODELS: '/v1/models'`, `COUNT_TOKENS: '/v1/count_tokens'`.
  - Add an error constant for no-capable-servers: `ERROR_MESSAGES.NO_ANTHROPIC_SERVER` with text `No Anthropic-capable servers are available`.
  - Ensure any serialization/persistence code tolerates missing fields (backwards compatible) when reading older saved server data.
  - Acceptance: TypeScript compiles; saved servers.json loads without schema errors; linter passes.

2. Health checks

- Files: `src/health-check-scheduler.ts` (primary), tests for health-check.
- Tasks:
  - Add probing of Anthropic endpoints (GET `/v1/models` + optional POST `/v1/messages`) with conservative timeouts.
  - Parse model listing and set `supportsAnthropic` and `anthropicModels` on `server` object.
  - Add `supportsAnthropic` and `anthropicModels` to `HealthCheckResult`.
  - Update logging for capability changes (same style as `supportsOllama`/`supportsV1`).
  - Acceptance: Unit tests assert `checkServerHealth` sets flags correctly given stubbed backend responses.

3. Orchestrator routing

- Files: `src/orchestrator.ts`, `src/orchestrator-instance.ts` (if capability propagation exists), `src/utils/*` if helper functions are added.
- Tasks:
  - Ensure routing decision respects `requiredCapability === 'anthropic'` and filters servers by `supportsAnthropic !== false`.
  - Update failover/hand-off logic to require Anthropic support for replacements when request protocol is Anthropic.
  - Add unit tests asserting an Anthropic request is not routed to non-Anthropic servers and that failover only considers Anthropic-capable servers.
  - Acceptance: existing routing tests pass and new tests added.

4. Anthropic controller & routes

- Files: `src/controllers/anthropicController.ts`, `src/routes/orchestrator.ts` (and any index of routes).
- Tasks:
  - Implement `handleAnthropicMessages`, `handleAnthropicModels`, `handleCountTokens` (optional).
  - Validate incoming request bodies (presence of `model` and `messages` for messages API) and return helpful 400 errors for invalid shapes.
  - Forward Authorization header and resolved API keys using `resolveApiKey` conventions.
  - Use `getOrchestratorInstance().tryRequestWithFailover(model, serverHandler)` to perform routing and failover.
  - For streaming requests: if request has `stream: true` pass-through only when backend server advertises Anthropic streaming support; otherwise return 422/501 with a clear message.
  - Acceptance: Controller unit tests validate behavior with mocked orchestrator and backend fetch responses.

5. Servers API & frontend data surfaces

- Files: `src/controllers/serversController.ts`, front-end code (if any), API docs.
- Tasks:
  - Ensure servers listing endpoints include `supportsAnthropic` and `anthropicModels` in returned JSON (do not include API keys or sensitive tokens in responses).
  - Update admin UI surfaces (see Frontend section below) to show the new capability and allow filtering/sorting by `supportsAnthropic`.
  - Acceptance: API returns flags and UI (if present) displays them; server add/edit flows remain secure (masked API key display).

6. Tests

- Files: tests under `tests/unit/` and any integration test harness.
- Tasks:
  - Add unit tests described in the plan.
  - Extend integration tests with a simple Anthropic-capable stub server that returns expected `/v1/models` and `/v1/messages` responses and supports streaming pass-through.
  - Ensure CI runs these tests; update test mocks if necessary.
  - Acceptance: All tests pass in CI.

7. Documentation

- Files: `README.md`, any doc pages under `docs/`, `src/controllers/README` (if present), `DESIGN-anthropic.md` (this document).
- Tasks:
  - Add clear API examples for `/v1/messages` and `/v1/models` with request/response shapes and example error responses when no Anthropic servers are available.
  - Update architecture/design docs referencing server capabilities.
  - Add troubleshooting steps that describe how to inspect `supportsAnthropic` in the servers API, and how to enable/disable via feature flag.
  - Acceptance: Docs build step (if present) succeeds and docs reviewers sign off on clarity.

8. Feature flags & config

- Files: `src/config/feature-flags.ts`, `src/config/config.ts`/schema.
- Tasks:
  - Add `enableAnthropicSupport` feature flag and wire into health-check scheduler and route registration (so routes can be disabled if flag off).
  - Add configuration options for Anthropic probe timeouts and retry counts.
  - Acceptance: Flag toggles behavior in tests and runtime.

9. Backwards compatibility & persistence

- Files: `src/orchestrator-persistence.ts`, config persistence, `data/servers.json` handling.
- Tasks:
  - Ensure new fields are optional and code handles older files that don't include them.
  - If a migration is required, implement a safe migration path or initialize default values when loading.
  - Acceptance: Server data persists and reloads successfully after changes.

10. Logging, metrics & observability

- Files: logger usage locations; metrics aggregator changes
- Tasks:
  - Emit structured logs recording capability changes `supportsAnthropic` and `anthropicModels` population events.
  - Add metrics (optional) counting Anthropic requests routed, Anthropic failovers, and rejected Anthropic requests due to no capable servers.
  - Acceptance: Logs show capability changes in staging; metrics are available in monitoring backends.

## Frontend changes (detailed)

Even if this repo is primarily a backend orchestrator, operators often interact with a small admin UI or the API via consoles; consider these UI changes:

- Server list / Servers detail pages
  - Add a new column `Anthropic` (boolean) and a details section listing `anthropicModels` for each server.
  - Allow filtering servers by capability (Ollama/OpenAI/Anthropic) to make it easy to find capable servers during debugging and route configuration.
  - Ensure that API keys are never displayed in full; continue to show masked tokens and a button to rotate/update keys.

- Model selection UX
  - If the UI allows selecting a server/model to target, add a protocol selector and automatically filter models by protocol. For Anthropic requests the model dropdown should only show `anthropicModels` from capable servers or aggregated catalog entries labeled with provider info.

- Documentation / API Explorer
  - If an API Explorer UI exists (swagger/openapi), register the Anthropic endpoints with example bodies and indicate that the request will only succeed if at least one Anthropic-capable backend is configured.

- Error handling UX
  - Surface a clear message in the UI when an Anthropic request fails due to no capable servers, linking to the Servers page to add/configure one.

Security & privacy notes for frontend

- Never show API keys; provide a masked display and explicit rotate/update flows.
- Ensure any frontend code that relies on `anthropicModels` treats the data as non-sensitive.

## Open questions to confirm (one targeted question)

I can proceed to implement these changes. One decision to confirm before coding:

1. Which HTTP status code should be used when an Anthropic request arrives but there are no Anthropic-capable servers? Recommendation: `503 Service Unavailable` with JSON `{ "error": "No Anthropic-capable servers are available" }` (matches a service-level capability absence). Do you agree with `503` (Recommended) or prefer `400`/`422`/a custom code?

If you confirm, I'll start implementing step 1 (types & constants) and step 2 (health checks). If you prefer a different status code I will use that instead and update the design doc accordingly.
