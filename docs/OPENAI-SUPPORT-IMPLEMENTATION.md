# OpenAI Server Support Implementation Summary

## Overview

This implementation adds support for OpenAI-compatible servers to the Ollama Orchestrator, enabling the system to work with both Ollama and OpenAI API servers simultaneously.

## Key Features Implemented

### 1. Dual Protocol Support

- **Ollama Protocol**: `/api/*` endpoints (tags, generate, chat, embeddings)
- **OpenAI Protocol**: `/v1/*` endpoints (models, chat/completions, completions, embeddings)

### 2. Per-Server Capability Detection

Each server now tracks:

- `supportsOllama`: Server responds to `/api/tags` (Ollama endpoints)
- `supportsV1`: Server responds to `/v1/models` (OpenAI endpoints)
- Servers can support both protocols (e.g., Ollama with OpenAI compatibility)

### 3. Separate Model Aggregation

- **Ollama clients** (`/api/tags`): Only see models from servers with `supportsOllama=true`
- **OpenAI clients** (`/v1/models`): Only see models from servers with `supportsV1=true`

### 4. API Key Authentication

- Optional `apiKey` field on all servers
- Supports `env:VARIABLE_NAME` format for environment variable references
- API keys are resolved at request time and passed as `Authorization: Bearer` headers
- Keys are redacted (`***REDACTED***`) in API responses

### 5. Protocol-Specific Routing

- Ollama requests route only to servers with `supportsOllama=true`
- OpenAI requests route only to servers with `supportsV1=true`
- Circuit breakers work per-model across both protocols

### 6. Model Management Restrictions

- Model management (pull, delete, copy) only works on Ollama-capable servers
- UI hides "Manage Models" button for OpenAI-only servers
- Backend returns 400 error for model operations on non-Ollama servers

## Files Modified

### Backend

#### Type Definitions

- `src/orchestrator.types.ts`: Added `supportsOllama`, `v1Models`, `apiKey` fields

#### Health Check

- `src/health-check-scheduler.ts`:
  - Detects both `/api/tags` and `/v1/models` endpoints
  - Server is healthy if EITHER endpoint responds
  - Added `fetchWithAuth()` helper for API key support
  - Parses and stores separate model lists for each protocol

#### Controllers

- `src/controllers/ollamaController.ts`:
  - All Ollama endpoints filter by `supportsOllama`
  - Pass `'ollama'` capability to `tryRequestWithFailover`
- `src/controllers/openaiController.ts`:
  - All OpenAI endpoints filter by `supportsV1`
  - Added auth header injection using `getBackendHeaders()`
  - Uses new `getAggregatedOpenAIModels()` method
  - Pass `'openai'` capability to `tryRequestWithFailover`

- `src/controllers/serversController.ts`:
  - Accepts `apiKey` in addServer
  - Redacts `apiKey` in responses
  - Returns capability flags in server list

- `src/controllers/serverModelsController.ts`:
  - All model operations check for Ollama support
  - Returns 400 error for OpenAI-only servers

#### Orchestrator Core

- `src/orchestrator.ts`:
  - Added `getAggregatedOpenAIModels()` method
  - `tryRequestWithFailover()` accepts `requiredCapability` parameter
  - Persists capability flags and model lists when they change
  - `getAggregatedTags()` filters by `supportsOllama`

- `src/orchestrator-instance.ts`:
  - Loads persisted capability flags and API keys

#### Validation & Config

- `src/middleware/validation.ts`: Added `apiKey` to addServerSchema
- `src/config/schema.ts`: Added `apiKey` to serverConfigSchema

### Frontend

#### Types

- `frontend/src/types.ts`: Added `supportsOllama`, `supportsV1`, `v1Models`, `apiKey` to AIServer

#### API

- `frontend/src/api.ts`: Added `apiKey` to addServer function signature

#### Validations

- `frontend/src/validations.ts`: Added `apiKeySchema` with format validation

#### UI

- `frontend/src/pages/Servers.tsx`:
  - Added API key input field in Add Server modal
  - Shows capability badges (Ollama/OpenAI) on server cards
  - Shows API key indicator (🔑) when configured
  - Displays API key status in server details
  - Hides "Manage Models" button for OpenAI-only servers

## Usage Examples

### Adding an Ollama Server

```bash
curl -X POST http://localhost:5100/api/servers \
  -H "Content-Type: application/json" \
  -d '{"id": "ollama-local", "url": "http://localhost:11434"}'
```

### Adding an OpenAI-Compatible Server with API Key

```bash
# Using environment variable reference (recommended)
curl -X POST http://localhost:5100/api/servers \
  -H "Content-Type: application/json" \
  -d '{"id": "azure-openai", "url": "https://my-resource.openai.azure.com", "apiKey": "env:AZURE_OPENAI_KEY"}'

# Using plain API key
curl -X POST http://localhost:5100/api/servers \
  -H "Content-Type: application/json" \
  -d '{"id": "openai-server", "url": "http://localhost:8000", "apiKey": "sk-my-api-key"}'
```

### Environment Variable Setup

```bash
export AZURE_OPENAI_KEY="sk-..."
# Then use "env:AZURE_OPENAI_KEY" in the API request
```

## API Changes

### Server Response Format

```json
{
  "id": "my-server",
  "url": "http://localhost:11434",
  "healthy": true,
  "supportsOllama": true,
  "supportsV1": true,
  "models": ["llama3.1:latest", "qwen3:latest"],
  "v1Models": ["llama3.1", "qwen3"],
  "apiKey": "***REDACTED***"
}
```

### Model List Endpoints

- `GET /api/tags` - Returns Ollama-formatted models from Ollama-capable servers
- `GET /v1/models` - Returns OpenAI-formatted models from OpenAI-capable servers

## Backward Compatibility

- Existing Ollama servers continue to work unchanged
- Default behavior: Servers without explicit flags are assumed to support Ollama
- No breaking changes to existing APIs

## Security Considerations

1. API keys are never persisted to disk in plain text when using `env:` format
2. API keys are redacted in all API responses
3. Keys are resolved at request time from environment variables
4. No key logging or exposure in error messages

## Circuit Breaker Behavior

- Circuit breakers are per-server:per-model
- If a circuit opens for a model on a dual-protocol server, both Ollama and OpenAI requests are blocked
- This ensures consistency regardless of which protocol clients use

## Future Enhancements

Potential improvements not included in this implementation:

- Model name mapping between protocols (e.g., `llama3.1:latest` ↔ `llama3.1`)
- Cross-protocol routing (e.g., OpenAI client → Ollama server)
- Per-protocol circuit breaker states
- Dynamic protocol detection without health checks
