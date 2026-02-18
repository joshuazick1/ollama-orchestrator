/**
 * circuit-breaker-helpers.ts
 * Circuit breaker utility functions
 * Centralizes bypass logic and state helpers
 */

import type { Request } from 'express';
import { clamp } from './math-helpers.js';
import { featureFlags } from '../config/feature-flags.js';

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

/**
 * Calculate adaptive timeout based on response time
 */
export function calculateAdaptiveTimeout(
  responseTime: number,
  options: {
    minTimeout?: number;
    maxTimeout?: number;
    multiplier?: number;
  } = {}
): number {
  const { minTimeout = 15000, maxTimeout = 600000, multiplier = 3 } = options;
  return clamp(responseTime * multiplier, minTimeout, maxTimeout);
}

/**
 * Should bypass circuit breaker with feature flag support
 */
export function shouldBypassWithFlag(req: Request): boolean {
  if (!featureFlags.get('useCircuitBreakerHelpers')) {
    return shouldBypassCircuitBreaker(req);
  }
  return shouldBypassCircuitBreaker(req);
}
