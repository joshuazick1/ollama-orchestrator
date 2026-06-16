/**
 * routing.ts
 * Orchestrator Router - Handles request routing, failover, and retry logic
 */

import type { RetryConfig } from '../config/config.js';
import { getDecisionHistory } from '../decision-history.js';
import { getRequestHistory } from '../request-history.js';
import { getMetricsStore } from '../storage/metrics-store.js';
import { sleep } from '../utils/async-helpers.js';
import { calculateBackoff, fromRetryConfig } from '../utils/backoff/index.js';
import { classifyError, type ErrorType } from '../utils/error-classifier.js';
import { logger } from '../utils/logger.js';
import { RetryBudget } from '../utils/retry-budget.js';

import type { AIOrchestrator } from './orchestrator.js';
import type { RoutingContext } from './orchestrator.js';
import type { AIServer, RequestContext } from './orchestrator.types.js';

export class OrchestratorRouter {
  constructor(private readonly orchestrator: AIOrchestrator) {}

  async tryRequestWithFailover<T>(
    model: string,
    fn: (server: AIServer, context?: { requestId?: string }) => Promise<T>,
    isStreaming: boolean = false,
    endpoint: 'generate' | 'embeddings' = 'generate',
    requiredCapability?: 'ollama' | 'openai' | 'anthropic',
    routingContext?: RoutingContext,
    signal?: AbortSignal,
    estimatedPromptTokens?: number,
    userId?: string,
    isAdmin?: boolean
  ): Promise<T> {
    const errors: Array<{ server: string; error: string; type?: ErrorType }> = [];
    const routingStartTime = Date.now();

    const retryBudget = new RetryBudget(
      (this.orchestrator.getConfig().retry as { maxBudget?: number })?.maxBudget ?? 10
    );

    const startTime = Date.now();
    const totalBudgetMs = this.orchestrator.getInferenceTimeoutMs() ?? 90000;
    const checkTotalBudget = (): boolean => Date.now() - startTime < totalBudgetMs;

    const executeFailoverPhase = async (
      phaseCandidates: AIServer[],
      phaseNum: 1 | 2,
      phaseIsRetry: boolean
    ): Promise<{ success: boolean; result?: T; serverId?: string }> => {
      for (const server of phaseCandidates) {
        if (signal?.aborted) {
          throw new Error('Request aborted');
        }
        if (!checkTotalBudget()) {
          throw new Error('Total timeout exceeded');
        }
        const maxConcurrency =
          server.maxConcurrency ?? this.orchestrator.getConfig().cooldown.defaultMaxConcurrency;
        if (
          !this.orchestrator
            .getInFlightManager()
            .tryIncrementInFlight(server.id, model, maxConcurrency)
        ) {
          concurrencySkipCount++;
          getDecisionHistory().recordFailoverAttempt({
            model,
            phase: phaseNum,
            serverId: server.id,
            result: 'skipped',
          });
          getMetricsStore().recordFailover({
            requestId: userRequestId,
            timestamp: Date.now(),
            model,
            phase: phaseNum,
            serverId: server.id,
            result: 'skipped',
          });
          continue;
        }
        const attemptStart = Date.now();
        const result = await this.tryRequestOnServerNoRetry(
          server,
          model,
          fn,
          isStreaming,
          errors,
          undefined,
          true,
          userRequestId,
          phaseIsRetry,
          routingContext
        );
        const attemptLatency = Date.now() - attemptStart;
        if (result.success) {
          getDecisionHistory().recordFailoverAttempt({
            model,
            phase: phaseNum,
            serverId: server.id,
            result: 'success',
            latencyMs: attemptLatency,
          });
          getMetricsStore().recordFailover({
            requestId: userRequestId,
            timestamp: Date.now(),
            model,
            phase: phaseNum,
            serverId: server.id,
            result: 'success',
            latencyMs: attemptLatency,
          });
          if (routingContext) {
            routingContext.retryCount = retryCount;
            routingContext.serversTried = [...allServersTried, server.id];
            routingContext.queueWaitTime = Date.now() - routingStartTime;
            routingContext.failoverPhase = phaseNum;
            routingContext.failoverCount = retryCount;
            routingContext.failoverOccurred = retryCount > 0;
            if (failoverErrors.length > 0) {
              routingContext.failoverErrors = failoverErrors;
            }
          }
          const serverMaxConcurrency =
            server.maxConcurrency ?? this.orchestrator.getConfig().cooldown.defaultMaxConcurrency;
          const serverLoad = this.orchestrator.getTotalInFlight(server.id);
          this.orchestrator.populateRoutingContext(
            routingContext,
            server.id,
            model,
            serverLoad,
            serverMaxConcurrency
          );
          return { success: true, result: result.value, serverId: server.id };
        }
        const lastError = errors[errors.length - 1];
        getDecisionHistory().recordFailoverAttempt({
          model,
          phase: phaseNum,
          serverId: server.id,
          result: 'failure',
          errorType: lastError?.type,
          latencyMs: attemptLatency,
        });
        getMetricsStore().recordFailover({
          requestId: userRequestId,
          timestamp: Date.now(),
          model,
          phase: phaseNum,
          serverId: server.id,
          result: 'failure',
          errorType: lastError?.type,
          latencyMs: attemptLatency,
        });
        allServersTried.push(server.id);
        if (lastError) {
          failoverErrors.push({
            serverId: server.id,
            error: lastError.error,
            errorType: lastError.type,
          });
        }
        retryCount++;
        retryBudget.recordAttempt(server.id);
        if (retryBudget.isExhausted()) {
          const uniqueServerCount = new Set(allServersTried).size;
          throw new Error(
            `Retry budget exhausted after ${retryBudget.getAttemptsUsed()} attempts across ${uniqueServerCount} servers`
          );
        }
        logger.info(`Server ${server.id} failed, failing over to next candidate`, { model });
      }
      return { success: false };
    };

    if (signal?.aborted) {
      throw new Error('Request aborted');
    }

    const clusterBackoffMs = this.orchestrator.getErrorAggregator().getBackoffForCluster();
    const rateLimitedServerIds = Object.keys(
      this.orchestrator.getErrorAggregator().getErrorSummary().rateLimitServers
    );

    const eligibleForBackoff = this.orchestrator.getServers().filter(s => {
      if (requiredCapability === 'ollama' && s.supportsOllama === false) {
        return false;
      }
      if (requiredCapability === 'openai') {
        const hasV1Evidence =
          s.supportsV1 === true ||
          (s.v1Models && s.v1Models.length > 0) ||
          (s.discoveredV1Models && s.discoveredV1Models.length > 0);
        if (!hasV1Evidence) {
          return false;
        }
      }
      if (requiredCapability === 'anthropic' && s.supportsAnthropic === false) {
        return false;
      }
      return (
        s.healthy &&
        !this.orchestrator.isInCooldown(s.id, model) &&
        !this.orchestrator.getBanManager().isBanned(s.id, model)
      );
    });

    const shouldDelay =
      clusterBackoffMs > 0 && eligibleForBackoff.some(s => rateLimitedServerIds.includes(s.id));
    if (shouldDelay) {
      await sleep(clusterBackoffMs);
    }

    let contextFilteredCount = 0;
    let smallestContextLimit = Infinity;
    const eligibleServers = this.orchestrator.getServers().filter(s => {
      if (requiredCapability === 'ollama' && s.supportsOllama === false) {
        return false;
      }
      const hasV1Evidence =
        s.supportsV1 === true ||
        (s.v1Models && s.v1Models.length > 0) ||
        (s.discoveredV1Models && s.discoveredV1Models.length > 0);

      if (requiredCapability === 'openai' && !hasV1Evidence) {
        return false;
      }
      if (requiredCapability === 'anthropic' && s.supportsAnthropic === false) {
        return false;
      }

      const availableModels =
        requiredCapability === 'openai' || requiredCapability === 'anthropic'
          ? (s.v1Models ?? s.models)
          : s.models;

      const resolvedModel = this.orchestrator.resolveModelName(model, availableModels);
      if (!resolvedModel) {
        return false;
      }

      if (estimatedPromptTokens !== undefined && estimatedPromptTokens > 100) {
        if (!this.orchestrator.canServerHandleContext(s, model, estimatedPromptTokens)) {
          const contextLimit = this.orchestrator.getModelContextLimit(s, model);
          contextFilteredCount++;
          if (contextLimit < smallestContextLimit) {
            smallestContextLimit = contextLimit;
          }
          logger.debug(
            `Skipping server ${s.id} for ${model}: context limit ${contextLimit} < ${estimatedPromptTokens} tokens`
          );
          return false;
        }
      }

      return (
        s.healthy &&
        !this.orchestrator.isInCooldown(s.id, model) &&
        !this.orchestrator.getBanManager().isBanned(s.id, model) &&
        !this.orchestrator.shouldSkipServerModel(s.id, model, endpoint)
      );
    });

    let candidates: AIServer[] = [];
    const remainingServers = [...eligibleServers];

    let firstDecisionRecorded = false;

    while (remainingServers.length > 0) {
      const selected = this.orchestrator.getLoadBalancer().select(
        remainingServers,
        model,
        (serverId: string, model: string) => this.orchestrator.getModelInFlight(serverId, model),
        (serverId: string) => this.orchestrator.getTotalInFlight(serverId),
        (serverId: string, model: string) =>
          this.orchestrator.getMetricsAggregator().getMetricsWithFallback(serverId, model),
        isStreaming,
        undefined,
        (serverId: string, model: string) => this.orchestrator.getTimeout(serverId, model),
        estimatedPromptTokens,
        (serverId: string, model: string) =>
          this.orchestrator.getModelContextLimit(
            this.orchestrator.getServers().find(s => s.id === serverId)!,
            model
          ),
        userId,
        isAdmin
      );

      if (!selected) {
        break;
      }

      if (!firstDecisionRecorded) {
        const scores = remainingServers.map(server => {
          const totalLoad = this.orchestrator.getTotalInFlight(server.id);
          const metrics = this.orchestrator
            .getMetricsAggregator()
            .getMetricsWithFallback(server.id, model);
          return this.orchestrator.calculateServerScore(
            server,
            model,
            totalLoad,
            totalLoad,
            metrics,
            undefined,
            this.orchestrator.getTimeout(server.id, model),
            estimatedPromptTokens,
            (serverId, model) =>
              this.orchestrator.getModelContextLimit(
                this.orchestrator.getServers().find(s => s.id === serverId)!,
                model
              )
          );
        });

        getDecisionHistory().recordDecision(
          model,
          selected,
          this.orchestrator.getLoadBalancer().getAlgorithm(),
          scores,
          'failover_routing'
        );
        firstDecisionRecorded = true;
      }

      candidates.push(selected);
      const index = remainingServers.findIndex(s => s.id === selected.id);
      if (index >= 0) {
        remainingServers.splice(index, 1);
      }
    }

    if (candidates.length === 0) {
      let errorReason = 'No servers available';

      if (
        estimatedPromptTokens !== undefined &&
        estimatedPromptTokens > 100 &&
        contextFilteredCount > 0
      ) {
        throw new Error(
          `Prompt size (${estimatedPromptTokens} tokens) exceeds context limit on all ${contextFilteredCount} server(s) ` +
            `(smallest limit: ${smallestContextLimit === Infinity ? 'unknown' : smallestContextLimit} tokens) for model '${model}'. ` +
            'Consider splitting the prompt or using a server with a larger context window.'
        );
      }

      const capabilityServers = this.orchestrator.getServers().filter(s => {
        if (requiredCapability === 'ollama' && s.supportsOllama === false) {
          return false;
        }
        if (requiredCapability === 'openai' && s.supportsV1 === false) {
          return false;
        }
        if (requiredCapability === 'anthropic' && s.supportsAnthropic === false) {
          return false;
        }
        return true;
      });

      if (capabilityServers.length === 0) {
        errorReason = `No servers support required capability '${requiredCapability}'`;
      } else {
        const modelServers = capabilityServers.filter(s => {
          const availableModels =
            requiredCapability === 'openai' || requiredCapability === 'anthropic'
              ? (s.v1Models ?? s.models)
              : s.models;
          const resolvedModel = this.orchestrator.resolveModelName(model, availableModels);
          return resolvedModel !== null;
        });

        if (modelServers.length === 0) {
          errorReason = `Model '${model}' not found on any ${requiredCapability || 'configured'} server`;
        } else {
          const healthyServers = modelServers.filter(s => s.healthy);
          if (healthyServers.length === 0) {
            errorReason = 'All servers are unhealthy';
          } else {
            const availableServers = healthyServers.filter(
              s =>
                !this.orchestrator.getBanManager().isBanned(s.id, model) &&
                !this.orchestrator.isInCooldown(s.id, model) &&
                !this.orchestrator.shouldSkipServerModel(s.id, model, endpoint)
            );
            if (availableServers.length === 0) {
              const bannedCount = healthyServers.filter(s =>
                this.orchestrator.getBanManager().isBanned(s.id, model)
              ).length;
              const cooldownCount = healthyServers.filter(s =>
                this.orchestrator.isInCooldown(s.id, model)
              ).length;
              const circuitCount = healthyServers.filter(s =>
                this.orchestrator.shouldSkipServerModel(s.id, model, endpoint)
              ).length;

              if (bannedCount === healthyServers.length) {
                errorReason = 'All servers are permanently banned for this model';
              } else if (cooldownCount === healthyServers.length) {
                errorReason = 'All servers are in cooldown for this model';
              } else if (circuitCount === healthyServers.length) {
                errorReason = 'All servers have open circuit breakers for this model';
              } else {
                errorReason =
                  'All servers are unavailable (banned, in cooldown, or circuit breaker open)';
              }
            }
          }
        }
      }

      throw new Error(`${errorReason} for model '${model}'`);
    }

    const initialServer = candidates[0];

    if (routingContext) {
      routingContext.availableServerCount = candidates.length;
      routingContext.totalCandidates = candidates.length;
    }

    logger.info(`Selected server ${initialServer.id} for model ${model}`, {
      totalCandidates: candidates.length,
      initialServer: initialServer.id,
      serverHealth: initialServer.healthy,
      serverLoad: this.orchestrator.getTotalInFlight(initialServer.id),
    });

    const retryConfig = this.orchestrator.getConfig().retry;
    let retryCount = 0;
    let failoverPhase = 1;
    const failoverErrors: Array<{ serverId: string; error: string; errorType?: string }> = [];
    const allServersTried: string[] = [];
    let concurrencySkipCount = 0;
    const userRequestId = `ureq-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    if (!retryBudget.canRetry()) {
      throw new Error('Retry budget exhausted before any attempts');
    }

    logger.info(`Phase 1: Trying ${candidates.length} candidate(s) once each`, { model });
    const phase1Result = await executeFailoverPhase(candidates, 1, retryCount > 0);
    if (phase1Result.success && phase1Result.result) {
      return phase1Result.result;
    }

    failoverPhase = 2;
    if (signal?.aborted) {
      throw new Error('Request aborted');
    }
    candidates = candidates.filter(
      s =>
        s.healthy &&
        !this.orchestrator.isInCooldown(s.id, model) &&
        !this.orchestrator.getBanManager().isBanned(s.id, model) &&
        !this.orchestrator.shouldSkipServerModel(s.id, model, endpoint)
    );

    logger.info(`Phase 2: Retrying full cycle of ${candidates.length} candidate(s)`, { model });
    const phase2Result = await executeFailoverPhase(candidates, 2, true);
    if (phase2Result.success && phase2Result.result) {
      return phase2Result.result;
    }

    failoverPhase = 3;
    if (signal?.aborted) {
      throw new Error('Request aborted');
    }
    if (!retryBudget.canRetry()) {
      const uniqueServerCount = new Set(allServersTried).size;
      throw new Error(
        `Retry budget exhausted before Phase 3 after ${retryBudget.getAttemptsUsed()} attempts across ${uniqueServerCount} servers`
      );
    }
    logger.info(
      `Phase 3: All servers exhausted twice. Attempting same-server retries on initial server ${initialServer.id}`,
      { model }
    );
    const maxConcurrency =
      initialServer.maxConcurrency ?? this.orchestrator.getConfig().cooldown.defaultMaxConcurrency;
    const totalLoad = this.orchestrator.getTotalInFlight(initialServer.id);

    if (totalLoad < maxConcurrency) {
      const attemptStart3 = Date.now();
      const result = await this.tryRequestOnServerWithRetries(
        initialServer,
        model,
        fn,
        isStreaming,
        retryConfig,
        errors,
        undefined,
        userRequestId,
        routingContext
      );
      const attemptLatency3 = Date.now() - attemptStart3;

      if (result.success) {
        getDecisionHistory().recordFailoverAttempt({
          model,
          phase: 3,
          serverId: initialServer.id,
          result: 'success',
          latencyMs: attemptLatency3,
        });
        getMetricsStore().recordFailover({
          requestId: userRequestId,
          timestamp: Date.now(),
          model,
          phase: 3,
          serverId: initialServer.id,
          result: 'success',
          latencyMs: attemptLatency3,
        });
        if (routingContext) {
          routingContext.retryCount = retryCount;
          routingContext.serversTried = [...allServersTried, initialServer.id];
          routingContext.queueWaitTime = Date.now() - routingStartTime;
          routingContext.failoverPhase = 3;
          routingContext.failoverCount = retryCount;
          routingContext.failoverOccurred = true;
          if (failoverErrors.length > 0) {
            routingContext.failoverErrors = failoverErrors;
          }
        }
        this.orchestrator.populateRoutingContext(
          routingContext,
          initialServer.id,
          model,
          totalLoad,
          maxConcurrency
        );
        return result.value;
      }

      const lastError3 = errors[errors.length - 1];
      getDecisionHistory().recordFailoverAttempt({
        model,
        phase: 3,
        serverId: initialServer.id,
        result: 'failure',
        errorType: lastError3?.type,
        latencyMs: attemptLatency3,
      });
      getMetricsStore().recordFailover({
        requestId: userRequestId,
        timestamp: Date.now(),
        model,
        phase: 3,
        serverId: initialServer.id,
        result: 'failure',
        errorType: lastError3?.type,
        latencyMs: attemptLatency3,
      });
      allServersTried.push(initialServer.id);
      if (lastError3) {
        failoverErrors.push({
          serverId: initialServer.id,
          error: lastError3.error,
          errorType: lastError3.type,
        });
      }
      retryBudget.recordAttempt(initialServer.id);
      if (retryBudget.isExhausted()) {
        const uniqueServerCount = new Set(allServersTried).size;
        throw new Error(
          `Retry budget exhausted after ${retryBudget.getAttemptsUsed()} attempts across ${uniqueServerCount} servers`
        );
      }
    }

    if (routingContext) {
      routingContext.retryCount = retryCount;
      routingContext.serversTried = allServersTried;
      routingContext.failoverPhase = failoverPhase;
      routingContext.failoverCount = retryCount;
      routingContext.failoverOccurred = retryCount > 0;
      if (failoverErrors.length > 0) {
        routingContext.failoverErrors = failoverErrors;
      }
      routingContext.retryBudgetUsed = retryBudget.getAttemptsUsed();
      routingContext.retryBudgetMax =
        retryBudget.getAttemptsRemaining() + retryBudget.getAttemptsUsed();
    }

    let errorMessage: string;
    if (errors.length > 0) {
      errorMessage =
        `All ${candidates.length} candidate(s) failed after 2 full cycles and same-server retries. ` +
        `Errors: ${errors.map(e => `${e.server}: ${e.error.substring(0, 100)}`).join('; ')}`;
    } else if (concurrencySkipCount > 0) {
      errorMessage =
        `All ${candidates.length} server(s) for model '${model}' are at max concurrency` +
        ` (${concurrencySkipCount} concurrency-blocked across all phases)`;
    } else {
      errorMessage = `No servers available for model '${model}'`;
    }

    throw new Error(errorMessage);
  }

  async requestToServer<T>(
    serverId: string,
    model: string,
    fn: (server: AIServer, context?: { requestId?: string }) => Promise<T>,
    options: {
      isStreaming?: boolean;
      bypassCircuitBreaker?: boolean;
      signal?: AbortSignal;
      routingContext?: RoutingContext;
    } = {}
  ): Promise<T> {
    const {
      isStreaming: _isStreaming = false,
      bypassCircuitBreaker = false,
      signal,
      routingContext,
    } = options;

    if (signal?.aborted) {
      throw new Error('Request aborted');
    }

    const server = this.orchestrator.getServers().find(s => s.id === serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }

    if (!server.healthy && !bypassCircuitBreaker) {
      throw new Error(`Server is not healthy: ${serverId}`);
    }

    if (!server.models.includes(model)) {
      throw new Error(`Model '${model}' not available on server ${serverId}`);
    }

    if (!bypassCircuitBreaker && this.orchestrator.isInCooldown(server.id, model)) {
      throw new Error(`Server ${serverId} is in cooldown for model ${model}`);
    }

    if (!bypassCircuitBreaker && this.orchestrator.getBanManager().isBanned(server.id, model)) {
      throw new Error(`Server ${serverId} is permanently banned for model ${model}`);
    }

    if (!bypassCircuitBreaker && this.orchestrator.shouldSkipServerModel(server.id, model)) {
      throw new Error(`Circuit breaker is open for ${serverId}:${model}`);
    }

    this.orchestrator.incrementInFlight(server.id, model, bypassCircuitBreaker);

    const requestId = _isStreaming
      ? `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      : undefined;

    try {
      const result = await fn(server, requestId ? { requestId } : undefined);

      this.orchestrator.decrementInFlight(server.id, model, bypassCircuitBreaker);

      if (!bypassCircuitBreaker) {
        this.orchestrator.recordSuccess(server.id, model);
      }

      if (routingContext) {
        const serverLoad = this.orchestrator.getTotalInFlight(server.id);
        const maxConcurrency =
          server.maxConcurrency ?? this.orchestrator.getConfig().cooldown.defaultMaxConcurrency;
        routingContext.queueWaitTime = 0;
        this.orchestrator.populateRoutingContext(
          routingContext,
          server.id,
          model,
          serverLoad,
          maxConcurrency
        );
      }

      return result;
    } catch (error) {
      this.orchestrator.decrementInFlight(server.id, model, bypassCircuitBreaker);

      const errorMessage = error instanceof Error ? error.message : String(error);

      if (!bypassCircuitBreaker) {
        this.orchestrator.recordFailure(server.id, errorMessage, model);
      }

      throw error;
    }
  }

