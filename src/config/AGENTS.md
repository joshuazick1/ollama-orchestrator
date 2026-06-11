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

## Work Guidance

- Adding a new tunable: add it to [schema.ts](schema.ts) with a default, add it to `DEFAULT_CONFIG` in [config.ts](config.ts), and (if applicable) add an env mapping in [env-mapper.ts](env-mapper.ts). If it needs to react to runtime changes, add a subscriber in the owning module.
- Provider-specific defaults (Ollama vs OpenAI) belong in [provider-defaults.ts](provider-defaults.ts).
- Hot-reload subscribers must be idempotent. After a config update, the module must re-read the relevant slice, not cache the entire config.
- Sensitive values (API keys, admin keys) are read from env or the file, never logged. The logger helper `safeJsonStringify` must be used when echoing config.

## Verification

- `npm test` — covers `config.test.ts`, `configManager.test.ts`, `envMapper.test.ts`, `jsonFileHandler.test.ts`, `config-controller.test.ts`, `provider-defaults` (if tests exist) in [tests/unit/](../../tests/unit/).
- `npm run test:integration` — covers `api-admin.test.ts` (config update + reload) and any persistence-related integration tests.
- Manual: edit `data/config.json` (or the env-overridden path) and confirm the orchestrator logs the reload and the new values take effect on the next request.
