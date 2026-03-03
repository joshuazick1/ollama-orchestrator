/**
 * debug-headers.ts
 * Helper utilities for adding debug info fields to responses.
 *
 * Debug information is included when the client sends either:
 *   - Query parameter: ?debug=true
 *   - Request header:  X-Include-Debug-Info: true
 */

import type { RoutingContext } from '../orchestrator-instance.js';

export interface ChunkDebugData {
  chunkCount?: number;
  totalBytes?: number;
  maxChunkGapMs?: number;
  avgChunkSizeBytes?: number;
}

export interface DebugInfo {
  // Request identification
  requestId?: string;
  requestTimestamp?: number;

  // Routing decisions
  selectedServerId?: string;
  serverCircuitState?: string;
  modelCircuitState?: string;
  availableServerCount?: number;
  routedToOpenCircuit?: boolean;
  retryCount?: number;
  serversTried?: string[];
  totalCandidates?: number;
  serverLoad?: number;
  maxConcurrency?: number;
  // REC-55: routing reasoning fields
  algorithm?: string;
  protocol?: string;
  excludedServers?: string[];
  serverScores?: Array<{ serverId: string; totalScore: number }>;
  timeoutMs?: number;

  // Streaming metrics
  timeToFirstToken?: number;
  streamingDuration?: number;
  tokensGenerated?: number;
  tokensPrompt?: number;

  // Chunk-level diagnostics
  chunkData?: ChunkDebugData;

  // Queue / concurrency diagnostics
  queueWaitTime?: number;

  // Stall detection diagnostics
  stallDetected?: boolean;
  stallDurationMs?: number;
  handoffAttempted?: boolean;
  handoffSuccess?: boolean;
  handoffTargetServer?: string;

  // Error context
  lastError?: string;
}

export interface DebugInfoOptions {
  requestId?: string;
  requestTimestamp?: number;
  timeToFirstToken?: number;
  streamingDuration?: number;
  tokensGenerated?: number;
  tokensPrompt?: number;
  lastError?: string;
  chunkData?: ChunkDebugData;
  queueWaitTime?: number;
  stallDetected?: boolean;
  stallDurationMs?: number;
  handoffAttempted?: boolean;
  handoffSuccess?: boolean;
  handoffTargetServer?: string;
}

/**
 * Check whether the client requested debug info via query param or header.
 */
export function isDebugRequested(req: {
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
}): boolean {
  if (req.query?.debug === 'true') {
    return true;
  }
  const headerValue = req.headers?.['x-include-debug-info'];
  if (headerValue === 'true' || headerValue === '1') {
    return true;
  }
  return false;
}

/**
 * Set lightweight diagnostic response headers that load-testing tools can parse
 * without inspecting the response body. Only set when debug is requested.
 */
export function setDebugResponseHeaders(
  res: { setHeader(name: string, value: string | number): void; headersSent?: boolean },
  debugInfo: DebugInfo
): void {
  if (res.headersSent) {
    return;
  }
  if (debugInfo.requestId) {
    res.setHeader('X-Request-Id', debugInfo.requestId);
  }
  if (debugInfo.selectedServerId) {
    res.setHeader('X-Selected-Server', debugInfo.selectedServerId);
  }
  if (debugInfo.retryCount !== undefined && debugInfo.retryCount > 0) {
    res.setHeader('X-Retry-Count', debugInfo.retryCount);
  }
  if (debugInfo.serverCircuitState) {
    res.setHeader('X-Server-Circuit-State', debugInfo.serverCircuitState);
  }
  if (debugInfo.modelCircuitState) {
    res.setHeader('X-Model-Circuit-State', debugInfo.modelCircuitState);
  }
  if (debugInfo.availableServerCount !== undefined) {
    res.setHeader('X-Available-Servers', debugInfo.availableServerCount);
  }
  if (debugInfo.totalCandidates !== undefined) {
    res.setHeader('X-Total-Candidates', debugInfo.totalCandidates);
  }
  if (debugInfo.serversTried && debugInfo.serversTried.length > 0) {
    res.setHeader('X-Servers-Tried', debugInfo.serversTried.join(','));
  }
  if (debugInfo.serverLoad !== undefined) {
    res.setHeader('X-Server-Load', debugInfo.serverLoad);
  }
  if (debugInfo.maxConcurrency !== undefined) {
    res.setHeader('X-Max-Concurrency', debugInfo.maxConcurrency);
  }
  if (debugInfo.algorithm) {
    res.setHeader('X-Algorithm', debugInfo.algorithm);
  }
  if (debugInfo.timeoutMs !== undefined) {
    res.setHeader('X-Timeout-Ms', debugInfo.timeoutMs);
  }
  if (debugInfo.queueWaitTime !== undefined) {
    res.setHeader('X-Queue-Wait-Ms', debugInfo.queueWaitTime);
  }
  if (debugInfo.stallDetected) {
    res.setHeader('X-Stall-Detected', '1');
  }
}

