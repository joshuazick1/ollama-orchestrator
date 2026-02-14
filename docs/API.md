# Ollama Orchestrator API Reference

This document provides comprehensive API documentation for the Ollama Orchestrator.

## Base URL

All API endpoints are prefixed with `/api/orchestrator/` unless otherwise noted.

## Authentication

Currently, no authentication is required. Configure security settings in the configuration endpoint.

## Response Format

All responses follow this structure:

```json
{
  "success": true,
  "data": "...",
  "error": "error message (if success=false)"
}
```

## Error Codes

- `200` - Success
- `400` - Bad Request (invalid parameters)
- `404` - Not Found
- `500` - Internal Server Error

---

## Server Management

### Add Server

**POST** `/api/orchestrator/servers/add`

Add a new Ollama server to the orchestrator.

**Request Body:**

```json
{
  "id": "server-1",
  "url": "http://localhost:11434",
  "maxConcurrency": 4,
  "priority": 1,
  "tags": ["gpu", "high-mem"]
}
```

**Parameters:**

- `id` (string, required): Unique server identifier
- `url` (string, required): Ollama server URL
- `maxConcurrency` (number, optional): Max concurrent requests (default: 4)
- `priority` (number, optional): Server priority for load balancing (default: 1)
- `tags` (array, optional): Server tags for filtering

**Response:**

```json
{
  "success": true,
  "server": {
    "id": "server-1",
    "url": "http://localhost:11434",
    "maxConcurrency": 4,
    "status": "healthy"
  }
}
```

### Remove Server

**DELETE** `/api/orchestrator/servers/:id`

Remove a server from the orchestrator.

### Update Server

**PATCH** `/api/orchestrator/servers/:id`

Update server configuration.

### Drain Server

**POST** `/api/orchestrator/servers/:id/drain`

Gracefully drain a server (stop accepting new requests, wait for existing to complete).

---

## Metrics & Health

### Comprehensive Metrics

**GET** `/api/orchestrator/metrics`

Get detailed metrics for all servers and global statistics.

**Query Parameters:**

- `timeRange` (string, optional): Time range (1h, 24h, 7d) - default: 1h

**Response:**

```json
{
  "success": true,
  "global": {
    "totalRequests": 15234,
    "errorRate": 0.023,
    "avgLatency": 1250,
    "p95Latency": 3400,
    "requestsPerSecond": 4.2
  },
  "servers": [
    {
      "id": "server-1",
      "status": "healthy",
      "requests": 4567,
      "errors": 45,
      "avgLatency": 1200,
      "p95Latency": 3200,
      "utilization": 0.75
    }
  ]
}
```

### Prometheus Metrics

**GET** `/metrics`

Prometheus-compatible metrics endpoint.

### Health Check

**GET** `/api/orchestrator/health`

Basic health check endpoint.

**Response:**

```json
{
  "success": true,
  "status": "healthy",
  "uptime": 3600,
  "version": "1.0.0"
}
```

---

## Queue Management

### Queue Status

**GET** `/api/orchestrator/queue`

Get current queue status and statistics.

**Response:**

```json
{
  "success": true,
  "queue": {
    "currentSize": 12,
    "maxSize": 1000,
    "processing": 3,
    "waiting": 9,
    "avgWaitTime": 450,
    "oldestRequest": "2024-01-01T10:00:00Z"
  }
}
```

### Pause Queue

**POST** `/api/orchestrator/queue/pause`

Pause request queue processing.

### Resume Queue

**POST** `/api/orchestrator/queue/resume`

Resume request queue processing.

---

## Analytics

### Analytics Summary

**GET** `/api/orchestrator/analytics/summary`

Get comprehensive analytics summary.

**Response:**

```json
{
  "success": true,
  "summary": {
    "totalRequests": 15234,
    "totalErrors": 345,
    "avgLatency": 1250,
    "p95Latency": 3400,
    "requestsPerSecond": 4.2,
    "topModel": "llama2:13b",
    "mostActiveServer": "server-1"
  }
}
```

### Top Models

**GET** `/api/orchestrator/analytics/top-models`

Get most used models by request count.

**Query Parameters:**

- `limit` (number, optional): Number of models to return (default: 10)
- `timeRange` (string, optional): Analysis time range (default: 24h)

**Response:**

```json
{
  "success": true,
  "timeRange": "24h",
  "models": [
    {
      "model": "llama2:13b",
      "requests": 5678,
      "percentage": 37.2,
      "avgLatency": 1200,
      "errorRate": 0.015
    }
  ]
}
```

### Server Performance

**GET** `/api/orchestrator/analytics/server-performance`

Compare performance across all servers.

**Query Parameters:**

- `timeRange` (string, optional): Analysis time range (default: 1h)

**Response:**

```json
{
  "success": true,
  "timeRange": "1h",
  "servers": [
    {
      "id": "server-1",
      "requests": 1234,
      "avgLatency": 1100,
      "p95Latency": 2800,
      "p99Latency": 4500,
      "errorRate": 0.012,
      "throughput": 0.34,
      "utilization": 0.72,
      "score": 0.85
    }
  ]
}
```

### Error Analysis

**GET** `/api/orchestrator/analytics/errors`

Analyze errors by type, server, and model.

**Query Parameters:**

- `timeRange` (string, optional): Analysis time range (default: 24h)
- `includeRecent` (boolean, optional): Include recent error details (default: true)

**Response:**

```json
{
  "success": true,
  "timeRange": "24h",
  "totalErrors": 345,
  "byType": {
    "timeout": 156,
    "server_error": 89,
    "network_error": 100
  },
  "byServer": {
    "server-1": 123,
    "server-2": 222
  },
  "byModel": {
    "llama2:13b": 234,
    "codellama:7b": 111
  },
  "recentErrors": [
    {
      "timestamp": "2024-01-01T10:30:00Z",
      "serverId": "server-1",
      "model": "llama2:13b",
      "errorType": "timeout",
      "message": "Request timed out after 30000ms"
    }
  ]
}
```

