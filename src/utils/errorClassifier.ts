/**
 * errorClassifier.ts
 * Centralized error classification for consistent handling across the system
 */

/**
 * Error classification types
 */
export type ErrorType = 'retryable' | 'non-retryable' | 'transient' | 'permanent' | 'rateLimited';

/**
 * Enhanced error categories for more detailed classification
 */
export enum ErrorCategory {
  RESOURCE = 'resource', // Memory, disk, CPU
  COMPATIBILITY = 'compatibility', // Model/endpoint mismatch
  NETWORK = 'network', // Connection, timeout
  AUTHENTICATION = 'auth', // Credentials, permissions
  CONFIGURATION = 'config', // Setup, parameters
  UNKNOWN = 'unknown',
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  LOW = 'low', // Retry immediately
  MEDIUM = 'medium', // Backoff retry
  HIGH = 'high', // Extended backoff
  CRITICAL = 'critical', // Permanent failure
}

/**
 * Retry strategy configuration
 */
export interface RetryStrategy {
  initialDelay: number;
  backoffMultiplier: number;
  maxAttempts: number;
  testType: 'lightweight' | 'full' | 'resource-aware';
  successThreshold: number; // Consecutive successes needed
}

/**
 * Detailed error classification result
 */
export interface ErrorClassification {
  type: ErrorType;
  isRetryable: boolean;
  isTransient: boolean;
  isPermanent: boolean;
  shouldCircuitBreak: boolean;
  category: ErrorCategory;
  severity: ErrorSeverity;
  retryStrategy: RetryStrategy;
  matchedPattern?: string;
}

/**
 * Configurable error patterns for classification
 */
export interface ErrorPatternConfig {
  // Non-retryable errors - permanent failures, don't retry
  nonRetryable: string[];
  // Transient errors - temporary issues, safe to retry
  transient: string[];
  // Network errors - connection issues, usually retryable
  network: string[];
  // Resource errors - server resource issues, may retry after delay
  resource: string[];
  // Ignore errors - these should not trigger circuit breakers (e.g., wrong model type)
  ignore: string[];
}

/**
 * Default error patterns
 */
export const DEFAULT_ERROR_PATTERNS: ErrorPatternConfig = {
  nonRetryable: [
    // Client errors - user/request issues
    'not found',
    'invalid',
    'unauthorized',
    'forbidden',
    'authentication failed',
    'bad request',
    'validation failed',
    'malformed',
    // Model/capability errors
    'model.*not found',
    'invalid model',
    'model not supported',
    'unknown model',
    'not enough ram',
    'out of memory',
    'oom',
    'requires more system memory',
    'not enough memory',
    'insufficient memory',
    'memory limit exceeded',
    // Fatal server errors
    'runner process has terminated',
    'fatal model server error',
    'internal server error',
    'llama runner',
    'runner process',
    'process has terminated',
  ],
  transient: [
    // Timeout errors
    'timeout',
    'timed out',
    'deadline exceeded',
    // Availability errors
    'temporarily unavailable',
    'service unavailable',
    'try again',
    // Rate limiting
    'rate limit',
    'too many requests',
    'throttled',
    // Gateway errors
    'gateway timeout',
    'bad gateway',
  ],
  network: [
    // Connection errors
    'econnrefused',
    'econnreset',
    'etimedout',
    'enotfound',
    'ehostunreach',
    'enetunreach',
    'epipe',
    // Generic network
    'network',
    'connection',
    'socket',
    'dns',
    'unreachable',
    'abort',
    'fetch failed',
  ],
  resource: [
    // Server overload
    'busy',
    'overloaded',
    'capacity',
    'queue full',
    // Memory/GPU issues that might resolve
    'no available slots',
    'all slots busy',
    'gpu memory',
    'vram',
  ],
  ignore: [
    // Embedding/wrong model type errors - these shouldn't open circuit breakers
    'does not support generate',
    'embedding model.*not support',
    'cannot generate.*embedding',
    'embed.*model.*only',
    'this model only supports embeddings',
    'unsupported model format',
  ],
};

/**
 * Default retry strategies by error category
 */
