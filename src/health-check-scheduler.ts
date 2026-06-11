/**
 * health-check-scheduler.ts
 * Periodic health check scheduler with configurable intervals and concurrency
 */

import type { HealthCheckConfig } from './config/config.js';
import type { AIServer } from './orchestrator/orchestrator.types.js';
import { resolveApiKey } from './utils/api-keys.js';
import { sleep } from './utils/async-helpers.js';
import { fetchWithTimeout } from './utils/fetch-with-timeout.js';
import { logger } from './utils/logger.js';
import { probeCoordinator } from './utils/probe-coordinator.js';
import { calculateActiveTestTimeout, calculateRecoveryBackoff } from './utils/recovery-backoff.js';
import { Timer } from './utils/timer.js';

const PROBE_MODEL = '__probe_nonexistent_model_000000__';
const PROBE_TIMEOUT_MS = 10_000;
const LIGHTWEIGHT_PROBE_TIMEOUT_MS = 2_000;

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

export interface HealthCheckModelDetail {
  name: string;
  parameterSize?: string;
  family?: string;
  quantization?: string;
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
  supportsAnthropic?: boolean;
  // NEW: OpenAI-compatible models
  v1Models?: string[];
  probedEndpoints?: AIServer['probedEndpoints'];
  // Loaded model information from /api/ps
  loadedModels?: {
    name: string;
    sizeVram: number;
    expiresAt: string;
    digest: string;
  }[];
  totalVramUsed?: number;
  /** Per-model metadata extracted from /api/tags details */
  modelDetails?: HealthCheckModelDetail[];
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
  private initialTimeoutId?: NodeJS.Timeout;
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

  // Track jitter offsets per server to spread out health checks (thundering herd prevention)
  private serverJitterOffsets: Map<string, number> = new Map();

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

    // Run initial health checks after a short delay
    this.initialTimeoutId = setTimeout(() => {
      this.initialTimeoutId = undefined;
      void this.runHealthChecks();
    }, 1000);

    // Start main health check interval
    this.intervalId = setInterval(() => {
      void this.runHealthChecks();
    }, this.config.intervalMs);

    // Start recovery checks for unhealthy servers
    this.recoveryIntervalId = setInterval(() => {
      void this.runRecoveryChecks();
    }, this.config.recoveryIntervalMs);
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

    if (this.initialTimeoutId) {
      clearTimeout(this.initialTimeoutId);
      this.initialTimeoutId = undefined;
    }

    if (this.activeTestIntervalId) {
      clearInterval(this.activeTestIntervalId);
      this.activeTestIntervalId = undefined;
    }

