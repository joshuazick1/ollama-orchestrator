/**
 * circuit-breaker.ts
 * Enhanced Circuit Breaker with adaptive thresholds and error classification
 */

import { ErrorClassifier, type ErrorType } from './utils/errorClassifier.js';
import { logger } from './utils/logger.js';
import { calculateCircuitBreakerBackoff } from './utils/recovery-backoff.js';

export type CircuitState = 'closed' | 'open' | 'half-open';

// Re-export ErrorType for backwards compatibility
export type { ErrorType } from './utils/errorClassifier.js';

export interface CircuitBreakerError {
  type: ErrorType;
  message: string;
  code?: string;
  timestamp: number;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  totalRequestCount?: number; // Total requests attempted (including blocked) - optional for backward compatibility
  blockedRequestCount?: number; // Requests blocked by open circuit breaker - optional for backward compatibility
  lastFailure: number;
  lastSuccess: number;
  nextRetryAt: number;
  errorRate: number; // 0-1
  errorCounts: Record<ErrorType, number>;
  consecutiveSuccesses: number;
  halfOpenStartedAt: number; // Timestamp when entered half-open state (for persistence)
  lastFailureReason?: string; // Last failure reason when circuit opened
  modelType?: 'embedding' | 'generation'; // Detected model capability
  lastErrorType?: ErrorType; // Last error type for adaptive backoff
  halfOpenAttempts?: number; // Number of recovery attempts
  consecutiveFailedRecoveries?: number; // Consecutive failed recovery attempts
  activeTestsInProgress?: number; // Number of active recovery tests currently running
}

export interface CircuitBreakerConfig {
  // Adaptive thresholds
  baseFailureThreshold: number;
  maxFailureThreshold: number;
  minFailureThreshold: number;

  // Timing
  openTimeout: number; // Time to stay open before trying half-open (ms)
  halfOpenTimeout: number; // Time to stay in half-open before reverting (ms)

  // Recovery settings
  halfOpenMaxRequests: number; // Number of test requests in half-open state
  recoverySuccessThreshold: number; // Consecutive successes needed to close
  activeTestTimeout: number; // Timeout for active tests in half-open state (ms)

  // Error rate calculation
  errorRateWindow: number; // Time window for error rate calculation (ms)
  errorRateThreshold: number; // Error rate (0-1) that triggers open state

  // Adaptive settings
  adaptiveThresholds: boolean; // Enable adaptive threshold adjustment
  errorRateSmoothing: number; // Smoothing factor for error rate (0-1)

  // Configurable error patterns for classification
  errorPatterns: {
    nonRetryable: string[]; // Regex patterns for non-retryable errors
    transient: string[]; // Regex patterns for transient errors
  };

  // Adaptive threshold adjustment amounts
  adaptiveThresholdAdjustment: number; // Amount to adjust threshold by (default: 2)
  nonRetryableRatioThreshold: number; // Ratio above which to lower threshold (default: 0.5)
  transientRatioThreshold: number; // Ratio above which to raise threshold (default: 0.7)

  // Model-to-server breaker escalation settings
  modelEscalation: {
    enabled: boolean; // Enable model breaker escalation to server breaker
    ratioThreshold: number; // Ratio of open model breakers that triggers server breaker (0-1)
    durationThresholdMs: number; // How long a model breaker must be open to trigger server breaker (ms)
    checkIntervalMs: number; // How often to check for escalation conditions (ms)
  };
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  baseFailureThreshold: 3, // Reduced from 5 for faster failure detection
  maxFailureThreshold: 8, // Reduced from 10
  minFailureThreshold: 2, // Reduced from 3
  openTimeout: 120000, // Increased from 30s to 2 minutes for better isolation
  halfOpenTimeout: 300000, // 5 minutes - match activeTestTimeout for adequate test time
  halfOpenMaxRequests: 3, // Reduced from 5 to be more conservative
  recoverySuccessThreshold: 5, // Increased from 3 for more reliable recovery
  activeTestTimeout: 300000, // 5 minutes
  errorRateWindow: 60000, // 1 minute
  errorRateThreshold: 0.3, // Reduced from 50% to 30% for earlier detection
  adaptiveThresholds: true,
  errorRateSmoothing: 0.3,
  errorPatterns: {
    nonRetryable: [
      'not found',
      'invalid',
      'unauthorized',
      'forbidden',
      'authentication failed',
      'bad request',
      'not enough ram',
      'out of memory',
      'runner process has terminated',
      'fatal model server error',
    ],
    transient: [
      'timeout',
      'temporarily unavailable',
      'rate limit',
      'too many requests',
      'service unavailable',
      'gateway timeout',
      'econnrefused',
      'econnreset',
      'etimedout',
    ],
  },
  adaptiveThresholdAdjustment: 2,
  nonRetryableRatioThreshold: 0.5,
  transientRatioThreshold: 0.7,
  modelEscalation: {
    enabled: true,
    ratioThreshold: 0.5, // 50%
    durationThresholdMs: 600000, // 10 minutes
    checkIntervalMs: 300000, // 5 minutes
  },
};

