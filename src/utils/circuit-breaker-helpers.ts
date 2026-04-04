/**
 * circuit-breaker-helpers.ts
 * Circuit breaker utility functions
 * Centralizes bypass logic and state helpers
 */

import type { Request } from 'express';

/**
 * Check if circuit breaker should be bypassed
 */
export function shouldBypassCircuitBreaker(req: Request): boolean {
  return req.query.bypass === 'true' || req.query.force === 'true';
}
