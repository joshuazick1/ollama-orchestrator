# Examples and Usage Guide

This guide provides practical examples for using the Ollama Orchestrator API.

## Quick Examples

### List Available Models

```bash
curl http://localhost:5100/api/tags
```

### Generate Text

```bash
curl -X POST http://localhost:5100/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.2",
    "prompt": "What is the capital of France?",
    "stream": false
  }'
```

### Chat Completion

```bash
curl -X POST http://localhost:5100/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.2",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

### Chat with Streaming

```bash
curl -X POST http://localhost:5100/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.2",
    "messages": [
      {"role": "user", "content": "Tell me a short story"}
    ],
    "stream": true
  }'
```

### Generate Embeddings

```bash
curl -X POST http://localhost:5100/api/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nomic-embed-text",
    "prompt": "The quick brown fox jumps over the lazy dog"
  }'
```

## Authentication

When `ORCHESTRATOR_ENABLE_AUTH=true` (the default), all inference and admin endpoints require authentication.

### First-Time Setup

```bash
# Create the initial admin user (only works before any users exist)
curl -X POST http://localhost:5100/api/orchestrator/setup \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your-secure-password"}'
```

### Login (JWT Cookie)

```bash
# Step 1: Get CSRF token
curl -c cookies.txt http://localhost:5100/api/orchestrator/auth/csrf-token

# Step 2: Login — stores httpOnly JWT cookie in cookies.txt
TOKEN=$(grep csrf-token cookies.txt | awk '{print $7}')
curl -X POST http://localhost:5100/api/orchestrator/auth/login \
  -c cookies.txt -b cookies.txt \
  -H "X-CSRF-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your-secure-password"}'

# Step 3: Use the cookie on subsequent requests
curl -b cookies.txt http://localhost:5100/api/orchestrator/servers
```

### API Key Authentication

```bash
# User API key (set via ORCHESTRATOR_API_KEYS env var)
curl http://localhost:5100/api/orchestrator/servers \
  -H "X-API-Key: your-api-key"

# Admin API key (set via ORCHESTRATOR_ADMIN_API_KEYS env var)
curl -X POST http://localhost:5100/api/orchestrator/servers/add \
  -H "X-API-Key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{"url": "http://ollama-1:11434"}'
```

### Disable Auth (Development)

Set `ORCHESTRATOR_ENABLE_AUTH=false` in `.env` to skip all authentication checks.

## OpenAI-Compatible API

The orchestrator supports OpenAI-compatible endpoints for easy integration.

### Chat Completions

```bash
curl -X POST http://localhost:5100/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.2",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Explain quantum computing in simple terms"}
    ],
    "temperature": 0.7,
    "max_tokens": 500
  }'
```

### List Models

```bash
curl http://localhost:5100/v1/models
```

### Get Model Info

```bash
curl http://localhost:5100/v1/models/llama3.2
```

## Anthropic-Compatible API

The orchestrator exposes an Anthropic Messages API compatible endpoint at `/v1/messages`.

### Messages (non-streaming)

```bash
curl -X POST http://localhost:5100/v1/messages \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

### Messages (streaming)

```bash
curl -X POST http://localhost:5100/v1/messages \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 1024,
    "stream": true,
    "messages": [
      {"role": "user", "content": "Tell me a short story"}
    ]
  }'
```

### Using the Anthropic Python SDK

```python
import anthropic

client = anthropic.Anthropic(
    base_url="http://localhost:5100",
    api_key="your-api-key",
)

message = client.messages.create(
    model="claude-3-5-sonnet-20241022",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
)
print(message.content[0].text)
```

## Server Management

### Add a Server

```bash
curl -X POST http://localhost:5100/api/orchestrator/servers/add \
  -H "Content-Type: application/json" \
  -d '{
    "id": "gpu-server-1",
    "url": "http://192.168.1.100:11434",
    "maxConcurrency": 4
  }'
```

### Remove a Server

```bash
curl -X DELETE http://localhost:5100/api/orchestrator/servers/gpu-server-1
```

### List All Servers

```bash
curl http://localhost:5100/api/orchestrator/servers
```

### Get Server Models

```bash
curl http://localhost:5100/api/orchestrator/servers/gpu-server-1/models
```

## Model Management

### Warm Up a Model

```bash
curl -X POST http://localhost:5100/api/orchestrator/models/llama3.2/warmup \
  -H "Content-Type: application/json" \
  -d '{
    "servers": ["gpu-server-1"],
    "priority": "high"
  }'
```

### Get Model Status

```bash
curl http://localhost:5100/api/orchestrator/models/llama3.2/status
```

### Get All Models Status

```bash
curl http://localhost:5100/api/orchestrator/models/status
```

### Unload a Model

```bash
curl -X POST http://localhost:5100/api/orchestrator/models/llama3.2/unload \
  -H "Content-Type: application/json" \
  -d '{"serverId": "gpu-server-1"}'
```

### Get Warmup Recommendations

```bash
curl http://localhost:5100/api/orchestrator/models/recommendations
```

## In-Flight Requests

### Get In-Flight Requests

```bash
curl http://localhost:5100/api/orchestrator/in-flight
```

## Circuit Breaker Operations

### Get All Circuit Breakers

```bash
curl http://localhost:5100/api/orchestrator/circuit-breakers
```

### Get Specific Circuit Breaker

