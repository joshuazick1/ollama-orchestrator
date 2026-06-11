/**
 * models.ts
 * Orchestrator Models - Handles model aggregation, tag fetching, and model resolution
 */

import { API_ENDPOINTS } from '../constants/api-endpoints.js';
import { sleep } from '../utils/async-helpers.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';
import { logger } from '../utils/logger.js';

import type { AIOrchestrator } from './orchestrator.js';

export interface FetchServerTagsResult {
  success: boolean;
  data?: any[];
  serverId: string;
  error?: { serverId: string; error: string; type: 'network' | 'server' | 'timeout' | 'unknown' };
}

export class OrchestratorModels {
  constructor(private readonly orchestrator: AIOrchestrator) {}

  async getAggregatedTags(): Promise<{ models: any[] }> {
    const orchestrator = this.orchestrator;
    const now = Date.now();

    const tagsCache = orchestrator.getTagsCache();
    const config = orchestrator.getConfig();

    if (tagsCache && now - tagsCache.timestamp < config.tags.cacheTtlMs) {
      return { models: tagsCache.data };
    }

    const servers = orchestrator.getServers();
    const healthyServers = servers.filter((s: any) => s.healthy && s.supportsOllama !== false);

    if (healthyServers.length === 0) {
      if (tagsCache) {
        return { models: tagsCache.data };
      }
      return { models: [] };
    }

    const allTags = new Map<string, Record<string, unknown>>();
    let totalRequests = 0;
    let successfulRequests = 0;
    let failedRequests = 0;
    const errors: Array<{
      serverId: string;
      error: string;
      type: 'network' | 'server' | 'timeout' | 'unknown';
    }> = [];

    const maxConcurrent = config.tags.maxConcurrentRequests ?? 10;
    const batchDelayMs = config.tags.batchDelayMs ?? 50;

    for (let i = 0; i < healthyServers.length; i += maxConcurrent) {
      const batch = healthyServers.slice(i, i + maxConcurrent);
      const batchPromises = batch.map((server: any) => this.fetchServerTags(server));
      const batchResults = await Promise.allSettled(batchPromises);

      for (const result of batchResults) {
        totalRequests++;
        if (result.status === 'fulfilled') {
          const fetchResult = result.value;
          if (fetchResult.success && fetchResult.data) {
            successfulRequests++;
            this.mergeTagsData(allTags, fetchResult.data, fetchResult.serverId);
          } else if (fetchResult.error) {
            failedRequests++;
            errors.push(fetchResult.error);
          }
        } else {
          failedRequests++;
          errors.push({
            serverId: 'unknown',
            error: `Promise rejected: ${result.reason}`,
            type: 'unknown',
          });
        }
      }

      if (i + maxConcurrent < healthyServers.length) {
        await sleep(batchDelayMs);
      }
    }

    const models = Array.from(allTags.values());
    const circuitBreakerRegistry = orchestrator.getCircuitBreakerRegistry();
    const filteredModels = models.filter(model => {
      const servers = model.servers as string[];
      const modelName = (model.name as string) ?? (model.model as string);
      return this.hasClosedCircuitBreaker(modelName, servers, circuitBreakerRegistry);
    });

    orchestrator.setTagsCache(filteredModels, {
      totalRequests,
      successfulRequests,
      failedRequests,
      serverCount: healthyServers.length,
      modelCount: filteredModels.length,
      errors: errors.slice(0, 10),
    });

    logger.debug(
      `Tags aggregation completed: ${successfulRequests}/${totalRequests} successful requests, ${filteredModels.length} unique models`
    );

    return { models: filteredModels };
  }

  private hasClosedCircuitBreaker(
    modelName: string,
    serverIds: string[],
    circuitBreakerRegistry: any
  ): boolean {
    for (const serverId of serverIds) {
      const key = `${serverId}:${modelName}`;
      const breaker = circuitBreakerRegistry.get(key);
      if (!breaker || breaker.getState() === 'closed') {
        return true;
      }
    }
    return false;
  }

