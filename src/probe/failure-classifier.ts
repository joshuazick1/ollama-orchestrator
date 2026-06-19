/**
 * failure-classifier.ts
 * Pure function for classifying probe failures into retry categories.
 * NO state, NO time math, NO shared backoff logic.
 */

import type { ProbeEndpoint } from './types.js';

/**
 * Classification kinds for probe failures
 */
export type FailureKind = 'transient' | 'rate_limited' | 'non_retryable' | 'permanent' | 'timeout';

/**
 * Classification result from classify()
 */
export interface Classification {
  kind: FailureKind;
  retryable: boolean;
  retryAfterMs?: number;
}

/**
 * Context passed to classify()
 */
export interface ClassificationContext {
  /** The endpoint being probed */
  endpoint?: ProbeEndpoint;
  /** HTTP status code if known */
  httpStatus?: number;
  /** Retry-After header value in various formats */
  retryAfterHeader?: string;
}

/**
 * Network error codes that indicate transient failures
 */
const TRANSIENT_NETWORK_ERRORS = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET'] as const;

/**
 * Patterns that indicate the model/endpoint doesn't support the operation
 * (non-retryable compatibility errors)
 */
const NON_SUPPORT_PATTERNS = [/does not support/i, /not support/i] as const;

/**
 * Parse Retry-After header value to milliseconds.
 * Supports:
 * - Seconds: "120" → 120000
 * - HTTP date: "Wed, 21 Oct 2025 07:28:00 GMT" → computed from now
 */
function parseRetryAfterHeader(header: string | undefined): number | undefined {
  if (!header) {
    return undefined;
  }

  const trimmed = header.trim();

  // Try parsing as seconds (integer or decimal)
  const seconds = Number(trimmed);
  if (!isNaN(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  // Try parsing as HTTP date (IMF-fixdate)
  const date = new Date(trimmed);
  if (!isNaN(date.getTime())) {
    const msUntilRetry = date.getTime() - Date.now();
    return msUntilRetry > 0 ? msUntilRetry : undefined;
  }

  return undefined;
}

/**
 * Extract HTTP status code from error message
 */
function extractHttpStatus(errorMsg: string): number | null {
  const match = errorMsg.match(/\b([45]\d{2})\b/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Check if error message contains a transient network error code
 */
function hasTransientNetworkError(errorMsg: string): boolean {
  const lowerMsg = errorMsg.toLowerCase();
  return TRANSIENT_NETWORK_ERRORS.some(
    code => lowerMsg.includes(code.toLowerCase()) || lowerMsg.includes(code)
  );
}

/**
 * Classify a probe failure.
 *
 * Rules (in priority order):
 * 1. HTTP 429 → rate_limited (retryable, parse Retry-After header)
 * 2. HTTP 503 → transient (retryable, fixed 5000ms)
 * 3. HTTP 500, 502, 504 → transient (retryable)
 * 4. HTTP 400, 404 → non_retryable
 * 5. HTTP 401, 403 → permanent
 * 6. ECONNREFUSED, ETIMEDOUT, ENOTFOUND, ECONNRESET → transient
 * 7. AbortError → timeout (retryable)
 * 8. "does not support" / "not support" pattern → non_retryable
 * 9. Default → transient (retryable)
 *
 * @param error - Error object or error message string
 * @param context - Optional context with httpStatus, retryAfterHeader, endpoint
 * @returns Classification result
 */
export function classify(error: Error | string, context?: ClassificationContext): Classification {
  // Normalize error to string message
  const errorMsg = typeof error === 'string' ? error : error.message;

  // Priority 1: HTTP 429 (Rate Limited)
  // Check context httpStatus first, then extract from message
  const httpStatus = context?.httpStatus ?? extractHttpStatus(errorMsg);

  if (httpStatus === 429) {
    const retryAfterMs = parseRetryAfterHeader(context?.retryAfterHeader);
    return {
      kind: 'rate_limited',
      retryable: true,
      retryAfterMs,
    };
  }

  // Priority 2: HTTP 503 (Service Unavailable)
  if (httpStatus === 503) {
    return {
      kind: 'transient',
      retryable: true,
      retryAfterMs: 5000,
    };
  }

  // Priority 3: HTTP 500, 502, 504 (Server Errors)
  if (httpStatus === 500 || httpStatus === 502 || httpStatus === 504) {
    return {
      kind: 'transient',
      retryable: true,
    };
  }

  // Priority 4: HTTP 400, 404 (Client Errors - Bad Request, Not Found)
  if (httpStatus === 400 || httpStatus === 404) {
    return {
      kind: 'non_retryable',
      retryable: false,
    };
  }

  // Priority 5: HTTP 401, 403 (Auth Errors - Permanent failures)
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      kind: 'permanent',
      retryable: false,
    };
  }

  // Priority 6: Transient network errors
  if (hasTransientNetworkError(errorMsg)) {
    return {
      kind: 'transient',
      retryable: true,
    };
  }

  // Priority 7: AbortError (timeout)
  if (errorMsg === 'AbortError' || errorMsg.includes('AbortError')) {
    return {
      kind: 'timeout',
      retryable: true,
    };
  }

  // Priority 8: "does not support" / "not support" patterns
  for (const pattern of NON_SUPPORT_PATTERNS) {
    if (pattern.test(errorMsg)) {
      return {
        kind: 'non_retryable',
        retryable: false,
      };
    }
  }

  // Priority 9: Default - transient (retryable)
  return {
    kind: 'transient',
    retryable: true,
  };
}
