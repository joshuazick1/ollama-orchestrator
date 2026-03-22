# Design: Context Window Aware Load Balancing

## Goal

Make the orchestrator (1) surface the largest context window available from our backend Ollama servers via `/api/ps` and health probes, and (2) bias the load balancer toward servers that can serve requests requiring larger context windows.

## Why

- Some Ollama servers are configured with smaller context windows; routing a long-context request to a server that cannot support the requested context will either fail or silently truncate context which reduces quality.
- By capturing the maximum context window per server and per loaded model, the orchestrator can prefer servers that meet the request requirement and report the cluster's highest available context window to operators.

## Scope

- Parse and persist context-window information from backend `/api/ps` responses during health checks.
- Expose aggregated context window information in the orchestrator's `/api/ps` endpoint (optional top-level field `max_context_window` and per-model `context_window`).
- Add a lightweight scoring component to the load balancer that favors servers with higher context windows when a request indicates a required context size.
- Plumb request-required-context through controllers → orchestrator → load balancer.

## Compatibility principles

- Backward compatible: existing behaviour unchanged if servers do not advertise context window.
- Conservative by default: new context scoring weight is small and feature-flag controlled so rollout can be gradual.
- Fallback default context window configurable (recommended default 2048 tokens).

## Data and field names

We will support the following fields (both when parsing backend `/api/ps` and when returning our own `/api/ps`):

- Per-process / model entry (from Ollama `/api/ps`): look for any of these keys and prefer in this order if present:
  - `context_window` (numeric tokens) — preferred explicit field
  - `num_ctx` or `num_ctx_tokens` — common alternative
  - `ctx` or `context` (less common)
  - in absence of explicit keys, we try to infer or fall back to configured default

- Our aggregated `/api/ps` response (returned by orchestrator `handlePs`):
  - `models`: array (unchanged), each model entry may include `context_window` when available
  - new top-level optional field: `max_context_window` (number). This is the highest context window seen across all healthy servers or undefined if unknown.

## Examples (expected shapes)

Backend PS snippet (examples we should detect):

1. explicit context

{
"models": [
{ "name": "llama3.2:latest", "size_vram": 3972362240, "context_window": 8192 }
]
}

2. alternative key

{
"models": [
{ "name": "mistral:latest", "size_vram": 0, "num_ctx": 4096 }
]
}

Our orchestrator `/api/ps` response:

{
"models": [ { "name": "llama3.2:latest", "server": "srv-....", "context_window": 8192 }, ... ],
"max_context_window": 8192
}

## Design details

1. Types and state
   - Extend types:
     - `LoadedModel` (src/orchestrator.types.ts): add optional `contextWindow?: number`.
     - `AIServer.hardware`: add optional `maxContextWindow?: number`.
   - Model-manager/health-check persistence:
     - When health-checks parse `/api/ps`, set `server.hardware.loadedModels[].contextWindow` (when detected) and `server.hardware.maxContextWindow` = max across loadedModels or other server-provided inference.

2. Health checks
   - File: `src/health-check-scheduler.ts`
   - When parsing `psResponse` models, attempt to extract `context_window`, `num_ctx`, `ctx` for each model. Convert to number and attach to `loadedModels` entries.
   - Compute `totalVramUsed` as before and compute `maxContextWindow` = max(contexts, default undefined).
   - Expose this information in `HealthCheckResult.loadedModels` shape and let orchestrator update AIServer.hardware accordingly.

3. Controller `/api/ps`
   - File: `src/controllers/ollamaController.ts`
   - Currently aggregates models from all backend servers into `models: []`. Keep this behavior but augment each model entry (if context found) with `context_window` and compute `max_context_window` as the highest advertised context among the servers we queried.
   - Keep this additive so clients that ignore the new fields are unaffected.

4. Load balancer scoring
   - File: `src/load-balancer.ts`
   - Add `weights.contextWindow` to `LoadBalancerConfig.weights` with default 0.05 (conservative).
   - Extend `calculateServerScore` signature to accept `requiredContext?: number` (or extend `AIServer`/`ServerModelMetrics` passed into calculateServerScore).
   - Compute `contextScore`:
     - If server.hardware.loadedModels contains the model and that entry has a `contextWindow` >= requiredContext: `contextScore = 100` (best).
     - Else if server.hardware.maxContextWindow defined: `contextScore = 100 * min(1, server.hardware.maxContextWindow / requiredContext)` (clamped 0..100). If no `requiredContext` present: treat `contextScore = 100` (neutral).
     - If neither available, treat neutral `contextScore = 50` so servers without info are not heavily penalized.
   - Combine `contextScore * weights.contextWindow` into the total score.

5. Request plumbing
   - Extract `requiredContext` in controllers where requests arrive:
     - For `handleGenerate` / `handleGenerateToServer`: if `body.context` array present use its length; else if `body.options?.num_ctx` or `body.options?.num_ctx_tokens` present use it; otherwise undefined (defaults to configured default).
   - Pass `requiredContext` into orchestrator selection path. Update orchestrator functions that call load-balancer to accept an optional `requiredContext` parameter and pass it down to `loadBalancer.select`.

6. Model-manager and warmup decisions (optional enhancement)
   - If model info (via `/api/show`) returns context metadata, persist `ModelLoadingState.contextWindow` and consider it when computing warmup feasibility (e.g., servers that cannot provide required context should be deprioritized for warmup of such requests).

7. Config & feature flag
   - Add `defaultContextWindow` config (default 2048) and `featureFlags.contextScoring` to toggle the scoring behavior.
   - Keep `weights.contextWindow` small initially; operators can tune.

## Testing

- Unit tests:
  - `tests/unit/load-balancer-weights.test.ts`: assert higher context servers win when `requiredContext` is large.
  - `tests/unit/health-check-enhanced.test.ts`: mock `/api/ps` responses with `context_window` and ensure scheduler parses and sets `server.hardware.maxContextWindow`.
  - `tests/utils/mock-server-factory.ts`: add mock `/api/ps` responses containing `context_window` variants.

- Integration tests:
  - Run `handlePs` endpoint in dev mode against a few test servers (see below) and assert the returned `max_context_window` equals the observed maximum.

## Rollout plan

1. Implement parsing and `/api/ps` aggregation only — ship to staging. Operators get visibility but routing unchanged.
2. Implement LB scoring behind a feature flag and default low weight. Deploy to canary; monitor routing changes and decision logs.
3. Gradually increase weight if results show improved success/latency for long-context requests.
4. When confident, enable broadly and increase docs.

## Operational notes

- Not all Ollama versions include `context_window` in `/api/ps`. Expect heterogeneity.
- Do not make context a hard requirement initially; use it as a soft scoring signal until we have widespread reporting.
- Keep an operator-facing metric: fraction of requests where requiredContext > cluster `max_context_window`.

## How to detect context window in the wild

When querying `/api/ps` from various servers look for keys described above. Some implementations may return the value under nonstandard keys — include quick heuristics:

- Numeric values on model entries named like `ctx`, `context_window`, `num_ctx`, `num_ctx_tokens`.
- Textual descriptions in `details` fields (rare) — attempt a regex like `/([0-9]{3,5})\s*(tokens|ctx|context)/i` as a last resort.

## Appendix: sample curl commands for live checks

- curl -sS --max-time 10 "http://<server>/api/ps" | jq .

Replace `<server>` with the server URL (host:port). Look at the `models` array for `context_window` or `num_ctx` fields and compute the maximum.

End of design