class SlidingWindow {
  private window: Array<{ timestamp: number; success: boolean; errorType?: ErrorType }> = [];
  private windowSize: number;

  constructor(windowSize: number) {
    this.windowSize = windowSize;
  }

  add(success: boolean, errorType?: ErrorType): void {
    const now = Date.now();
    this.window.push({ timestamp: now, success, errorType });
    this.cleanup(now);
  }

  getErrorRate(): number {
    const now = Date.now();
    this.cleanup(now);

    if (this.window.length === 0) {
      return 0;
    }

    const failures = this.window.filter(e => !e.success).length;
    return failures / this.window.length;
  }

  getErrorTypeCounts(): Record<ErrorType, number> {
    const now = Date.now();
    this.cleanup(now);

    const counts: Record<ErrorType, number> = {
      retryable: 0,
      'non-retryable': 0,
      transient: 0,
      permanent: 0,
      rateLimited: 0,
    };

    for (const entry of this.window) {
      if (!entry.success && entry.errorType) {
        counts[entry.errorType]++;
      }
    }

    return counts;
  }

  private cleanup(now: number): void {
    const cutoff = now - this.windowSize;
    this.window = this.window.filter(e => e.timestamp > cutoff);
  }

  clear(): void {
    this.window = [];
  }
}

export class CircuitBreaker {
  private name: string;
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private totalRequestCount = 0; // Total requests attempted (including blocked)
  private blockedRequestCount = 0; // Requests blocked by open circuit breaker
  private lastFailure = 0;
  private lastSuccess = 0;
  private nextRetryAt = 0;
  private halfOpenRequestCount = 0;
  private halfOpenStartedAt = 0; // Timestamp when entered half-open state
  private consecutiveSuccesses = 0;
  private errorRate = 0;
  private activeTestsInProgress = 0; // Track active test requests currently being processed
  private lastFailureReason?: string; // Track the last failure reason when circuit opened
  private modelType?: 'embedding' | 'generation'; // Detected model type
  private lastErrorType?: ErrorType; // Track error type for adaptive backoff
  private halfOpenAttempts = 0; // Track how many times we've tried half-open recovery
  private consecutiveFailedRecoveries = 0; // Track consecutive failed recovery attempts
  private rateLimitConsecutiveFailures = 0; // Track consecutive rate limit failures
  private learnedRateLimitBackoff: number | undefined; // Successfully learned backoff for rate limits

  private window: SlidingWindow;
  private config: CircuitBreakerConfig;
  private onStateChange?: (oldState: CircuitState, newState: CircuitState) => void;
  private errorClassifier: ErrorClassifier;

  constructor(
    name: string,
    config?: Partial<CircuitBreakerConfig>,
    onStateChange?: (oldState: CircuitState, newState: CircuitState) => void
  ) {
    this.name = name;
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
    this.window = new SlidingWindow(this.config.errorRateWindow);
    this.onStateChange = onStateChange;

    // Create error classifier using configured patterns
    this.errorClassifier = new ErrorClassifier({
      nonRetryable: this.config.errorPatterns.nonRetryable,
      transient: this.config.errorPatterns.transient,
    });
  }