### Capacity Analysis

**GET** `/api/orchestrator/analytics/capacity`

Get capacity planning data and forecasts.

**Query Parameters:**

- `timeRange` (string, optional): Forecast time range (default: 24h)

**Response:**

```json
{
  "success": true,
  "current": {
    "queueSize": 12,
    "avgWaitTime": 450,
    "saturationLevel": 0.75
  },
  "forecast": {
    "predictedLoad": 1.2,
    "recommendedServers": 2,
    "bottleneckServer": "server-1"
  },
  "recommendations": [
    "Add 1 more server to handle peak load",
    "Consider increasing queue timeout for high-traffic periods"
  ]
}
```

### Trend Analysis

**GET** `/api/orchestrator/analytics/trends/:metric`

Analyze trends for specific metrics.

**Path Parameters:**

- `metric` (string, required): Metric to analyze (latency, errors, throughput)

**Query Parameters:**

- `serverId` (string, optional): Filter by server
- `model` (string, optional): Filter by model
- `timeRange` (string, optional): Analysis time range (default: 24h)

**Response:**

```json
{
  "success": true,
  "metric": "latency",
  "analysis": {
    "direction": "increasing",
    "slope": 15.7,
    "confidence": 0.87
  },
  "timeRange": "24h"
}
```

---

## Model Management

### Warmup Model

**POST** `/api/orchestrator/models/:model/warmup`

Warmup a model on specified or all servers.

**Path Parameters:**

- `model` (string, required): Model name to warmup

**Request Body:**

```json
{
  "servers": ["server-1", "server-2"],
  "priority": "normal"
}
```

**Parameters:**

- `servers` (array, optional): Target server IDs (default: all servers)
- `priority` (string, optional): Warmup priority (low, normal, high)

**Response:**

```json
{
  "success": true,
  "model": "llama2:13b",
  "jobs": [
    {
      "serverId": "server-1",
      "status": "loading",
      "estimatedTime": 15000,
      "loadTime": 0
    }
  ],
  "summary": {
    "totalServers": 3,
    "loadedOn": 1,
    "loadingOn": 2,
    "failedOn": 0
  }
}
```

### Model Status

**GET** `/api/orchestrator/models/:model/status`

Get warmup status for a specific model.

**Response:**

```json
{
  "success": true,
  "model": "llama2:13b",
  "status": {
    "totalServers": 3,
    "loadedOn": 2,
    "loadingOn": 1,
    "notLoadedOn": 0,
    "failedOn": 0
  },
  "servers": [
    {
      "serverId": "server-1",
      "status": "loaded",
      "loadTime": 12345,
      "lastUsed": "2024-01-01T10:00:00Z"
    }
  ]
}
```

### All Models Status

**GET** `/api/orchestrator/models/status`

Get loading status for all models.

### Warmup Recommendations

**GET** `/api/orchestrator/models/recommendations`

Get recommended models to warmup based on usage patterns.

**Response:**

```json
{
  "success": true,
  "recommendations": [
    {
      "model": "codellama:13b",
      "reason": "High usage pattern detected"
    }
  ],
  "count": 3
}
```

### Unload Model

**POST** `/api/orchestrator/models/:model/unload`

Unload a model from servers to free memory.

**Request Body:**

```json
{
  "serverId": "server-1"
}
```

### Idle Models

**GET** `/api/orchestrator/models/idle`

List models that haven't been used recently.

**Query Parameters:**

- `threshold` (number, optional): Idle time threshold in ms (default: 30 minutes)

---

## Configuration

### Get Configuration

**GET** `/api/orchestrator/config`

Get current orchestrator configuration.

**Response:**

```json
{
  "success": true,
  "config": {
    "port": 5100,
    "enableQueue": true,
    "circuitBreaker": {
      "baseFailureThreshold": 5,
      "openTimeout": 30000
    }
  },
  "source": "config.yaml"
}
```

### Update Configuration

**POST** `/api/orchestrator/config`

Update full configuration.

**Request Body:**

```json
{
  "port": 5101,
  "enableCircuitBreaker": false
}
```

### Update Configuration Section

**PATCH** `/api/orchestrator/config/:section`

Update a specific configuration section.

**Path Parameters:**

- `section` (string, required): Config section (queue, loadBalancer, circuitBreaker, etc.)

### Reload Configuration

**POST** `/api/orchestrator/config/reload`

Reload configuration from file.

**Request Body:**

```json
{
  "configPath": "/path/to/config.yaml"
}
```

### Save Configuration

**POST** `/api/orchestrator/config/save`

Save current configuration to file.

### Configuration Schema

**GET** `/api/orchestrator/config/schema`

Get JSON schema for configuration validation.

---

## Ollama-Compatible Endpoints

These endpoints proxy requests to Ollama servers with load balancing and circuit breaking.

### List Models

**GET** `/api/tags`

List all available models across servers.

### Generate Text

**POST** `/api/generate`

Generate text using specified model.

**Request Body:**

```json
{
  "model": "llama2:13b",
  "prompt": "Hello, world!",
  "stream": true
}
```

### Chat Completion

**POST** `/api/chat`

Generate chat completion.

**Request Body:**

```json
{
  "model": "llama2:13b",
  "messages": [{ "role": "user", "content": "Hello!" }]
}
```

### Generate Embeddings

**POST** `/api/embeddings`

Generate text embeddings.

**Request Body:**

```json
{
  "model": "nomic-embed-text",
  "prompt": "Hello, world!"
}
```