const DEFAULT_RETRY_STRATEGIES: Record<ErrorCategory, RetryStrategy> = {
  [ErrorCategory.RESOURCE]: {
    initialDelay: 300000, // 5 minutes
    backoffMultiplier: 2,
    maxAttempts: 3,
    testType: 'resource-aware',
    successThreshold: 3,
  },
  [ErrorCategory.NETWORK]: {
    initialDelay: 30000, // 30 seconds
    backoffMultiplier: 1.5,
    maxAttempts: 5,
    testType: 'lightweight',
    successThreshold: 1,
  },
  [ErrorCategory.COMPATIBILITY]: {
    initialDelay: 60000, // 1 minute
    backoffMultiplier: 1.2,
    maxAttempts: 2,
    testType: 'full',
    successThreshold: 1,
  },
  [ErrorCategory.AUTHENTICATION]: {
    initialDelay: 120000, // 2 minutes
    backoffMultiplier: 1.5,
    maxAttempts: 3,
    testType: 'lightweight',
    successThreshold: 1,
  },
  [ErrorCategory.CONFIGURATION]: {
    initialDelay: 60000, // 1 minute
    backoffMultiplier: 1.2,
    maxAttempts: 1,
    testType: 'full',
    successThreshold: 1,
  },
  [ErrorCategory.UNKNOWN]: {
    initialDelay: 60000, // 1 minute
    backoffMultiplier: 1.5,
    maxAttempts: 3,
    testType: 'lightweight',
    successThreshold: 1,
  },
};

/**
 * HTTP status code ranges
 */
const HTTP_STATUS_PATTERNS = {
  clientError: /^4\d{2}$|http 4\d{2}/i,
  serverError: /^5\d{2}$|http 5\d{2}/i,
  retryableServerErrors: [502, 503, 504], // Bad Gateway, Service Unavailable, Gateway Timeout
  nonRetryableClientErrors: [400, 401, 403, 404, 405, 406, 410, 422], // Permanent client errors
};

/**
 * Error Classifier - Centralizes error classification logic
 */
export class ErrorClassifier {
  private patterns: ErrorPatternConfig;
  private compiledPatterns: {
    nonRetryable: RegExp[];
    transient: RegExp[];
    network: RegExp[];
    resource: RegExp[];
    ignore: RegExp[];
  };

  constructor(patterns: Partial<ErrorPatternConfig> = {}) {
    this.patterns = {
      nonRetryable: [...DEFAULT_ERROR_PATTERNS.nonRetryable, ...(patterns.nonRetryable ?? [])],
      transient: [...DEFAULT_ERROR_PATTERNS.transient, ...(patterns.transient ?? [])],
      network: [...DEFAULT_ERROR_PATTERNS.network, ...(patterns.network ?? [])],
      resource: [...DEFAULT_ERROR_PATTERNS.resource, ...(patterns.resource ?? [])],
      ignore: [...DEFAULT_ERROR_PATTERNS.ignore, ...(patterns.ignore ?? [])],
    };

    // Compile patterns for performance
    this.compiledPatterns = {
      nonRetryable: this.patterns.nonRetryable.map(p => new RegExp(p, 'i')),
      transient: this.patterns.transient.map(p => new RegExp(p, 'i')),
      network: this.patterns.network.map(p => new RegExp(p, 'i')),
      resource: this.patterns.resource.map(p => new RegExp(p, 'i')),
      ignore: this.patterns.ignore.map(p => new RegExp(p, 'i')),
    };
  }