  async fetchServerTags(server: any): Promise<FetchServerTagsResult> {
    const config = this.orchestrator.getConfig();
    const timeoutMs = config.tags?.requestTimeoutMs ?? 5000;

    try {
      const response = await fetchWithTimeout(`${server.url}${API_ENDPOINTS.OLLAMA.TAGS}`, {
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'ollama-orchestrator/1.0.0',
        },
      });

      if (!response.ok) {
        const errorType = response.status >= 500 ? 'server' : 'unknown';
        return {
          success: false,
          serverId: server.id,
          error: {
            serverId: server.id,
            error: `HTTP ${response.status}: ${response.statusText}`,
            type: errorType,
          },
        };
      }

      const data = (await response.json()) as { models?: unknown };

      if (!data || typeof data !== 'object') {
        return {
          success: false,
          serverId: server.id,
          error: {
            serverId: server.id,
            error: 'Invalid response: not an object',
            type: 'server',
          },
        };
      }

      if (!('models' in data)) {
        return {
          success: false,
          serverId: server.id,
          error: {
            serverId: server.id,
            error: 'Invalid response: missing models property',
            type: 'server',
          },
        };
      }

      const models = data.models;
      if (!Array.isArray(models)) {
        return {
          success: false,
          serverId: server.id,
          error: {
            serverId: server.id,
            error: 'Invalid response: models is not an array',
            type: 'server',
          },
        };
      }

      this.orchestrator.recordSuccess(server.id);

      return {
        success: true,
        data: models,
        serverId: server.id,
      };
    } catch (error) {
      let errorType: 'network' | 'server' | 'timeout' | 'unknown' = 'unknown';
      let errorMessage = 'Unknown error';

      if (error instanceof Error) {
        errorMessage = error.message;

        if (error.name === 'AbortError') {
          errorType = 'timeout';
        } else if (
          error.message.includes('ECONNREFUSED') ||
          error.message.includes('ENOTFOUND') ||
          error.message.includes('ECONNRESET')
        ) {
          errorType = 'network';
        } else if (error.message.includes('fetch failed') || error.message.includes('network')) {
          errorType = 'network';
        }
      }

      if (errorType !== 'network') {
        this.orchestrator.recordFailure(
          server.id,
          error instanceof Error ? error.message : String(error)
        );
      }

      return {
        success: false,
        serverId: server.id,
        error: {
          serverId: server.id,
          error: errorMessage,
          type: errorType,
        },
      };
    }
  }

  mergeTagsData(
    allTags: Map<string, Record<string, unknown>>,
    models: unknown[],
    serverId: string
  ): void {
    for (const tag of models) {
      if (!tag || typeof tag !== 'object') {
        continue;
      }

      const tagRecord = tag as Record<string, unknown>;
      const modelName =
        (tagRecord.name as string | undefined) ?? (tagRecord.model as string | undefined);
      if (!modelName || typeof modelName !== 'string') {
        continue;
      }

      const digest = tagRecord.digest as string | undefined;
      const modelKey = digest ? `${modelName}:${digest}` : modelName;

      if (!allTags.has(modelKey)) {
        allTags.set(modelKey, {
          ...tagRecord,
          servers: [serverId],
        });
      } else {
        const existing = allTags.get(modelKey);
        if (existing) {
          const servers = existing.servers as string[];
          if (!servers.includes(serverId)) {
            servers.push(serverId);
          }
        }
      }
    }
  }

  resolveModelName(model: string, availableModels: string[]): string | null {
    if (availableModels.includes(model)) {
      return model;
    }

    if (!model.includes(':')) {
      const withLatest = `${model}:latest`;
      if (availableModels.includes(withLatest)) {
        return withLatest;
      }
    }

    if (model.endsWith(':latest')) {
      const withoutLatest = model.slice(0, -7);
      if (availableModels.includes(withoutLatest)) {
        return withoutLatest;
      }
      const withLatestSuffix = `${withoutLatest}:latest`;
      if (availableModels.includes(withLatestSuffix)) {
        return withLatestSuffix;
      }
    }

    return null;
  }

  extractModelsFromResponse(responseData?: any): string[] {
    if (!responseData || typeof responseData !== 'object') {
      return [];
    }

    const data = responseData as { models?: unknown };
    if (!data.models || !Array.isArray(data.models)) {
      return [];
    }

    return data.models
      .map((m: unknown) => {
        if (typeof m === 'string') {
          return m;
        }
        if (typeof m === 'object' && m !== null) {
          const record = m as Record<string, unknown>;
          return (
            (record.model as string | undefined) ?? (record.name as string | undefined) ?? null
          );
        }
        return null;
      })
      .filter(Boolean) as string[];
  }

  arraysEqual<T>(a: T[], b: T[]): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((val, index) => val === b[index]);
  }
}
