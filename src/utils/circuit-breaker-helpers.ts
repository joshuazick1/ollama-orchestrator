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

/**
 * Extract circuit breaker options from request
 */
export function extractCircuitBreakerOptions(req: Request): {
  bypass: boolean;
  reason?: string;
} {
  const bypass = shouldBypassCircuitBreaker(req);
  const reason = bypass
    ? req.query.bypass === 'true'
      ? 'bypass query param'
      : 'force query param'
    : undefined;

  return { bypass, reason };
}
