/**
 * error-event.ts
 * TypeScript interfaces for error event persistence layer.
 */

/**
 * Error categories from ErrorClassifier
 */
export type ErrorCategory =
  | 'resource'
  | 'compatibility'
  | 'network'
  | 'auth'
  | 'config'
  | 'unknown';

/**
 * Error severity levels
 */
export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Error types from ErrorClassifier
 */
export type ErrorType =
  | 'retryable'
  | 'non_retryable'
  | 'transient'
  | 'permanent'
  | 'rate_limited';

/**
 * Error event record for persistence.
 * Captures all relevant information about an error occurrence.
 */
export interface ErrorEvent {
  /** Unique identifier (nanoid or uuid) */
  id: string;
  /** Server that experienced the error */
  serverId: string;
  /** Circuit identifier: serverId:model combination */
  circuitId: string;
  /** Classified error type */
  errorType: ErrorType;
  /** Raw error message */
  errorMessage: string;
  /** ISO timestamp when error occurred */
  timestamp: string;
  /** Whether this error is retryable */
  retryable: boolean;
  /** Error category from classification */
  category: ErrorCategory;
  /** Error severity level */
  severity: ErrorSeverity;
  /** Which pattern matched during classification (if any) */
  matchedPattern: string | null;
}

/**
 * Query filters for retrieving error events.
 * All filters are optional - omitted fields match all.
 */
export interface ErrorQueryFilters {
  /** Filter by specific server */
  serverId?: string;
  /** Filter by specific circuit (serverId:model) */
  circuitId?: string;
  /** Filter events after this time (ISO timestamp) */
  startTime?: string;
  /** Filter events before this time (ISO timestamp) */
  endTime?: string;
  /** Filter by error type */
  errorType?: ErrorType;
  /** Maximum number of results (default: 100) */
  limit?: number;
}