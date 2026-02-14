# Ollama Orchestrator Frontend

A React-based dashboard for monitoring and managing the Ollama Orchestrator.

## Overview

The frontend provides a web-based interface for:

- **Dashboard** - Overview of system health, requests, and performance
- **Servers** - Manage and monitor Ollama servers
- **Models** - Model status, warmup, and fleet management
- **Queue** - Request queue monitoring and control
- **Analytics** - Performance metrics and trends
- **Circuit Breakers** - Circuit breaker status and control
- **Logs** - Application log viewer
- **Settings** - Configuration management

## Getting Started

### Prerequisites

- Node.js v18+
- npm or yarn

### Development

```bash
cd frontend
npm install
npm run dev
```

The frontend will be available at `http://localhost:5173` (default Vite port).

### Production Build

```bash
npm run build
```

The built files are in the `dist/` directory.

## Connecting to the Backend

By default, the frontend expects the orchestrator API at `http://localhost:5100`.

To change the API endpoint, set the `VITE_API_BASE_URL` environment variable:

```bash
VITE_API_BASE_URL=http://your-server:5100 npm run build
```

Or update the API base URL in `src/api.ts`:

```typescript
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5100';
```

## Features

### Dashboard

- System health status overview
- Total requests and error rates
- Active servers count
- Queue depth
- Recent activity

### Servers

- View all registered servers with status
- Add/remove servers
- View per-server metrics (latency, requests, errors)
- Server health indicators
- Drain/undrain servers
- Set maintenance mode

### Models

- View all models across the fleet
- Model loading status (loaded, loading, not loaded)
- Warmup models proactively
- Unload idle models
- View warmup recommendations
- Per-model status on each server

### Queue

- Current queue size and capacity
- Processing vs waiting requests
- Average wait time
- Pause/resume queue
- View in-flight requests by server

### Analytics

- Top models by usage
- Server performance comparison
- Error analysis by type/server/model
- Capacity planning data
- Trend analysis for metrics
- Decision history
- Request timeline

### Circuit Breakers

- View all circuit breakers
- Per-breaker status (closed, open, half-open)
- Failure counts and timestamps
- Force open/close/reset breakers
- Recovery test triggers

### Logs

- Application log viewer
- Filter by level
- Search functionality
- Clear logs

### Settings

- View current configuration
- Update configuration sections
- Reload configuration from file
- Export/import configuration

## API Integration

The frontend communicates with the orchestrator via REST API. See [API.md](../docs/API.md) for the complete API reference.

Key endpoints used:

- `/api/orchestrator/servers` - Server management
- `/api/orchestrator/models` - Model management
- `/api/orchestrator/queue` - Queue operations
- `/api/orchestrator/metrics` - Metrics data
- `/api/orchestrator/analytics/*` - Analytics endpoints
- `/api/orchestrator/circuit-breakers` - Circuit breaker control

## Technology Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **Vitest** - Testing
- **React Router** - Client-side routing

## Project Structure

```
src/
├── api.ts           # API client functions
├── App.tsx          # Main application component
├── main.tsx         # Entry point
├── components/      # Reusable UI components
│   ├── ErrorBoundary.tsx
│   ├── Layout.tsx
│   ├── Modal.tsx
│   └── ModelManagerModal.tsx
├── pages/           # Page components
│   ├── Analytics.tsx
│   ├── CircuitBreakers.tsx
│   ├── Dashboard.tsx
│   ├── Logs.tsx
│   ├── Models.tsx
│   ├── Queue.tsx
│   ├── Servers.tsx
│   └── Settings.tsx
├── types.ts         # TypeScript type definitions
└── utils/           # Utility functions
    └── security.ts
```

## Security

When deploying in production:

1. Configure API authentication in the backend
2. Set appropriate CORS origins
3. Use HTTPS/TLS
4. Consider running the frontend behind a reverse proxy

## Troubleshooting

### CORS Errors

If you see CORS errors, ensure the backend's CORS configuration allows requests from your frontend's origin.

### Connection Refused

Ensure the orchestrator is running and accessible at the configured URL. Check firewall rules if running on different hosts.

### API Returns 401

API authentication is enabled. Provide the correct API key in requests or disable authentication for development.
