# src/config/

Runtime configuration: Zod schema, env mapper, JSON file handler, config manager, hot reload, and provider defaults.

## Purpose

Single source of truth for orchestrator configuration. Reads env vars, JSON files (`config.json`, `config.yaml`, `config.yml` — see root README), validates with Zod, and publishes updates to subscribers (auth, rate limiter, load balancer, model manager, orchestrator, metrics).

Files of record:

- [schema.ts](schema.ts) — `OrchestratorConfig` Zod schema. Defines every tunable, its default, and its validation rules.
- [config.ts](config.ts) — `DEFAULT_CONFIG`, `getConfigManager`, and the `ServerConfig`, `SecurityConfig`, `MetricsConfig`, `StreamingConfig`, `HealthCheckConfig`, `RetryConfig`, `LoadBalancerConfig` types re-used by other modules.
- [config-manager.ts](config-manager.ts) — Singleton config manager with hot reload, file watching, and subscriber notification.
- [env-mapper.ts](env-mapper.ts) — Maps `ORCHESTRATOR_*` and other env vars into the config shape.
- [json-file-handler.ts](json-file-handler.ts) — Atomic read/write of the JSON config file.
- [provider-defaults.ts](provider-defaults.ts) — Per-provider default configurations (Ollama, OpenAI).

## Ownership

- Owns the config schema and the env/file precedence. Other modules read from `getConfigManager().getConfig()`.
- New config sections must be added to the Zod schema and to `DEFAULT_CONFIG` together.
- Auth, rate limiter, and the load balancer subscribe to config changes through the config manager — do not pass config by import.

## Local Contracts

- `getConfigManager()` is a process-wide singleton. Hot reload is enabled by default and is triggered by file-system events.
- The config shape is `OrchestratorConfig`. Public config sub-shapes are exported from [config.ts](config.ts); controllers and tests must import from there, not from the schema.
- The env mapper runs once at startup. File reload runs thereafter. Subscribers receive the new full config.
- Persistence of the config file uses atomic write through [json-file-handler.ts](json-file-handler.ts); never write the config file from outside this folder.
- Probe config is named `probeConfig` in the schema; the prior `circuitBreakerConfig` name is superseded.

## Hot-Reload Behavior Matrix

The orchestrator supports hot-reload of most config sections via API. When `POST /api/orchestrator/config` or `PATCH /api/orchestrator/config/:section` is called, modules subscribed via `getConfigManager().onChange()` are notified and update their internal state.

| Section                      | Hot-reloadable | Notes                                                 |
| ---------------------------- | :------------: | ----------------------------------------------------- |
| `adaptiveWeightTuner`        |       ✅       | Via LoadBalancer                                      |
| `anthropic`                  |       ✅       |                                                       |
| `capabilityProbe`            |       ✅       |                                                       |
| `circuitBreaker`             |       ✅       | Via Orchestrator                                      |
| `cooldown`                   |       ✅       | Via banManager                                        |
| `errorAggregator`            |       ✅       | Via Orchestrator                                      |
| `healthCheck`                |       ✅       |                                                       |
| `inferenceTimeoutMs`         |       ✅       |                                                       |
| `loadBalancer`               |       ✅       | Via LoadBalancer                                      |
| `logLevel`                   |       ✅       | Wired via `initLoggerConfigSubscription()`            |
| `metrics`                    |       ✅       |                                                       |
| `modelManager`               |       ✅       |                                                       |
| `probeScheduler`             |       ✅       |                                                       |
| `rateLimit`                  |       ✅       |                                                       |
| `recoveryBackoff`            |       ✅       |                                                       |
| `recoveryTest`               |       ✅       |                                                       |
| `retry`                      |       ✅       |                                                       |
| `security.apiKeys`           |       ✅       | Wired via `initAuthConfigSubscription()`              |
| `security.corsOrigins`       |       ✅       |                                                       |
| `security.rateLimitMax`      |       ✅       | Custom middleware reads on every request              |
| `security.rateLimitWindowMs` |       ✅       | Custom middleware reads on every request              |
| `streaming`                  |       ✅       | Wired via cached config pattern                       |
| `tags`                       |       ✅       |                                                       |
| `timeout`                    |       ✅       |                                                       |
| `port`                       |       ❌       | Express binds at startup; restart required            |
| `host`                       |       ❌       | Express binds at startup; restart required            |
| `persistencePath`            |       ❌       | Files may be open; restart required                   |
| `servers`                    |       ❌       | Use dedicated `/api/orchestrator/servers/*` endpoints |

### Reload from Environment

When env vars are changed after startup, call `POST /api/orchestrator/config/reload-from-env` to re-apply them. This re-runs `applyEnvOverrides` and triggers all subscribers.

### PATCH Endpoint Expansion

`PATCH /api/orchestrator/config/:section` accepts all sections except `servers` (which has dedicated endpoints). The full list of accepted sections is in the response to an invalid PATCH (400 error).

### Adding Hot-Reload to a New Module

If you add a new module that reads config:

1. **Avoid module-load-time subscriptions** — calling `getConfigManager()` at module top-level causes circular import errors (config.ts → logger.ts → config.ts).
2. **Use the init function pattern** — export an `initXxxConfigSubscription()` function and call it from `src/index.ts` after `getOrchestratorInstance()`.
3. **OR call `getConfigManager()` inside your functions** — works if the function is called per-request (like the custom rate limiter).

Example:

```typescript
// In your module:
export function initMyConfigSubscription(): void {
  getConfigManager().onChange(config => {
    if (config.mySection) {
      updateMyState(config.mySection);
    }
  });
}

// In src/index.ts (after getOrchestratorInstance):
initMyConfigSubscription();
```