  /**
   * Check if request should be allowed through
   */
  canExecute(): boolean {
    const now = Date.now();
    this.totalRequestCount++; // Track all requests attempted

    switch (this.state) {
      case 'closed':
        return true;

      case 'open':
        if (now >= this.nextRetryAt) {
          // Limit recovery attempts - after 3 failed recoveries, extend backoff based on error type
          // Permanent/non-retryable errors get much longer extensions to prevent resource waste
          if (this.consecutiveFailedRecoveries >= 3) {
            let baseTimeout = this.config.openTimeout;
            if (this.lastErrorType === 'permanent' || this.lastErrorType === 'non-retryable') {
              baseTimeout = Math.max(baseTimeout, 3600000); // At least 1 hour for permanent errors
            }

            const backoffMultiplier = Math.min(
              this.lastErrorType === 'permanent' || this.lastErrorType === 'non-retryable' ? 5 : 10,
              Math.pow(2, this.consecutiveFailedRecoveries - 3)
            );
            const extendedTimeout = baseTimeout * backoffMultiplier;
            this.nextRetryAt = now + extendedTimeout;

            // If we've failed 5+ times with zero successes, log warning
            if (this.consecutiveFailedRecoveries >= 5 && this.successCount === 0) {
              logger.warn(
                `Circuit breaker ${this.name} has failed ${this.consecutiveFailedRecoveries} recovery attempts with 0% success rate. Extending timeout to ${extendedTimeout}ms.`,
                {
                  halfOpenAttempts: this.halfOpenAttempts,
                  consecutiveFailedRecoveries: this.consecutiveFailedRecoveries,
                  successCount: this.successCount,
                  extendedTimeout,
                }
              );
            }

            // Don't transition to half-open if we've had too many failures
            // This prevents the flapping behavior
            if (this.consecutiveFailedRecoveries >= 5) {
              this.blockedRequestCount++; // Track blocked request
              return false;
            }
          }

          this.halfOpenAttempts++;
          this.transitionTo('half-open');
          this.halfOpenRequestCount = 0;
          return true;
        }
        this.blockedRequestCount++; // Track blocked request when circuit is open
        return false;

      case 'half-open': {
        // In half-open state, do not allow direct requests
        // Recovery testing should be handled separately by calling performRecoveryTest()
        this.blockedRequestCount++; // Track blocked request when circuit is half-open
        return false;
      }

      default:
        this.blockedRequestCount++; // Track blocked request for unknown states
        return false;
    }
  }

  /**
   * Record a successful execution
   */
  recordSuccess(): void {
    const now = Date.now();
    this.window.add(true);
    this.successCount++;
    this.lastSuccess = now;
    this.consecutiveSuccesses++;

    // Decrement active tests counter for half-open state
    if (this.state === 'half-open' && this.activeTestsInProgress > 0) {
      this.activeTestsInProgress--;
    }

    this.updateErrorRate();

    if (this.state === 'half-open') {
      const remainingForRecovery = this.config.recoverySuccessThreshold - this.consecutiveSuccesses;
      logger.info(
        `Circuit breaker ${this.name}: ${this.consecutiveSuccesses}/${this.config.recoverySuccessThreshold} successful tests (${remainingForRecovery} more required for recovery)`,
        {
          consecutiveSuccesses: this.consecutiveSuccesses,
          recoverySuccessThreshold: this.config.recoverySuccessThreshold,
          remainingForRecovery,
        }
      );

      if (this.consecutiveSuccesses >= this.config.recoverySuccessThreshold) {
        const successes = this.consecutiveSuccesses; // Capture before reset
        this.transitionTo('closed');
        this.failureCount = 0;
        this.consecutiveSuccesses = 0;
        this.halfOpenRequestCount = 0;
        this.activeTestsInProgress = 0;
        this.consecutiveFailedRecoveries = 0; // Reset failed recovery counter on success

        // If we recovered from a rate limit, record the learned backoff for future use
        if (this.lastErrorType === 'rateLimited' && this.rateLimitConsecutiveFailures > 0) {
          const backoffUsed = this.getRateLimitBackoff();
          this.learnedRateLimitBackoff = backoffUsed;
          logger.info(
            `Circuit breaker ${this.name} recovered from rate limit. Learned backoff: ${backoffUsed}ms`,
            {
              learnedBackoff: backoffUsed,
              consecutiveFailures: this.rateLimitConsecutiveFailures,
            }
          );
        }

        // Reset rate limit failure counter on successful recovery
        if (this.rateLimitConsecutiveFailures > 0) {
          this.rateLimitConsecutiveFailures = 0;
        }

        // Note: Don't clear the window - let time-based eviction handle it
        logger.info(`Circuit breaker ${this.name} closed after ${successes} consecutive successes`);
      }
    } else if (this.state === 'closed') {
      // Reset failure count on success in closed state
      if (this.failureCount > 0) {
        this.failureCount = 0;
      }
    }
  }