export function getDebugInfo(
  context: RoutingContext,
  options?: DebugInfoOptions
): DebugInfo | undefined {
  const hasDebugInfo =
    context.selectedServerId ||
    context.serverCircuitState ||
    context.modelCircuitState ||
    context.availableServerCount !== undefined ||
    context.routedToOpenCircuit ||
    (context.retryCount !== undefined && context.retryCount > 0) ||
    (context.serversTried && context.serversTried.length > 0) ||
    context.serverLoad !== undefined ||
    context.maxConcurrency !== undefined ||
    context.algorithm ||
    context.protocol ||
    (context.excludedServers && context.excludedServers.length > 0) ||
    (context.serverScores && context.serverScores.length > 0) ||
    context.timeoutMs !== undefined ||
    context.queueWaitTime !== undefined ||
    options?.requestId ||
    options?.timeToFirstToken !== undefined ||
    options?.streamingDuration !== undefined ||
    options?.tokensGenerated !== undefined ||
    options?.tokensPrompt !== undefined ||
    options?.lastError ||
    options?.chunkData ||
    options?.queueWaitTime !== undefined ||
    options?.stallDetected;

  if (!hasDebugInfo) {
    return undefined;
  }

  const debugInfo: DebugInfo = {};

  // Request identification
  if (options?.requestId) {
    debugInfo.requestId = options.requestId;
  }
  if (options?.requestTimestamp) {
    debugInfo.requestTimestamp = options.requestTimestamp;
  }

  // Routing context
  if (context.selectedServerId) {
    debugInfo.selectedServerId = context.selectedServerId;
  }
  if (context.serverCircuitState) {
    debugInfo.serverCircuitState = context.serverCircuitState;
  }
  if (context.modelCircuitState) {
    debugInfo.modelCircuitState = context.modelCircuitState;
  }
  if (context.availableServerCount !== undefined) {
    debugInfo.availableServerCount = context.availableServerCount;
  }
  if (context.routedToOpenCircuit) {
    debugInfo.routedToOpenCircuit = context.routedToOpenCircuit;
  }
  if (context.retryCount !== undefined && context.retryCount > 0) {
    debugInfo.retryCount = context.retryCount;
  }
  if (context.serversTried && context.serversTried.length > 0) {
    debugInfo.serversTried = context.serversTried;
  }
  if (context.totalCandidates !== undefined) {
    debugInfo.totalCandidates = context.totalCandidates;
  }
  if (context.serverLoad !== undefined) {
    debugInfo.serverLoad = context.serverLoad;
  }
  if (context.maxConcurrency !== undefined) {
    debugInfo.maxConcurrency = context.maxConcurrency;
  }
  if (context.algorithm) {
    debugInfo.algorithm = context.algorithm;
  }
  if (context.protocol) {
    debugInfo.protocol = context.protocol;
  }
  if (context.excludedServers && context.excludedServers.length > 0) {
    debugInfo.excludedServers = context.excludedServers;
  }
  if (context.serverScores && context.serverScores.length > 0) {
    debugInfo.serverScores = context.serverScores;
  }
  if (context.timeoutMs !== undefined) {
    debugInfo.timeoutMs = context.timeoutMs;
  }

  // Streaming metrics
  if (options?.timeToFirstToken !== undefined) {
    debugInfo.timeToFirstToken = options.timeToFirstToken;
  }
  if (options?.streamingDuration !== undefined) {
    debugInfo.streamingDuration = options.streamingDuration;
  }
  if (options?.tokensGenerated !== undefined) {
    debugInfo.tokensGenerated = options.tokensGenerated;
  }
  if (options?.tokensPrompt !== undefined) {
    debugInfo.tokensPrompt = options.tokensPrompt;
  }

  // Chunk-level diagnostics
  if (options?.chunkData) {
    debugInfo.chunkData = options.chunkData;
  }

  // Queue / concurrency diagnostics
  const queueWaitTime = context.queueWaitTime ?? options?.queueWaitTime;
  if (queueWaitTime !== undefined) {
    debugInfo.queueWaitTime = queueWaitTime;
  }

  // Stall detection diagnostics
  if (options?.stallDetected) {
    debugInfo.stallDetected = options.stallDetected;
  }
  if (options?.stallDurationMs !== undefined) {
    debugInfo.stallDurationMs = options.stallDurationMs;
  }
  if (options?.handoffAttempted !== undefined) {
    debugInfo.handoffAttempted = options.handoffAttempted;
  }
  if (options?.handoffSuccess !== undefined) {
    debugInfo.handoffSuccess = options.handoffSuccess;
  }
  if (options?.handoffTargetServer) {
    debugInfo.handoffTargetServer = options.handoffTargetServer;
  }

  // Error context
  if (options?.lastError) {
    debugInfo.lastError = options.lastError;
  }

  return debugInfo;
}