    logger.info('Health check scheduler stopped');
    this.serverJitterOffsets.clear();
  }

  private clearServerTimeouts(): void {
    // No-op placeholder - individual server timeouts are managed internally
    // by the setTimeout closures that check this.isRunning
  }

  /**
   * Run health checks on all servers with concurrency control and per-server jitter
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

      // Ensure jitter offsets exist for all servers
      for (const server of servers) {
        if (!this.serverJitterOffsets.has(server.id)) {
          this.serverJitterOffsets.set(server.id, 0.9 + Math.random() * 0.2);
        }
      }

      const results: HealthCheckResult[] = [];

      for (let i = 0; i < servers.length; i += this.config.maxConcurrentChecks) {
        const batch = servers.slice(i, i + this.config.maxConcurrentChecks);

        // Apply per-server jitter delay (spread across the interval)
        const batchPromises = batch.map(async server => {
          const jitterOffset = this.serverJitterOffsets.get(server.id) ?? 1.0;
          // Jitter delay: multiply by (jitterOffset - 0.9) * interval * 0.33
          // This gives 0-10% of interval as delay (0.9-1.0 → 0-3.3%, 1.0-1.1 → 3.3-10%)
          const jitterDelayMs = (jitterOffset - 0.9) * this.config.intervalMs * 0.33;
          if (jitterDelayMs > 0) {
            await sleep(jitterDelayMs);
          }
          return this.checkServerHealth(server);
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        if (i + this.config.maxConcurrentChecks < servers.length) {
          await sleep(100);
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
          await sleep(500);
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
    if (!probeCoordinator.tryAcquire(server.id)) {
      logger.debug(`Health check for ${server.id} skipped - probe already in progress`);
      return {
        serverId: server.id,
        success: false,
        error: 'Probe already in progress',
        timestamp: Date.now(),
      };
    }
    const useTimer = true;
    const timer = useTimer ? new Timer() : null;
    const startTime = timer ? undefined : Date.now();

    try {
      // Query /api/tags, /api/ps, and /v1/models in parallel
      // Probe selection: openai=skip ollama probes, others probe both (unless forcedCapabilities overrides)
      const probeOllama =
        server.type !== 'openai' && server.forcedCapabilities?.supportsOllama !== false;
      const probeV1 = server.forcedCapabilities?.supportsV1 !== false;

      const [tagsResponse, psResponse, v1Response] = await Promise.all([
        probeOllama
          ? fetchWithAuth(`${server.url}/api/tags`, server.apiKey, {
              timeout: this.config.timeoutMs,
            }).catch((err: unknown) => {
              logger.warn('Health probe failed for /api/tags', {
                serverId: server.id,
                error: String(err),
              });
              return null;
            })
          : Promise.resolve(null),
        probeOllama
          ? fetchWithAuth(`${server.url}/api/ps`, server.apiKey, {
              timeout: 5000,
            }).catch((err: unknown) => {
              logger.warn('Health probe failed for /api/ps', {
                serverId: server.id,
                error: String(err),
              });
              return null;
            })
          : Promise.resolve(null),
        probeV1
          ? fetchWithAuth(`${server.url}/v1/models`, server.apiKey, {
              timeout: LIGHTWEIGHT_PROBE_TIMEOUT_MS,
            }).catch((err: unknown) => {
              const errorMsg = String(err);
              // Distinguish between timeout (connection was made, server slow) and network error (connection refused/reset)
              // Timeout error message format: "Request timeout after Xms: URL"
              if (errorMsg.includes('timeout')) {
                // Endpoint exists but responded slowly - treat as positive result
                // We create a minimal response-like object since we can't create actual Response
                logger.debug('Health probe timeout for /v1/models - endpoint exists but slow', {
                  serverId: server.id,
                });
                return { ok: true, json: () => () => ({ data: [] }) } as unknown as Response;
              }
              // Network error (ECONNREFUSED, ECONNRESET, etc.) - endpoint doesn't exist
              logger.warn('Health probe failed for /v1/models', {
                serverId: server.id,
                error: errorMsg,
              });
              return null;
            })
          : Promise.resolve(null),
      ]);

      const responseTime = timer ? timer.elapsed() : Date.now() - startTime!;

      // Run inference endpoint probes in parallel (all 7 inference endpoints)
      const probedEndpoints = await this.runEndpointProbes(server);

      // Apply forcedCapabilities overrides if present
      const forced = server.forcedCapabilities ?? {};

      const inferredOllama =
        probedEndpoints.ollama_chat ||
        probedEndpoints.ollama_generate ||
        probedEndpoints.ollama_embeddings ||
        false;
      const inferredV1 =
        probedEndpoints.openai_chat ||
        probedEndpoints.openai_completions ||
        probedEndpoints.openai_embeddings ||
        false;
      const inferredAnthropic = probedEndpoints.anthropic_messages || false;

      const v1EndpointExistence = await this.probeV1EndpointExistence(server);

      const supportsOllama = forced.supportsOllama ?? (tagsResponse?.ok || inferredOllama);

      const supportsV1 =
        forced.supportsV1 ??
        (v1Response?.ok === true ? true : undefined) ??
        (v1EndpointExistence.exists ? true : undefined) ??
        (inferredV1 ? true : undefined);

      logger.debug(`Server ${server.id} supportsV1 detection`, {
        forced: forced.supportsV1 ?? 'undefined',
        v1ResponseOk: v1Response?.ok,
        v1EndpointExists: v1EndpointExistence.exists,
        inferredV1,
        finalResult: supportsV1,
      });

      const supportsAnthropic = forced.supportsAnthropic ?? inferredAnthropic;

      // Update capability flags
      if (supportsOllama !== server.supportsOllama) {
        logger.info(`Server ${server.id} Ollama support changed: ${supportsOllama}`);
        server.supportsOllama = supportsOllama;
      }
      if (supportsV1 !== server.supportsV1) {
        logger.info(`Server ${server.id} /v1/* support changed: ${supportsV1}`);
        server.supportsV1 = supportsV1;
      }

      server.probedEndpoints = probedEndpoints;
      if (supportsAnthropic !== server.supportsAnthropic) {
        logger.info(`Server ${server.id} Anthropic support changed: ${supportsAnthropic}`);
        server.supportsAnthropic = supportsAnthropic;
      }

      // Server is healthy if at least one endpoint works
      if (!supportsOllama && !supportsV1 && !supportsAnthropic) {
        throw new Error('No inference endpoints responded (Ollama, OpenAI, or Anthropic)');
      }

      // Extract Ollama models if available
      let models: string[] = [];
      let modelDetails: HealthCheckModelDetail[] = [];
      if (tagsResponse?.ok) {
        const data = (await tagsResponse.json()) as { models?: unknown };
        if (data && typeof data === 'object' && 'models' in data) {
          models = this.extractModels(data.models);
          modelDetails = this.extractModelDetails(data.models);
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
        modelDetails,
        v1Models,
        loadedModels,
        totalVramUsed,
        supportsOllama,
        supportsV1,
        supportsAnthropic,
        probedEndpoints,
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
        await sleep(delay);

        probeCoordinator.release(server.id);
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
    } finally {
      probeCoordinator.release(server.id);
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

  private extractModelDetails(models: unknown): HealthCheckModelDetail[] {
    if (!Array.isArray(models)) {
      return [];
    }

    const details: HealthCheckModelDetail[] = [];
    for (const m of models) {
      if (typeof m !== 'object' || m === null) {
        continue;
      }
      const rec = m as Record<string, unknown>;
      const name = (rec.model as string | undefined) ?? (rec.name as string | undefined);
      if (!name) {
        continue;
      }
      const det = rec.details as Record<string, unknown> | undefined;
      details.push({
        name,
        parameterSize: (det?.parameter_size as string | undefined) || undefined,
        family: (det?.family as string | undefined) || undefined,
        quantization: (det?.quantization_level as string | undefined) || undefined,
      });
    }
    return details;
  }

  private interpretV1Status(status: number): 'exists' | 'not_exists' | 'error' {
    // For v1 endpoints specifically:
    // - 2xx = exists (good)
    // - 400 "model not found" = exists but model doesn't (good - endpoint works!)
    // - 401/403 = exists but auth issues (good - endpoint exists!)
    // - 404/405/410 = doesn't exist (bad)
    // - 422 = validation error = exists (good)
    // - Other 4xx = exists but other issues (good)
    // - Network error = doesn't exist (bad)
    if (status >= 200 && status < 300) {return 'exists';}
    if (status === 400 || status === 401 || status === 403 || status === 422 || status === 429)
      {return 'exists';}
    if (status === 404 || status === 405 || status === 410) {return 'not_exists';}
    if (status >= 400) {return 'exists';} // Other 4xx = exists but issues
    return 'error';
  }

  private async probeInferenceEndpoint(
    url: string,
    method: string,
    body: object,
    apiKey?: string,
    headerName?: string,
    headerPrefix?: string
  ): Promise<{ exists: boolean; healthy: boolean; status: number }> {
    try {
      const resolvedKey = resolveApiKey(apiKey);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (resolvedKey) {
        const authHeader = headerName || 'Authorization';
        const authPrefix = headerPrefix ?? 'Bearer';
        headers[authHeader] = authPrefix ? `${authPrefix} ${resolvedKey}` : resolvedKey;
      }
      const res = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      const status = res.status;
      const exists =
        (status >= 200 && status < 300) ||
        status === 400 ||
        status === 401 ||
        status === 403 ||
        status === 429;
      const healthy = status >= 200 && status < 300;
      return { exists, healthy, status };
    } catch {
      return { exists: false, healthy: false, status: 0 };
    }
  }

  private async probeV1EndpointExistence(
    server: AIServer,
    timeoutMs: number = LIGHTWEIGHT_PROBE_TIMEOUT_MS
  ): Promise<{ exists: boolean; healthy: boolean; status: number }> {
    try {
      const resolvedKey = resolveApiKey(server.apiKey);
      const headers: Record<string, string> = {};
      if (resolvedKey) {
        headers['Authorization'] = `Bearer ${resolvedKey}`;
      }

      // Try HEAD first, fall back to GET if HEAD not supported
      let res: Response;
      try {
        res = await fetchWithTimeout(`${server.url}/v1/models`, {
          method: 'HEAD',
          headers,
          timeout: timeoutMs,
        });
      } catch {
        // Fall back to GET if HEAD fails
        res = await fetchWithTimeout(`${server.url}/v1/models`, {
          method: 'GET',
          headers,
          timeout: timeoutMs,
        });
      }

      const status = res.status;
      const interpretation = this.interpretV1Status(status);
      if (interpretation === 'exists') {
        return { exists: true, healthy: status >= 200 && status < 300, status };
      } else {
        return { exists: false, healthy: false, status };
      }
    } catch {
      // Network error - endpoint doesn't exist
      return { exists: false, healthy: false, status: 0 };
    }
  }

  /**
   * Lightweight POST probe to /v1/chat/completions with minimal payload
   * Uses 2s timeout to prevent model loading
   * Treats 400/422 as positive (endpoint works, model doesn't exist)
   * Treats timeout as "endpoint exists but slow" = positive
   */
  async probeV1EndpointsLightweight(
    server: AIServer
  ): Promise<{ exists: boolean; healthy: boolean; status: number }> {
    try {
      const resolvedKey = resolveApiKey(server.apiKey);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (resolvedKey) {
        headers['Authorization'] = `Bearer ${resolvedKey}`;
      }

      const res = await fetchWithTimeout(`${server.url}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: '__probe__',
          messages: [],
          max_tokens: 1,
        }),
        timeout: LIGHTWEIGHT_PROBE_TIMEOUT_MS,
      });

      const status = res.status;
      const interpretation = this.interpretV1Status(status);
      const exists = interpretation === 'exists';
      const healthy = exists && status >= 200 && status < 300;
      return { exists, healthy, status };
    } catch {
      // Timeout or network error - endpoint exists but didn't respond in time
      // This is still considered "exists" since we got a connection
      return { exists: true, healthy: false, status: 0 };
    }
  }

  private async runEndpointProbes(
    server: AIServer
  ): Promise<NonNullable<AIServer['probedEndpoints']>> {
    const base = server.url;
    const key = server.apiKey;
    const overrides = server.endpointOverrides;

    const anthropicPath = overrides?.anthropic_messages ?? '/v1/messages';
    const anthropicAuth = overrides?.anthropic_auth;
    const anthropicHeaderName = anthropicAuth?.headerName;
    const anthropicHeaderPrefix = anthropicAuth?.headerPrefix;

    const [
      ollamaChat,
      ollamaGenerate,
      ollamaEmbeddings,
      openaiChat,
      openaiCompletions,
      openaiEmbeddings,
      anthropicMessages,
    ] = await Promise.all([
      this.probeInferenceEndpoint(
        `${base}/api/chat`,
        'POST',
        { model: PROBE_MODEL, messages: [{ role: 'user', content: 'probe' }], stream: false },
        key
      ),
      this.probeInferenceEndpoint(
        `${base}/api/generate`,
        'POST',
        { model: PROBE_MODEL, prompt: 'probe', stream: false },
        key
      ),
      this.probeInferenceEndpoint(
        `${base}/api/embeddings`,
        'POST',
        { model: PROBE_MODEL, prompt: 'probe' },
        key
      ),
      this.probeInferenceEndpoint(
        `${base}/v1/chat/completions`,
        'POST',
        { model: PROBE_MODEL, messages: [{ role: 'user', content: 'probe' }], stream: false },
        key
      ),
      this.probeInferenceEndpoint(
        `${base}/v1/completions`,
        'POST',
        { model: PROBE_MODEL, prompt: 'probe', stream: false },
        key
      ),
      this.probeInferenceEndpoint(
        `${base}/v1/embeddings`,
        'POST',
        { model: PROBE_MODEL, input: 'probe' },
        key
      ),
      this.probeInferenceEndpoint(
        `${base}${anthropicPath}`,
        'POST',
        { model: PROBE_MODEL, max_tokens: 1, messages: [{ role: 'user', content: 'probe' }] },
        key,
        anthropicHeaderName,
        anthropicHeaderPrefix
      ),
    ]);

    return {
      ollama_chat: ollamaChat.exists,
      ollama_generate: ollamaGenerate.exists,
      ollama_embeddings: ollamaEmbeddings.exists,
      openai_chat: openaiChat.exists,
      openai_completions: openaiCompletions.exists,
      openai_embeddings: openaiEmbeddings.exists,
      anthropic_messages: anthropicMessages.exists,
    };
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
      /neither.*responded/i, // Both probes returned null (connection failure)
      /no inference endpoints responded/i,
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
      await sleep(1000);
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
    const result = calculateRecoveryBackoff({
      attempt: testCount,
      failureReason,
      errorType,
    });

    if (result.shouldStop) {
      logger.warn(`Stopping active tests after ${testCount} attempts: ${result.stopReason}`);
      return Infinity;
    }

    return result.delayMs;
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
    // Get current timeout as base, defaulting to 120 seconds
    let baseTimeout = 120000;
    if (getCurrentTimeout) {
      baseTimeout = getCurrentTimeout(server.id, model);
    }

    return calculateActiveTestTimeout(
      state.testCount,
      baseTimeout,
      state.failureReason,
      state.errorType
    );
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
