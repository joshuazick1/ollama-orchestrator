/**
 * health-check-scheduler.ts
 * Periodic health check scheduler with configurable intervals and concurrency
 */

import type { HealthCheckConfig } from './config/config.js';
import type { AIServer } from './orchestrator.types.js';
import { fetchWithTimeout } from './utils/fetchWithTimeout.js';
import { logger } from './utils/logger.js';
import { Timer } from './utils/timer.js';
import { featureFlags } from './config/feature-flags.js';

/**
 * Resolve API key from string (supports env:VARNAME format)
 */
function resolveApiKey(apiKey?: string): string | undefined {
  if (!apiKey) return undefined;
  if (apiKey.startsWith('env:')) {
    const envVar = apiKey.substring(4);
    return process.env[envVar];
  }
  return apiKey;
}

/**
 * Fetch with optional API key authentication
 */
async function fetchWithAuth(
  url: string,
  apiKey?: string,
  options?: { timeout?: number }
): Promise<Response> {
  const resolvedKey = resolveApiKey(apiKey);
  const headers: Record<string, string> = {};

  if (resolvedKey) {
    headers['Authorization'] = `Bearer ${resolvedKey}`;
  }

  return fetchWithTimeout(url, {
    ...options,
    headers,
  });
}

export interface HealthCheckResult {
  serverId: string;
  success: boolean;
  responseTime?: number;
  error?: string;
  timestamp: number;
  models?: string[];
  version?: string;
  // NEW: Endpoint capabilities
  supportsOllama?: boolean; // Whether server supports /api/* Ollama endpoints
  supportsV1?: boolean; // Whether server supports /v1/* OpenAI-compatible endpoints
  // NEW: OpenAI-compatible models
  v1Models?: string[];
  // Loaded model information from /api/ps
  loadedModels?: {
    name: string;
    sizeVram: number;
    expiresAt: string;
    digest: string;
  }[];
  totalVramUsed?: number;
}

export interface HealthCheckMetrics {
  totalChecks: number;
  successfulChecks: number;
  failedChecks: number;
  averageResponseTime: number;
  lastCheckTime: number;
}

export class HealthCheckScheduler {
  private config: HealthCheckConfig;
  private intervalId?: NodeJS.Timeout;
  private recoveryIntervalId?: NodeJS.Timeout;
  private activeTestIntervalId?: NodeJS.Timeout;
  private isRunning = false;
  private metrics: HealthCheckMetrics = {
    totalChecks: 0,
    successfulChecks: 0,
    failedChecks: 0,
    averageResponseTime: 0,
    lastCheckTime: 0,
  };

  // Track active test state per server:model
  private activeTestState: Map<
    string,
    {
      lastTestTime: number;
      testCount: number;
      consecutiveFailures: number;
      failureReason?: string;
      errorType?: 'retryable' | 'non-retryable' | 'transient' | 'permanent' | 'rateLimited';
    }
  > = new Map();

  // Track which servers are currently being tested (prevent concurrent tests on same server)
  private serversBeingTested: Map<
    string,
    {
      testStartTime: number;
      modelsTestedThisRound: number;
    }
  > = new Map();

  // Config: max models to test per server per health check cycle
  private readonly MAX_MODELS_PER_SERVER_PER_CYCLE = 1;
  // Config: cooldown between test rounds per server
  private readonly SERVER_TEST_COOLDOWN_MS = 5000; // 5 seconds

  // Callbacks
  private getServers?: () => AIServer[];
  private onHealthCheck?: (result: HealthCheckResult) => void;
  private onAllChecksComplete?: (results: HealthCheckResult[]) => void;
  // Callback to trigger active tests for a server (orchestrator looks up half-open models)
  private onRunActiveTests?: (
    server: AIServer
  ) => Promise<Array<{ model: string; success: boolean; duration: number; error?: string }>>;

  constructor(
    config: HealthCheckConfig,
    getServers?: () => AIServer[],
    onHealthCheck?: (result: HealthCheckResult) => void,
    onAllChecksComplete?: (results: HealthCheckResult[]) => void,
    onRunActiveTests?: (
      server: AIServer
    ) => Promise<Array<{ model: string; success: boolean; duration: number; error?: string }>>
  ) {
    this.config = config;
    this.getServers = getServers;
    this.onHealthCheck = onHealthCheck;
    this.onAllChecksComplete = onAllChecksComplete;
    this.onRunActiveTests = onRunActiveTests;
  }