  /**
   * Classify an error and return detailed classification
   */
  classify(error: Error | string): ErrorClassification {
    const errorMessage = typeof error === 'string' ? error : error.message;
    const errorLower = errorMessage.toLowerCase();

    // Check for ignore patterns first - these shouldn't trigger circuit breakers
    for (let i = 0; i < this.compiledPatterns.ignore.length; i++) {
      if (this.compiledPatterns.ignore[i].test(errorLower)) {
        return {
          type: 'non-retryable',
          isRetryable: false,
          isTransient: false,
          isPermanent: true,
          shouldCircuitBreak: false, // Don't open circuit for wrong model type
          category: ErrorCategory.COMPATIBILITY,
          severity: ErrorSeverity.LOW,
          retryStrategy: DEFAULT_RETRY_STRATEGIES[ErrorCategory.COMPATIBILITY],
          matchedPattern: this.patterns.ignore[i],
        };
      }
    }

    // Check for non-retryable patterns
    for (let i = 0; i < this.compiledPatterns.nonRetryable.length; i++) {
      if (this.compiledPatterns.nonRetryable[i].test(errorLower)) {
        const category = this.determineCategoryFromPattern(
          'nonRetryable',
          this.patterns.nonRetryable[i]
        );
        return {
          type: 'non-retryable',
          isRetryable: false,
          isTransient: false,
          isPermanent: true,
          shouldCircuitBreak: true,
          category,
          severity: ErrorSeverity.CRITICAL,
          retryStrategy: DEFAULT_RETRY_STRATEGIES[category],
          matchedPattern: this.patterns.nonRetryable[i],
        };
      }
    }

    // Check for rate limit patterns first (before general transient)
    const rateLimitPatterns = ['rate limit', 'too many requests', 'throttled', '429'];
    for (const pattern of rateLimitPatterns) {
      if (errorLower.includes(pattern)) {
        return {
          type: 'rateLimited',
          isRetryable: true,
          isTransient: true,
          isPermanent: false,
          shouldCircuitBreak: true, // Rate limits should open circuit to stop traffic
          category: ErrorCategory.NETWORK,
          severity: ErrorSeverity.MEDIUM,
          retryStrategy: {
            initialDelay: 300000, // 5 minutes
            backoffMultiplier: 3,
            maxAttempts: 5,
            testType: 'lightweight',
            successThreshold: 1,
          },
          matchedPattern: pattern,
        };
      }
    }

    // Check for transient patterns
    for (let i = 0; i < this.compiledPatterns.transient.length; i++) {
      if (this.compiledPatterns.transient[i].test(errorLower)) {
        return {
          type: 'transient',
          isRetryable: true,
          isTransient: true,
          isPermanent: false,
          shouldCircuitBreak: false, // Transient errors shouldn't trigger circuit breaker
          category: ErrorCategory.NETWORK,
          severity: ErrorSeverity.MEDIUM,
          retryStrategy: DEFAULT_RETRY_STRATEGIES[ErrorCategory.NETWORK],
          matchedPattern: this.patterns.transient[i],
        };
      }
    }

    // Check for network patterns
    for (let i = 0; i < this.compiledPatterns.network.length; i++) {
      if (this.compiledPatterns.network[i].test(errorLower)) {
        return {
          type: 'transient',
          isRetryable: true,
          isTransient: true,
          isPermanent: false,
          shouldCircuitBreak: false,
          category: ErrorCategory.NETWORK,
          severity: ErrorSeverity.MEDIUM,
          retryStrategy: DEFAULT_RETRY_STRATEGIES[ErrorCategory.NETWORK],
          matchedPattern: this.patterns.network[i],
        };
      }
    }

    // Check for resource patterns
    for (let i = 0; i < this.compiledPatterns.resource.length; i++) {
      if (this.compiledPatterns.resource[i].test(errorLower)) {
        return {
          type: 'retryable',
          isRetryable: true,
          isTransient: false,
          isPermanent: false,
          shouldCircuitBreak: false,
          category: ErrorCategory.RESOURCE,
          severity: ErrorSeverity.HIGH,
          retryStrategy: DEFAULT_RETRY_STRATEGIES[ErrorCategory.RESOURCE],
          matchedPattern: this.patterns.resource[i],
        };
      }
    }

    // Check HTTP status codes
    const httpClassification = this.classifyHttpStatus(errorMessage);
    if (httpClassification) {
      return httpClassification;
    }

    // Default: treat unknown errors as retryable but potentially circuit-breaking
    return {
      type: 'retryable',
      isRetryable: true,
      isTransient: false,
      isPermanent: false,
      shouldCircuitBreak: true, // Unknown errors should still count towards circuit breaker
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.HIGH,
      retryStrategy: DEFAULT_RETRY_STRATEGIES[ErrorCategory.UNKNOWN],
    };
  }

  /**
   * Determine error category from pattern and pattern type
   */
  private determineCategoryFromPattern(
    patternType: keyof ErrorPatternConfig,
    pattern: string
  ): ErrorCategory {
    // For nonRetryable patterns, determine category based on content
    if (patternType === 'nonRetryable') {
      const lowerPattern = pattern.toLowerCase();
      if (
        lowerPattern.includes('ram') ||
        lowerPattern.includes('memory') ||
        lowerPattern.includes('out of memory')
      ) {
        return ErrorCategory.RESOURCE;
      }
      if (
        lowerPattern.includes('auth') ||
        lowerPattern.includes('unauthorized') ||
        lowerPattern.includes('forbidden')
      ) {
        return ErrorCategory.AUTHENTICATION;
      }
      if (
        lowerPattern.includes('model') &&
        (lowerPattern.includes('not found') || lowerPattern.includes('not supported'))
      ) {
        return ErrorCategory.CONFIGURATION;
      }
    }
    return ErrorCategory.UNKNOWN;
  }

