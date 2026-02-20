/**
 * Recovery Test Coordinator
 * Manages active testing across circuit breakers with server-level coordination
 *
 * Key Features:
 * - Server-level breakers: Uses lightweight /api/tags tests
 * - Model-level breakers: Uses full inference tests with server coordination
 * - Ensures only one model test per server at a time
 * - Enforces cooldown periods between tests on the same server
 * - Checks for in-flight requests before testing
 */

import { CircuitBreaker } from './circuit-breaker.js';
import { featureFlags } from './config/feature-flags.js';
import { fetchWithTimeout, parseResponse } from './utils/fetchWithTimeout.js';
import { logger } from './utils/logger.js';
import { safeJsonStringify } from './utils/json-utils.js';
import { Timer } from './utils/timer.js';

interface ServerTestState {
  lastTestTime: number;
  currentTestBreakerId: string | null;
  testQueue: string[]; // Breaker IDs waiting to be tested on this server
}

interface TestCoordinatorConfig {
  // Minimum time between tests on the same server (ms)
  serverCooldownMs: number;
  // Maximum time to wait for in-flight requests to clear (ms)
  maxWaitForInFlightMs: number;
  // Timeout for model-level recovery tests (ms)
  modelTestTimeoutMs: number;
  // Whether to check in-flight requests before testing
  checkInFlightRequests: boolean;
  // Maximum queue size per server
  maxQueueSizePerServer: number;
}

const DEFAULT_CONFIG: TestCoordinatorConfig = {
  serverCooldownMs: 10000, // 10 seconds between tests
  maxWaitForInFlightMs: 5000, // Wait up to 5 seconds for in-flight to clear
  modelTestTimeoutMs: 60000, // 60 seconds for model test
  checkInFlightRequests: true,
  maxQueueSizePerServer: 10,
};

export interface ActiveTestResult {
  breakerName: string;
  model?: string;
  success: boolean;
  duration: number;
  error?: string;
}

export interface ActiveTestOptions {
  onTestStart?: (breakerName: string) => void;
  onTestEnd?: (breakerName: string, success: boolean, duration: number) => void;
  signal?: AbortSignal;
}

export interface TestMetrics {
  testId: string;
  breakerName: string;
  model?: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  success?: boolean;
  error?: string;
  timeout: boolean;
  cancelled: boolean;
}

export interface TestStats {
  totalTests: number;
  successes: number;
  failures: number;
  timeouts: number;
  cancellations: number;
  averageDuration: number;
}

export class RecoveryTestCoordinator {
  private serverStates = new Map<string, ServerTestState>();
  private config: TestCoordinatorConfig;
  private serverUrlProvider?: (serverId: string) => string | null;
  private inFlightProvider?: (serverId: string) => number;
  private incrementInFlight?: (serverId: string, model: string) => void;
  private decrementInFlight?: (serverId: string, model: string) => void;
  private abortControllers = new Map<string, AbortController>();
  private cancelledTests = new Set<string>();
  private testMetrics: TestMetrics[] = [];
  private readonly MAX_METRICS = 1000;