  /**
   * Start the periodic health check scheduler
   */
  start(): void {
    if (this.isRunning || !this.config.enabled) {
      return;
    }

    this.isRunning = true;
    logger.info(`Health check scheduler started (interval: ${this.config.intervalMs}ms)`);

    // Start main health check interval
    this.intervalId = setInterval(() => {
      void this.runHealthChecks();
    }, this.config.intervalMs);

    // Start recovery checks for unhealthy servers
    this.recoveryIntervalId = setInterval(() => {
      void this.runRecoveryChecks();
    }, this.config.recoveryIntervalMs);

    // Run initial health checks
    setTimeout(() => void this.runHealthChecks(), 1000);
  }

  /**
   * Stop the health check scheduler
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    if (this.recoveryIntervalId) {
      clearInterval(this.recoveryIntervalId);
      this.recoveryIntervalId = undefined;
    }

    logger.info('Health check scheduler stopped');
  }

  /**
   * Run health checks on all servers with concurrency control
   */
  private async runHealthChecks(): Promise<void> {
    if (!this.isRunning || !this.getServers) {
      return;
    }

    try {
      logger.debug('Running scheduled health checks');

      const servers = this.getServers();
      if (servers.length === 0) {
        return;
      }

      // Run health checks with concurrency control
      const results: HealthCheckResult[] = [];

      // Process servers in batches to respect concurrency limits
      for (let i = 0; i < servers.length; i += this.config.maxConcurrentChecks) {
        const batch = servers.slice(i, i + this.config.maxConcurrentChecks);

        const batchPromises = batch.map(server => this.checkServerHealth(server));
        const batchResults = await Promise.all(batchPromises);

        results.push(...batchResults);

        // Run active tests for servers with successful health checks
        // The orchestrator will look up which models have half-open circuit breakers
        if (this.onRunActiveTests) {
          for (const result of batchResults) {
            if (result.success) {
              const server = servers.find(s => s.id === result.serverId);
              if (server) {
                // Orchestrator handles looking up half-open models and their failure reasons
                void this.onRunActiveTests(server);
              }
            }
          }
        }

        // Small delay between batches to avoid overwhelming the network
        if (i + this.config.maxConcurrentChecks < servers.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      this.onAllChecksComplete?.(results);
    } catch (error) {
      logger.error('Error during scheduled health checks:', { error });
    }
  }

  /**
   * Run recovery checks on unhealthy servers
   */
  private async runRecoveryChecks(): Promise<void> {
    if (!this.isRunning || !this.getServers) {
      return;
    }

    try {
      logger.debug('Running recovery health checks');

      const servers = this.getServers();
      const unhealthyServers = servers.filter(server => !server.healthy);

      if (unhealthyServers.length === 0) {
        return;
      }

      logger.debug(`Checking ${unhealthyServers.length} unhealthy servers for recovery`);

      // Check unhealthy servers with lower concurrency to be gentle
      const maxConcurrentRecovery = Math.min(this.config.maxConcurrentChecks, 2);
      const results: HealthCheckResult[] = [];

      for (let i = 0; i < unhealthyServers.length; i += maxConcurrentRecovery) {
        const batch = unhealthyServers.slice(i, i + maxConcurrentRecovery);

        const batchPromises = batch.map(server => this.checkServerHealth(server));
        const batchResults = await Promise.all(batchPromises);

        results.push(...batchResults);

        // Longer delay between recovery batches
        if (i + maxConcurrentRecovery < unhealthyServers.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      const recoveredCount = results.filter(r => r.success).length;
      if (recoveredCount > 0) {
        logger.info(
          `Recovery checks: ${recoveredCount}/${unhealthyServers.length} servers recovered`
        );
      }
      if (recoveredCount < unhealthyServers.length) {
        const failedRecoveries = results.filter(r => !r.success);
        logger.warn(
          `Recovery checks: ${unhealthyServers.length - recoveredCount}/${unhealthyServers.length} servers failed to recover`,
          {
            failedServers: failedRecoveries.map(r => ({ id: r.serverId, error: r.error })),
          }
        );
      }
    } catch (error) {
      logger.error('Error during recovery health checks:', { error });
    }
  }

  /**
   * Perform health check on a single server with retry logic
   */
  async checkServerHealth(server: AIServer, retryCount = 0): Promise<HealthCheckResult> {
    const useTimer = featureFlags.get('useTimerUtility');
    const timer = useTimer ? new Timer() : null;
    const startTime = timer ? undefined : Date.now();

    try {
      // Query /api/tags, /api/ps, and /v1/models in parallel
      // Server is healthy if either /api/tags OR /v1/models responds
      const [tagsResponse, psResponse, v1Response] = await Promise.all([
        fetchWithAuth(`${server.url}/api/tags`, server.apiKey, {
          timeout: this.config.timeoutMs,
        }).catch(() => null),
        fetchWithAuth(`${server.url}/api/ps`, server.apiKey, {
          timeout: 5000, // Shorter timeout for ps - don't fail health check if ps is slow
        }).catch(() => null), // Don't fail health check if ps endpoint fails
        fetchWithAuth(`${server.url}/v1/models`, server.apiKey, {
          timeout: 5000, // Shorter timeout for v1 - don't fail health check if not supported
        }).catch(() => null), // Don't fail health check if v1 endpoint fails
      ]);

      const responseTime = timer ? timer.elapsed() : Date.now() - startTime!;

      // Check which endpoints are supported
      const supportsOllama = tagsResponse?.ok ?? false;
      const supportsV1 = v1Response?.ok ?? false;

      // Update capability flags
      if (supportsOllama !== server.supportsOllama) {
        logger.info(`Server ${server.id} Ollama support changed: ${supportsOllama}`);
        server.supportsOllama = supportsOllama;
      }
      if (supportsV1 !== server.supportsV1) {
        logger.info(`Server ${server.id} /v1/* support changed: ${supportsV1}`);
        server.supportsV1 = supportsV1;
      }

      // Server is healthy if at least one endpoint works
      if (!supportsOllama && !supportsV1) {
        throw new Error('Neither /api/tags nor /v1/models responded');
      }

      // Extract Ollama models if available
      let models: string[] = [];
      if (tagsResponse?.ok) {
        const data = (await tagsResponse.json()) as { models?: unknown };
        if (data && typeof data === 'object' && 'models' in data) {
          models = this.extractModels(data.models);
        }
      }

      // Extract OpenAI models if available
      let v1Models: string[] = [];
      if (v1Response?.ok) {
        const data = (await v1Response.json()) as { data?: Array<{ id?: string }> };
        if (data && Array.isArray(data.data)) {
          v1Models = data.data
            .map((m: { id?: string }) => m.id)
            .filter((id): id is string => typeof id === 'string');
        }
      }

      // Parse ps data if available
      let loadedModels: { name: string; sizeVram: number; expiresAt: string; digest: string }[] =
        [];
      let totalVramUsed = 0;
      if (psResponse?.ok) {
        try {
          const psData = (await psResponse.json()) as { models?: unknown[] };
          if (psData.models && Array.isArray(psData.models)) {
            interface PsModel {
              name?: string;
              model?: string;
              size_vram?: number;
              expires_at?: string;
              digest?: string;
            }
            loadedModels = (psData.models as PsModel[]).map(m => ({
              name: m.name ?? m.model ?? '',
              sizeVram: m.size_vram ?? 0,
              expiresAt: m.expires_at ?? '',
              digest: m.digest ?? '',
            }));
            totalVramUsed = loadedModels.reduce((sum, m) => sum + (m.sizeVram || 0), 0);
          }
        } catch (psError) {
          logger.debug(`Failed to parse ps response for ${server.id}:`, psError);
        }
      }

      const result: HealthCheckResult = {
        serverId: server.id,
        success: true,
        responseTime,
        timestamp: Date.now(),
        models,
        v1Models,
        loadedModels,
        totalVramUsed,
        supportsOllama,
        supportsV1,
      };

      this.updateMetrics(result);
      this.onHealthCheck?.(result);

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const shouldRetry = retryCount < this.config.retryAttempts && this.shouldRetry(errorMessage);

      if (shouldRetry) {
        logger.debug(`Retrying health check for ${server.id} (attempt ${retryCount + 1})`);

        // Exponential backoff
        const delay =
          this.config.retryDelayMs * Math.pow(this.config.backoffMultiplier, retryCount);
        await new Promise(resolve => setTimeout(resolve, delay));

        return this.checkServerHealth(server, retryCount + 1);
      }

      const result: HealthCheckResult = {
        serverId: server.id,
        success: false,
        error: errorMessage,
        timestamp: Date.now(),
      };

      this.updateMetrics(result);
      this.onHealthCheck?.(result);

      return result;
    }
  }

  /**
   * Extract model names from the /api/tags response
   */
  private extractModels(models: unknown): string[] {
    if (!Array.isArray(models)) {
      return [];
    }

    return models
      .map((m: unknown) => {
        if (typeof m === 'string') {
          return m;
        }
        if (typeof m === 'object' && m !== null) {
          const model = m as { model?: string; name?: string };
          return model.model ?? model.name ?? null;
        }
        return null;
      })
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
  }

  /**
   * Check if an error should be retried
   */
  private shouldRetry(errorMessage: string): boolean {
    const retryablePatterns = [
      /timeout/i,
      /econnrefused/i,
      /econnreset/i,
      /etimedout/i,
      /enotfound/i, // DNS issues
      /network/i,
      /temporary/i,
    ];

    return retryablePatterns.some(pattern => pattern.test(errorMessage));
  }

  /**
   * Update metrics based on health check result
   */
  private updateMetrics(result: HealthCheckResult): void {
    this.metrics.totalChecks++;
    this.metrics.lastCheckTime = result.timestamp;

    if (result.success) {
      this.metrics.successfulChecks++;
      if (result.responseTime) {
        // Update rolling average
        const alpha = 0.1; // Smoothing factor
        this.metrics.averageResponseTime =
          alpha * result.responseTime + (1 - alpha) * this.metrics.averageResponseTime;
      }
    } else {
      this.metrics.failedChecks++;
    }
  }

  /**
   * Get current health check metrics
   */
  getMetrics(): HealthCheckMetrics {
    return { ...this.metrics };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<HealthCheckConfig>): void {
    this.config = { ...this.config, ...config };

    // Restart scheduler if interval changed
    if (config.intervalMs !== undefined || config.recoveryIntervalMs !== undefined) {
      this.restart();
    }

    logger.info('Health check scheduler configuration updated');
  }

  /**
   * Restart the scheduler (useful when config changes)
   */
  private restart(): void {
    this.stop();
    this.start();
  }

  /**
   * Check if scheduler is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Run active tests for half-open circuit breakers
   * Called after successful health checks to test model recovery
   */
  async runActiveTests(
    server: AIServer,
    halfOpenModels: Array<{
      model: string;
      failureReason?: string;
      errorType?: 'retryable' | 'non-retryable' | 'transient' | 'permanent' | 'rateLimited';
    }>,
    runTestFn: (
      serverId: string,
      model: string,
      timeoutMs: number
    ) => Promise<{ success: boolean; duration: number; error?: string; [key: string]: any }>,
    onTestStart?: (serverId: string, model: string) => void,
    onTestEnd?: (serverId: string, model: string) => void,
    getCurrentTimeout?: (serverId: string, model: string) => number
  ): Promise<
    Array<{ model: string; success: boolean; duration: number; error?: string; [key: string]: any }>
  > {
    const results: Array<{
      model: string;
      success: boolean;
      duration: number;
      error?: string;
      [key: string]: any;
    }> = [];

    for (const { model, failureReason, errorType } of halfOpenModels) {
      const stateKey = `${server.id}:${model}`;
      const state = this.activeTestState.get(stateKey) ?? {
        lastTestTime: 0,
        testCount: 0,
        consecutiveFailures: 0,
        failureReason: failureReason || 'unknown',
        errorType: errorType,
      };

      // Check if we should run a test based on progressive backoff
      const timeSinceLastTest = Date.now() - state.lastTestTime;
      const backoffDelay = this.calculateBackoffDelay(
        state.testCount,
        state.failureReason,
        state.errorType
      );

      if (timeSinceLastTest < backoffDelay) {
        logger.debug(
          `Skipping active test for ${stateKey}, backoff active (${Math.round(timeSinceLastTest / 1000)}s < ${Math.round(backoffDelay / 1000)}s)`
        );
        continue;
      }

      // Calculate appropriate timeout based on current timeout (doubling each test attempt)
      const timeoutMs = this.calculateActiveTestTimeout(state, server, model, getCurrentTimeout);

      logger.info(`Running active test for ${stateKey}`, {
        attempt: state.testCount + 1,
        timeoutMs,
        failureReason: state.failureReason,
        backoffDelay,
      });

      // Notify that test is starting (for circuit breaker active test tracking)
      if (onTestStart) {
        onTestStart(server.id, model);
      }

      try {
        const result = await runTestFn(server.id, model, timeoutMs);

        state.lastTestTime = Date.now();
        state.testCount++;

        if (result.success) {
          state.consecutiveFailures = 0;
          logger.info(`Active test succeeded for ${stateKey} in ${result.duration}ms`);
        } else {
          state.consecutiveFailures++;
          logger.warn(`Active test failed for ${stateKey}: ${result.error}`);
        }

        this.activeTestState.set(stateKey, state);
        results.push({ model, ...result });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Active test error for ${stateKey}:`, { error: errorMsg });

        state.lastTestTime = Date.now();
        state.testCount++;
        state.consecutiveFailures++;
        this.activeTestState.set(stateKey, state);

        results.push({ model, success: false, duration: 0, error: errorMsg });
      } finally {
        // Notify that test has ended
        if (onTestEnd) {
          onTestEnd(server.id, model);
        }
      }

      // Small delay between tests to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return results;
  }

  /**
   * Calculate backoff delay based on number of attempts, error type, and failure reason
   * Progressive backoff: 30s, 60s, 2min, 4min, 8min, 15min, 30min, then stop testing
   * For non-retryable/permanent errors: use much longer delays (5min, 10min, 20min, 40min, 60min, then stop)
   */
  private calculateBackoffDelay(
    testCount: number,
    failureReason?: string,
    errorType?: 'retryable' | 'non-retryable' | 'transient' | 'permanent' | 'rateLimited'
  ): number {
    const failureReasonLower = failureReason?.toLowerCase() || '';

    // Check for permanent/non-retryable errors - these need much longer backoff
    const isPermanentError = errorType === 'non-retryable' || errorType === 'permanent';
    const isMemoryError =
      failureReasonLower.includes('memory') ||
      failureReasonLower.includes('ram') ||
      failureReasonLower.includes('oom');
    const isRunnerStopped =
      failureReasonLower.includes('runner') || failureReasonLower.includes('terminated');

    // CRITICAL: Check for model capability errors (embedding models that don't support generate)
    // These will NEVER succeed and should stop testing immediately after 1-2 attempts
    const isModelCapabilityError =
      failureReasonLower.includes('does not support generate') ||
      failureReasonLower.includes('does not support chat') ||
      failureReasonLower.includes('unsupported operation');

    // Check for model file corruption/permanent infrastructure errors
    // These won't fix themselves without manual intervention
    const isModelFileError =
      failureReasonLower.includes('unable to load model') ||
      failureReasonLower.includes('invalid file magic') ||
      failureReasonLower.includes('unsupported model format') ||
      failureReasonLower.includes('invalid model format') ||
      failureReasonLower.includes('model file not found') ||
      (failureReasonLower.includes('blob') && failureReasonLower.includes('sha256'));

    // Model capability errors: Stop after 2 attempts (immediate then one retry)
    if (isModelCapabilityError) {
      if (testCount >= 2) {
        logger.warn(
          `Stopping active tests for model capability error after ${testCount} attempts: ${failureReason}`
        );
        return Infinity;
      }
      // Very short backoff - test once more to confirm, then stop
      return 30000; // 30 seconds
    }

    // Model file errors: Stop after 3 attempts
    if (isModelFileError) {
      if (testCount >= 3) {
        logger.warn(
          `Stopping active tests for model file error after ${testCount} attempts: ${failureReason}`
        );
        return Infinity;
      }
      // Moderate backoff for file errors - might be temporary filesystem issue
      const fileErrorDelays = [60000, 300000, 600000]; // 1min, 5min, 10min
      return fileErrorDelays[Math.min(testCount, fileErrorDelays.length - 1)];
    }

    if (isPermanentError || isMemoryError || isRunnerStopped) {
      // For permanent errors, use much longer delays
      // Stop testing after 5 attempts (max ~60min backoff)
      if (testCount >= 5) {
        return Infinity;
      }

      const permanentDelays = [
        5 * 60 * 1000, // 5 minutes
        10 * 60 * 1000, // 10 minutes
        20 * 60 * 1000, // 20 minutes
        40 * 60 * 1000, // 40 minutes
        60 * 60 * 1000, // 60 minutes
      ];

      return permanentDelays[Math.min(testCount, permanentDelays.length - 1)];
    }

    // Standard progressive backoff for retryable errors
    // Stop testing after 8 attempts (max ~30min backoff)
    if (testCount >= 8) {
      return Infinity;
    }

    const baseDelay = 30000; // 30 seconds
    const multiplier = Math.pow(2, testCount);
    let delay = baseDelay * multiplier;

    // Cap at 30 minutes
    const maxDelay = 30 * 60 * 1000;
    delay = Math.min(delay, maxDelay);

    return delay;
  }

  /**
   * Calculate appropriate timeout for active test based on current circuit timeout
   * Doubles the current timeout for each test attempt to allow for model loading
   */
  private calculateActiveTestTimeout(
    state: {
      failureReason?: string;
      testCount: number;
      errorType?: 'retryable' | 'non-retryable' | 'transient' | 'permanent' | 'rateLimited';
    },
    server: AIServer,
    model: string,
    getCurrentTimeout?: (serverId: string, model: string) => number
  ): number {
    // Get current timeout as base, defaulting to 60 seconds
    let baseTimeout = 60000; // 60 seconds default
    if (getCurrentTimeout) {
      baseTimeout = getCurrentTimeout(server.id, model);
    }

    const failureReasonLower = state.failureReason?.toLowerCase() || '';

    // Check for model capability errors - these fail immediately, no need for long timeout
    if (
      failureReasonLower.includes('does not support generate') ||
      failureReasonLower.includes('does not support chat') ||
      failureReasonLower.includes('unsupported operation')
    ) {
      return 5000; // 5 seconds - just enough to get the error response
    }

    // Check for model file errors - these also fail quickly
    if (
      failureReasonLower.includes('unable to load model') ||
      failureReasonLower.includes('invalid file magic') ||
      failureReasonLower.includes('unsupported model format') ||
      failureReasonLower.includes('invalid model format')
    ) {
      return 10000; // 10 seconds - model loading will fail fast
    }

    // Check for permanent errors - these need quick tests (or no test at all)
    if (state.errorType === 'non-retryable' || state.errorType === 'permanent') {
      // For permanent errors, don't waste time on long timeouts
      return 15000; // Quick 15 second test
    }

    // Check for memory errors
    if (
      failureReasonLower.includes('memory') ||
      failureReasonLower.includes('oom') ||
      failureReasonLower.includes('system memory')
    ) {
      // Memory errors - quick test (model may not load at all)
      return 10000; // 10 seconds
    }

    // Different strategies based on failure reason
    switch (state.failureReason) {
      case 'timeout': {
        // For timeouts, double the current timeout each attempt
        // Start at current timeout * 2, then * 4, * 8, etc.
        const timeoutMultiplier = Math.pow(2, Math.min(state.testCount + 1, 10));
        const maxTimeout = 15 * 60 * 1000; // 15 minutes max
        return Math.min(baseTimeout * timeoutMultiplier, maxTimeout);
      }

      case 'model_not_found': {
        // Model not available - quick test
        return 5000; // 5 seconds
      }

      case 'connection_refused': {
        // Connection issues - moderate test based on current timeout
        return baseTimeout;
      }

      default: {
        // Unknown/other errors - double current timeout each attempt
        const timeoutMultiplier = Math.pow(2, Math.min(state.testCount + 1, 10));
        const maxTimeout = 15 * 60 * 1000; // 15 minutes max
        return Math.min(baseTimeout * timeoutMultiplier, maxTimeout);
      }
    }
  }

  /**
   * Reset active test state for a server:model (call when circuit breaker closes)
   */
  resetActiveTestState(serverId: string, model: string): void {
    const key = `${serverId}:${model}`;
    this.activeTestState.delete(key);
    logger.debug(`Reset active test state for ${key}`);
  }

  /**
   * Get active test state for monitoring
   */
  getActiveTestStates(): Array<{
    serverModel: string;
    lastTestTime: number;
    testCount: number;
    consecutiveFailures: number;
    failureReason?: string;
    nextTestInMs: number;
  }> {
    const now = Date.now();
    return Array.from(this.activeTestState.entries()).map(([key, state]) => ({
      serverModel: key,
      ...state,
      nextTestInMs: Math.max(
        0,
        this.calculateBackoffDelay(state.testCount, state.failureReason) -
          (now - state.lastTestTime)
      ),
    }));
  }
}
