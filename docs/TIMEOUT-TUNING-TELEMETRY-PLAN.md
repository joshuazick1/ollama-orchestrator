# Timeout Tuning Telemetry Plan

## Objective

Create a structured telemetry log file that captures **every timeout-relevant event** at runtime, enabling data-driven tuning of timeout parameters for slow public AI endpoint servers.

## Problem

Currently, timeout tuning is guesswork. You can't answer:

- What's the actual p95 response time for server X, model Y?
- How often do timeouts fire vs. complete successfully?
- Is the 60s activity timeout too aggressive for streaming?
- How long does it take for TimeoutManager to converge after a server slows down?
- What's the distribution of TTFT vs. total duration?

## Design

### New Module: `src/utils/timeout-telemetry.ts`

A dedicated telemetry writer that appends structured JSON entries to a **separate log file** (`logs/timeout-tuning.log`), independent of the main application log. This keeps tuning data clean, queryable, and unaffected by `LOG_LEVEL` settings.

### Log File

| Property | Value                                                                |
| -------- | -------------------------------------------------------------------- |
| Path     | `logs/timeout-tuning.log` (configurable via `TIMEOUT_TELEMETRY_LOG`) |
| Format   | One JSON object per line (NDJSON)                                    |
| Rotation | Daily — file named `timeout-tuning-YYYY-MM-DD.log`                   |
| Control  | Enabled by default, disabled via `TIMEOUT_TELEMETRY_ENABLED=false`   |

### Telemetry Event Types

#### 1. `REQUEST_COMPLETE` — Every completed request

Emitted when a non-streaming request finishes or a streaming request ends.

```typescript
interface RequestCompleteEvent {
  type: 'REQUEST_COMPLETE';
  timestamp: string; // ISO 8601
  serverId: string;
  model: string;
  protocol: 'ollama' | 'openai' | 'anthropic';
  endpoint: string; // e.g., '/api/generate', '/v1/chat/completions'
  isStreaming: boolean;

  // Timeout configuration at time of request
  configuredTimeoutMs: number; // What TimeoutManager returned
  clientHeaderTimeoutMs?: number; // X-Request-Timeout if supplied
  effectiveTimeoutMs: number; // After header clamping

  // Actual timing
  timeToFirstTokenMs?: number; // Streaming only
  totalDurationMs: number; // From request start to completion
  tokensGenerated?: number;
  tokensPrompt?: number;

  // Outcome
  status: 'success' | 'timeout' | 'error' | 'client_disconnect' | 'stall_handoff';
  httpStatus?: number;
  errorMessage?: string;

  // Retry context
  retryAttempt: number; // 0 = first attempt
  failoverServer?: string; // If this was a failover target
}
```

**Why this matters**: This is the core dataset for tuning. You can compute p50/p95/p99 response times per server:model, see how often the configured timeout is too tight or too loose, and correlate token count with duration.

#### 2. `TIMEOUT_ADAPTED` — TimeoutManager adjustment

Emitted whenever `TimeoutManager` changes a timeout value.

```typescript
interface TimeoutAdaptedEvent {
  type: 'TIMEOUT_ADAPTED';
  timestamp: string;
  serverId: string;
  model: string;

  // Before/after
  previousTimeoutMs: number;
  newTimeoutMs: number;
  baseTimeoutMs: number;

  // Trigger
  trigger: 'response_time' | 'failure_escalation' | 'decay' | 'manual_reset' | 'default_update';
  observedResponseTimeMs?: number;
  isActiveTest: boolean;
  multiplier: number;
  emaAlpha: number;
}
```

**Why this matters**: Shows the convergence curve. You can see if timeouts oscillate, how fast they adapt, and whether the EMA smoothing is appropriate for your server population.

#### 3. `TIMEOUT_FIRED` — Actual timeout abort

Emitted when `fetchWithTimeout` or `fetchWithActivityTimeout` aborts a request.