  constructor(config: Partial<TestCoordinatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record test metrics
   */
  private recordTestMetrics(metrics: Omit<TestMetrics, 'testId'>): void {
    const testMetrics: TestMetrics = {
      ...metrics,
      testId: `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    };

    this.testMetrics.push(testMetrics);

    // Prune old metrics
    if (this.testMetrics.length > this.MAX_METRICS) {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      this.testMetrics = this.testMetrics.filter(m => m.startTime > cutoff);
    }
  }

  /**
   * Get metrics for a specific breaker
   */
  getMetricsForBreaker(breakerName: string): TestMetrics[] {
    return this.testMetrics
      .filter(m => m.breakerName === breakerName)
      .sort((a, b) => b.startTime - a.startTime);
  }

  /**
   * Get recovery probability estimate for a breaker
   */
  getRecoveryProbability(breakerName: string, windowHours: number = 24): number {
    const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
    const recentTests = this.testMetrics.filter(
      m => m.breakerName === breakerName && m.startTime > cutoff
    );

    if (recentTests.length === 0) {
      return -1;
    }

    const successes = recentTests.filter(m => m.success === true).length;
    return successes / recentTests.length;
  }

  /**
   * Get aggregate test statistics
   */
  getTestStats(): TestStats {
    const tests = this.testMetrics;
    const completed = tests.filter(t => t.endTime !== undefined);

    return {
      totalTests: tests.length,
      successes: tests.filter(t => t.success === true).length,
      failures: tests.filter(t => t.success === false).length,
      timeouts: tests.filter(t => t.timeout).length,
      cancellations: tests.filter(t => t.cancelled).length,
      averageDuration:
        completed.length > 0
          ? completed.reduce((sum, t) => sum + (t.duration || 0), 0) / completed.length
          : 0,
    };
  }

  /**
   * Set the server URL provider function
   */
  setServerUrlProvider(provider: (serverId: string) => string | null): void {
    this.serverUrlProvider = provider;
  }

  /**
   * Set the in-flight requests provider function
   */
  setInFlightProvider(provider: (serverId: string) => number): void {
    this.inFlightProvider = provider;
  }

  /**
   * Set the increment in-flight function
   */
  setIncrementInFlight(increment: (serverId: string, model: string) => void): void {
    this.incrementInFlight = increment;
    logger.debug('RecoveryTestCoordinator: setIncrementInFlight configured');
  }

  /**
   * Set the decrement in-flight function
   */
  setDecrementInFlight(decrement: (serverId: string, model: string) => void): void {
    this.decrementInFlight = decrement;
    logger.debug('RecoveryTestCoordinator: setDecrementInFlight configured');
  }

  /**
   * Determine if a breaker is a server-level or model-level breaker
   * Server-level: "srv-abc123" (no colon in ID portion)
   * Model-level: "srv-abc123:llama3.1:8b" (has model name after server ID)
   */
  private isServerLevelBreaker(breakerName: string): boolean {
    // Split by colon - if we have more than 2 parts, it's model-level
    // Format: "serverId" (server) or "serverId:model:name" (model)
    const parts = breakerName.split(':');
    return parts.length <= 1;
  }

  /**
   * Extract server ID from breaker name
   */
  private getServerId(breakerName: string): string {
    return breakerName.split(':')[0];
  }

  /**
   * Extract model name from breaker name (for model-level breakers)
   */
  private getModelName(breakerName: string): string | null {
    const parts = breakerName.split(':');
    if (parts.length <= 1) {
      return null;
    }
    return parts.slice(1).join(':');
  }

  /**
   * Get or create server test state
   */
  private getServerState(serverId: string): ServerTestState {
    if (!this.serverStates.has(serverId)) {
      this.serverStates.set(serverId, {
        lastTestTime: 0,
        currentTestBreakerId: null,
        testQueue: [],
      });
    }
    return this.serverStates.get(serverId)!;
  }

  /**
   * Check if server is ready for testing (cooldown elapsed, no in-flight requests)
   */
  private isServerReadyForTest(serverId: string): {
    ready: boolean;
    reason?: string;
    waitTimeMs?: number;
  } {
    const state = this.getServerState(serverId);
    const now = Date.now();

    // Check if currently testing
    if (state.currentTestBreakerId) {
      return {
        ready: false,
        reason: `Server ${serverId} is currently testing breaker ${state.currentTestBreakerId}`,
      };
    }

    // Check cooldown period
    const timeSinceLastTest = now - state.lastTestTime;
    if (timeSinceLastTest < this.config.serverCooldownMs) {
      const waitTime = this.config.serverCooldownMs - timeSinceLastTest;
      return {
        ready: false,
        reason: `Server ${serverId} cooldown period active`,
        waitTimeMs: waitTime,
      };
    }

    // Check for in-flight requests
    if (this.config.checkInFlightRequests && this.inFlightProvider) {
      const inFlightCount = this.inFlightProvider(serverId);
      if (inFlightCount > 0) {
        return {
          ready: false,
          reason: `Server ${serverId} has ${inFlightCount} in-flight requests`,
        };
      }
    }

    return { ready: true };
  }

  /**
   * Queue a breaker for recovery testing
   * Returns true if queued successfully, false if queue is full
   */
  queueForTest(breaker: CircuitBreaker): boolean {
    const breakerName = (breaker as any).name || 'unknown';
    const serverId = this.getServerId(breakerName);
    const state = this.getServerState(serverId);

    // Check if already in queue
    if (state.testQueue.includes(breakerName)) {
      return true; // Already queued
    }

    // Check if currently being tested
    if (state.currentTestBreakerId === breakerName) {
      return true; // Currently testing
    }

    // Check queue capacity
    if (state.testQueue.length >= this.config.maxQueueSizePerServer) {
      logger.warn(`Test queue full for server ${serverId}, dropping ${breakerName}`);
      return false;
    }

    state.testQueue.push(breakerName);
    logger.debug(`Queued ${breakerName} for recovery testing on server ${serverId}`, {
      queuePosition: state.testQueue.length,
    });

    return true;
  }

  /**
   * Perform recovery test with server-level coordination
   * This is the main entry point that should replace direct performRecoveryTest calls
   */
  async performCoordinatedRecoveryTest(breaker: CircuitBreaker): Promise<boolean> {
    const breakerName = (breaker as any).name || 'unknown';
    const serverId = this.getServerId(breakerName);
    const isServerLevel = this.isServerLevelBreaker(breakerName);

    logger.debug(
      `RecoveryTestCoordinator: performCoordinatedRecoveryTest called for ${breakerName}, incrementInFlight set: ${!!this.incrementInFlight}`
    );

    // Check server readiness
    const readiness = this.isServerReadyForTest(serverId);
    if (!readiness.ready) {
      logger.debug(`Server ${serverId} not ready for test: ${readiness.reason}`, {
        breaker: breakerName,
        waitTimeMs: readiness.waitTimeMs,
      });
      return false;
    }

    const state = this.getServerState(serverId);

    // For server-level breakers: use lightweight test immediately
    if (isServerLevel) {
      return this.performServerLevelTest(breaker);
    }

    // For model-level breakers: check queue and coordinate
    const modelName = this.getModelName(breakerName);
    if (!modelName) {
      logger.error(`Model-level breaker ${breakerName} has no model name`);
      return false;
    }

    // Ensure this breaker is at the front of the queue
    if (state.testQueue.length > 0 && state.testQueue[0] !== breakerName) {
      // Not our turn yet - add to queue if not already there
      if (!state.testQueue.includes(breakerName)) {
        this.queueForTest(breaker);
      }
      logger.debug(`${breakerName} waiting in queue for server ${serverId}`, {
        queuePosition: state.testQueue.indexOf(breakerName) + 1,
        queueLength: state.testQueue.length,
      });
      return false;
    }

    // It's our turn - remove from queue and perform test
    if (state.testQueue.length > 0) {
      state.testQueue.shift(); // Remove from front
    }

    return this.performModelLevelTest(breaker, serverId, modelName);
  }

  /**
   * Perform lightweight test for server-level breaker
   */
  private async performServerLevelTest(breaker: CircuitBreaker): Promise<boolean> {
    const breakerName = (breaker as any).name || 'unknown';
    const serverId = this.getServerId(breakerName);
    const state = this.getServerState(serverId);

    const useTimer = featureFlags.get('useTimerUtility');
    const timer = useTimer ? new Timer() : null;
    const startTime = timer ? undefined : Date.now();

    state.currentTestBreakerId = breakerName;

    try {
      logger.debug(`Starting server-level recovery test for ${breakerName}`);

      const serverUrl = this.getServerUrl(serverId);
      if (!serverUrl) {
        logger.error(`Server URL not found for ${serverId}`);
        return false;
      }

      // Lightweight /api/tags test
      const response = await fetchWithTimeout(`${serverUrl}/api/tags`, {
        timeout: 5000,
      });

      const duration = timer ? timer.elapsed() : Date.now() - startTime!;
      state.lastTestTime = Date.now();
      state.currentTestBreakerId = null;

      if (response.ok) {
        logger.info(`Server-level recovery test passed for ${breakerName}`, {
          duration,
          serverId,
        });
        return true;
      } else {
        logger.warn(`Server-level recovery test failed for ${breakerName}`, {
          duration,
          status: response.status,
          serverId,
        });
        return false;
      }
    } catch (error) {
      const duration = timer ? timer.elapsed() : Date.now() - startTime!;
      state.lastTestTime = Date.now();
      state.currentTestBreakerId = null;

      logger.error(`Server-level recovery test error for ${breakerName}`, {
        duration,
        error: error instanceof Error ? error.message : String(error),
        serverId,
      });
      return false;
    }
  }

  /**
   * Perform full inference test for model-level breaker
   */
  private async performModelLevelTest(
    breaker: CircuitBreaker,
    serverId: string,
    modelName: string
  ): Promise<boolean> {
    const breakerName = (breaker as any).name || 'unknown';
    const state = this.getServerState(serverId);

    const useTimer = featureFlags.get('useTimerUtility');
    const timer = useTimer ? new Timer() : null;
    const startTime = timer ? undefined : Date.now();

    state.currentTestBreakerId = breakerName;

    // Increment in-flight count for recovery test
    if (this.incrementInFlight) {
      this.incrementInFlight(serverId, modelName);
      logger.debug(`Recovery test incrementInFlight for ${serverId}:${modelName}`);
    }

    try {
      // First check model name patterns - these are definitive indicators
      const modelNameLower = modelName.toLowerCase();
      const isEmbeddingModelByName =
        modelNameLower.includes('embed') ||
        modelNameLower.includes('pygmalion') ||
        modelNameLower.includes('nomic-embed') ||
        modelNameLower.includes('text-embedding') ||
        modelNameLower.includes('sentence') ||
        modelNameLower.includes('bge-') ||
        modelNameLower.includes('gte-') ||
        modelNameLower.includes('e5-') ||
        modelNameLower.includes('all-minilm') ||
        modelNameLower.includes('all-mpnet');

      if (isEmbeddingModelByName) {
        logger.info(
          `Model ${modelName} detected as embedding-only by name pattern, using embedding test`,
          {
            serverId,
            model: modelName,
          }
        );
        // Update model type if it was wrong
        if ((breaker as any).setModelType && (breaker as any).getModelType?.() !== 'embedding') {
          (breaker as any).setModelType('embedding');
        }
        return this.performEmbeddingTest(breaker, serverId, modelName);
      }

      // Check if model type is already known
      const modelType = (breaker as any).getModelType?.();

      if (modelType === 'embedding') {
        logger.info(`Model ${modelName} is embedding-only, skipping generate test`, {
          serverId,
          model: modelName,
        });
        // For embedding models, try embedding test instead
        return this.performEmbeddingTest(breaker, serverId, modelName);
      }

      logger.info(`Starting model-level recovery test for ${breakerName}`, {
        serverId,
        model: modelName,
      });

      const serverUrl = this.getServerUrl(serverId);
      if (!serverUrl) {
        logger.error(`Server URL not found for ${serverId}`);
        state.currentTestBreakerId = null;
        return false;
      }

      // Perform full inference test
      const response = await fetchWithTimeout(`${serverUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: safeJsonStringify({
          model: modelName,
          prompt: 'Hi',
          stream: false,
          options: {
            num_predict: 1,
            temperature: 0,
          },
        }),
        timeout: this.config.modelTestTimeoutMs,
      });

      const duration = timer ? timer.elapsed() : Date.now() - startTime!;
      state.lastTestTime = Date.now();
      state.currentTestBreakerId = null;

      if (response.ok) {
        const data = await parseResponse(response);
        if (data?.response) {
          logger.info(`Model-level recovery test passed for ${breakerName}`, {
            duration,
            serverId,
            model: modelName,
          });
          return true;
        } else {
          logger.warn(`Model-level recovery test returned invalid response for ${breakerName}`, {
            duration,
            serverId,
            model: modelName,
          });
          return false;
        }
      } else {
        const errorText = await response.text().catch(() => 'Unknown error');
        const errorLower = errorText.toLowerCase();

        // Check if this is a "does not support generate" error
        if (
          errorLower.includes('does not support generate') ||
          errorLower.includes('cannot generate') ||
          errorLower.includes('not supported')
        ) {
          logger.info(`Model ${modelName} does not support generate, marking as embedding-only`, {
            serverId,
            model: modelName,
            error: errorText,
          });

          // Mark as embedding model
          if ((breaker as any).setModelType) {
            (breaker as any).setModelType('embedding');
          }

          // Try embedding test instead
          return this.performEmbeddingTest(breaker, serverId, modelName);
        }

        logger.warn(`Model-level recovery test failed for ${breakerName}`, {
          duration,
          status: response.status,
          error: errorText,
          serverId,
          model: modelName,
        });
        return false;
      }
    } catch (error) {
      const duration = timer ? timer.elapsed() : Date.now() - startTime!;
      state.lastTestTime = Date.now();
      state.currentTestBreakerId = null;

      logger.error(`Model-level recovery test error for ${breakerName}`, {
        duration,
        error: error instanceof Error ? error.message : String(error),
        serverId,
        model: modelName,
      });
      return false;
    } finally {
      // Decrement in-flight count for recovery test
      if (this.decrementInFlight) {
        this.decrementInFlight(serverId, modelName);
        logger.debug(`Recovery test decrementInFlight for ${serverId}:${modelName}`);
      }
    }
  }

