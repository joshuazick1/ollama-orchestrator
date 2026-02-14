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
import { fetchWithTimeout } from './utils/fetchWithTimeout.js';
import { logger } from './utils/logger.js';

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

export class RecoveryTestCoordinator {
  private serverStates = new Map<string, ServerTestState>();
  private config: TestCoordinatorConfig;
  private serverUrlProvider?: (serverId: string) => string | null;
  private inFlightProvider?: (serverId: string) => number;
  private incrementInFlight?: (serverId: string, model: string) => void;
  private decrementInFlight?: (serverId: string, model: string) => void;

  constructor(config: Partial<TestCoordinatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
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
    logger.info('RecoveryTestCoordinator: setIncrementInFlight called');
  }

  /**
   * Set the decrement in-flight function
   */
  setDecrementInFlight(decrement: (serverId: string, model: string) => void): void {
    this.decrementInFlight = decrement;
    logger.info('RecoveryTestCoordinator: setDecrementInFlight called');
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

    state.currentTestBreakerId = breakerName;
    const startTime = Date.now();

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

      const duration = Date.now() - startTime;
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
      const duration = Date.now() - startTime;
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

    state.currentTestBreakerId = breakerName;
    const startTime = Date.now();

    // Increment in-flight count for recovery test
    if (this.incrementInFlight) {
      this.incrementInFlight(serverId, modelName);
      logger.info(`Recovery test incrementInFlight called for ${serverId}:${modelName}`);
    } else {
      logger.info(`Recovery test incrementInFlight NOT SET for ${serverId}:${modelName}`);
    }

    // Add delay to make recovery test visible in frontend (5 seconds)
    await new Promise(resolve => setTimeout(resolve, 5000));

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
        body: JSON.stringify({
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

      const duration = Date.now() - startTime;
      state.lastTestTime = Date.now();
      state.currentTestBreakerId = null;

      if (response.ok) {
        const data = await response.json().catch(() => null);
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
      const duration = Date.now() - startTime;
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
        logger.info(`Recovery test decrementInFlight called for ${serverId}:${modelName}`);
      } else {
        logger.info(`Recovery test decrementInFlight NOT SET for ${serverId}:${modelName}`);
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
      logger.info(`Recovery test embedding incrementInFlight called for ${serverId}:${modelName}`);
    } else {
      logger.info(`Recovery test embedding incrementInFlight NOT SET for ${serverId}:${modelName}`);
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
        body: JSON.stringify({
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
        logger.info(
          `Recovery test embedding decrementInFlight called for ${serverId}:${modelName}`
        );
      } else {
        logger.info(
          `Recovery test embedding decrementInFlight NOT SET for ${serverId}:${modelName}`
        );
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
   * Clear all queues (useful for testing or resets)
   */
  clearAllQueues(): void {
    for (const state of this.serverStates.values()) {
      state.testQueue = [];
      state.currentTestBreakerId = null;
    }
    logger.info('Cleared all recovery test queues');
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
