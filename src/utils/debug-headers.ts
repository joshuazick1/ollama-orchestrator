/**
 * debug-headers.ts
 * Helper utilities for adding debug headers and JSON fields to responses
 */

import type { Request, Response } from 'express';

import type { RoutingContext } from '../orchestrator-instance.js';

export interface DebugInfo {
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
  timeToFirstToken?: number;
  streamingDuration?: number;
  tokensGenerated?: number;
  tokensPrompt?: number;
  lastError?: string;
}

export interface ExtendedRoutingContext {
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
}

export function addDebugHeaders(req: Request, res: Response, context: RoutingContext): void {
  if (req.headers['x-include-debug-info'] !== 'true') {
    return;
  }

  if (context.selectedServerId) {
    res.setHeader('X-Selected-Server', context.selectedServerId);
  }
  if (context.serverCircuitState) {
    res.setHeader('X-Server-Circuit-State', context.serverCircuitState);
  }
  if (context.modelCircuitState) {
    res.setHeader('X-Model-Circuit-State', context.modelCircuitState);
  }
  if (context.availableServerCount !== undefined) {
    res.setHeader('X-Available-Servers', context.availableServerCount.toString());
  }
  if (context.routedToOpenCircuit) {
    res.setHeader('X-Routed-To-Open-Circuit', 'true');
  }
  if (context.retryCount !== undefined && context.retryCount > 0) {
    res.setHeader('X-Retry-Count', context.retryCount.toString());
  }
}

export function getDebugInfo(
  context: RoutingContext,
  options?: {
    timeToFirstToken?: number;
    streamingDuration?: number;
    tokensGenerated?: number;
    tokensPrompt?: number;
    lastError?: string;
  }
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
    options?.timeToFirstToken !== undefined ||
    options?.streamingDuration !== undefined ||
    options?.tokensGenerated !== undefined ||
    options?.tokensPrompt !== undefined ||
    options?.lastError;

  if (!hasDebugInfo) {
    return undefined;
  }

  const debugInfo: DebugInfo = {};

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
  if (options?.lastError) {
    debugInfo.lastError = options.lastError;
  }

  return debugInfo;
}
