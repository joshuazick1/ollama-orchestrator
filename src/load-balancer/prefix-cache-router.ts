import type { AIServer, ServerModelMetrics } from '../orchestrator/orchestrator.types.js';
import { hashPrefix, PREFIX_HASH_DEFAULT_TOKEN_COUNT } from '../utils/hash.js';

import { ConsistentHashRing } from './consistent-hash.js';

export interface PrefixCacheRouterConfig {
  hashTokenCount?: number;
}

export class PrefixCacheRouter {
  private hashRing: ConsistentHashRing<string>;
  private hashTokenCount: number;

  constructor(hashRing: ConsistentHashRing<string>, config: PrefixCacheRouterConfig = {}) {
    this.hashRing = hashRing;
    this.hashTokenCount = config.hashTokenCount ?? PREFIX_HASH_DEFAULT_TOKEN_COUNT;
  }

  selectPrefixCacheAware(
    prompt: string | undefined,
    model: string,
    candidates: AIServer[],
    filterByProbeHealth: (servers: AIServer[], model: string) => AIServer[],
    getLoad: (serverId: string, model: string) => number,
    getTotalLoad: (serverId: string) => number,
    getMetrics: (serverId: string, model: string) => ServerModelMetrics | undefined,
    selectFastestResponse: (
      candidates: AIServer[],
      model: string,
      getLoad: (serverId: string, model: string) => number,
      getTotalLoad: (serverId: string) => number,
      getMetrics: (serverId: string, model: string) => ServerModelMetrics | undefined
    ) => AIServer | undefined
  ): AIServer | null {
    if (candidates.length === 0) {
      return null;
    }

    const healthyCandidates = filterByProbeHealth(candidates, model);
    if (healthyCandidates.length === 0) {
      return null;
    }

    const modelCandidates = healthyCandidates.filter(s => s.models.includes(model));
    if (modelCandidates.length === 0) {
      return null;
    }

    if (prompt && prompt.trim().length > 0) {
      const prefixHash = hashPrefix(prompt, this.hashTokenCount);
      const targetServerId = this.hashRing.getNode(prefixHash);

      if (targetServerId) {
        const targetServer = modelCandidates.find(s => s.id === targetServerId);
        if (targetServer) {
          const isHealthy = targetServer.healthy !== false;
          const currentLoad = getLoad(targetServer.id, model);
          const maxConcurrency = targetServer.maxConcurrency ?? 4;
          const hasCapacity = currentLoad < maxConcurrency;
          const hasModel = targetServer.models.includes(model);
          const isProbeHealthy = filterByProbeHealth([targetServer], model).length > 0;

          if (isHealthy && hasCapacity && hasModel && isProbeHealthy) {
            return targetServer;
          }
        }
      }
    }

    const fallback = selectFastestResponse(
      modelCandidates,
      model,
      getLoad,
      getTotalLoad,
      getMetrics
    );
    return fallback ?? null;
  }
}