```bash
curl http://localhost:5100/api/orchestrator/circuit-breakers/gpu-server-1/llama3.2
```

### Reset Circuit Breaker

```bash
curl -X POST http://localhost:5100/api/orchestrator/circuit-breakers/gpu-server-1/llama3.2/reset
```

### Force Open Circuit Breaker

```bash
curl -X POST http://localhost:5100/api/orchestrator/circuit-breakers/gpu-server-1/llama3.2/open
```

## Server Maintenance

### Drain a Server

```bash
curl -X POST http://localhost:5100/api/orchestrator/servers/gpu-server-1/drain
```

### Undrain a Server

```bash
curl -X POST http://localhost:5100/api/orchestrator/servers/gpu-server-1/undrain
```

### Set Maintenance Mode

```bash
curl -X POST http://localhost:5100/api/orchestrator/servers/gpu-server-1/maintenance \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "reason": "planned maintenance"}'
```

## Analytics

### Get Analytics Summary

```bash
curl http://localhost:5100/api/orchestrator/analytics/summary
```

### Get Top Models

```bash
curl "http://localhost:5100/api/orchestrator/analytics/top-models?limit=5&timeRange=24h"
```

### Get Server Performance

```bash
curl "http://localhost:5100/api/orchestrator/analytics/server-performance?timeRange=1h"
```

### Get Error Analysis

```bash
curl http://localhost:5100/api/orchestrator/analytics/errors
```

### Get Decision History

```bash
curl "http://localhost:5100/api/orchestrator/analytics/decisions?limit=50"
```

## Performance Probe

### Run Fleet-Wide Performance Probe

```bash
# Trigger a performance probe across all servers
curl -X POST http://localhost:5100/api/orchestrator/performance-probe \
  -H "X-API-Key: your-admin-api-key"
# Returns: {"taskId": "...", "status": "running", "probeModels": [...], "totalProbes": N}

# Check probe status
TASK_ID="<taskId from above>"
curl http://localhost:5100/api/orchestrator/performance-probe/$TASK_ID \
  -H "X-API-Key: your-api-key"
```

### Probe History

```bash
# Get historical probe results for a server+model
curl "http://localhost:5100/api/orchestrator/performance-probe/history?serverId=gpu-server-1&model=llama3.2" \
  -H "X-API-Key: your-api-key"

# Check scheduler status
curl http://localhost:5100/api/orchestrator/performance-probe/scheduler-status \
  -H "X-API-Key: your-api-key"
```

## Monitoring

### Get Metrics

```bash
curl http://localhost:5100/api/orchestrator/metrics
```

### Get Prometheus Metrics

```bash
curl http://localhost:5100/metrics
```

### Health Check

```bash
curl http://localhost:5100/health
```

### Get Stats

```bash
curl http://localhost:5100/api/orchestrator/stats
```

## Configuration

### Get Current Config

```bash
curl http://localhost:5100/api/orchestrator/config
```

### Update Config

```bash
curl -X POST http://localhost:5100/api/orchestrator/config \
  -H "Content-Type: application/json" \
  -d '{
    "queue": {
      "maxSize": 2000
    }
  }'
```

### Get Config Schema

```bash
curl http://localhost:5100/api/orchestrator/config/schema
```

## Server-Specific Requests

Route requests directly to a specific server (bypasses load balancer):

```bash
# Generate to specific server
curl -X POST http://localhost:5100/api/generate--gpu-server-1 \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.2",
    "prompt": "Hello"
  }'
```

## Client Examples

### JavaScript/TypeScript

```typescript
const response = await fetch('http://localhost:5100/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'llama3.2',
    messages: [{ role: 'user', content: 'Hello!' }],
  }),
});

const data = await response.json();
console.log(data.message.content);
```

### Python

```python
import requests

response = requests.post('http://localhost:5100/api/chat', json={
    'model': 'llama3.2',
    'messages': [{'role': 'user', 'content': 'Hello!'}]
})

print(response.json()['message']['content'])
```

### OpenAI Python Library

```python
from openai import OpenAI

client = OpenAI(
    base_url='http://localhost:5100/v1',
    api_key='dummy'  # Not required but needs a value
)

response = client.chat.completions.create(
    model='llama3.2',
    messages=[{'role': 'user', 'content': 'Hello!'}]
)

print(response.choices[0].message.content)
```

### Anthropic Python SDK

(see Anthropic-Compatible API section above)

### OpenAI Node.js SDK

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:5100/v1',
  apiKey: 'your-api-key',
});

const response = await client.chat.completions.create({
  model: 'llama3.2',
  messages: [{ role: 'user', content: 'Hello!' }],
});

console.log(response.choices[0].message.content);
```

### Streaming with OpenAI Node.js SDK

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:5100/v1',
  apiKey: 'your-api-key',
});

const stream = await client.chat.completions.create({
  model: 'llama3.2',
  messages: [{ role: 'user', content: 'Tell me a story' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}
```

### Ollama JavaScript Library

```javascript
import { Ollama } from 'ollama';

const ollama = new Ollama({ host: 'http://localhost:5100' });

const response = await ollama.chat({
  model: 'llama3.2',
  messages: [{ role: 'user', content: 'Hello!' }],
});

console.log(response.message.content);
```

### cURL with Authentication

```bash
# If API keys are configured
curl -X POST http://localhost:5100/api/chat \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"model": "llama3.2", "messages": [{"role": "user", "content": "Hi"}]}'
```
