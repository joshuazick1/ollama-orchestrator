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
curl http://localhost.5100/api/orchestrator/models/status
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

## Queue Management

### Get Queue Status

```bash
curl http://localhost:5100/api/orchestrator/queue
```

### Pause Queue

```bash
curl -X POST http://localhost:5100/api/orchestrator/queue/pause
```

### Resume Queue

```bash
curl -X POST http://localhost:5100/api/orchestrator/queue/resume
```

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

# Chat to specific server
curl -X POST http://localhost:5100/api/chat--gpu-server-1 \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.2",
    "messages": [{"role": "user", "content": "Hi"}]
  }'

# OpenAI-compatible to specific server
curl -X POST http://localhost:5100/v1/chat/completions--gpu-server-1 \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.2",
    "messages": [{"role": "user", "content": "Hi"}]
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

### cURL with Authentication

```bash
# If API keys are configured
curl -X POST http://localhost:5100/api/chat \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"model": "llama3.2", "messages": [{"role": "user", "content": "Hi"}]}'
```