```typescript
interface TimeoutFiredEvent {
  type: 'TIMEOUT_FIRED';
  timestamp: string;
  serverId: string;
  model: string;
  protocol: 'ollama' | 'openai' | 'anthropic';
  endpoint: string;
  isStreaming: boolean;

  // Which timeout layer fired
  timeoutType: 'connection' | 'activity' | 'non_streaming';
  configuredTimeoutMs: number;
  elapsedMs: number; // How long the request ran before timeout

  // Context
  retryAttempt: number;
  circuitBreakerState?: string; // 'closed' | 'open' | 'half-open'
}
```

**Why this matters**: Distinguishes between connection timeouts (server not responding), activity timeouts (stream stalled mid-response), and non-streaming timeouts. Each requires different tuning.

#### 4. `STALL_DETECTED` — Post-first-chunk stall

Emitted when the stall detector identifies no chunks for the threshold period.

```typescript
interface StallDetectedEvent {
  type: 'STALL_DETECTED';
  timestamp: string;
  serverId: string;
  model: string;
  protocol: 'ollama' | 'openai' | 'anthropic';

  // Timing
  stallThresholdMs: number;
  timeSinceLastChunkMs: number;
  timeToFirstTokenMs: number;
  totalTokensBeforeStall: number;
  totalDurationMs: number;

  // Handoff result
  handoffAttempted: boolean;
  handoffSuccess: boolean;
  handoffTargetServer?: string;
}
```

**Why this matters**: Shows whether stalls are genuine (server hung) or just slow token generation. If handoffs consistently succeed, stalls are real. If they fail, the server may just be slow.

#### 5. `STREAMING_CHUNK_GAP` — Periodic chunk gap sampling

Emitted every 30 seconds during an active streaming request (configurable interval).

```typescript
interface StreamingChunkGapEvent {
  type: 'STREAMING_CHUNK_GAP';
  timestamp: string;
  serverId: string;
  model: string;
  protocol: 'ollama' | 'openai' | 'anthropic';

  // Current stream state
  chunkCount: number;
  totalTokensSoFar: number;
  timeSinceFirstTokenMs: number;
  timeSinceLastChunkMs: number;
  maxChunkGapMs: number;
  avgChunkGapMs: number;
  effectiveTimeoutMs: number;
  activityTimeoutMs: number;

  // Health indicator
  approachingTimeout: boolean; // true if timeSinceLastChunkMs > 0.5 * activityTimeoutMs
}
```

**Why this matters**: This is the key metric for tuning `activityTimeout`. If you see `approachingTimeout: true` frequently on valid streams, the activity timeout is too aggressive. The `maxChunkGapMs` tells you the natural gap distribution for each server.

---

## Integration Points

### Where to emit events

| Event                 | Location                                                                                   | Trigger                        |
| --------------------- | ------------------------------------------------------------------------------------------ | ------------------------------ |
| `REQUEST_COMPLETE`    | `orchestrator.ts` — after `tryRequestWithFailover` resolves                                | Every request completion       |
| `TIMEOUT_ADAPTED`     | `timeout-manager.ts` — in `updateFromResponseTime`, `recordFailure`, `applyDecay`, `reset` | Every timeout value change     |
| `TIMEOUT_FIRED`       | `fetch-with-timeout.ts` — in catch block for AbortError                                    | Every timeout abort            |
| `STALL_DETECTED`      | `streaming.ts` — in stall detection interval callback                                      | Every stall trigger            |
| `STREAMING_CHUNK_GAP` | `streaming.ts` — in existing 30s progress log                                              | Every 30s during active stream |

### Minimal instrumentation in controllers

Controllers already compute `timeoutMs`, `stallThreshold`, and have access to `serverId`, `model`, and response metrics. The telemetry module exposes a simple API:

```typescript
// In controllers — one-liner at request completion
recordRequestComplete({
  serverId: server.id,
  model,
  protocol: 'ollama',
  endpoint: 'generate',
  isStreaming: useStreaming,
  configuredTimeoutMs: timeoutMs,
  effectiveTimeoutMs: effectiveTimeout,
  totalDurationMs: Date.now() - startTime,
  timeToFirstTokenMs: ttftMetrics?.ttft,
  tokensGenerated,
  tokensPrompt,
  status: 'success',
  retryAttempt: 0,
});
```

---

## Analysis Queries

With this telemetry, you can answer:

### "What timeout should I set for server X?"

