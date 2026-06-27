import { API_ENDPOINTS } from '../constants/api-endpoints.js';
import type { Tuple } from '../probe/types.js';
import { sleep } from '../utils/async-helpers.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';
import { logger } from '../utils/logger.js';

import type { AIOrchestrator } from './orchestrator.js';

export interface AnthropicModelsCache {
  data: AnthropicModel[];
  timestamp: number;
}

export interface AnthropicModel {
  id: string;
  type: 'model';
  display_name?: string;
  created_at?: number;
}

export interface FetchAnthropicModelsResult {
  success: boolean;
  data?: AnthropicModel[];
  serverId: string;
  error?: { serverId: string; error: string; type: 'network' | 'server' | 'timeout' | 'unknown' };
}

const ANTHROPIC_MODELS_MAX_CONCURRENT = 10;
const ANTHROPIC_MODELS_BATCH_DELAY_MS = 50;
const ANTHROPIC_MODELS_REQUEST_TIMEOUT_MS = 5000;

export class AnthropicModels {
  private cache: AnthropicModelsCache | undefined;

  constructor(
    private readonly orchestrator: AIOrchestrator,
    private readonly cacheTtlMs: number = 30000
  ) {}

  async getAggregatedAnthropicModels(): Promise<{ object: string; data: AnthropicModel[] }> {
    const now = Date.now();

    if (this.cache && now - this.cache.timestamp < this.cacheTtlMs) {
      return { object: 'list', data: this.cache.data };
    }

    const servers = this.orchestrator.getServers();
    const endpointRegistry = this.orchestrator.getEndpointRegistry();

    const eligibleServers = servers.filter(server => {
      if (!server.healthy) {
        return false;
      }
      const cap = endpointRegistry.getCapability(server.id, 'anthropic_messages');
      return cap?.confirmed === true;
    });

    if (eligibleServers.length === 0) {
      const emptyResult = { object: 'list', data: [] as AnthropicModel[] };
      this.cache = { data: emptyResult.data, timestamp: now };
      return emptyResult;
    }

    const modelMap = new Map<string, AnthropicModel>();
    const errors: Array<{
      serverId: string;
      error: string;
      type: 'network' | 'server' | 'timeout' | 'unknown';
    }> = [];
    let totalRequests = 0;
    let successfulRequests = 0;
    let failedRequests = 0;

    for (let i = 0; i < eligibleServers.length; i += ANTHROPIC_MODELS_MAX_CONCURRENT) {
      const batch = eligibleServers.slice(i, i + ANTHROPIC_MODELS_MAX_CONCURRENT);
      const batchPromises = batch.map(server => this.fetchServerModels(server));
      const batchResults = await Promise.allSettled(batchPromises);

      for (const result of batchResults) {
        totalRequests++;
        if (result.status === 'fulfilled') {
          const fetchResult = result.value;
          if (fetchResult.success && fetchResult.data) {
            successfulRequests++;
            for (const model of fetchResult.data) {
              if (!modelMap.has(model.id)) {
                modelMap.set(model.id, model);
              }
            }
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

      if (i + ANTHROPIC_MODELS_MAX_CONCURRENT < eligibleServers.length) {
        await sleep(ANTHROPIC_MODELS_BATCH_DELAY_MS);
      }
    }

    const models = Array.from(modelMap.values());

    const filteredModels = models.filter(model => {
      const serversSupportingModel = this.getServersForModel(model.id, eligibleServers);
      return this.hasAvailableServer(model.id, serversSupportingModel);
    });

    this.cache = { data: filteredModels, timestamp: now };

    logger.debug(
      `Anthropic models aggregation completed: ${successfulRequests}/${totalRequests} successful requests, ${filteredModels.length} unique models`,
      {
        totalRequests,
        successfulRequests,
        failedRequests,
        modelCount: filteredModels.length,
        errorCount: errors.length,
      }
    );

    return { object: 'list', data: filteredModels };
  }

  private async fetchServerModels(server: {
    id: string;
    url: string;
    apiKey?: string;
  }): Promise<FetchAnthropicModelsResult> {
    try {
      const headers: Record<string, string> = {
        'User-Agent': 'ollama-orchestrator/1.0.0',
      };

      if (server.apiKey) {
        headers['Authorization'] = `Bearer ${server.apiKey}`;
      }

      const response = await fetchWithTimeout(`${server.url}${API_ENDPOINTS.ANTHROPIC.MODELS}`, {
        timeout: ANTHROPIC_MODELS_REQUEST_TIMEOUT_MS,
        headers,
      });

      if (!response.ok) {
        const errorType = response.status >= 500 ? 'server' : 'network';
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

      const data = (await response.json()) as { object?: string; data?: unknown[] };

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

      if (!Array.isArray(data.data)) {
        return {
          success: false,
          serverId: server.id,
          error: {
            serverId: server.id,
            error: 'Invalid response: data is not an array',
            type: 'server',
          },
        };
      }

      const models: AnthropicModel[] = [];
      for (const item of data.data) {
        if (item && typeof item === 'object' && 'id' in item) {
          const m = item as Record<string, unknown>;
          models.push({
            id: String(m.id),
            type: 'model',
            display_name: m.display_name ? String(m.display_name) : undefined,
            created_at: m.created_at ? Number(m.created_at) : undefined,
          });
        }
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

  private getServersForModel(modelId: string, eligibleServers: { id: string }[]): string[] {
    return eligibleServers.map(s => s.id);
  }

  private hasAvailableServer(modelName: string, serverIds: string[]): boolean {
    for (const serverId of serverIds) {
      const tuple: Tuple = { serverId, model: modelName, endpoint: 'anthropic_messages' };
      if (this.orchestrator.getProbeOrchestrator().canServe(tuple, 'routing')) {
        return true;
      }
    }
    return false;
  }

  invalidateCache(): void {
    this.cache = undefined;
  }
}