  /**
   * Record a failed execution with error classification
   */
  recordFailure(error: Error | string, errorType?: ErrorType): void {
    const now = Date.now();

    // Always record the error in the sliding window for statistics
    const classifiedType = errorType ?? this.classifyError(error);
    this.window.add(false, classifiedType);

    this.failureCount++;
    this.lastFailure = now;
    this.consecutiveSuccesses = 0;

    this.updateErrorRate();

    // Check if this error type should count toward circuit breaking decisions
    const classification = this.errorClassifier.classify(error);
    if (!classification.shouldCircuitBreak) {
      // Log but don't trigger circuit breaker state changes
      // This includes embedding model errors, transient errors, etc.
      logger.debug('Error recorded but not counted toward circuit breaker state', {
        serverId: this.name.split(':')[0],
        model: this.name.split(':').slice(1).join(':') || '',
        errorType: classification.type,
        shouldCircuitBreak: classification.shouldCircuitBreak,
      });

      // Still track the failure reason for informational purposes
      this.lastFailureReason = error instanceof Error ? error.message : String(error);
      this.lastErrorType = classifiedType;

      // Track rate limit failures for adaptive backoff
      if (classifiedType === 'rateLimited') {
        this.rateLimitConsecutiveFailures++;
      }

      return;
    }

    // Track rate limit failures for adaptive backoff (even when circuit breaking)
    if (classifiedType === 'rateLimited') {
      this.rateLimitConsecutiveFailures++;
    }

    if (this.state === 'half-open') {
      // Decrement active tests counter before transitioning
      if (this.activeTestsInProgress > 0) {
        this.activeTestsInProgress--;
      }
      // Store failure reason and type before transitioning
      this.lastFailureReason = error instanceof Error ? error.message : String(error);
      this.lastErrorType = classifiedType;
      // Track failed recovery attempt
      this.consecutiveFailedRecoveries++;
      // Any circuit-breaking failure in half-open immediately opens the circuit
      logger.warn(
        `Circuit breaker ${this.name} half-open failure - transitioning to open. Error: ${error instanceof Error ? error.message : String(error)}, Type: ${classifiedType}, Consecutive: ${this.consecutiveFailedRecoveries}`,
        {
          state: this.state,
          lastFailureReason: this.lastFailureReason,
          lastErrorType: this.lastErrorType,
          consecutiveFailedRecoveries: this.consecutiveFailedRecoveries,
          halfOpenStartedAt: this.halfOpenStartedAt,
          timeInHalfOpen: Date.now() - (this.halfOpenStartedAt || Date.now()),
        }
      );
      this.transitionTo('open');
      // Apply error-type-specific backoff (48h for non-retryable, 24h for permanent, etc.)
      this.nextRetryAt = now + this.getBackoffForErrorType(classifiedType);
      logger.warn(
        `Circuit breaker opened due to failure in half-open state (recovery attempt ${this.consecutiveFailedRecoveries} failed)`,
        {
          failureReason: this.lastFailureReason,
          errorType: this.lastErrorType,
          consecutiveFailedRecoveries: this.consecutiveFailedRecoveries,
          nextRetryAt: this.nextRetryAt,
        }
      );
    } else if (this.state === 'closed') {
      const currentThreshold = this.getAdaptiveThreshold();

      if (
        this.failureCount >= currentThreshold ||
        this.errorRate > this.config.errorRateThreshold
      ) {
        // Store failure reason and type before transitioning
        this.lastFailureReason = error instanceof Error ? error.message : String(error);
        this.lastErrorType = classifiedType;
        this.transitionTo('open');
        this.nextRetryAt = now + this.getBackoffForErrorType(classifiedType);
        logger.warn(
          `Circuit breaker opened: ${this.failureCount} failures, ${(this.errorRate * 100).toFixed(1)}% error rate`,
          {
            failureReason: this.lastFailureReason,
            errorType: this.lastErrorType,
          }
        );
      }
    }
  }

