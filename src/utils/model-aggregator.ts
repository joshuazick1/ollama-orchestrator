import type { AIServer } from '../orchestrator.types.js';

export class ModelAggregator {
  private servers: AIServer[] = [];

  constructor(servers?: AIServer[]) {
    if (servers) {
      this.servers = servers;
    }
  }

  setServers(servers: AIServer[]): void {
    this.servers = servers;
  }

  addServer(server: AIServer): void {
    this.servers.push(server);
  }

  removeServer(serverId: string): void {
    this.servers = this.servers.filter(s => s.id !== serverId);
  }

  updateServer(server: AIServer): void {
    const idx = this.servers.findIndex(s => s.id === server.id);
    if (idx >= 0) {
      this.servers[idx] = server;
    }
  }

  getModelMap(healthyOnly: boolean = true): Record<string, string[]> {
    const modelMap: Record<string, string[]> = {};

    for (const server of this.servers) {
      if (healthyOnly && !server.healthy) {
        continue;
      }

      for (const model of server.models) {
        if (!modelMap[model]) {
          modelMap[model] = [];
        }
        if (!modelMap[model].includes(server.id)) {
          modelMap[model].push(server.id);
        }
      }
    }

    return modelMap;
  }

  getAllModels(healthyOnly: boolean = true): string[] {
    return Object.keys(this.getModelMap(healthyOnly));
  }

  getCurrentModelList(): string[] {
    const models = new Set<string>();

    for (const server of this.servers) {
      for (const model of server.models) {
        models.add(model);
      }
    }

    return Array.from(models);
  }

  getModelsForServer(serverId: string, healthyOnly: boolean = true): string[] {
    const server = this.servers.find(s => s.id === serverId);
    if (!server) {
      return [];
    }
    if (healthyOnly && !server.healthy) {
      return [];
    }
    return [...server.models];
  }

  getServersForModel(model: string, healthyOnly: boolean = true): string[] {
    return this.getModelMap(healthyOnly)[model] ?? [];
  }
}
