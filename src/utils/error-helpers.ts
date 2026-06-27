/**
 * error-helpers.ts
 * Centralized error message extraction utilities
 * Eliminates 73+ duplicate patterns across the codebase
 */

import { isOrchestratorError } from './domain-errors.js';

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
  type: string;
  status: number;
  title: string;
  detail?: string;
} {
  if (isOrchestratorError(error)) {
    return {
      type: `https://orchestrator.local/errors/${error.code}`,
      status: error.status,
      title: error.message,
    };
  }

  const details = getErrorDetails(error);
  return {
    type: 'https://orchestrator.local/errors/internal_server_error',
    status: 500,
    title: details.message,
    detail: details.stack?.split('\n')[1]?.trim(),
  };
}
