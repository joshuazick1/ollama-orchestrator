# DESIGN: Debug Info in JSON Response

## Overview

This document outlines the design for adding optional debug information directly into JSON responses from the Ollama Orchestrator. This feature addresses a limitation in the existing debug header implementation, which cannot add headers to streaming responses after the stream has completed.

## Problem Statement

### Current Implementation

The current debug header implementation (`src/utils/debug-headers.ts`) adds debug information as HTTP response headers when the client sends `X-Include-Debug-Info: true`. The debug headers include:

- `X-Selected-Server` - The server ID that handled the request
- `X-Server-Circuit-State` - Server-level circuit breaker state
- `X-Model-Circuit-State` - Model-level circuit breaker state
- `X-Available-Servers` - Count of available servers
- `X-Routed-To-Open-Circuit` - Whether request was routed to an open circuit
- `X-Retry-Count` - Number of retries performed

### Limitation

For streaming requests, headers cannot be added after `res.write()` / `res.end()` has been called. The streaming response is sent as raw NDJSON via `res.write()`, so the debug headers are never added to the response.

## Proposed Solution

Add an optional `debug` field in the actual JSON response body, activated via query parameter `?debug=true`. This works for both streaming and non-streaming requests.

### Activation Mechanism

- **Query Parameter**: `?debug=true`
- **Field Name**: `debug` (top-level field in response JSON)
- **Backward Compatibility**: Keep existing header-based approach (`X-Include-Debug-Info`) for non-streaming requests

### Debug Object Structure

```typescript
interface DebugInfo {
  selectedServerId?: string;
  serverCircuitState?: string;
  modelCircuitState?: string;
  availableServerCount?: number;
  routedToOpenCircuit?: boolean;
  retryCount?: number;
}
```

### Response Examples

#### Non-Streaming Response

**Request:**

```
POST /v1/chat/completions?debug=true
{
  "model": "llama3:latest",
  "messages": [{"role": "user", "content": "Hello"}]
}
```

**Response:**

```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1704067200,
  "model": "llama3:latest",
  "choices": [...],
  "debug": {
    "selectedServerId": "server-1",
    "serverCircuitState": "closed",
    "modelCircuitState": "closed",
    "availableServerCount": 3,
    "routedToOpenCircuit": false,
    "retryCount": 0
  }
}
```

#### Streaming Response

**Request:**

```
POST /v1/chat/completions?debug=true
{
  "model": "llama3:latest",
  "messages": [{"role": "user", "content": "Hello"}],
  "stream": true
}
```

**Response:**

```json
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1704067200,"model":"llama3:latest","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1704067200,"model":"llama3:latest","choices":[{"index":0,"delta":{"content":" there"},"finish_reason":null}]}

data: {"debug":{"selectedServerId":"server-1","serverCircuitState":"closed","modelCircuitState":"closed","availableServerCount":3,"routedToOpenCircuit":false,"retryCount":0}}

data: [DONE]
```

## Implementation Plan

### Phase 1: Core Implementation

#### 1.1 Create Debug Object Helper

**File:** `src/utils/debug-headers.ts`

Add a new function `getDebugInfo(context: RoutingContext): DebugInfo | undefined` that returns the debug object.

```typescript
export function getDebugInfo(context: RoutingContext): DebugInfo | undefined {
  // Return debug object only if there's any debug info to include
  if (
    !context.selectedServerId &&
    !context.serverCircuitState &&
    !context.modelCircuitState &&
    context.availableServerCount === undefined &&
    !context.routedToOpenCircuit &&
    (context.retryCount === undefined || context.retryCount === 0)
  ) {
    return undefined;
  }

  return {
    selectedServerId: context.selectedServerId,
    serverCircuitState: context.serverCircuitState,
    modelCircuitState: context.modelCircuitState,
    availableServerCount: context.availableServerCount,
    routedToOpenCircuit: context.routedToOpenCircuit,
    retryCount: context.retryCount,
  };
}
```

#### 1.2 Update OpenAI Controller

**File:** `src/controllers/openaiController.ts`

**Non-Streaming Path** (around line 473):

```typescript
// Check for debug query param
const includeDebug = req.query.debug === 'true';

// Add debug headers if requested
addDebugHeaders(req, res, routingContext);

// Inject debug info into response if requested
if (!stream && result && !result._streamed) {
  if (includeDebug) {
    const debugInfo = getDebugInfo(routingContext);
    if (debugInfo) {
      result.debug = debugInfo;
    }
  }
  res.json(result);
}
```

**Streaming Path** (after line 554):

```typescript
// After stream completes
if (includeDebug) {
  const debugInfo = getDebugInfo(routingContext);
  if (debugInfo) {
    res.write(`data: ${JSON.stringify({ debug: debugInfo })}\n\n`);
  }
}
res.end();
```

#### 1.3 Update Ollama Controller

**File:** `src/controllers/ollamaController.ts`

Apply similar changes to:

- `handleGenerate` (non-streaming around line 280)
- `handleChat` (non-streaming around line 460)
- `handleStreamingGenerate` (streaming around line 350)
- `handleStreamingChat` (if exists)

### Phase 2: Testing

#### 2.1 Update Existing Tests

**File:** `tests/unit/openai-controller.test.ts`

Update the existing debug header test to also verify the JSON field:

```typescript
it('should add debug info to JSON response when debug=true query param is set', async () => {
  mockReq.body = {
    model: 'llama3:latest',
    messages: [{ role: 'user', content: 'Hello' }],
  };
  mockReq.query = { debug: 'true' };

  // ... existing mock setup ...

  const mockResult = { id: 'test', choices: [] };

  // ... existing mock implementation ...

  await handleChatCompletions(mockReq as Request, mockRes as Response);

  // Verify JSON response includes debug
  expect(mockRes.json).toHaveBeenCalledWith(
    expect.objectContaining({
      debug: expect.objectContaining({
        selectedServerId: 'server-1',
        availableServerCount: 3,
        retryCount: 1,
      }),
    })
  );
});
```

**File:** `tests/unit/ollama-controller.test.ts`

Add similar tests for ollama endpoints.

#### 2.2 New Test Cases

Create new test file: `tests/unit/debug-info.test.ts`

**Test Categories:**

1. **Non-Streaming Tests**
   - Debug info included when `?debug=true`
   - Debug info excluded when no debug param
   - Debug info excluded when `?debug=false`
   - All debug fields populated correctly
   - Partial debug info (only some fields set)
   - Debug info with zero retry count (should exclude)

2. **Streaming Tests**
   - Debug info sent as final SSE event
   - Debug info included for streaming chat
   - Debug info included for streaming generate
   - Empty debug info (no final event sent)

3. **Error Handling**
   - Debug info included in error responses
   - Debug info works when upstream returns error

4. **Edge Cases**
   - Debug info with empty routing context
   - Debug info with circuit breaker open states
   - Debug info with multiple retries
   - Debug info when routed to open circuit
   - Debug info not added when stream already ended
   - Query param variations (`?debug=1`, `?debug=true`, `?debug=TRUE`)

### Phase 3: CI/CD Integration

#### 3.1 Git Workflow

```
1. Create feature branch: feature/debug-json-response
2. Implement changes following this design
3. Run local tests: npm run test:unit
4. Run linting: npm run lint
5. Run typecheck: npm run typecheck
6. Commit with conventional commit message:
   feat: add optional debug field in JSON response for streaming support

7. Push branch and create PR
8. CI runs:
   - Lint
   - Type check
   - Unit tests with coverage
   - Integration tests (PR only)

9. After merge to main:
   - Docker build runs
   - Release workflow triggers
```

#### 3.2 CI Pipeline Updates

No changes required to CI pipeline. The new feature will be tested by:

- Existing unit tests (will need updates)
- New unit tests added
- Integration tests (if applicable)

#### 3.3 Commit Message Convention

Follow conventional commits:

- `feat: add optional debug field in JSON response for streaming support`
- `test: add tests for debug info in JSON response`
- `refactor: extract getDebugInfo helper function`

### Phase 4: Documentation

#### 4.1 API Documentation Update

Update API documentation to include:

````markdown
## Debug Information

### Query Parameters

| Parameter | Type    | Default | Description                           |
| --------- | ------- | ------- | ------------------------------------- |
| debug     | boolean | false   | Include debug information in response |

### Response Field

When `debug=true` is specified, the response will include a `debug` object:

```json
{
  "debug": {
    "selectedServerId": "string",
    "serverCircuitState": "closed|open|half-open",
    "modelCircuitState": "closed|open|half-open",
    "availableServerCount": number,
    "routedToOpenCircuit": boolean,
    "retryCount": number
  }
}
```
````

### Streaming

For streaming responses, the debug info is sent as a final SSE event after the stream completes.

```

## Edge Cases and Considerations

### 1. Empty Debug Info

If no routing context is available (early error before routing), the `debug` field should not be included in the response.

### 2. Zero Retry Count

If `retryCount` is 0, it should be excluded from the debug object (not sent as `"retryCount": 0`).

### 3. Header vs Query Parameter

Both activation methods should work:
- `X-Include-Debug-Info: true` → headers (existing)
- `?debug=true` → JSON field (new)

For non-streaming, both can be used simultaneously.

### 4. Response Size

Debug info adds minimal overhead (~200 bytes). This is acceptable for most use cases.

### 5. Client Compatibility

Clients should handle the case where the `debug` field may or may not be present.

### 6. Streaming Event Format

The final debug SSE event follows the standard SSE format:
```

data: {"debug": {...}}

```

This is compatible with standard SSE parsers.

## Files to Modify

| File | Changes |
|------|---------|
| `src/utils/debug-headers.ts` | Add `getDebugInfo()` function |
| `src/controllers/openaiController.ts` | Inject debug into JSON responses |
| `src/controllers/ollamaController.ts` | Inject debug into JSON responses |
| `tests/unit/openai-controller.test.ts` | Update/add tests |
| `tests/unit/ollama-controller.test.ts` | Update/add tests |
| `tests/unit/debug-info.test.ts` | New comprehensive test file |

## Acceptance Criteria

1. **Non-Streaming**: Debug info appears in JSON response when `?debug=true`
2. **Streaming**: Debug info appears as final SSE event
3. **Backward Compatible**: Existing header-based debug still works for non-streaming
4. **No Breaking Changes**: Existing clients work without modification
5. **All Fields Present**: All 6 debug fields are correctly populated
6. **Edge Cases Handled**: Zero retry, empty context, error responses
7. **Tests Pass**: All unit and integration tests pass
8. **Lint/Typecheck**: Code passes all linting and type checking
```