  async tryRequestOnServerNoRetry<T>(
    server: AIServer,
    model: string,
    fn: (server: AIServer, context?: { requestId?: string }) => Promise<T>,
    isStreaming: boolean,
    errors: Array<{ server: string; error: string; type?: ErrorType }>,
    _timeoutMs?: number,
    alreadyIncremented: boolean = false,
    parentRequestId?: string,
    isRetry: boolean = false,
    routingContext?: RoutingContext
  ): Promise<{ success: true; value: T } | { success: false }> {
    const wasActiveTestAtStart = false;

    const requestContext: RequestContext = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      startTime: Date.now(),
      serverId: server.id,
      model,
      endpoint: 'generate',
      streaming: isStreaming,
      success: false,
      parentRequestId,
      isRetry,
    };

    try {
      if (!alreadyIncremented) {
        this.orchestrator.incrementInFlight(server.id, model);
      }

      if (isStreaming) {
        this.orchestrator
          .getInFlightManager()
          .addStreamingRequest(requestContext.id, server.id, model);
      }

      const result = await fn(server, { requestId: requestContext.id });
      this.orchestrator.decrementInFlight(server.id, model);

      requestContext.endTime = Date.now();
      requestContext.duration = requestContext.endTime - requestContext.startTime;
      requestContext.success = true;

      if (!isStreaming && result && typeof result === 'object') {
        const ollamaResponse = result as Record<string, unknown>;
        if (typeof ollamaResponse.eval_count === 'number') {
          requestContext.tokensGenerated = ollamaResponse.eval_count;
        }
        if (typeof ollamaResponse.prompt_eval_count === 'number') {
          requestContext.tokensPrompt = ollamaResponse.prompt_eval_count;
        }
      }

      if (isStreaming && result && typeof result === 'object' && '_tokenMetrics' in result) {
        const tokenMetrics = (
          result as { _tokenMetrics?: { tokensGenerated?: number; tokensPrompt?: number } }
        )._tokenMetrics;
        if (tokenMetrics) {
          if (typeof tokenMetrics.tokensGenerated === 'number') {
            requestContext.tokensGenerated = tokenMetrics.tokensGenerated;
          }
          if (typeof tokenMetrics.tokensPrompt === 'number') {
            requestContext.tokensPrompt = tokenMetrics.tokensPrompt;
          }
        }
      }

      if (isStreaming && result && typeof result === 'object' && '_chunkData' in result) {
        const chunkData = (
          result as {
            _chunkData?: {
              chunkCount?: number;
              totalBytes?: number;
              maxChunkGapMs?: number;
              avgChunkSizeBytes?: number;
            };
          }
        )._chunkData;
        if (chunkData) {
          requestContext.chunkCount = chunkData.chunkCount;
          requestContext.totalBytes = chunkData.totalBytes;
          requestContext.maxChunkGapMs = chunkData.maxChunkGapMs;
          requestContext.avgChunkSizeBytes = chunkData.avgChunkSizeBytes;
        }
      }

      if (isStreaming && result && typeof result === 'object' && '_ollamaDurations' in result) {
        const od = (
          result as {
            _ollamaDurations?: {
              evalDuration?: number;
              promptEvalDuration?: number;
              totalDuration?: number;
              loadDuration?: number;
            };
          }
        )._ollamaDurations;
        if (od) {
          requestContext.evalDuration = od.evalDuration;
          requestContext.promptEvalDuration = od.promptEvalDuration;
          requestContext.totalDuration = od.totalDuration;
          requestContext.loadDuration = od.loadDuration;
        }
      }

      requestContext.queueWaitTime = routingContext?.queueWaitTime;
      this.orchestrator.getMetricsAggregator().recordRequest(requestContext);
      getRequestHistory().recordRequest(requestContext);
      getMetricsStore().recordRequest(requestContext);
      if (isStreaming) {
        this.orchestrator.getInFlightManager().removeStreamingRequest(requestContext.id);
      }

      this.orchestrator.resetServerFailureCount(server.id);
      this.orchestrator.recordSuccess(server.id, model);

      if (wasActiveTestAtStart && requestContext.duration > 0) {
        this.orchestrator
          .getTimeoutManager()
          .updateFromResponseTime(server.id, model, requestContext.duration, true);
        logger.info(
          `Active test success: updated timeout for ${server.id}:${model} to ${this.orchestrator.getTimeoutManager().getTimeout(server.id, model)}ms (3x ${requestContext.duration}ms response time)`
        );
      } else if (requestContext.duration > 5000) {
        this.orchestrator
          .getTimeoutManager()
          .updateFromResponseTime(server.id, model, requestContext.duration, false);
        logger.debug(
          `Updated timeout for ${server.id}:${model} to ${this.orchestrator.getTimeoutManager().getTimeout(server.id, model)}ms based on response time of ${requestContext.duration}ms`
        );
      }

      logger.info(`Request succeeded on ${server.id} for model ${model}`, {
        duration: requestContext.duration,
        wasActiveTest: wasActiveTestAtStart,
      });

      return { success: true, value: result };
    } catch (error) {
      this.orchestrator.decrementInFlight(server.id, model);

      if (isStreaming) {
        this.orchestrator.getInFlightManager().removeStreamingRequest(requestContext.id);
      }

      const lastError = error instanceof Error ? error : new Error(String(error));

      requestContext.endTime = Date.now();
      requestContext.duration = requestContext.endTime - requestContext.startTime;
      requestContext.success = false;
      requestContext.error = lastError;
      requestContext.queueWaitTime = routingContext?.queueWaitTime;
      this.orchestrator.getMetricsAggregator().recordRequest(requestContext);
      getRequestHistory().recordRequest(requestContext);
      getMetricsStore().recordRequest(requestContext);

      const errorMessage = lastError.message;
      const errorType = classifyError(errorMessage).type;

      if (errorType === 'rateLimited') {
        this.orchestrator.getErrorAggregator().recordError(server.id, 'rateLimited');
      }

      logger.warn(`Request failed on ${server.id} for model ${model}`, {
        error: errorMessage,
        errorType,
        duration: requestContext.duration,
      });

      this.orchestrator.handleServerError(server, model, errorMessage, errorType, errors);
      return { success: false };
    }
  }

  async tryRequestOnServerWithRetries<T>(
    server: AIServer,
    model: string,
    fn: (server: AIServer, context?: { requestId?: string }) => Promise<T>,
    isStreaming: boolean,
    retryConfig: RetryConfig,
    errors: Array<{ server: string; error: string; type?: ErrorType }>,
    _timeoutMs?: number,
    parentRequestId?: string,
    routingContext?: RoutingContext
  ): Promise<{ success: true; value: T } | { success: false }> {
    let lastError: Error | undefined;
    let retryCount = 0;

    const baseRequestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    logger.info(`Attempting request on server ${server.id} for model ${model} with retries`, {
      isStreaming,
      maxRetries: retryConfig.maxRetriesPerServer,
      serverHealth: server.healthy,
      serverLoad: this.orchestrator.getTotalInFlight(server.id),
    });

    while (retryCount <= retryConfig.maxRetriesPerServer) {
      const requestId = retryCount === 0 ? baseRequestId : `${baseRequestId}-retry-${retryCount}`;

      const requestContext: RequestContext = {
        id: requestId,
        startTime: Date.now(),
        serverId: server.id,
        model,
        endpoint: 'generate',
        streaming: isStreaming,
        success: false,
        parentRequestId,
        isRetry: retryCount > 0,
      };

      try {
        this.orchestrator.incrementInFlight(server.id, model);

        if (isStreaming) {
          this.orchestrator
            .getInFlightManager()
            .addStreamingRequest(requestContext.id, server.id, model);
        }

        if (retryCount > 0) {
          logger.info(
            `Retry ${retryCount}/${retryConfig.maxRetriesPerServer} on ${server.id} for model ${model}`
          );
        }

        const result = await fn(server, { requestId: requestContext.id });
        this.orchestrator.decrementInFlight(server.id, model);

        requestContext.endTime = Date.now();
        requestContext.duration = requestContext.endTime - requestContext.startTime;
        requestContext.success = true;

        if (isStreaming && result && typeof result === 'object' && '_streamingMetrics' in result) {
          const streamingMetrics = (
            result as { _streamingMetrics?: { ttft?: number; streamingDuration?: number } }
          )._streamingMetrics;
          if (streamingMetrics) {
            requestContext.ttft = streamingMetrics.ttft;
            requestContext.streamingDuration = streamingMetrics.streamingDuration;
          }
        }

        if (isStreaming && result && typeof result === 'object' && '_chunkData' in result) {
          const chunkData = (
            result as {
              _chunkData?: {
                chunkCount?: number;
                totalBytes?: number;
                maxChunkGapMs?: number;
                avgChunkSizeBytes?: number;
              };
            }
          )._chunkData;
          if (chunkData) {
            requestContext.chunkCount = chunkData.chunkCount;
            requestContext.totalBytes = chunkData.totalBytes;
            requestContext.maxChunkGapMs = chunkData.maxChunkGapMs;
            requestContext.avgChunkSizeBytes = chunkData.avgChunkSizeBytes;
          }
        }

        if (!isStreaming && result && typeof result === 'object') {
          const ollamaResponse = result as Record<string, unknown>;
          if (typeof ollamaResponse.eval_count === 'number') {
            requestContext.tokensGenerated = ollamaResponse.eval_count;
          }
          if (typeof ollamaResponse.prompt_eval_count === 'number') {
            requestContext.tokensPrompt = ollamaResponse.prompt_eval_count;
          }
        }

        if (isStreaming && result && typeof result === 'object' && '_tokenMetrics' in result) {
          const tokenMetrics = (
            result as { _tokenMetrics?: { tokensGenerated?: number; tokensPrompt?: number } }
          )._tokenMetrics;
          if (tokenMetrics) {
            if (typeof tokenMetrics.tokensGenerated === 'number') {
              requestContext.tokensGenerated = tokenMetrics.tokensGenerated;
            }
            if (typeof tokenMetrics.tokensPrompt === 'number') {
              requestContext.tokensPrompt = tokenMetrics.tokensPrompt;
            }
          }
        }

        if (isStreaming && result && typeof result === 'object' && '_ollamaDurations' in result) {
          const od = (
            result as {
              _ollamaDurations?: {
                evalDuration?: number;
                promptEvalDuration?: number;
                totalDuration?: number;
                loadDuration?: number;
              };
            }
          )._ollamaDurations;
          if (od) {
            requestContext.evalDuration = od.evalDuration;
            requestContext.promptEvalDuration = od.promptEvalDuration;
            requestContext.totalDuration = od.totalDuration;
            requestContext.loadDuration = od.loadDuration;
          }
        }

        requestContext.queueWaitTime = routingContext?.queueWaitTime;
        this.orchestrator.getMetricsAggregator().recordRequest(requestContext);
        getRequestHistory().recordRequest(requestContext);
        getMetricsStore().recordRequest(requestContext);
        if (isStreaming) {
          this.orchestrator.getInFlightManager().removeStreamingRequest(requestContext.id);
        }

        this.orchestrator.resetServerFailureCount(server.id);
        this.orchestrator.recordSuccess(server.id, model);

        if (retryCount > 0) {
          logger.info(
            `Request succeeded on ${server.id} for model ${model} after ${retryCount} retries`,
            {
              duration: requestContext.duration,
            }
          );
        } else {
          logger.info(`Request succeeded on ${server.id} for model ${model}`, {
            duration: requestContext.duration,
          });
        }

        return { success: true, value: result };
      } catch (error) {
        this.orchestrator.decrementInFlight(server.id, model);

        if (isStreaming) {
          this.orchestrator.getInFlightManager().removeStreamingRequest(requestContext.id);
        }

        lastError = error instanceof Error ? error : new Error(String(error));

        requestContext.endTime = Date.now();
        requestContext.duration = requestContext.endTime - requestContext.startTime;
        requestContext.success = false;
        requestContext.error = lastError;
        requestContext.queueWaitTime = routingContext?.queueWaitTime;
        this.orchestrator.getMetricsAggregator().recordRequest(requestContext);
        getRequestHistory().recordRequest(requestContext);
        getMetricsStore().recordRequest(requestContext);

        const errorMessage = lastError.message;
        const errorType = classifyError(errorMessage).type;

        logger.warn(`Request failed on ${server.id} for model ${model}`, {
          error: errorMessage,
          errorType,
          attempt: retryCount + 1,
          maxRetries: retryConfig.maxRetriesPerServer,
          duration: requestContext.duration,
        });

        const isRetryableOnSameServer = this.isRetryableOnSameServer(errorMessage, retryConfig);

        logger.debug(`Error classification for ${server.id}:${model}`, {
          errorType,
          isRetryableOnSameServer,
          retryCount,
          maxRetries: retryConfig.maxRetriesPerServer,
          willRetry: isRetryableOnSameServer && retryCount < retryConfig.maxRetriesPerServer,
        });

        if (isRetryableOnSameServer && retryCount < retryConfig.maxRetriesPerServer) {
          const adapter = fromRetryConfig(retryConfig);
          const result = calculateBackoff('exponential', {
            ...adapter.options,
            attempt: retryCount,
          });
          const delay = result.delayMs;

          logger.info(
            `Will retry on same server ${server.id} for model ${model} in ${delay}ms (attempt ${retryCount + 1}/${retryConfig.maxRetriesPerServer})`,
            { errorType, error: errorMessage }
          );

          await sleep(delay);
          retryCount++;
          continue;
        }

        if (retryCount >= retryConfig.maxRetriesPerServer) {
          logger.warn(
            `Max retries (${retryConfig.maxRetriesPerServer}) exhausted on ${server.id} for model ${model}, failing over to next server`
          );
        } else {
          logger.info(
            `Error not retryable on same server (${errorType}), failing over to next server for model ${model}`
          );
        }

        this.orchestrator.handleServerError(server, model, errorMessage, errorType, errors);
        return { success: false };
      }
    }

    return { success: false };
  }

  private isRetryableOnSameServer(errorMessage: string, retryConfig: RetryConfig): boolean {
    for (const code of retryConfig.retryableStatusCodes) {
      if (errorMessage.includes(`HTTP ${code}`) || errorMessage.includes(`${code}`)) {
        return true;
      }
    }

    const transientPatterns = [
      /timeout/i,
      /temporarily unavailable/i,
      /rate limit/i,
      /too many requests/i,
      /econnreset/i,
      /etimedout/i,
    ];

    return transientPatterns.some(pattern => pattern.test(errorMessage));
  }
}
