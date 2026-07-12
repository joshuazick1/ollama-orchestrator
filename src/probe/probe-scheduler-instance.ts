import { getConfigManager } from '../config/config.js';
import { getOrchestratorInstance } from '../orchestrator/orchestrator-instance.js';
import { logger } from '../utils/logger.js';

import { HealthCheckScheduler } from './health-check-scheduler.js';
import { CapabilityProbeScheduler, type ServerDescriptor } from './probe-scheduler.js';

let scheduler: CapabilityProbeScheduler | null = null;
let healthCheckScheduler: HealthCheckScheduler | null = null;

export function getCapabilityProbeScheduler(): CapabilityProbeScheduler {
  if (!scheduler) {
    const orchestrator = getOrchestratorInstance();
    scheduler = new CapabilityProbeScheduler({
      endpointRegistry: orchestrator.getEndpointRegistry(),
      configManager: getConfigManager(),
      logger,
      serverListProvider: () => {
        const servers = orchestrator.getServers();
        return Promise.resolve(
          servers.map(
            (s): ServerDescriptor => ({
              id: s.id,
              url: s.url,
              apiKey: s.apiKey,
            })
          )
        );
      },
      onVersionDetected: (serverId: string, version: string) => {
        const server = orchestrator.getServer(serverId);
        if (server && server.version !== version) {
          server.version = version;
          orchestrator.persistServers();
          logger.debug('Server version updated from capability probe', {
            serverId,
            version,
          });
        }
      },
    });
  }
  return scheduler;
}

export function resetCapabilityProbeScheduler(): void {
  if (scheduler) {
    scheduler.stop();
  }
  scheduler = null;
}

export function getHealthCheckScheduler(): HealthCheckScheduler {
  if (!healthCheckScheduler) {
    const orchestrator = getOrchestratorInstance();
    healthCheckScheduler = new HealthCheckScheduler({
      serverListProvider: () => orchestrator.getServers().map(s => ({ id: s.id })),
      updateServerStatus: async server => {
        const s = orchestrator.getServer(server.id);
        if (!s) {
          return;
        }
        await orchestrator.updateServerStatus(s);
      },
    });
  }
  return healthCheckScheduler;
}

export function resetHealthCheckScheduler(): void {
  if (healthCheckScheduler) {
    healthCheckScheduler.stop();
  }
  healthCheckScheduler = null;
}
