/**
 * Intelligent Recovery Manager
 * Provides context-aware recovery testing strategies for circuit breakers
 */

import { CircuitBreaker } from './circuit-breaker.js';
import { featureFlags } from './config/feature-flags.js';
import { ErrorCategory, ErrorSeverity, type RetryStrategy } from './utils/errorClassifier.js';
import { fetchWithTimeout } from './utils/fetchWithTimeout.js';
import { logger } from './utils/logger.js';
import { Timer } from './utils/timer.js';

export interface RecoveryContext {
  strategy: 'lightweight' | 'full' | 'resource-aware';
  lastErrorCategory: ErrorCategory;
  lastErrorSeverity: ErrorSeverity;
  consecutiveFailures: number;
  timeSinceLastSuccess: number;
  serverLoad: number; // 0-1, higher means more loaded
}

/**
 * Recovery test result
 */
export interface RecoveryTestResult {
  success: boolean;
  duration: number;
  error?: string;
  resourceUsage?: {
    memoryUsage: number;
    cpuUsage: number;
  };
}

/**
 * Intelligent Recovery Manager
 * Handles context-aware recovery testing with different strategies
 */
export class IntelligentRecoveryManager {
  private recoveryHistory = new Map<string, RecoveryTestResult[]>();
  private serverUrlProvider?: (serverId: string) => string | null;

  /**
   * Set the server URL provider function
   */
  setServerUrlProvider(provider: (serverId: string) => string | null): void {
    this.serverUrlProvider = provider;
  }

  /**
   * Perform recovery test based on breaker context
   */
  async performRecoveryTest(
    breaker: CircuitBreaker,
    context: RecoveryContext
  ): Promise<RecoveryTestResult> {
    switch (context.strategy) {
      case 'lightweight':
        return this.lightweightRecoveryTest(breaker, context);
      case 'full':
        return this.fullRecoveryTest(breaker, context);
      case 'resource-aware':
        return this.resourceAwareRecoveryTest(breaker, context);
      default:
        return this.lightweightRecoveryTest(breaker, context);
    }
  }