  /**
   * Perform embedding test for embedding-only models
   */
  private async performEmbeddingTest(
    breaker: CircuitBreaker,
    serverId: string,
    modelName: string
  ): Promise<boolean> {
    const breakerName = (breaker as any).name || 'unknown';
    const _state = this.getServerState(serverId);
    const startTime = Date.now();

    // Increment in-flight count for recovery test
    if (this.incrementInFlight) {
      this.incrementInFlight(serverId, modelName);
      logger.debug(`Recovery test embedding incrementInFlight for ${serverId}:${modelName}`);
    }

    // Add delay to make recovery test visible in frontend (5 seconds)
    await new Promise(resolve => setTimeout(resolve, 5000));

    try {
      const serverUrl = this.getServerUrl(serverId);
      if (!serverUrl) {
        return false;
      }

      logger.info(`Running embedding test for ${breakerName}`, {
        serverId,
        model: modelName,
      });

      // Perform embedding test
      const response = await fetchWithTimeout(`${serverUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: safeJsonStringify({
          model: modelName,
          prompt: 'test',
        }),
        timeout: 15000, // Shorter timeout for embedding test
      });

      const duration = Date.now() - startTime;

      if (response.ok) {
        logger.info(`Embedding test passed for ${breakerName}`, {
          duration,
          serverId,
          model: modelName,
        });
        return true;
      } else {
        const errorText = await response.text().catch(() => 'Unknown error');
        logger.warn(`Embedding test failed for ${breakerName}`, {
          duration,
          status: response.status,
          error: errorText,
          serverId,
          model: modelName,
        });
        return false;
      }
    } catch (error) {
      logger.error(`Embedding test error for ${breakerName}`, {
        error: error instanceof Error ? error.message : String(error),
        serverId,
        model: modelName,
      });
      return false;
    } finally {
      // Decrement in-flight count for recovery test
      if (this.decrementInFlight) {
        this.decrementInFlight(serverId, modelName);
        logger.debug(`Recovery test embedding decrementInFlight for ${serverId}:${modelName}`);
      }
    }
  }

  /**
   * Get server URL from provider
   */
  private getServerUrl(serverId: string): string | null {
    if (this.serverUrlProvider) {
      return this.serverUrlProvider(serverId);
    }
    logger.warn(`Server URL provider not configured for ${serverId}`);
    return null;
  }

  /**
   * Get current queue status for a server
   */
  getServerQueueStatus(serverId: string): {
    queueLength: number;
    isTesting: boolean;
    currentTestBreakerId: string | null;
    timeSinceLastTest: number;
  } {
    const state = this.getServerState(serverId);
    return {
      queueLength: state.testQueue.length,
      isTesting: state.currentTestBreakerId !== null,
      currentTestBreakerId: state.currentTestBreakerId,
      timeSinceLastTest: Date.now() - state.lastTestTime,
    };
  }

  /**
   * Get all servers with pending tests
   */
  getServersWithPendingTests(): Array<{
    serverId: string;
    queueLength: number;
    isTesting: boolean;
  }> {
    const result = [];
    for (const [serverId, state] of this.serverStates.entries()) {
      if (state.testQueue.length > 0 || state.currentTestBreakerId) {
        result.push({
          serverId,
          queueLength: state.testQueue.length,
          isTesting: state.currentTestBreakerId !== null,
        });
      }
    }
    return result;
  }

  /**
   * Cancel any active or queued test for a specific breaker
   * This should be called when a circuit breaker is manually reset
   */
  cancelTest(breakerName: string): boolean {
    const serverId = this.getServerId(breakerName);
    const state = this.serverStates.get(serverId);

    if (!state) {
      return false;
    }

    // Abort in-flight test if running
    const controller = this.abortControllers.get(breakerName);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(breakerName);
    }

    let cancelled = false;

    // Check if this breaker is currently being tested
    if (state.currentTestBreakerId === breakerName) {
      state.currentTestBreakerId = null;
      cancelled = true;
      logger.info(`Cancelled active test for ${breakerName}`);
    }

    // Remove from queue if present
    const queueIndex = state.testQueue.indexOf(breakerName);
    if (queueIndex !== -1) {
      state.testQueue.splice(queueIndex, 1);
      cancelled = true;
      logger.info(`Removed ${breakerName} from test queue`);
    }

    // Mark as cancelled
    this.cancelledTests.add(breakerName);

    return cancelled;
  }

  /**
   * Check if a test was cancelled
   */
  isTestCancelled(breakerName: string): boolean {
    return this.cancelledTests.has(breakerName);
  }

  /**
   * Clear cancelled status (allows test to run again after reset)
   */
  clearCancelled(breakerName: string): void {
    this.cancelledTests.delete(breakerName);
  }

  /**
   * Clear all queues (useful for testing or resets)
   */
  clearAllQueues(): void {
    for (const state of this.serverStates.values()) {
      state.testQueue = [];
      state.currentTestBreakerId = null;
    }
    this.abortControllers.clear();
    this.cancelledTests.clear();
    logger.info('Cleared all recovery test queues');
  }

  /**
   * Run active tests for multiple half-open breakers
   * Called by health check scheduler instead of direct executeActiveTest calls
   * This unifies the health check and request paths
   */
  async runActiveTests(
    serverId: string,
    breakers: Array<{ breaker: CircuitBreaker; model?: string }>,
    options: ActiveTestOptions = {}
  ): Promise<ActiveTestResult[]> {
    const results: ActiveTestResult[] = [];

    // Limit concurrent tests per server
    const maxConcurrentPerServer = 2;

    // Sort by halfOpenStartedAt (oldest first)
    breakers.sort((a, b) => {
      const aStats = a.breaker.getStats();
      const bStats = b.breaker.getStats();
      return (aStats.halfOpenStartedAt || 0) - (bStats.halfOpenStartedAt || 0);
    });

    const toTest = breakers.slice(0, maxConcurrentPerServer);

    logger.info(
      `Running active tests for ${toTest.length}/${breakers.length} breakers on ${serverId}`,
      {
        models: toTest.map(t => t.model || 'server-level'),
      }
    );

    for (const { breaker, model } of toTest) {
      const breakerName = (breaker as any).name || 'unknown';
      const startTime = Date.now();

      // Check for cancellation
      if (options.signal?.aborted || this.cancelledTests.has(breakerName)) {
        logger.debug(`Test for ${breakerName} was cancelled, skipping`);

        this.recordTestMetrics({
          breakerName,
          model,
          startTime,
          endTime: Date.now(),
          duration: Date.now() - startTime,
          success: false,
          error: 'Test cancelled',
          timeout: false,
          cancelled: true,
        });

        results.push({
          breakerName,
          model,
          success: false,
          duration: 0,
          error: 'Test cancelled',
        });
        continue;
      }

      // Create abort controller for this test
      const controller = new AbortController();
      this.abortControllers.set(breakerName, controller);

      const timer = new Timer();
      options.onTestStart?.(breakerName);

      try {
        let success: boolean;

        if (model) {
          success = await this.performModelLevelTestWithAbort(
            breaker,
            serverId,
            model,
            controller.signal
          );
        } else {
          success = await this.performServerLevelTestWithAbort(breaker, controller.signal);
        }

        const duration = timer.elapsed();
        options.onTestEnd?.(breakerName, success, duration);

        results.push({
          breakerName,
          model,
          success,
          duration,
        });

        // Record metrics
        this.recordTestMetrics({
          breakerName,
          model,
          startTime,
          endTime: Date.now(),
          duration,
          success,
          timeout: false,
          cancelled: false,
        });

        // Update circuit breaker state
        if (success) {
          breaker.recordSuccess();
        } else {
          breaker.recordFailure(new Error('Active test failed'), 'transient');
        }
      } catch (error) {
        const duration = timer.elapsed();
        const errorMsg = error instanceof Error ? error.message : String(error);
        const isTimeout = errorMsg.includes('timeout') || errorMsg.includes('timed out');
        options.onTestEnd?.(breakerName, false, duration);

        // Record metrics
        this.recordTestMetrics({
          breakerName,
          model,
          startTime,
          endTime: Date.now(),
          duration,
          success: false,
          error: errorMsg,
          timeout: isTimeout,
          cancelled: false,
        });

        results.push({
          breakerName,
          model,
          success: false,
          duration,
          error: errorMsg,
        });

        breaker.recordFailure(new Error(errorMsg), 'transient');
      } finally {
        this.abortControllers.delete(breakerName);
      }

      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return results;
  }

  /**
   * Server-level test with abort support
   */
  private async performServerLevelTestWithAbort(
    breaker: CircuitBreaker,
    signal: AbortSignal
  ): Promise<boolean> {
    const breakerName = (breaker as any).name || 'unknown';
    const serverId = this.getServerId(breakerName);

    try {
      const serverUrl = this.getServerUrl(serverId);
      if (!serverUrl) {
        return false;
      }

      const response = await fetchWithTimeout(`${serverUrl}/api/tags`, {
        timeout: 5000,
        signal,
      });

      return response.ok;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.debug(`Server-level test aborted for ${breakerName}`);
        return false;
      }
      logger.error(`Server-level test failed for ${breakerName}`, { error });
      return false;
    }
  }

  /**
   * Model-level test with abort support
   */
  private async performModelLevelTestWithAbort(
    breaker: CircuitBreaker,
    serverId: string,
    modelName: string,
    signal: AbortSignal
  ): Promise<boolean> {
    const breakerName = (breaker as any).name || 'unknown';

    try {
      const serverUrl = this.getServerUrl(serverId);
      if (!serverUrl) {
        return false;
      }

      // Determine model type
      const modelNameLower = modelName.toLowerCase();
      const isEmbeddingModel =
        modelNameLower.includes('embed') ||
        modelNameLower.includes('pygmalion') ||
        modelNameLower.includes('nomic-embed') ||
        modelNameLower.includes('text-embedding') ||
        modelNameLower.includes('sentence') ||
        modelNameLower.includes('bge-') ||
        modelNameLower.includes('gte-') ||
        modelNameLower.includes('e5-') ||
        modelNameLower.includes('all-minilm') ||
        modelNameLower.includes('all-mpnet');

      const endpoint = isEmbeddingModel ? '/api/embeddings' : '/api/generate';
      const body = isEmbeddingModel
        ? { model: modelName, prompt: 'test' }
        : {
            model: modelName,
            prompt: 'Hi',
            stream: false,
            options: { num_predict: 1, temperature: 0 },
          };

      const response = await fetchWithTimeout(`${serverUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: safeJsonStringify(body),
        timeout: this.config.modelTestTimeoutMs,
        signal,
      });

      if (!response.ok) {
        return false;
      }

      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.debug(`Model-level test aborted for ${breakerName}`);
        return false;
      }
      logger.error(`Model-level test failed for ${breakerName}`, { error });
      return false;
    }
  }
}

// Global instance
let coordinator: RecoveryTestCoordinator | undefined;

/**
 * Get the global recovery test coordinator instance
 */
export function getRecoveryTestCoordinator(): RecoveryTestCoordinator {
  if (!coordinator) {
    coordinator = new RecoveryTestCoordinator();
  }
  return coordinator;
}

/**
 * Reset the global instance (useful for testing)
 */
export function resetRecoveryTestCoordinator(): void {
  coordinator = undefined;
}