  /**
   * Classify an error into retryable or non-retryable using centralized classifier
   */
  classifyError(error: Error | string): ErrorType {
    return this.errorClassifier.getErrorType(error);
  }

  /**
   * Get current statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      totalRequestCount: this.totalRequestCount,
      blockedRequestCount: this.blockedRequestCount,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
      nextRetryAt: this.nextRetryAt,
      errorRate: this.errorRate,
      errorCounts: this.window.getErrorTypeCounts(),
      consecutiveSuccesses: this.consecutiveSuccesses,
      halfOpenStartedAt: this.halfOpenStartedAt,
      lastFailureReason: this.lastFailureReason,
      modelType: this.modelType,
      lastErrorType: this.lastErrorType,
      halfOpenAttempts: this.halfOpenAttempts,
      consecutiveFailedRecoveries: this.consecutiveFailedRecoveries,
      activeTestsInProgress: this.activeTestsInProgress,
    };
  }

  /**
   * Get the last failure reason when circuit opened
   */
  getLastFailureReason(): string | undefined {
    return this.lastFailureReason;
  }

  /**
   * Get the detected model type (embedding or generation)
   * If not set, attempts to infer from model name patterns
   */
  getModelType(): 'embedding' | 'generation' | undefined {
    if (this.modelType) {
      return this.modelType;
    }

    // If model type not set, try to infer from model name patterns
    // This serves as a fallback when active testing hasn't run yet
    const modelName = this.name.split(':').slice(1).join(':');
    if (modelName) {
      const inferredType = this.inferModelTypeFromName(modelName);
      if (inferredType) {
        this.modelType = inferredType;
        logger.debug(`Model type inferred from name '${modelName}': ${inferredType}`);
      }
    }

    return this.modelType;
  }

  /**
   * Set the detected model type
   */
  setModelType(type: 'embedding' | 'generation'): void {
    this.modelType = type;
    logger.debug(`Model type set to ${type} for ${this.name}`);
  }

  /**
   * Infer model type from model name patterns
   * This is used as a fallback when active testing hasn't determined the type yet
   */
  private inferModelTypeFromName(modelName: string): 'embedding' | 'generation' | undefined {
    const lowerName = modelName.toLowerCase();

    // Common embedding model patterns
    const embeddingPatterns = [
      'embed',
      'embedding',
      'sentence',
      'text2vec',
      'bge',
      'gte',
      'stella',
      'nomic-embed',
      'text-embedding',
      'all-mpnet',
      'all-minilm',
      'paraphrase-multilingual',
      'msmarco',
      'e5-',
      'uae-',
      'gtr-',
      'sentence-t5',
      'pygmalion', // Chat/roleplay model that doesn't support /api/generate
    ];

    // Check for embedding patterns in model name
    for (const pattern of embeddingPatterns) {
      if (lowerName.includes(pattern)) {
        return 'embedding';
      }
    }

    // Common generation model patterns (most models are generation by default)
    // If it doesn't match embedding patterns, assume it's generation
    // This is a safe default since most Ollama models are text generation models
    return 'generation';
  }

  /**
   * Get the last error type for adaptive backoff
   */
  getLastErrorType(): ErrorType | undefined {
    return this.lastErrorType;
  }

  /**
   * Start an active test - increments the in-progress counter
   * This prevents half-open timeout from triggering during active tests
   */
  startActiveTest(): void {
    this.activeTestsInProgress++;
    logger.debug(
      `Active test started for ${this.name}, in progress: ${this.activeTestsInProgress}`
    );
  }