### Load Balancer Config Fields (orchestrator stability release)

#### `loadBalancer.fallbackToFastestResponse` (kill switch)

- **Type**: `boolean`
- **Default**: `false`
- **Description**: When `true`, all load balancer algorithms (including `weighted` and `prefix-cache-aware`) revert to `fastest-response` behavior. Use this as a kill switch if issues arise with the new scoring components.
- **When to use**: If you observe unexpected routing behavior after upgrading, set this to `true` to immediately restore pre-stability-release routing.
- **How to verify**: Check `GET /api/orchestrator/config` and confirm `loadBalancer.fallbackToFastestResponse = true`. Monitor `GET /api/orchestrator/analytics/decisions` to verify routing reverts to lowest-latency selection.

#### `loadBalancer.prefixCacheAware`

- **Type**: object `{ enabled: boolean, hashTokenCount: number, hashBuckets: number }`
- **Defaults**: `{ enabled: false, hashTokenCount: 512, hashBuckets: 256 }`
- **Description**: Enables prefix-cache-aware routing. Prompt token prefixes are consistently hashed into buckets; servers that previously handled prompts with the same prefix are preferred to maximize upstream prefix-cache hit rates.
- **`enabled`**: Enable/disable the algorithm. When enabled, set `loadBalancer.algorithm` to `prefix-cache-aware` to activate.
- **`hashTokenCount`**: Number of leading tokens to hash for the prefix. Higher values increase cache specificity but reduce hit rate.
- **`hashBuckets`**: Number of buckets in the consistent hash ring. Higher values improve distribution but increase memory.

#### `loadBalancer.sloFallback`

- **Type**: object `{ enabled: boolean, ttftThresholdMs: number, p95WindowMs: number }`
- **Defaults**: `{ enabled: false, ttftThresholdMs: 2000, p95WindowMs: 60000 }`
- **Description**: SLO fallback mode. When enabled, if a server's P95 TTFT over the configured window exceeds the threshold, the load balancer temporarily shifts from score-based routing to recovery-rate-based routing — preferring servers that have recently demonstrated the best recovery trend.
- **`enabled`**: Activate SLO fallback mode.
- **`ttftThresholdMs`**: TTFT P95 threshold in milliseconds. When exceeded, SLO fallback activates for that server.
- **`p95WindowMs`**: Rolling window for P95 TTFT calculation in milliseconds.

#### `loadBalancer.tokenWeightedLoad`

- **Type**: object `{ enabled: boolean, promptTokenWeight: number, outputTokenWeight: number }`
- **Defaults**: `{ enabled: true, promptTokenWeight: 1.0, outputTokenWeight: 4.0 }`
- **Description**: Replaces simple in-flight concurrency count with token-weighted load. Each in-flight request contributes `promptTokens * promptTokenWeight + outputTokens * outputTokenWeight` to the server's load estimate.
- **`enabled`**: Activate token-weighted load accounting.
- **`promptTokenWeight`**: Weight multiplier for prompt tokens. Default 1.0 means each prompt token adds 1 unit of load.
- **`outputTokenWeight`**: Weight multiplier for output tokens. Default 4.0 reflects that output generation is typically longer-running.

#### `loadBalancer.coldStartMagnitude`

- **Type**: object `{ enabled: boolean, thresholdMs: number, penaltyDurationMs: number }`
- **Defaults**: `{ enabled: true, thresholdMs: 1000, penaltyDurationMs: 60000 }`
- **Description**: Penalizes servers that have recently cold-started (TTFT above threshold). The penalty decays linearly over `penaltyDurationMs`.
- **`enabled`**: Activate cold-start magnitude tracking.
- **`thresholdMs`**: TTFT threshold in milliseconds above which a request is classified as a cold start.
- **`penaltyDurationMs`**: Duration of the score penalty in milliseconds.

### Example Configurations

```json
// Prefix-cache-aware routing
{
  "loadBalancer": {
    "algorithm": "prefix-cache-aware",
    "prefixCacheAware": {
      "enabled": true,
      "hashTokenCount": 512,
      "hashBuckets": 256
    }
  }
}
```

```json
// SLO fallback enabled
{
  "loadBalancer": {
    "sloFallback": {
      "enabled": true,
      "ttftThresholdMs": 2000,
      "p95WindowMs": 60000
    }
  }
}
```

```json
// Kill switch: revert to fastest-response for all algorithms
{
  "loadBalancer": {
    "fallbackToFastestResponse": true
  }
}
```

## Work Guidance

- Adding a new tunable: add it to [schema.ts](schema.ts) with a default, add it to `DEFAULT_CONFIG` in [config.ts](config.ts), and (if applicable) add an env mapping in [env-mapper.ts](env-mapper.ts). If it needs to react to runtime changes, add a subscriber in the owning module.
- Provider-specific defaults (Ollama vs OpenAI) belong in [provider-defaults.ts](provider-defaults.ts).
- Hot-reload subscribers must be idempotent. After a config update, the module must re-read the relevant slice, not cache the entire config.
- Sensitive values (API keys, admin keys) are read from env or the file, never logged. The logger helper `safeJsonStringify` must be used when echoing config.

## Verification

- `npm test` — covers `config.test.ts`, `configManager.test.ts`, `envMapper.test.ts`, `jsonFileHandler.test.ts`, `config-controller.test.ts`, `provider-defaults` (if tests exist) in [tests/unit/](../../tests/unit/).
- `npm run test:integration` — covers `api-admin.test.ts` (config update + reload) and any persistence-related integration tests.
- Manual: edit `data/config.json` (or the env-overridden path) and confirm the orchestrator logs the reload and the new values take effect on the next request.
