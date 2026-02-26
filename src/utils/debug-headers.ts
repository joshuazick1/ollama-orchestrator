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

export function getDebugInfo(context: RoutingContext): DebugInfo | undefined {
  const hasDebugInfo =
    context.selectedServerId ||
    context.serverCircuitState ||
    context.modelCircuitState ||
    context.availableServerCount !== undefined ||
    context.routedToOpenCircuit ||
    (context.retryCount !== undefined && context.retryCount > 0);

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

  return debugInfo;
}
