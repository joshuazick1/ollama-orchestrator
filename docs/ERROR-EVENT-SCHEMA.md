# Error Event Schema & Storage Design

## Overview

The error event persistence layer captures every classified error occurrence for analysis, debugging, and pattern detection. It complements the existing in-memory error tracking (RecoveryFailureTracker, ErrorClassifier, CircuitBreaker) by providing durable, queryable error history.

## Data Model

### ErrorEvent Interface

```typescript
interface ErrorEvent {
  id: string;                    // Unique identifier (nanoid/uuid)
  serverId: string;              // Server that experienced the error
  circuitId: string;             // serverId:model combination
  errorType: ErrorType;          // retryable|non_retryable|transient|permanent|rate_limited
  errorMessage: string;          // Raw error message
  timestamp: string;             // ISO 8601 timestamp
  retryable: boolean;            // Whether the error can be retried
  category: ErrorCategory;       // resource|compatibility|network|auth|config|unknown
  severity: ErrorSeverity;       // low|medium|high|critical
  matchedPattern: string | null;  // Pattern name that matched (if any)
}
```

### ErrorQueryFilters Interface

```typescript
interface ErrorQueryFilters {
  serverId?: string;    // Filter by server
  circuitId?: string;   // Filter by circuit (serverId:model)
  startTime?: string;   // ISO timestamp - events after this time
  endTime?: string;     // ISO timestamp - events before this time
  errorType?: ErrorType; // Filter by error type
  limit?: number;       // Max results (default: 100)
}
```

## Type Enums

### ErrorType
- `retryable` - Error can be retried immediately
- `non_retryable` - Error will never succeed (e.g., model not found)
- `transient` - Temporary error that may succeed on retry
- `permanent` - Permanent failure condition
- `rate_limited` - Rate limit exceeded

### ErrorCategory
- `resource` - Resource exhaustion (OOM, CPU)
- `compatibility` - Model/server version mismatch
- `network` - Network connectivity issues
- `auth` - Authentication/authorization failures
- `config` - Configuration errors
- `unknown` - Uncategorized errors

### ErrorSeverity
- `low` - Minor issue, minimal impact
- `medium` - Moderate impact, worth monitoring
- `high` - Significant issue affecting reliability
- `critical` - Complete failure requiring immediate attention

## Storage Design

### Location
```
./data/error-events/
```

### Format
- JSON files with daily rotation
- Filename pattern: `error-events-YYYY-MM-DD.json`
- Each error event stored as a single JSON object per line (NDJSON-like)
- No file locking required for append-only writes

### File Structure Example
```
data/error-events/
├── error-events-2026-04-08.json
├── error-events-2026-04-07.json
├── error-events-2026-04-06.json
└── ...
```

### Daily File Format
```json
{"id":"abc123","serverId":"server-1","circuitId":"server-1:llama3","errorType":"retryable","errorMessage":"connection timeout","timestamp":"2026-04-08T10:30:00Z","retryable":true,"category":"network","severity":"medium","matchedPattern":"connection_timeout"}
{"id":"def456","serverId":"server-2","circuitId":"server-2:mistral","errorType":"permanent","errorMessage":"model not found","timestamp":"2026-04-08T10:31:15Z","retryable":false,"category":"compatibility","severity":"high","matchedPattern":"model_not_found"}
```

### Query Strategy
1. Parse `startTime` and `endTime` from filter
2. Determine which day files are needed (daily rotation)
3. Read relevant files (skip non-matching days)
4. Parse each line as JSON, apply remaining filters
5. Apply `limit` to results

## Implementation Notes

### Write Path (Out of Scope)
The storage class implementation is not part of this design. Expected behavior:
- Append-only writes to current day's file
- No file locking needed
- Batch writes for performance

### Read Path (Out of Scope)
The storage class implementation is not part of this design. Expected behavior:
- Stream lines from relevant day files
- Parse JSON, apply filters in memory
- Support efficient time-range queries via daily file rotation

### Retention
- Recommend keeping files for 30 days (configurable)
- Old files can be pruned by external process
- No automatic retention in initial implementation

## Relationship to Existing Components

```
ErrorClassifier ──classifies──> ErrorEvent ──persisted to──> File-based JSON
       │                                      │
       └── used by ──────────────────────────> CircuitBreaker
                                              RecoveryFailureTracker
                                              AnalyticsEngine
```

The ErrorEvent schema captures output from ErrorClassifier, providing the input interface for the persistence layer.

## Example Usage

```typescript
import { ErrorEvent, ErrorQueryFilters } from './types/error-event';

// Query recent errors from a specific server
const filters: ErrorQueryFilters = {
  serverId: 'server-1',
  startTime: '2026-04-08T00:00:00Z',
  limit: 50
};
```

## Future Considerations

- Compression for older files (gzip)
- Indexed queries for high-volume scenarios
- Aggregation APIs (count by type, severity, etc.)
- Export to external systems (S3, database)