  /**
   * End an active test - decrements the in-progress counter
   */
  endActiveTest(): void {
    if (this.activeTestsInProgress > 0) {
      this.activeTestsInProgress--;
    }
    logger.debug(`Active test ended for ${this.name}, in progress: ${this.activeTestsInProgress}`);
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Force open the circuit breaker
   * Applies extended backoff for non-retryable/permanent errors to prevent
   * rapid retry cycles when the underlying issue requires external intervention
   */
  forceOpen(): void {
    if (this.state !== 'open') {
      this.transitionTo('open');

      // Apply extended backoff for non-retryable/permanent errors
      // This ensures 401 auth errors and similar issues get proper 48-hour backoff
      // even when transitioning from half-open back to open due to timeout
      let backoffTimeout = this.config.openTimeout;
      if (this.lastErrorType === 'non-retryable') {
        backoffTimeout = 172800000; // 48 hours
      } else if (this.lastErrorType === 'permanent') {
        backoffTimeout = 86400000; // 24 hours
      } else if (this.lastErrorType === 'retryable') {
        backoffTimeout = 43200000; // 12 hours
      }

      this.nextRetryAt = Date.now() + backoffTimeout;
    }
  }

  /**
   * Force close the circuit breaker
   */
  forceClose(): void {
    if (this.state !== 'closed') {
      this.transitionTo('closed');
      this.failureCount = 0;
      this.consecutiveSuccesses = 0;
      this.halfOpenRequestCount = 0;
      this.window.clear();
    }
  }

  /**
   * Force half-open the circuit breaker (for testing/admin purposes)
   */
  forceHalfOpen(): void {
    if (this.state !== 'half-open') {
      this.transitionTo('half-open');
      this.halfOpenRequestCount = 0;
    }
  }

  /**
   * Restore circuit breaker state from persistence
   * Used during startup to recover previous state
   */
  restoreState(stats: CircuitBreakerStats): void {
    // Restore model type first - it's always valuable regardless of state
    if (stats.modelType) {
      this.modelType = stats.modelType;
    }

    // Only restore circuit state if persisted state is more severe or has data
    if (stats.failureCount > 0 || stats.state !== 'closed') {
      this.state = stats.state;
      this.failureCount = stats.failureCount;
      this.successCount = stats.successCount;
      this.totalRequestCount = stats.totalRequestCount || 0;
      this.blockedRequestCount = stats.blockedRequestCount || 0;
      this.lastFailure = stats.lastFailure;
      this.lastSuccess = stats.lastSuccess;
      this.nextRetryAt = stats.nextRetryAt;
      this.consecutiveSuccesses = stats.consecutiveSuccesses;
      this.halfOpenRequestCount = 0; // Always reset counters on restore
      this.activeTestsInProgress = 0; // Always reset counters on restore

      // Restore half-open timestamp - validate it to prevent immediate timeout
      if (stats.halfOpenStartedAt && stats.halfOpenStartedAt > 0) {
        this.halfOpenStartedAt = stats.halfOpenStartedAt;
      } else if (this.state === 'half-open') {
        // If entering half-open without a timestamp, set it to now
        this.halfOpenStartedAt = Date.now();
      }

      // Restore last failure reason
      if (stats.lastFailureReason) {
        this.lastFailureReason = stats.lastFailureReason;
      }

      // Restore last error type
      if (stats.lastErrorType) {
        this.lastErrorType = stats.lastErrorType;
      }

      // Recalculate error rate based on restored counts
      const total = this.failureCount + this.successCount;
      this.errorRate = total > 0 ? this.failureCount / total : 0;

      // If circuit was open but nextRetryAt has passed, transition to half-open
      if (this.state === 'open' && Date.now() >= this.nextRetryAt) {
        this.transitionTo('half-open');
      }

      // If circuit was half-open but halfOpenTimeout has passed, transition back to open
      if (this.state === 'half-open' && this.config.halfOpenTimeout > 0) {
        // We'll let the next canExecute() handle this
      }

      logger.info(`Restored circuit breaker state for ${this.name}`, {
        state: this.state,
        failureCount: this.failureCount,
        successCount: this.successCount,
        errorRate: this.errorRate.toFixed(3),
        halfOpenStartedAt: this.halfOpenStartedAt,
      });
    }
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(config: Partial<CircuitBreakerConfig>): void {
    this.config = { ...this.config, ...config };

    // Recreate window if window size changed
    if (config.errorRateWindow) {
      // Recreate window if window size changed - old window discarded
      this.window = new SlidingWindow(config.errorRateWindow);
      // Copy recent entries if needed
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): CircuitBreakerConfig {
    return { ...this.config };
  }

  /**
   * Calculate backoff timeout based on error type
   * Uses unified backoff from recovery-backoff.ts
   */
  private getBackoffForErrorType(errorType: ErrorType): number {
    return calculateCircuitBreakerBackoff(errorType, undefined, this.consecutiveFailedRecoveries);
  }

  /**
   * Calculate adaptive backoff for rate limit errors
   * Uses learned backoff if available, otherwise exponential from 5min base
   */
  private getRateLimitBackoff(): number {
    const baseBackoff = 300000; // 5 minutes
    const maxBackoff = 3600000; // 60 minutes
    const multiplier = 3;

    // If we have a learned backoff that worked before, use it
    if (this.learnedRateLimitBackoff && this.rateLimitConsecutiveFailures === 0) {
      return this.learnedRateLimitBackoff;
    }

    // Calculate backoff based on consecutive failures
    // Each failure increases the backoff: 5min, 15min, 45min, 60min (capped)
    const backoff = Math.min(
      baseBackoff * Math.pow(multiplier, this.rateLimitConsecutiveFailures),
      maxBackoff
    );

    return backoff;
  }

  /**
   * Get active test timeout for half-open state
   */
  getActiveTestTimeout(): number {
    return this.config.activeTestTimeout;
  }

  /**
   * Perform recovery test for half-open state
   * Returns true if recovery test passed (circuit should close), false if failed
   *
   * NOTE: This method now delegates to RecoveryTestCoordinator for proper server-level
   * coordination. Direct calls to this method are supported but the coordinator provides
   * better management of server resources and test queuing.
   */
  async performRecoveryTest(): Promise<boolean> {
    if (this.state !== 'half-open') {
      logger.warn(`Attempted recovery test on circuit ${this.name} in ${this.state} state`);
      return false;
    }

    try {
      // Import and use the RecoveryTestCoordinator for coordinated testing
      const { getRecoveryTestCoordinator } = await import('./recovery-test-coordinator.js');
      const coordinator = getRecoveryTestCoordinator();

      // The coordinator handles:
      // - Server-level breakers: lightweight /api/tags tests
      // - Model-level breakers: full inference tests with server coordination
      // - Server cooldown periods between tests
      // - In-flight request checking
      // - One model test per server at a time
      return await coordinator.performCoordinatedRecoveryTest(this);
    } catch (error) {
      logger.error(`Recovery test error for ${this.name}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Manually trigger an active recovery test (for debugging/testing)
   * Returns true if test passed (circuit should close), false if failed
   */
  async manualRecoveryTest(): Promise<boolean> {
    if (this.state !== 'half-open') {
      logger.warn(
        `Manual recovery test attempted on circuit ${this.name} in ${this.state} state - only works in half-open`
      );
      return false;
    }

    logger.info(`Manual recovery test triggered for circuit breaker ${this.name}`, {
      state: this.state,
      lastFailureReason: this.lastFailureReason,
      consecutiveFailedRecoveries: this.consecutiveFailedRecoveries,
    });

    return this.performRecoveryTest();
  }

  /**
   * Calculate adaptive threshold based on error patterns
   */
  private getAdaptiveThreshold(): number {
    if (!this.config.adaptiveThresholds) {
      return this.config.baseFailureThreshold;
    }

    const errorCounts = this.window.getErrorTypeCounts();
    const totalErrors = Object.values(errorCounts).reduce((a, b) => a + b, 0);

    if (totalErrors === 0) {
      return this.config.baseFailureThreshold;
    }

    // If mostly non-retryable errors, use lower threshold
    const nonRetryableRatio =
      (errorCounts['non-retryable'] + errorCounts['permanent']) / totalErrors;

    if (nonRetryableRatio > this.config.nonRetryableRatioThreshold) {
      // More permanent failures = lower threshold (faster circuit opening)
      return Math.max(
        this.config.minFailureThreshold,
        this.config.baseFailureThreshold - this.config.adaptiveThresholdAdjustment
      );
    }

    // If mostly transient errors, use higher threshold
    const transientRatio = (errorCounts['transient'] + errorCounts['retryable']) / totalErrors;

    if (transientRatio > this.config.transientRatioThreshold) {
      // More transient failures = higher threshold (more tolerant)
      return Math.min(
        this.config.maxFailureThreshold,
        this.config.baseFailureThreshold + this.config.adaptiveThresholdAdjustment
      );
    }

    return this.config.baseFailureThreshold;
  }

  /**
   * Update error rate with smoothing
   */
  private updateErrorRate(): void {
    const currentErrorRate = this.window.getErrorRate();

    // Exponential smoothing
    this.errorRate =
      this.config.errorRateSmoothing * currentErrorRate +
      (1 - this.config.errorRateSmoothing) * this.errorRate;
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;

      logger.info(`Circuit breaker ${this.name} state transition: ${oldState} -> ${newState}`, {
        name: this.name,
        oldState,
        newState,
        failureCount: this.failureCount,
        successCount: this.successCount,
        consecutiveFailedRecoveries: this.consecutiveFailedRecoveries,
        lastFailureReason: this.lastFailureReason,
        timeInCurrentState:
          oldState === 'half-open'
            ? Date.now() - (this.halfOpenStartedAt || Date.now())
            : undefined,
      });

      if (newState === 'half-open') {
        this.halfOpenRequestCount = 0;
        this.activeTestsInProgress = 0;
        // Add random jitter (0-30s) to stagger half-open transitions and prevent stampedes
        const jitter = Math.floor(Math.random() * 30000);
        this.halfOpenStartedAt = Date.now() + jitter;
        this.consecutiveSuccesses = 0; // Reset consecutive successes when entering half-open
        logger.debug(`Half-open jitter applied for ${this.name}: +${jitter}ms`);
      }

      // Reset half-open timestamp when transitioning to open (fixes timeout bug)
      if (newState === 'open' && oldState === 'half-open') {
        this.halfOpenStartedAt = 0;
        this.activeTestsInProgress = 0;
        logger.debug(`Reset half-open tracking for ${this.name} when transitioning to open`);
      }

      this.onStateChange?.(oldState, newState);
      logger.info(`Circuit breaker state changed: ${oldState} -> ${newState}`);
    }
  }
}

/**
 * Circuit breaker registry for managing multiple breakers
 */
export class CircuitBreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>();
  private defaultConfig: Partial<CircuitBreakerConfig>;

  constructor(defaultConfig?: Partial<CircuitBreakerConfig>) {
    this.defaultConfig = defaultConfig ?? {};
  }

  /**
   * Get or create a circuit breaker
   */
  getOrCreate(
    name: string,
    config?: Partial<CircuitBreakerConfig>,
    onStateChange?: (oldState: CircuitState, newState: CircuitState) => void
  ): CircuitBreaker {
    if (!this.breakers.has(name)) {
      const mergedConfig = { ...this.defaultConfig, ...config };
      this.breakers.set(name, new CircuitBreaker(name, mergedConfig, onStateChange));
    }
    return this.breakers.get(name)!;
  }

  /**
   * Get existing circuit breaker
   */
  get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  /**
   * Remove a circuit breaker by name
   */
  remove(name: string): boolean {
    return this.breakers.delete(name);
  }

  /**
   * Remove all circuit breakers matching a prefix
   * Useful for cleaning up all breakers for a server (e.g., "serverId" and "serverId:model1", "serverId:model2")
   */
  removeByPrefix(prefix: string): number {
    let removed = 0;
    for (const name of this.breakers.keys()) {
      if (name === prefix || name.startsWith(`${prefix}:`)) {
        this.breakers.delete(name);
        removed++;
      }
    }
    if (removed > 0) {
      logger.info(`Removed ${removed} circuit breaker(s) matching prefix '${prefix}'`);
    }
    return removed;
  }

  /**
   * Get all circuit breaker stats
   */
  getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    for (const [name, breaker] of this.breakers.entries()) {
      stats[name] = breaker.getStats();
    }
    return stats;
  }

  /**
   * Load circuit breaker states from persisted data
   * Creates circuit breakers for all persisted entries and restores their state
   */
  loadPersistedState(persistedData: Record<string, CircuitBreakerStats>): void {
    for (const [name, stats] of Object.entries(persistedData)) {
      // Get or create the circuit breaker
      const breaker = this.getOrCreate(name);
      // Restore its state
      breaker.restoreState(stats);
    }
    logger.info(
      `Loaded ${Object.keys(persistedData).length} circuit breaker states from persistence`
    );
  }

  /**
   * Update configuration for all circuit breakers
   */
  updateAllConfig(config: Partial<CircuitBreakerConfig>): void {
    // Update default config so new breakers get the latest config
    this.defaultConfig = { ...this.defaultConfig, ...config };

    // Update all existing breakers
    for (const breaker of this.breakers.values()) {
      breaker.updateConfig(config);
    }
  }

  /**
   * Clear all circuit breakers
   */
  clear(): void {
    this.breakers.clear();
  }
}