  /**
   * Lightweight recovery test - quick server availability check
   */
  private async lightweightRecoveryTest(
    breaker: CircuitBreaker,
    context: RecoveryContext
  ): Promise<RecoveryTestResult> {
    const useTimer = featureFlags.get('useTimerUtility');
    const timer = useTimer ? new Timer() : null;
    const startTime = timer ? undefined : Date.now();
    const breakerName = (breaker as any).name || 'unknown';

    try {
      // Extract server URL from breaker name (format: "serverId:modelName")
      const serverId = breakerName.split(':')[0];
      const serverUrl = this.getServerUrl(serverId);

      if (!serverUrl) {
        return {
          success: false,
          duration: timer ? timer.elapsed() : Date.now() - startTime!,
          error: 'Server URL not found',
        };
      }

      // Quick tags endpoint check
      const response = await fetchWithTimeout(`${serverUrl}/api/tags`, {
        timeout: 5000, // 5 second timeout for lightweight test
      });

      const duration = timer ? timer.elapsed() : Date.now() - startTime!;

      if (!response.ok) {
        return {
          success: false,
          duration,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      // Verify we got valid JSON
      const data = await response.json().catch(() => null);
      if (!data || typeof data !== 'object') {
        return {
          success: false,
          duration,
          error: 'Invalid response format',
        };
      }

      logger.debug(`Lightweight recovery test passed for ${breakerName}`, {
        duration,
        serverId,
      });

      return {
        success: true,
        duration,
      };
    } catch (error) {
      const duration = timer ? timer.elapsed() : Date.now() - startTime!;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.debug(`Lightweight recovery test failed for ${breakerName}`, {
        duration,
        error: errorMessage,
        context,
      });

      return {
        success: false,
        duration,
        error: errorMessage,
      };
    }
  }

  /**
   * Full recovery test - complete model loading test
   */
  private async fullRecoveryTest(
    breaker: CircuitBreaker,
    context: RecoveryContext
  ): Promise<RecoveryTestResult> {
    const useTimer = featureFlags.get('useTimerUtility');
    const timer = useTimer ? new Timer() : null;
    const startTime = timer ? undefined : Date.now();
    const breakerName = (breaker as any).name || 'unknown';

    try {
      // Extract server and model info from breaker name
      const parts = breakerName.split(':');
      const serverId = parts[0];
      const modelName = parts.slice(1).join(':');
      const serverUrl = this.getServerUrl(serverId);

      if (!serverUrl || !modelName) {
        return {
          success: false,
          duration: timer ? timer.elapsed() : Date.now() - startTime!,
          error: 'Server URL or model name not found',
        };
      }

      // Test actual model inference with minimal prompt
      const response = await fetch(`${serverUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          prompt: 'Hi',
          stream: false,
          options: {
            num_predict: 1, // Only generate 1 token for speed
            temperature: 0, // Deterministic for testing
          },
        }),
      });

      const duration = timer ? timer.elapsed() : Date.now() - startTime!;

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        return {
          success: false,
          duration,
          error: `HTTP ${response.status}: ${errorText}`,
        };
      }

      // Verify response is valid
      const data = await response.json().catch(() => null);
      if (!data?.response) {
        return {
          success: false,
          duration,
          error: 'Invalid inference response',
        };
      }

      logger.debug(`Full recovery test passed for ${breakerName}`, {
        duration,
        serverId,
        modelName,
        responseLength: data.response?.length || 0,
      });

      return {
        success: true,
        duration,
        resourceUsage: {
          memoryUsage: 0, // Could be populated from server metrics
          cpuUsage: 0,
        },
      };
    } catch (error) {
      const duration = timer ? timer.elapsed() : Date.now() - startTime!;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.debug(`Full recovery test failed for ${breakerName}`, {
        duration,
        error: errorMessage,
        context,
      });

      return {
        success: false,
        duration,
        error: errorMessage,
      };
    }
  }

  /**
   * Resource-aware recovery test - checks server capacity before testing
   */
  private async resourceAwareRecoveryTest(
    breaker: CircuitBreaker,
    context: RecoveryContext
  ): Promise<RecoveryTestResult> {
    const breakerName = (breaker as any).name || 'unknown';
    const serverId = breakerName.split(':')[0];

    // First check server resources
    const resourceCheck = await this.checkServerResources(serverId);
    if (!resourceCheck.available) {
      return {
        success: false,
        duration: resourceCheck.duration,
        error: `Insufficient resources: ${resourceCheck.reason}`,
        resourceUsage: resourceCheck.usage,
      };
    }

    // If resources are available, perform full recovery test
    return this.fullRecoveryTest(breaker, context);
  }

  /**
   * Check server resource availability
   */
  private async checkServerResources(serverId: string): Promise<{
    available: boolean;
    duration: number;
    reason?: string;
    usage?: { memoryUsage: number; cpuUsage: number };
  }> {
    const startTime = Date.now();

    try {
      const serverUrl = this.getServerUrl(serverId);
      if (!serverUrl) {
        return {
          available: false,
          duration: Date.now() - startTime,
          reason: 'Server URL not found',
        };
      }

      // Check /api/ps for resource usage
      const response = await fetchWithTimeout(`${serverUrl}/api/ps`, {
        timeout: 3000,
      });

      if (!response.ok) {
        return {
          available: false,
          duration: Date.now() - startTime,
          reason: `Resource check failed: HTTP ${response.status}`,
        };
      }

      const data = await response.json().catch(() => null);
      if (!Array.isArray(data)) {
        return {
          available: true, // Assume available if we can't check
          duration: Date.now() - startTime,
        };
      }

      // Calculate total memory usage
      let totalMemoryUsed = 0;
      for (const model of data) {
        if (model.size_vram) {
          totalMemoryUsed += model.size_vram;
        }
      }

      // Convert bytes to MB
      const totalMemoryUsedMB = totalMemoryUsed / (1024 * 1024);

      // Assume 8GB total GPU memory as conservative default
      const maxMemoryMB = 8192;
      const memoryUsagePercent = totalMemoryUsedMB / maxMemoryMB;

      // Consider server overloaded if using >80% of memory
      if (memoryUsagePercent > 0.8) {
        return {
          available: false,
          duration: Date.now() - startTime,
          reason: `High memory usage: ${(memoryUsagePercent * 100).toFixed(1)}%`,
          usage: {
            memoryUsage: memoryUsagePercent,
            cpuUsage: 0, // Could be extended to check CPU
          },
        };
      }

      return {
        available: true,
        duration: Date.now() - startTime,
        usage: {
          memoryUsage: memoryUsagePercent,
          cpuUsage: 0,
        },
      };
    } catch (error) {
      // On error, assume resources are available (fail open)
      return {
        available: true,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Determine recovery strategy based on error context
   */
  determineRecoveryStrategy(
    lastErrorCategory: ErrorCategory,
    consecutiveFailures: number,
    serverLoad: number
  ): RecoveryContext['strategy'] {
    // High server load -> prefer lightweight tests
    if (serverLoad > 0.7) {
      return 'lightweight';
    }

    // Resource errors -> resource-aware testing
    if (lastErrorCategory === ErrorCategory.RESOURCE) {
      return 'resource-aware';
    }

    // Many consecutive failures -> be more thorough
    if (consecutiveFailures > 3) {
      return 'full';
    }

    // Network or auth errors -> lightweight is sufficient
    if (
      lastErrorCategory === ErrorCategory.NETWORK ||
      lastErrorCategory === ErrorCategory.AUTHENTICATION
    ) {
      return 'lightweight';
    }

    // Default to full testing for unknown or compatibility issues
    return 'full';
  }

  /**
   * Get recovery strategy for error category
   */
  getRecoveryStrategyForCategory(category: ErrorCategory): RetryStrategy {
    const strategies: Record<ErrorCategory, RetryStrategy> = {
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

    return strategies[category];
  }

  /**
   * Get server URL from server ID (uses configured provider)
   */
  private getServerUrl(serverId: string): string | null {
    if (this.serverUrlProvider) {
      return this.serverUrlProvider(serverId);
    }
    logger.warn(`Server URL provider not configured for ${serverId}`);
    return null;
  }

  /**
   * Record recovery test result for analytics
   */
  recordRecoveryResult(breakerId: string, result: RecoveryTestResult): void {
    if (!this.recoveryHistory.has(breakerId)) {
      this.recoveryHistory.set(breakerId, []);
    }

    const history = this.recoveryHistory.get(breakerId)!;
    history.push(result);

    // Keep only last 50 results
    if (history.length > 50) {
      history.shift();
    }
  }

  /**
   * Get recovery success rate for breaker
   */
  getRecoverySuccessRate(breakerId: string): number {
    const history = this.recoveryHistory.get(breakerId);
    if (!history || history.length === 0) {
      return 0;
    }

    const successful = history.filter(r => r.success).length;
    return successful / history.length;
  }
}

// Global instance
let recoveryManager: IntelligentRecoveryManager | undefined;

/**
 * Get the global recovery manager instance
 */
export function getRecoveryManager(): IntelligentRecoveryManager {
  if (!recoveryManager) {
    recoveryManager = new IntelligentRecoveryManager();
  }
  return recoveryManager;
}
