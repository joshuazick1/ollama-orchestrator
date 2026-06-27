# Ollama Orchestrator - Implementation Plan

## Overview

This document details the implementation plan for all issues identified in the comprehensive code review. Issues are categorized by severity and grouped by domain for efficient resolution.

---

## Table of Contents

1. [Critical Issues](#critical-issues)
2. [High Severity Issues](#high-severity-issues)
3. [Medium Severity Issues](#medium-severity-issues)
4. [Low Severity Issues](#low-severity-issues)
5. [Cross-Cutting Concerns](#cross-cutting-concerns)

---

## Critical Issues

### CR-1: Authentication Bypass in `requireAdmin`

**File:** `src/middleware/auth.ts:123`

**Problem:** The `requireAdmin` function checks `DEFAULT_AUTH_CONFIG.enabled` (global) instead of the passed `_config` parameter, completely ignoring the passed configuration and potentially bypassing authentication.

**Current Code:**

```typescript
export function requireAdmin(
  _config: AuthConfig = DEFAULT_AUTH_CONFIG
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!DEFAULT_AUTH_CONFIG.enabled) {  // BUG: uses global, not _config
      next();
      return;
    }
```

**Fix:**

```typescript
export function requireAdmin(
  _config: AuthConfig = DEFAULT_AUTH_CONFIG
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const config = _config ?? DEFAULT_AUTH_CONFIG;
    if (!config.enabled) {
      next();
      return;
    }
```

**Validation:** Write unit test that passes a config with `enabled: true` and verify admin access is enforced.

---

### CR-2: Metrics Data Loss on Flush Failure

**File:** `src/storage/metrics-store.ts:635-748`

**Problem:** `splice()` empties buffers BEFORE the database transaction executes. If the transaction fails, all buffered metrics are permanently lost.

**Current Code:**

```typescript
const requests = this.requestBuffer.splice(0); // Buffer emptied
const decisions = this.decisionBuffer.splice(0); // Buffer emptied
const failovers = this.failoverBuffer.splice(0); // Buffer emptied

try {
  this.db.transaction(() => {
    // ... inserts ...
  })();
} catch (err) {
  logger.error('[MetricsStore] Batch flush failed', { error: err });
  // Data already lost!
}
```

**Fix:**

```typescript
const requests = [...this.requestBuffer]; // Copy, don't splice yet
const decisions = [...this.decisionBuffer];
const failovers = [...this.failoverBuffer];

try {
  this.db.transaction(() => {
    // ... inserts ...
  })();
  // Only clear buffers after successful commit
  this.requestBuffer.length = 0;
  this.decisionBuffer.length = 0;
  this.failoverBuffer.length = 0;
} catch (err) {
  logger.error('[MetricsStore] Batch flush failed', { error: err });
  // Keep data in buffers for retry on next flush
  // Optionally implement exponential backoff for consecutive failures
}
```

**Additional:** Add a `failedFlushCount` counter to trigger alerts after N consecutive failures.

---

### CR-3: Timer Leak in Metrics Store

**File:** `src/storage/metrics-store.ts:1164-1178`

**Problem:** The `setInterval` for hourly rollup scheduling is never stored in a class property and never cleared in `stopTimers()`.

**Current Code:**

```typescript
private startTimers(): void {
  // ...
  let lastScheduledHour = truncateToHour(Date.now());
  setInterval(() => {  // NOT stored!
    // ...
  }, 60_000);
}
```

**Fix:**

```typescript
private rollupCheckTimer: NodeJS.Timeout | null = null;

private startTimers(): void {
  // ...
  let lastScheduledHour = truncateToHour(Date.now());
  this.rollupCheckTimer = setInterval(() => {
    // ...
  }, 60_000);
}

public stopTimers(): void {
  // ... existing cleanup ...
  if (this.rollupCheckTimer) {
    clearInterval(this.rollupCheckTimer);
    this.rollupCheckTimer = null;
  }
}
```

---

### CR-4: Race Condition in `handlePs`

**File:** `src/controllers/ollamaController.ts:1153-1183`

**Problem:** `allModels` array is modified concurrently inside `Promise.all()`.

**Current Code:**

```typescript
const allModels: Array<PsModelEntry & { server: string }> = [];
const promises = servers.map(async server => {
  // ...
  allModels.push({ ...model, server: server.id }); // RACE!
});
await Promise.all(promises);
```

**Fix:**

```typescript
const promises = servers.map(async server => {
  // ...
  return { ...model, server: server.id }; // Return instead of push
});
const results = await Promise.all(promises);
const allModels: Array<PsModelEntry & { server: string }> = results;
```

---

### CR-5: CORS Configuration Ignored

**File:** `src/index.ts:65`

**Problem:** `cors()` uses default permissive settings, ignoring `security.corsOrigins` from config.

**Current Code:**

```typescript
app.use(cors()); // Default: { origin: '*' }
```

**Fix:**

```typescript
const corsOptions: cors.CorsOptions = {
  origin: config.security.corsOrigins.length > 0 ? config.security.corsOrigins : false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  maxAge: 86400,
};
app.use(cors(corsOptions));
```

Also update `src/config/schema.ts` to validate corsOrigins as an array of valid URLs.

---

## High Severity Issues

### HIGH-1: ReDoS Vulnerability in Error Classifier

**File:** `src/utils/errorClassifier.ts:248-262`

**Problem:** User-provided regex patterns are compiled directly without validation for pathological constructs.

**Fix:**

```typescript
private validateRegexPattern(pattern: string): boolean {
  const dangerous = [
    /^\.\*/,
    /\*\+/,
    /\(\.\*\)\+/,
    /\(\+\)\+/,
    /\(a\+\)\+/,
  ];
  for (const dangerousPattern of dangerous) {
    if (dangerousPattern.test(pattern)) {
      return false;
    }
  }
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

this.patterns.nonRetryable = userPatterns
  .map(p => {
    if (!this.validateRegexPattern(p)) {
      logger.warn(`Skipping invalid regex pattern: ${p}`);
      return null;
    }
    return new RegExp(p, 'i');
  })
  .filter((r): r is RegExp => r !== null);
```

**Additional:** Add regex complexity limit (max 100 characters) and timeout for regex matching.

---

### HIGH-2: API Key Exposure in Logs

**File:** `src/utils/stream-handoff.ts:139`

**Problem:** Bearer token included in headers object which is logged at line 56-82.

**Fix:**

```typescript
private sanitizeForLogging(obj: Record<string, unknown>): Record<string, unknown> {
  const sensitive = ['authorization', 'x-api-key', 'api-key', 'password'];
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (sensitive.some(s => key.toLowerCase().includes(s))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = this.sanitizeForLogging(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// Before logging:
logger.info('Attempting stream handoff', {
  ...this.sanitizeForLogging(originalRequest),
  apiKey: undefined,  // Explicitly undefined
});
```

---

### HIGH-3: Invalid Context Size Defaults

**File:** `src/utils/prompt-estimator.ts:66-72`

**Problem:** Default context sizes of 128 tokens are impossibly small.

**Current (WRONG):**

```typescript
'llama3.1': 128,
'llama3.1:8b': 128,
'llama3.1:70b': 128,
'mistral-nemo': 128,
'mistral-large': 128,
```

**Fix:**

```typescript
'llama3.1': 128000,
'llama3.1:8b': 128000,
'llama3.1:70b': 128000,
'llama3.2': 128000,
'llama3.2:3b': 128000,
'mistral-nemo': 128000,
'mistral-large': 128000,
'mixtral-8x7b': 128000,
'qwen2.5': 128000,
'qwen2.5-coder': 128000,
```

Also add a fallback for unknown models:

```typescript
const defaultContextSize = 4096; // Reasonable minimum
```

---

### HIGH-4: `markFailure()` Does Nothing

**File:** `src/storage/ban-manager.ts:55-62`

**Problem:** `markFailure()` sets cooldown but doesn't increment failure counters.

**Current Code:**

```typescript
markFailure(serverId: string, model: string): void {
  const key = `${serverId}:${model}`;
  this.failureCooldown.set(key, Date.now());
  const ban = `${serverId}:${model}`;
  if (this.permanentBan.has(ban)) {
    return;
  }
  // Nothing recorded!
}
```

**Fix:**

```typescript
markFailure(serverId: string, model: string): void {
  const key = `${serverId}:${model}`;
  this.failureCooldown.set(key, Date.now());

  // Record failure for rate tracking
  this.recordFailure(serverId, model);

  const ban = `${serverId}:${model}`;
  if (this.permanentBan.has(ban)) {
    return;
  }

  // Track for this specific server:model combination
  const modelKey = `${serverId}:${model}`;
  const currentCount = this.modelFailureTracker.get(modelKey) || 0;
  this.modelFailureTracker.set(modelKey, currentCount + 1);

  if (currentCount + 1 >= this.maxFailures) {
    this.permanentBan.add(ban);
    logger.warn(`Server ${serverId} permanently banned for model ${model}`);
  }
}
```

Also update `recordFailure()` to be callable and ensure it updates `serverFailureCount`.

---

### HIGH-5: Queue Config Environment Variables Ignored

**Files:** `src/config/envMapper.ts`, `src/config/config.ts`

**Problem:** Environment variables like `ORCHESTRATOR_QUEUE_MAX_SIZE` map to `queue.maxSize` but `DEFAULT_CONFIG` has no `queue` property.

**Fix - config.ts:**

```typescript
const DEFAULT_CONFIG: OrchestratorConfig = {
  // ... existing properties ...
  queue: {
    maxSize: 1000,
    timeout: 300000,
    evictionPolicy: 'oldest',
    enableMetrics: true,
  },
};
```

**Fix - schema.ts:** Add queue schema validation:

```typescript
export const queueConfigSchema = z.object({
  maxSize: z.number().min(1).max(100000),
  timeout: z.number().min(1000).max(3600000),
  evictionPolicy: z.enum(['oldest', 'newest', 'priority']),
  enableMetrics: z.boolean(),
});
```

---

### HIGH-6: Timing Attack on API Key Comparison

**File:** `src/middleware/auth.ts:89-92`

**Problem:** `Array.includes()` is not constant-time, vulnerable to timing attacks.

**Fix:**

```typescript
import { timingSafeEqual } from 'crypto';

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const isAdmin = config.adminApiKeys.some(key => safeCompare(apiKey, key));
if (!isAdmin && !config.apiKeys.some(key => safeCompare(apiKey, key))) {
```

---

### HIGH-7: Model Name Not URL-Encoded in DELETE

**File:** `frontend/src/api.ts:792`

**Problem:** Model names like `llama3.2:latest` contain special characters that aren't encoded.

**Current:**

```typescript
export const deleteModelFromServer = async (serverId: string, model: string) => {
  const response = await api.delete(`/servers/${serverId}/models/${model}`);
```

**Fix:**

```typescript
export const deleteModelFromServer = async (serverId: string, model: string) => {
  const response = await api.delete(
    `/servers/${encodeURIComponent(serverId)}/models/${encodeURIComponent(model)}`
  );
```

Also validate in `src/middleware/validation.ts` that model names don't contain path traversal attempts.

---

### HIGH-8: VRAM Estimation Uses Wrong Model

**File:** `src/load-balancer.ts:253-257`

**Problem:** Estimates requested model's VRAM as average of already-loaded models, which is wrong.

**Current Code:**

```typescript
const modelSizeEstimate =
  loadedModels.length > 0
    ? loadedModels.reduce((sum, m) => sum + m.sizeVram, 0) / loadedModels.length
    : (hw.usedVram ?? 0);
```

**Fix:**

```typescript
// Try to find the requested model in loaded models for size reference
const referenceModel = loadedModels.find(m => m.name === modelName);
const modelSizeEstimate = referenceModel?.sizeVram ?? hw.usedVram ?? this.defaultModelSizeEstimate;
```

Add `defaultModelSizeEstimate` to config (e.g., 7_000_000_000 for 7GB default).

---

### HIGH-9: Zero Threshold Incorrectly Bypasses Validation

**File:** `src/controllers/modelController.ts:268-269`

**Problem:** `parseInt('0', 10) || 1800000` evaluates to 1800000, making 0 an invalid threshold.

**Current:**

```typescript
const threshold = parseInt(threshold as string, 10) || 1800000;
```

**Fix:**

```typescript
const parsed = parseInt(threshold as string, 10);
const threshold = !isNaN(parsed) && parsed >= 0 ? parsed : 1800000;
```

---

### HIGH-10: Unbounded `warmupJobs` Map

**File:** `src/model-manager.ts`

**Problem:** Jobs are added but never removed, causing memory leak.

**Fix - Add cleanup method:**

```typescript
private cleanupJob(jobId: string): void {
  this.warmupJobs.delete(jobId);
}

private cleanupServerJobs(serverId: string): void {
  for (const [id, job] of this.warmupJobs) {
    if (job.serverId === serverId) {
      this.warmupJobs.delete(id);
    }
  }
}

// Call cleanupServerJobs in unregisterServer:
unregisterServer(serverId: string): void {
  this.serverStates.delete(serverId);
  this.cleanupServerJobs(serverId);  // Add this
}
```

**Also:** Add periodic cleanup of stale jobs (older than 30 minutes with status 'loading').

---

## Medium Severity Issues

### MED-1: Accumulated Text Unbounded Growth

**File:** `src/streaming.ts:233, 363-364`

**Problem:** `accumulatedText` string grows without limit for long streams.

**Fix:**

```typescript
const MAX_ACCUMULATED_TEXT = 1_000_000; // 1MB limit

if (chunkText) {
  if (accumulatedText.length + chunkText.length > MAX_ACCUMULATED_TEXT) {
    accumulatedText = accumulatedText.slice(-MAX_ACCUMULATED_TEXT / 2) + chunkText;
  } else {
    accumulatedText += chunkText;
  }
}
```

---

### MED-2: Sticky Session Cleanup Interval Duplicates

**File:** `src/load-balancer.ts:472-483`

**Problem:** Multiple `setInterval` calls without clearing existing intervals.

**Fix:**

```typescript
private stickySessionCleanupInterval: NodeJS.Timeout | null = null;

private startStickySessionCleanup(): void {
  this.stopStickySessionCleanup(); // Clear existing first
  this.stickySessionCleanupInterval = setInterval(() => {
    // cleanup logic
  }, 60000);
}

private stopStickySessionCleanup(): void {
  if (this.stickySessionCleanupInterval) {
    clearInterval(this.stickySessionCleanupInterval);
    this.stickySessionCleanupInterval = null;
  }
}

public updateConfig(newConfig: LoadBalancerConfig): void {
  // ... existing updates ...
  if (newConfig.stickySessionTTL !== this.config.stickySessionTTL) {
    this.startStickySessionCleanup();
  }
}
```

---

### MED-3: AbortController Not Cleared on Early Return

**File:** `src/model-manager.ts:553`

**Problem:** `job.abortController` created but never cleared if retry doesn't happen.

**Fix:**

```typescript
try {
  job.abortController = new AbortController();
  // ... existing logic ...
} finally {
  if (!shouldRetry) {
    job.abortController?.abort();
    job.abortController = undefined;
  }
}
```

---

### MED-4: Double Chunk Count Increment

**File:** `src/storage/in-flight-manager.ts:66-96`

**Problem:** `markFirstChunk` and `markFirstContent` both increment `chunkCount`.

**Fix:**

```typescript
markFirstChunk(chunkSize: number): void {
  if (this.options.trackFirstChunk && !this.firstChunkTime) {
    this.firstChunkTime = Date.now();
    this.firstChunkSize = chunkSize;
    this.chunkCount++;
  }
}

markFirstContent(contentPreview?: string): void {
  if (this.options.trackFirstContent && !this.firstContentTime) {
    this.firstContentTime = Date.now();
    this.firstContentPreview = contentPreview?.slice(0, 100);
    // Don't increment chunkCount here - already counted in markFirstChunk
    // OR increment only if firstChunk wasn't tracked
    if (!this.options.trackFirstChunk) {
      this.chunkCount++;
    }
  }
}
```

---

### MED-5: Division by Zero in Token Throughput

**File:** `src/metrics/metrics-aggregator.ts:108-121`

**Problem:** `tokensGenerated / (evalDuration / 1e9)` produces Infinity if evalDuration is 0.

**Fix:**

```typescript
const evalSeconds = context.evalDuration / 1e9;
const tps = evalSeconds > 0 ? context.tokensGenerated / evalSeconds : 0;
```

---

### MED-6: Config Property Access Before Initialization

**File:** `src/metrics/metrics-aggregator.ts:470-491`

**Problem:** `crossModelInference` config accessed but might not be initialized.

**Fix:**

```typescript
// Initialize with defaults if not set
const crossModelConfig = this.config.crossModelInference ?? {
  enabled: false,
  weight: 0.1,
  minSamples: 10,
};
```

---

### MED-7: Request Timeout Too Long

**File:** `src/index.ts:183`

**Problem:** `requestTimeout = 600000` (10 minutes) could cause resource exhaustion.

**Fix:**

```typescript
server.requestTimeout = 300000; // 5 minutes - still generous for AI workloads
```

Add config option for this:

```typescript
server.requestTimeout = config.security?.requestTimeoutMs ?? 300000;
```

---

### MED-8: Metrics Endpoint Unauthenticated

**File:** `src/index.ts:102`

**Problem:** `/metrics` exposed without authentication.

**Fix:**

```typescript
// Option 1: Only allow in non-production
if (process.env.NODE_ENV !== 'production') {
  app.get('/metrics', getPrometheusMetrics);
} else {
  // Option 2: Protect with internal network check
  app.get('/metrics', (req, res, next) => {
    const ip = req.ip;
    if (this.isInternalIp(ip)) {
      getPrometheusMetrics(req, res);
    } else {
      res.status(403).json({ error: 'Metrics only available internally' });
    }
  });
}
```

---

### MED-9: Shallow Copy in getConfig()

**File:** `src/config/config.ts:605-607`

**Problem:** `getConfig()` returns shallow copy, allowing modification of nested objects.

**Fix:**

```typescript
import deepMerge from 'deepmerge';

getConfig(): OrchestratorConfig {
  return deepMerge({}, this.config) as OrchestratorConfig;
}
```

Or use `structuredClone` (Node 17+):

```typescript
getConfig(): OrchestratorConfig {
  return structuredClone(this.config);
}
```

---

### MED-10: Persist Flag Not Reset on Error

**File:** `src/orchestrator-instance.ts:152-154`

**Problem:** If loading fails after `setSuppressPersistence(true)`, suppression stays active.

**Fix:**

```typescript
} catch (error) {
  logger.error('Failed to load persisted data:', { error });
  // Don't suppress persistence on load failures - just log
  // setSuppressPersistence(false); // REMOVE this from catch
}
```

The suppression should only be manual:

```typescript
// Add explicit method to enable suppression
public suppressPersistence(reason: string): void {
  logger.warn(`Persistence suppressed: ${reason}`);
  this.suppressPersistenceCount++;
}
```

---

### MED-11: ParseInt Bug for keep_alive Check

**File:** `src/controllers/ollamaController.ts:146`

**Problem:** String `"0"` is truthy, so `!body.keep_alive` is false.

**Fix:**

```typescript
const keepAliveValue = body.keep_alive;
const keepAliveZero = Number(keepAliveValue) === 0;
if (!prompt && (!keepAliveValue || keepAliveZero)) {
```

---

### MED-12: Schema/Type Mismatch for Message Content

**File:** `src/controllers/openaiController.ts:41-51 vs 102-108`

**Problem:** Interface allows array content but Zod validation only accepts strings.

**Fix:** Update Zod schema:

```typescript
const messageContentSchema: z.ZodType<MessageContent> = z.union([
  z.string(),
  z.array(
    z.object({
      type: z.enum(['text', 'image_url']),
      text: z.string().optional(),
      image_url: z.union([z.string(), z.object({ url: z.string() })]).optional(),
    })
  ),
]);
```

---

## Low Severity Issues

### LOW-1: Non-Cryptographic ID Generation

**File:** `src/controllers/openaiController.ts:111`

**Problem:** `Math.random()` used for IDs.

**Fix:**

```typescript
import { randomUUID } from 'crypto';

function generateId(prefix: string = 'chatcmpl'): string {
  return `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 13)}`;
}
```

---

### LOW-2: Dead Code - unified-recorder.ts

**File:** `src/utils/unified-recorder.ts`

**Problem:** File marked as deprecated with no imports.

**Fix:** Delete the file and remove any references.

---

### LOW-3: O(n) Log Buffer Management

**File:** `src/utils/logger.ts:34-37`

**Problem:** `shift()` on large arrays is O(n).

**Fix:** Implement ring buffer:

```typescript
class RingBuffer<T> {
  private buffer: T[];
  private head = 0;

  constructor(private capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
  }

  toArray(): T[] {
    return [...this.buffer.slice(this.head), ...this.buffer.slice(0, this.head)];
  }
}
```

---

### LOW-4: Empty String API Key Allowed

**File:** `frontend/src/validations.ts:21`

**Problem:** `""` matches the regex due to `?`.

**Fix:**

```typescript
export const apiKeySchema = z
  .string()
  .regex(
    /^(env:[A-Z_][A-Z0-9_]*|sk-[a-zA-Z0-9-_]{20,})$/,
    'API key must be "env:VARIABLE_NAME" or "sk-" followed by 20+ characters'
  )
  .optional()
  .refine(val => !val || val.length > 0, 'Empty string not allowed');
```

---

### LOW-5: Server ID Generation Fails on Unicode

**File:** `frontend/src/pages/Servers.tsx:182`

**Problem:** `btoa()` throws on Unicode characters.

**Fix:**

```typescript
const id = btoa(encodeUrlParam(newServerUrl.replace(/[^\\x00-\\x7F]/g, ''))).replace(
  /[^a-zA-Z0-9]/g,
  ''
);
```

Or better - generate server-side and have client wait for response.

---

### LOW-6: Fragmented Model Name Parsing

**File:** `src/controllers/serversController.ts:253-257`

**Problem:** Model names with colons (e.g., `model:v3`) split incorrectly.

**Fix:**

```typescript
const lastColonIndex = name.lastIndexOf(':');
const serverId = lastColonIndex > 0 ? name.substring(0, lastColonIndex) : name;
const model = lastColonIndex > 0 ? name.substring(lastColonIndex + 1) : name;
```

---

### LOW-7: SlidingWindow Cleanup Race

**File:** `src/circuit-breaker.ts:180-184`

**Problem:** `Date.now()` can advance between push and cleanup.

**Fix:**

```typescript
add(success: boolean, errorType?: ErrorType): void {
  const now = Date.now();
  this.window.push({ timestamp: now, success, errorType });
  // Cleanup using the timestamp we just pushed, not current time
  this.cleanup(this.window[this.window.length - 1].timestamp);
}
```

---

### LOW-8: Model Name Regex Overly Permissive

**File:** `src/middleware/validation.ts:86-89`

**Problem:** Allows path traversal characters.

**Fix:**

```typescript
.regex(/^[a-zA-Z0-9][a-zA-Z0-9\-_:./]{0,500}$/, 'Invalid characters in model name')
  .refine(name => !name.includes('..') && !name.includes('//'), 'Path traversal detected')
```

---

### LOW-9: Unbound Query Results

**File:** `src/storage/metrics-store.ts:322-323`

**Problem:** User-controlled `limit` and `offset` not validated.

**Fix:**

```typescript
const safeLimit = Math.min(Math.max(1, limit), 10000);
const safeOffset = Math.max(0, offset);
const sql = `SELECT * FROM requests ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
return this.db.prepare(sql).all(...params, safeLimit, safeOffset);
```

---

### LOW-10: Double Decode Risk

**File:** `src/controllers/serversController.ts:339, 389, 431`

**Problem:** `decodeURIComponent` called without checking if already decoded.

**Fix:**

```typescript
function safeDecode(str: string): string {
  try {
    const decoded = decodeURIComponent(str);
    return decoded === str ? str : safeDecode(decoded); // Recursively decode
  } catch {
    return str;
  }
}
```

---

## Cross-Cutting Concerns

### Type Safety Initiative

**Problem:** Extensive `as any` usage throughout codebase undermines TypeScript's benefits.

**Plan:**

1. Audit all `as any` usages - categorize as necessary or lazy
2. Replace with proper generics or unknown handling:

   ```typescript
   // Bad
   const value = (item as any)[key];

   // Good - use index signature
   const value = (item as Record<string, unknown>)[key];

   // Or proper typing
   interface Item {
     [key: string]: unknown;
   }
   const value = (item as Item)[key];
   ```

3. Enable strict mode in tsconfig if not already
4. Add ESLint rule `@typescript-eslint/no-explicit-any: error`

---

### Error Type Consistency

**Problem:** Some places use `Error` objects, others use `string` for errors.

**Plan:**

1. Define `OrchestratorError` type:
   ```typescript
   type OrchestratorError = {
     code: string;
     message: string;
     details?: unknown;
   };
   ```
2. Convert all error throwing/catching to use this type
3. Update `MetricDataPoint.errorType` from `string` to `ErrorType`
4. Update `RequestContext.error` from `Error` to `OrchestratorError`

---

### Testing Requirements

For each fix, ensure:

1. **Unit tests** for logic changes (especially circuit breaker, load balancer)
2. **Integration tests** for storage/persistence changes
3. **E2E tests** for auth changes
4. **Chaos tests** for race conditions

---

## Implementation Order

### Phase 1: Critical Fixes (Week 1)

1. CR-1: Auth bypass fix
2. CR-2: Metrics data loss fix
3. CR-3: Timer leak fix
4. CR-4: Race condition in handlePs
5. CR-5: CORS configuration

### Phase 2: Security Hardening (Week 2)

1. HIGH-1: ReDoS protection
2. HIGH-2: API key redaction
3. HIGH-6: Timing attack fix
4. HIGH-7: URL encoding fix
5. MED-8: Metrics endpoint protection

### Phase 3: Data Integrity (Week 3)

1. HIGH-4: markFailure fix
2. MED-1: Unbounded text growth
3. MED-2: Sticky session cleanup
4. MED-9: Deep clone for getConfig
5. MED-10: Persistence flag handling

### Phase 4: Correctness Fixes (Week 4)

1. HIGH-3: Context size defaults
2. HIGH-5: Queue config env vars
3. HIGH-8: VRAM estimation
4. HIGH-9: Zero threshold bug
5. HIGH-10: warmupJobs cleanup
6. MED-5: Division by zero
7. MED-6: Config initialization

### Phase 5: Polish (Week 5)

1. LOW-1: Cryptographic IDs
2. LOW-2: Remove dead code
3. LOW-3: Ring buffer for logs
4. LOW-4 through LOW-10
5. Type safety initiative
6. Error type consistency

---

## Testing Requirements

### Test Creation Guidelines

For each issue fix, create tests BEFORE or alongside the fix:

#### 1. Unit Tests (`tests/unit/`)

Each fix must include unit tests that:

```typescript
// Example test structure for CR-1 (Auth Bypass)
describe('requireAdmin', () => {
  it('should use passed config.enabled, not global', () => {
    const mockConfig: AuthConfig = { enabled: true, ... };
    const middleware = requireAdmin(mockConfig);

    // When auth is enabled in passed config but disabled globally
    DEFAULT_AUTH_CONFIG.enabled = false;

    const req = { headers: {} } as Request;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
    const next = jest.fn();

    middleware(req, res, next);

    // Should block request, not allow through
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();

    // Cleanup
    DEFAULT_AUTH_CONFIG.enabled = true;
  });
});
```

**Coverage requirements:**

- Happy path
- Edge cases (null, undefined, empty values)
- Error conditions
- Boundary conditions

#### 2. Integration Tests (`tests/integration/`)

For storage, config, and multi-component fixes:

```typescript
// Example for CR-2 (Metrics Data Loss)
describe('MetricsStore flush', () => {
  it('should not lose data when transaction fails', async () => {
    const store = new MetricsStore();

    // Add some metrics
    store.recordRequest(mockRequest);

    // Simulate DB failure
    jest.spyOn(store.db, 'transaction').mockImplementation(() => {
      throw new Error('DB Error');
    });

    // Trigger flush
    await store.flush();

    // Data should still be in buffer
    expect(store.requestBuffer.length).toBe(1);

    // After fix, verify data is preserved
  });
});
```

#### 3. E2E Tests (`tests/e2e/`)

For frontend fixes and auth changes:

```typescript
// Example for HIGH-7 (Model URL encoding)
test('delete model with special characters in name', async ({ page }) => {
  await page.goto('/servers');

  // Add server
  await page.click('[data-testid="add-server"]');
  await page.fill('[name="url"]', 'http://localhost:11434');
  await page.click('[data-testid="save-server"]');

  // Pull model with colon in name
  await page.click('[data-testid="pull-model"]');
  await page.fill('[name="model"]', 'llama3.2:latest');

  // Delete should work without URL encoding issues
  await page.click('[data-testid="delete-model"]');
  await expect(page.locator('.toast-error')).not.toBeVisible();
});
```

#### 4. Chaos Tests (`tests/chaos/`)

For race conditions and concurrency fixes:

```typescript
// Example for CR-4 (Race in handlePs)
describe('handlePs race condition', () => {
  it('should handle concurrent server responses', async () => {
    const servers = createMockServers(20);

    // Fire many concurrent requests
    const promises = servers.map(s => handlePs(s));
    const results = await Promise.all(promises);

    // Verify no data loss or corruption
    const allModels = results.flat();
    const seen = new Set<string>();

    for (const model of allModels) {
      const key = `${model.server}:${model.name}`;
      expect(seen.has(key)).toBe(false); // No duplicates
      seen.add(key);
    }
  });
});
```

---

### Test Naming Convention

```
{component}.test.ts
{component}.integration.test.ts
{component}.e2e.test.ts
{component}.chaos.test.ts
```

Test descriptions should follow: `should {expected behavior} when {condition}`

---

## Git Workflow

### Branch Naming

```
fix/{issue-id}-{short-description}
feat/{feature-name}
refactor/{component}
test/{component}
chore/{task}
```

Examples:

```
fix/CR-1-auth-bypass-requireAdmin
fix/HIGH-10-warmupJobs-memory-leak
refactor/load-balancer-types
test/streaming-error-handling
```

### Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
{type}({scope}): {description}

[optional body]

[optional footer(s)]
```

**Types:**

- `fix` - Bug fix
- `feat` - New feature
- `refactor` - Code refactoring
- `test` - Adding or updating tests
- `docs` - Documentation only
- `chore` - Maintenance tasks
- `perf` - Performance improvements
- `security` - Security fixes

**Scopes:**

- `auth` - Authentication/authorization
- `metrics` - Metrics and monitoring
- `circuit-breaker` - Circuit breaker
- `load-balancer` - Load balancing
- `streaming` - Streaming functionality
- `storage` - Persistence layer
- `config` - Configuration
- `api` - API endpoints
- `frontend` - Frontend code

**Examples:**

```
fix(auth): use passed config in requireAdmin instead of global

Closes CR-1

fix(metrics): preserve buffer data on flush failure

Previously splice() emptied buffers before the transaction,
causing permanent data loss if the transaction failed.
Now buffers are only cleared after successful commit.

Refs: CR-2
```

```
fix(auth): prevent timing attack in API key comparison

Use crypto.timingSafeEqual for constant-time comparison
to prevent timing-based attacks on API keys.

Closes HIGH-6
```

```
test(circuit-breaker): add chaos tests for concurrent state changes

Add race condition tests for serversUndergoingActiveTests Set
and sliding window cleanup timing issues.

Refs: MED-2
```

### Commit Per Issue

Each issue (CR-1, HIGH-1, etc.) should be its own commit with:

1. The fix itself
2. Corresponding tests
3. Documentation updates if any

### Pull Request Process

1. **Create PR** after completing all changes for a phase:

   ```bash
   git checkout -b fix/phase-1-critical
   git add .
   git commit -m "fix: resolve critical security and data integrity issues

   - fix(auth): CR-1 auth bypass in requireAdmin
   - fix(metrics): CR-2 data loss on flush failure
   - fix(metrics): CR-3 timer leak in rollup scheduler
   - fix(controller): CR-4 race condition in handlePs
   - fix(server): CR-5 CORS configuration ignored

   Closes CR-1, CR-2, CR-3, CR-4, CR-5"
   git push origin fix/phase-1-critical
   gh pr create --title "fix: Critical security and data integrity issues"
   ```

2. **PR Description Template:**

   ```markdown
   ## Summary

   Brief description of what this PR fixes.

   ## Issues Fixed

   - CR-1: Authentication bypass in requireAdmin
   - CR-2: Metrics data loss on flush failure
   - ...

   ## Testing

   - [ ] Unit tests added/updated for all changes
   - [ ] Integration tests pass
   - [ ] E2E tests pass
   - [ ] Memory leak tests pass
   - [ ] Race condition tests pass

   ## Checklist

   - [ ] Code follows project style guidelines
   - [ ] No `as any` without documentation
   - [ ] TypeScript strict mode passes
   - [ ] ESLint passes
   ```

3. **Code Review Requirements:**
   - At least 1 approval for fixes
   - 2 approvals for security-critical changes
   - All CI checks must pass
   - No merge conflicts

### Tagging Releases

After completing a phase:

```bash
git tag -a v0.2.0-rc1 -m "Release candidate for phase 1 fixes"
git push origin v0.2.0-rc1
```

---

## Files Modified Per Issue

| Issue   | Primary File(s)                               | Test File(s)                         |
| ------- | --------------------------------------------- | ------------------------------------ |
| CR-1    | src/middleware/auth.ts                        | tests/unit/middleware/auth.test.ts   |
| CR-2    | src/storage/metrics-store.ts                  | tests/integration/metrics.test.ts    |
| CR-3    | src/storage/metrics-store.ts                  | tests/unit/metrics.test.ts           |
| CR-4    | src/controllers/ollamaController.ts           | tests/unit/controller/ollama.test.ts |
| CR-5    | src/index.ts, src/config/schema.ts            | tests/integration/server.test.ts     |
| HIGH-1  | src/utils/errorClassifier.ts                  | tests/unit/errorClassifier.test.ts   |
| HIGH-2  | src/utils/stream-handoff.ts                   | tests/unit/stream.test.ts            |
| HIGH-3  | src/utils/prompt-estimator.ts                 | tests/unit/estimator.test.ts         |
| HIGH-4  | src/storage/ban-manager.ts                    | tests/unit/ban.test.ts               |
| HIGH-5  | src/config/config.ts, src/config/envMapper.ts | tests/unit/config.test.ts            |
| HIGH-6  | src/middleware/auth.ts                        | tests/unit/middleware/auth.test.ts   |
| HIGH-7  | frontend/src/api.ts                           | tests/e2e/models.test.ts             |
| HIGH-8  | src/load-balancer.ts                          | tests/unit/load-balancer.test.ts     |
| HIGH-9  | src/controllers/modelController.ts            | tests/unit/controller/model.test.ts  |
| HIGH-10 | src/model-manager.ts                          | tests/unit/model-manager.test.ts     |

---

## Verification Checklist

### Pre-Commit Verification

Before each commit:

- [ ] Code follows style guidelines (run `npm run lint`)
- [ ] TypeScript compiles without errors (run `npm run typecheck`)
- [ ] New unit tests written for the fix
- [ ] Unit tests pass locally (`npm run test:unit`)
- [ ] No `as any` casts added without documentation comment
- [ ] Commit message follows Conventional Commits format

### Post-Implementation Verification

After completing each phase:

- [ ] All unit tests pass (`npm run test:unit`)
- [ ] All integration tests pass (`npm run test:integration`)
- [ ] All E2E tests pass (`npm run test:e2e`)
- [ ] All chaos tests pass (`npm run test:chaos`)
- [ ] ESLint passes with no new errors (`npm run lint`)
- [ ] TypeScript compilation with strict mode (`tsc --strict`)
- [ ] Memory profiling shows no leaks under load
- [ ] Race condition tests pass under concurrent load
- [ ] PR created and approved
- [ ] All CI checks pass
- [ ] Changes merged to main branch

### Security Verification

For security-related fixes (CR-1, HIGH-1, HIGH-2, HIGH-6):

- [ ] Security review completed
- [ ] No sensitive data in logs (verify log output)
- [ ] Timing-safe comparison verified
- [ ] Input validation tested with edge cases
- [ ] Auth bypass scenarios tested

### Performance Verification

For performance-related fixes (MED-1, MED-2, MED-3):

- [ ] Benchmark before and after
- [ ] Memory profiling shows improvement
- [ ] No new memory leaks introduced
- [ ] Timer cleanup verified
