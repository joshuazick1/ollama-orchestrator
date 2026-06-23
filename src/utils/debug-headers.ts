/**
 * debug-headers.ts
 * Helper utilities for adding debug info fields to responses.
 *
 * Debug information is controlled by proxy.debugHeadersMode:
 *   - 'off': Never inject debug headers (default, recommended for production)
 *   - 'admin-only': Only inject when request has admin auth
 *   - 'always': Always inject when client requests via ?debug=true or X-Include-Debug-Info header
 *
 * SECURITY: 'always' mode exposes internal routing decisions to all clients.
 * Use 'admin-only' or 'off' in production environments.
 *
 * Header namespace: X-Orchestrator-Debug-*
 */

import { getConfigManager } from '../config/config.js';
import type { RoutingContext } from '../orchestrator/orchestrator-instance.js';

export interface ChunkDebugData {
  chunkCount?: number;
  totalBytes?: number;
  maxChunkGapMs?: number;
  avgChunkSizeBytes?: number;
  prefixHash?: string;
  chunkGapPercentiles?: { p50: number; p95: number; p99: number };
  isColdStart?: boolean;
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

  streamProgress?: boolean;
  prefixHash?: string;
  isColdStart?: boolean;

  // Error context
  lastError?: string;

  // Failover diagnostics
  failoverPhase?: number;
  failoverCount?: number;
  failoverErrors?: Array<{ serverId: string; error: string; errorType?: string }>;
  failoverOccurred?: boolean;
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
  prefixHash?: string;
  isColdStart?: boolean;
  streamProgress?: boolean;
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
 * Check if the request has admin authentication.
 * Returns true when auth is disabled OR req.auth?.isAdmin === true.
 */
function isAdminRequest(req: { auth?: { isAdmin?: boolean } }): boolean {
  return req.auth?.isAdmin === true;
}

/**
 * Determine whether debug headers should be included based on proxy.debugHeadersMode config.
 *
 * - 'off': Never inject debug headers
 * - 'admin-only': Only inject when request has admin auth
 * - 'always': Always inject when client requests via ?debug=true or X-Include-Debug-Info header
 */
export function shouldIncludeDebugHeaders(req: {
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  auth?: { isAdmin?: boolean };
}): boolean {
  const config = getConfigManager().getConfig();
  const mode = config.proxy.debugHeadersMode;

  switch (mode) {
    case 'off':
      return false;
    case 'admin-only':
      return isAdminRequest(req);
    case 'always':
      return isDebugRequested(req);
    default:
      return false;
  }
}

/**
 * Set lightweight diagnostic response headers that load-testing tools can parse
 * without inspecting the response body. Headers use X-Orchestrator-Debug-* namespace.
 */
export function setDebugResponseHeaders(
  res: { setHeader(name: string, value: string | number): void; headersSent?: boolean },
  debugInfo: DebugInfo
): void {
  if (res.headersSent) {
    return;
  }
  if (debugInfo.requestId) {
    res.setHeader('X-Orchestrator-Debug-Request-Id', debugInfo.requestId);
  }
  if (debugInfo.selectedServerId) {
    res.setHeader('X-Orchestrator-Debug-Selected-Server', debugInfo.selectedServerId);
  }
  if (debugInfo.retryCount !== undefined && debugInfo.retryCount > 0) {
    res.setHeader('X-Orchestrator-Debug-Retry-Count', debugInfo.retryCount);
  }
  if (debugInfo.serverCircuitState) {
    res.setHeader('X-Orchestrator-Debug-Server-Circuit-State', debugInfo.serverCircuitState);
  }
  if (debugInfo.modelCircuitState) {
    res.setHeader('X-Orchestrator-Debug-Model-Circuit-State', debugInfo.modelCircuitState);
  }
  if (debugInfo.availableServerCount !== undefined) {
    res.setHeader('X-Orchestrator-Debug-Available-Servers', debugInfo.availableServerCount);
  }
  if (debugInfo.totalCandidates !== undefined) {
    res.setHeader('X-Orchestrator-Debug-Total-Candidates', debugInfo.totalCandidates);
  }
  if (debugInfo.serversTried && debugInfo.serversTried.length > 0) {
    res.setHeader('X-Orchestrator-Debug-Servers-Tried', debugInfo.serversTried.join(','));
  }
  if (debugInfo.serverLoad !== undefined) {
    res.setHeader('X-Orchestrator-Debug-Server-Load', debugInfo.serverLoad);
  }
  if (debugInfo.maxConcurrency !== undefined) {
    res.setHeader('X-Orchestrator-Debug-Max-Concurrency', debugInfo.maxConcurrency);
  }
  if (debugInfo.algorithm) {
    res.setHeader('X-Orchestrator-Debug-Algorithm', debugInfo.algorithm);
  }
  if (debugInfo.timeoutMs !== undefined) {
    res.setHeader('X-Orchestrator-Debug-Timeout-Ms', debugInfo.timeoutMs);
  }
  if (debugInfo.queueWaitTime !== undefined) {
    res.setHeader('X-Orchestrator-Debug-Queue-Wait-Ms', debugInfo.queueWaitTime);
  }
  if (debugInfo.stallDetected) {
    res.setHeader('X-Orchestrator-Debug-Stall-Detected', '1');
  }
  if (debugInfo.failoverPhase !== undefined) {
    res.setHeader('X-Orchestrator-Debug-Failover-Phase', debugInfo.failoverPhase);
  }
  if (debugInfo.failoverCount !== undefined && debugInfo.failoverCount > 0) {
    res.setHeader('X-Orchestrator-Debug-Failover-Count', debugInfo.failoverCount);
  }
  if (debugInfo.failoverOccurred) {
    res.setHeader('X-Orchestrator-Debug-Failover-Occurred', '1');
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
    context.failoverPhase !== undefined ||
    context.failoverOccurred ||
    options?.requestId ||
    options?.timeToFirstToken !== undefined ||
    options?.streamingDuration !== undefined ||
    options?.tokensGenerated !== undefined ||
    options?.tokensPrompt !== undefined ||
    options?.lastError ||
    options?.chunkData ||
    options?.queueWaitTime !== undefined ||
    options?.stallDetected ||
    options?.streamProgress !== undefined ||
    options?.prefixHash ||
    options?.isColdStart !== undefined;

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

  // Failover diagnostics
  if (context.failoverPhase !== undefined) {
    debugInfo.failoverPhase = context.failoverPhase;
  }
  if (context.failoverCount !== undefined && context.failoverCount > 0) {
    debugInfo.failoverCount = context.failoverCount;
  }
  if (context.failoverErrors && context.failoverErrors.length > 0) {
    debugInfo.failoverErrors = context.failoverErrors;
  }
  if (context.failoverOccurred) {
    debugInfo.failoverOccurred = context.failoverOccurred;
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

  if (options?.streamProgress !== undefined) {
    debugInfo.streamProgress = options.streamProgress;
  }
  if (options?.prefixHash) {
    debugInfo.prefixHash = options.prefixHash;
  }
  if (options?.isColdStart !== undefined) {
    debugInfo.isColdStart = options.isColdStart;
  }

  // Error context
  if (options?.lastError) {
    debugInfo.lastError = options.lastError;
  }

  return debugInfo;
}
