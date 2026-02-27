import { describe, it, expect, beforeEach } from 'vitest';
import { ModelAggregator } from '../../src/utils/model-aggregator.js';
import type { AIServer } from '../../src/orchestrator.types.js';

describe('ModelAggregator', () => {
  let aggregator: ModelAggregator;
  const healthyServer: AIServer = {
    id: 'server-1',
    url: 'http://localhost:11434',
    type: 'ollama',
    healthy: true,
    maxConcurrency: 4,
    models: ['llama2', 'mistral'],
    lastResponseTime: 100,
  };

  const unhealthyServer: AIServer = {
    id: 'server-2',
    url: 'http://localhost:11435',
    type: 'ollama',
    healthy: false,
    maxConcurrency: 4,
    models: ['codellama'],
    lastResponseTime: 500,
  };

  beforeEach(() => {
    aggregator = new ModelAggregator();
  });

  describe('constructor', () => {
    it('should create empty aggregator by default', () => {
      const agg = new ModelAggregator();
      expect(agg.getAllModels()).toEqual([]);
    });

    it('should accept initial servers', () => {
      const agg = new ModelAggregator([healthyServer]);
      expect(agg.getAllModels()).toContain('llama2');
    });
  });

  describe('setServers', () => {
    it('should replace all servers', () => {
      aggregator.addServer(healthyServer);
      aggregator.setServers([unhealthyServer]);
      expect(aggregator.getAllModels(false)).toEqual(['codellama']);
    });
  });

  describe('addServer', () => {
    it('should add a server', () => {
      aggregator.addServer(healthyServer);
      expect(aggregator.getAllModels()).toContain('llama2');
    });

    it('should allow duplicate additions', () => {
      aggregator.addServer(healthyServer);
      aggregator.addServer(healthyServer);
      expect(aggregator.getAllModels()).toContain('llama2');
    });
  });

  describe('removeServer', () => {
    it('should remove server by id', () => {
      aggregator.addServer(healthyServer);
      aggregator.addServer(unhealthyServer);
      aggregator.removeServer('server-1');
      expect(aggregator.getAllModels(false)).toEqual(['codellama']);
    });

    it('should handle removing non-existent server', () => {
      aggregator.addServer(healthyServer);
      aggregator.removeServer('non-existent');
      expect(aggregator.getAllModels()).toContain('llama2');
    });
  });

  describe('updateServer', () => {
    it('should update existing server', () => {
      aggregator.addServer(healthyServer);
      const updated: AIServer = { ...healthyServer, models: ['newmodel'] };
      aggregator.updateServer(updated);
      expect(aggregator.getAllModels()).toEqual(['newmodel']);
    });

    it('should do nothing for non-existent server', () => {
      aggregator.addServer(healthyServer);
      const newServer: AIServer = { ...healthyServer, id: 'new-server', models: ['model-x'] };
      aggregator.updateServer(newServer);
      expect(aggregator.getAllModels()).toEqual(['llama2', 'mistral']);
    });
  });

  describe('getModelMap', () => {
    it('should return empty object for no servers', () => {
      expect(aggregator.getModelMap()).toEqual({});
    });

    it('should group models by server', () => {
      aggregator.addServer(healthyServer);
      aggregator.addServer(unhealthyServer);
      const map = aggregator.getModelMap(false);
      expect(map['llama2']).toContain('server-1');
      expect(map['codellama']).toContain('server-2');
    });

    it('should filter unhealthy servers when healthyOnly is true', () => {
      aggregator.addServer(healthyServer);
      aggregator.addServer(unhealthyServer);
      const map = aggregator.getModelMap(true);
      expect(map['llama2']).toContain('server-1');
      expect(map['codellama']).toBeUndefined();
    });

    it('should include unhealthy servers when healthyOnly is false', () => {
      aggregator.addServer(healthyServer);
      aggregator.addServer(unhealthyServer);
      const map = aggregator.getModelMap(false);
      expect(map['llama2']).toContain('server-1');
      expect(map['codellama']).toContain('server-2');
    });

    it('should not duplicate server for same model', () => {
      const server1: AIServer = { ...healthyServer, id: 'server-1', models: ['llama2'] };
      const server2: AIServer = { ...healthyServer, id: 'server-2', models: ['llama2'] };
      aggregator.addServer(server1);
      aggregator.addServer(server2);
      const map = aggregator.getModelMap();
      expect(map['llama2']).toHaveLength(2);
    });
  });

  describe('getAllModels', () => {
    it('should return all unique models', () => {
      aggregator.addServer(healthyServer);
      aggregator.addServer(unhealthyServer);
      const models = aggregator.getAllModels(false);
      expect(models).toContain('llama2');
      expect(models).toContain('mistral');
      expect(models).toContain('codellama');
    });

    it('should filter unhealthy servers by default', () => {
      aggregator.addServer(healthyServer);
      aggregator.addServer(unhealthyServer);
      const models = aggregator.getAllModels(true);
      expect(models).toContain('llama2');
      expect(models).not.toContain('codellama');
    });

    it('should include unhealthy when healthyOnly is false', () => {
      aggregator.addServer(healthyServer);
      aggregator.addServer(unhealthyServer);
      const models = aggregator.getAllModels(false);
      expect(models).toContain('codellama');
    });
  });

  describe('getCurrentModelList', () => {
    it('should return unique models from all servers', () => {
      aggregator.addServer(healthyServer);
      aggregator.addServer(unhealthyServer);
      const models = aggregator.getCurrentModelList();
      expect(models).toHaveLength(3);
      expect(models).toContain('llama2');
    });
  });

  describe('getModelsForServer', () => {
    it('should return models for existing server', () => {
      aggregator.addServer(healthyServer);
      const models = aggregator.getModelsForServer('server-1');
      expect(models).toContain('llama2');
    });

    it('should return empty array for non-existent server', () => {
      aggregator.addServer(healthyServer);
      const models = aggregator.getModelsForServer('non-existent');
      expect(models).toEqual([]);
    });

    it('should return empty array for unhealthy server when healthyOnly is true', () => {
      aggregator.addServer(unhealthyServer);
      const models = aggregator.getModelsForServer('server-2', true);
      expect(models).toEqual([]);
    });

    it('should return models for unhealthy server when healthyOnly is false', () => {
      aggregator.addServer(unhealthyServer);
      const models = aggregator.getModelsForServer('server-2', false);
      expect(models).toContain('codellama');
    });
  });

  describe('getServersForModel', () => {
    it('should return servers that have the model', () => {
      aggregator.addServer(healthyServer);
      aggregator.addServer(unhealthyServer);
      const servers = aggregator.getServersForModel('llama2');
      expect(servers).toContain('server-1');
    });

    it('should return empty array for model not on any server', () => {
      aggregator.addServer(healthyServer);
      const servers = aggregator.getServersForModel('nonexistent');
      expect(servers).toEqual([]);
    });

    it('should filter unhealthy servers by default', () => {
      aggregator.addServer(unhealthyServer);
      const servers = aggregator.getServersForModel('codellama');
      expect(servers).toEqual([]);
    });

    it('should include unhealthy when healthyOnly is false', () => {
      aggregator.addServer(unhealthyServer);
      const servers = aggregator.getServersForModel('codellama', false);
      expect(servers).toContain('server-2');
    });
  });
});
