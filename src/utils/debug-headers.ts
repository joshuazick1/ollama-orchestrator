/**
 * debug-headers.ts
 * Helper utilities for adding debug headers to responses
 */

import type { Request, Response } from 'express';

import type { RoutingContext } from '../orchestrator-instance.js';

/**
 * Add debug headers when requested (opt-in via X-Include-Debug-Info header)
 */
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