  /**
   * Classify based on HTTP status code if present in error message
   */
  private classifyHttpStatus(errorMessage: string): ErrorClassification | null {
    // Extract status code if present
    const statusMatch = errorMessage.match(/\b([45]\d{2})\b/);
    if (!statusMatch) {
      return null;
    }

    const statusCode = parseInt(statusMatch[1], 10);

    // Check if it's a retryable server error
    if (HTTP_STATUS_PATTERNS.retryableServerErrors.includes(statusCode)) {
      return {
        type: 'transient',
        isRetryable: true,
        isTransient: true,
        isPermanent: false,
        shouldCircuitBreak: false,
        category: ErrorCategory.NETWORK,
        severity: ErrorSeverity.MEDIUM,
        retryStrategy: DEFAULT_RETRY_STRATEGIES[ErrorCategory.NETWORK],
        matchedPattern: `HTTP ${statusCode}`,
      };
    }

    // Check if it's a non-retryable client error
    if (HTTP_STATUS_PATTERNS.nonRetryableClientErrors.includes(statusCode)) {
      return {
        type: 'non-retryable',
        isRetryable: false,
        isTransient: false,
        isPermanent: true,
        shouldCircuitBreak: true,
        category: ErrorCategory.CONFIGURATION,
        severity: ErrorSeverity.CRITICAL,
        retryStrategy: DEFAULT_RETRY_STRATEGIES[ErrorCategory.CONFIGURATION],
        matchedPattern: `HTTP ${statusCode}`,
      };
    }

    // Other 5xx errors - retryable but circuit-breaking
    if (statusCode >= 500) {
      return {
        type: 'retryable',
        isRetryable: true,
        isTransient: false,
        isPermanent: false,
        shouldCircuitBreak: true,
        category: ErrorCategory.UNKNOWN,
        severity: ErrorSeverity.HIGH,
        retryStrategy: DEFAULT_RETRY_STRATEGIES[ErrorCategory.UNKNOWN],
        matchedPattern: `HTTP ${statusCode}`,
      };
    }

    // Other 4xx errors - non-retryable
    if (statusCode >= 400) {
      return {
        type: 'non-retryable',
        isRetryable: false,
        isTransient: false,
        isPermanent: true,
        shouldCircuitBreak: true,
        category: ErrorCategory.CONFIGURATION,
        severity: ErrorSeverity.CRITICAL,
        retryStrategy: DEFAULT_RETRY_STRATEGIES[ErrorCategory.CONFIGURATION],
        matchedPattern: `HTTP ${statusCode}`,
      };
    }

    return null;
  }

  /**
   * Simple check if error is retryable
   */
  isRetryable(error: Error | string): boolean {
    return this.classify(error).isRetryable;
  }

  /**
   * Simple check if error is transient
   */
  isTransient(error: Error | string): boolean {
    return this.classify(error).isTransient;
  }

  /**
   * Simple check if error should trigger circuit breaker
   */
  shouldCircuitBreak(error: Error | string): boolean {
    return this.classify(error).shouldCircuitBreak;
  }

  /**
   * Get the error type for circuit breaker recording
   */
  getErrorType(error: Error | string): ErrorType {
    return this.classify(error).type;
  }

  /**
   * Update patterns at runtime
   */
  updatePatterns(patterns: Partial<ErrorPatternConfig>): void {
    if (patterns.nonRetryable) {
      this.patterns.nonRetryable = [...this.patterns.nonRetryable, ...patterns.nonRetryable];
      this.compiledPatterns.nonRetryable = this.patterns.nonRetryable.map(p => new RegExp(p, 'i'));
    }
    if (patterns.transient) {
      this.patterns.transient = [...this.patterns.transient, ...patterns.transient];
      this.compiledPatterns.transient = this.patterns.transient.map(p => new RegExp(p, 'i'));
    }
    if (patterns.network) {
      this.patterns.network = [...this.patterns.network, ...patterns.network];
      this.compiledPatterns.network = this.patterns.network.map(p => new RegExp(p, 'i'));
    }
    if (patterns.resource) {
      this.patterns.resource = [...this.patterns.resource, ...patterns.resource];
      this.compiledPatterns.resource = this.patterns.resource.map(p => new RegExp(p, 'i'));
    }
    if (patterns.ignore) {
      this.patterns.ignore = [...this.patterns.ignore, ...patterns.ignore];
      this.compiledPatterns.ignore = this.patterns.ignore.map(p => new RegExp(p, 'i'));
    }
  }

  /**
   * Get current patterns
   */
  getPatterns(): ErrorPatternConfig {
    return { ...this.patterns };
  }
}

// Default singleton instance
let defaultClassifier: ErrorClassifier | undefined;

/**
 * Get the default error classifier instance
 */
export function getErrorClassifier(): ErrorClassifier {
  if (!defaultClassifier) {
    defaultClassifier = new ErrorClassifier();
  }
  return defaultClassifier;
}

/**
 * Set a custom default error classifier
 */
export function setErrorClassifier(classifier: ErrorClassifier): void {
  defaultClassifier = classifier;
}

/**
 * Convenience function to classify an error using the default classifier
 */
export function classifyError(error: Error | string): ErrorClassification {
  return getErrorClassifier().classify(error);
}

/**
 * Convenience function to check if error is retryable
 */
export function isRetryableError(error: Error | string): boolean {
  return getErrorClassifier().isRetryable(error);
}

/**
 * Convenience function to check if error is transient
 */
export function isTransientError(error: Error | string): boolean {
  return getErrorClassifier().isTransient(error);
}

/**
 * Convenience function to get error type
 */
export function getErrorType(error: Error | string): ErrorType {
  return getErrorClassifier().getErrorType(error);
}
