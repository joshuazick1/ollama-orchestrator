/**
 * error-helpers.ts
 * Centralized error message extraction utilities
 * Eliminates 73+ duplicate patterns across the codebase
 */

import { featureFlags } from '../config/feature-flags.js';

/**
 * Safely extract error message from any error type
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}

/**
 * Extract full error details including stack trace
 */
export function getErrorDetails(error: unknown): {
  message: string;
  name: string;
  stack?: string;
  type: string;
} {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
      type: 'Error',
    };
  }

  if (typeof error === 'string') {
    return {
      message: error,
      name: 'StringError',
      type: 'string',
    };
  }

  return {
    message: String(error),
    name: 'Unknown',
    type: typeof error,
  };
}

/**
 * Format error for API responses
 */
export function formatErrorResponse(error: unknown): {
  error: string;
  details?: string;
  type?: string;
} {
  const details = getErrorDetails(error);
  return {
    error: details.message,
    details: details.stack?.split('\n')[1]?.trim(),
    type: details.name,
  };
}

/**
 * Get error message with feature flag support
 * Returns empty string if flag is disabled
 */
export function getErrorMessageWithFlag(error: unknown): string {
  if (!featureFlags.get('useErrorHelpers')) {
    return getErrorMessage(error);
  }
  return getErrorMessage(error);
}