```
# Filter by serverId, compute p95 totalDurationMs for non-streaming
# Set timeout = p95 * 2x (matching slowRequestMultiplier)
grep '"serverId":"my-slow-server"' timeout-tuning.log \
  | jq 'select(.type == "REQUEST_COMPLETE" and .isStreaming == false and .status == "success")' \
  | jq '.totalDurationMs' \
  | sort -n | awk 'BEGIN{c=0}{sum+=$1;val[c++]=$1}END{print "p95="val[int(c*0.95)]}'
```

### "Is my activity timeout too aggressive?"

```
# Count how many successful streams had approachingTimeout=true
grep '"STREAMING_CHUNK_GAP"' timeout-tuning.log \
  | jq 'select(.approachingTimeout == true)' \
  | wc -l
# If > 5% of samples, activity timeout is too tight
```

### "How often do timeouts actually fire?"

```
grep '"TIMEOUT_FIRED"' timeout-tuning.log | wc -l
grep '"REQUEST_COMPLETE"' timeout-tuning.log | wc -l
# Ratio = timeout rate
```

### "What's the natural chunk gap distribution?"

```
grep '"STREAMING_CHUNK_GAP"' timeout-tuning.log \
  | jq '.maxChunkGapMs' \
  | sort -n
# Set activityTimeout > p99 of maxChunkGapMs
```

### "Is TimeoutManager converging properly?"

```
grep '"TIMEOUT_ADAPTED"' timeout-tuning.log \
  | jq '{ts: .timestamp, server: .serverId, model: .model, before: .previousTimeoutMs, after: .newTimeoutMs, trigger: .trigger}'
# Look for oscillation patterns or slow convergence
```

---

## Implementation Plan

### Phase 1: Telemetry Module

1. Create `src/utils/timeout-telemetry.ts` — structured NDJSON writer with daily rotation
2. Add `TIMEOUT_TELEMETRY_ENABLED` env var (default: `true`)
3. Add `TIMEOUT_TELEMETRY_LOG` env var for custom path

### Phase 2: Instrumentation

4. Instrument `timeout-manager.ts` — emit `TIMEOUT_ADAPTED` on every state change
5. Instrument `fetch-with-timeout.ts` — emit `TIMEOUT_FIRED` on AbortError
6. Instrument `streaming.ts` — emit `STALL_DETECTED` and `STREAMING_CHUNK_GAP`
7. Instrument `orchestrator.ts` — emit `REQUEST_COMPLETE` after every request

### Phase 3: Controller Integration

8. Add telemetry calls to all controller endpoints (Ollama, OpenAI, Anthropic)
9. Ensure `handleEmbed` gets the fix from T1 + telemetry

### Phase 4: Verification

10. Run load test, verify `logs/timeout-tuning.log` contains expected events
11. Validate NDJSON is parseable and queryable

---

## File Structure

```
src/utils/
  timeout-telemetry.ts      # New: telemetry writer + recorders
  timeout-manager.ts        # Modified: emit TIMEOUT_ADAPTED
  fetch-with-timeout.ts     # Modified: emit TIMEOUT_FIRED
  streaming.ts              # Modified: emit STALL_DETECTED, STREAMING_CHUNK_GAP

src/orchestrator/
  orchestrator.ts           # Modified: emit REQUEST_COMPLETE

src/controllers/
  ollama-controller.ts      # Modified: pass telemetry context
  openai-controller.ts      # Modified: pass telemetry context
  anthropic-controller.ts   # Modified: pass telemetry context

logs/
  timeout-tuning-2026-04-07.log  # New: daily telemetry log
```

---

## Configuration

| Env Var                                   | Default                     | Description                                     |
| ----------------------------------------- | --------------------------- | ----------------------------------------------- |
| `TIMEOUT_TELEMETRY_ENABLED`               | `true`                      | Enable/disable telemetry logging                |
| `TIMEOUT_TELEMETRY_LOG`                   | `./logs/timeout-tuning.log` | Base path for telemetry log                     |
| `TIMEOUT_TELEMETRY_CHUNK_GAP_INTERVAL_MS` | `30000`                     | How often to sample chunk gaps during streaming |
