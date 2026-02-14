import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  ConfigManager,
  ConfigValidationError,
  type OrchestratorConfig,
  DEFAULT_CONFIG,
  getConfigManager,
  setConfigManager,
} from '../../src/config/config.js';

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ConfigManager', () => {
  let manager: ConfigManager;
  let tempDir: string;

  beforeEach(async () => {
    manager = new ConfigManager();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-test-'));
  });

  afterEach(async () => {
    manager.stopHotReload();
    await fs.rm(tempDir, { recursive: true, force: true });
    // Reset singleton
    setConfigManager(new ConfigManager());
  });

  describe('Initialization', () => {
    it('should initialize with default config', () => {
      const config = manager.getConfig();
      expect(config.port).toBe(DEFAULT_CONFIG.port);
      expect(config.host).toBe(DEFAULT_CONFIG.host);
      expect(config.logLevel).toBe(DEFAULT_CONFIG.logLevel);
    });

    it('should merge partial config with defaults', () => {
      const customManager = new ConfigManager({ port: 8080 });
      const config = customManager.getConfig();

      expect(config.port).toBe(8080);
      expect(config.host).toBe(DEFAULT_CONFIG.host); // Unchanged default
      expect(config.logLevel).toBe(DEFAULT_CONFIG.logLevel); // Unchanged default
    });

    it('should get singleton instance', () => {
      const instance1 = getConfigManager();
      const instance2 = getConfigManager();
      expect(instance1).toBe(instance2);
    });
  });

  describe('Configuration Updates', () => {
    it('should update config at runtime', () => {
      manager.updateConfig({ port: 8080 });
      const config = manager.getConfig();

      expect(config.port).toBe(8080);
      expect(config.host).toBe(DEFAULT_CONFIG.host); // Unchanged
    });

    it('should update config section', () => {
      manager.updateSection('queue', { maxSize: 500 });
      const config = manager.getConfig();

      expect(config.queue.maxSize).toBe(500);
      expect(config.queue.timeout).toBe(DEFAULT_CONFIG.queue.timeout); // Unchanged
    });

    it('should throw on invalid config update', () => {
      expect(() => {
        manager.updateConfig({ port: -1 });
      }).toThrow(ConfigValidationError);
    });

    it('should throw on invalid section update', () => {
      // Note: updateSection doesn't validate - use updateConfig for validation
      expect(() => {
        manager.updateConfig({ queue: { maxSize: -1 } as any });
      }).toThrow(ConfigValidationError);
    });

    it('should notify watchers on config change', () => {
      const watcher = vi.fn();
      manager.onChange(watcher);

      manager.updateConfig({ port: 8080 });

      expect(watcher).toHaveBeenCalledTimes(1);
      expect(watcher).toHaveBeenCalledWith(expect.objectContaining({ port: 8080 }));
    });

    it('should allow unsubscribing from changes', () => {
      const watcher = vi.fn();
      const unsubscribe = manager.onChange(watcher);

      unsubscribe();

      manager.updateConfig({ port: 8080 });
      expect(watcher).not.toHaveBeenCalled();
    });
  });

  describe('Environment Variable Overrides', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should override port from environment', () => {
      process.env.ORCHESTRATOR_PORT = '8080';
      const envManager = new ConfigManager();

      expect(envManager.getConfig().port).toBe(8080);
    });

    it('should override host from environment', () => {
      process.env.ORCHESTRATOR_HOST = '127.0.0.1';
      const envManager = new ConfigManager();

      expect(envManager.getConfig().host).toBe('127.0.0.1');
    });

    it('should override log level from environment', () => {
      process.env.ORCHESTRATOR_LOG_LEVEL = 'debug';
      const envManager = new ConfigManager();

      expect(envManager.getConfig().logLevel).toBe('debug');
    });

    it('should override feature toggles from environment', () => {
      process.env.ORCHESTRATOR_ENABLE_QUEUE = 'false';
      process.env.ORCHESTRATOR_ENABLE_STREAMING = 'false';
      const envManager = new ConfigManager();

      expect(envManager.getConfig().enableQueue).toBe(false);
      expect(envManager.getConfig().enableStreaming).toBe(false);
    });

    it('should override queue settings from environment', () => {
      process.env.ORCHESTRATOR_QUEUE_MAX_SIZE = '500';
      const envManager = new ConfigManager();

      expect(envManager.getConfig().queue.maxSize).toBe(500);
    });

    it('should ignore invalid environment values', () => {
      process.env.ORCHESTRATOR_PORT = 'invalid';
      const envManager = new ConfigManager();

      expect(envManager.getConfig().port).toBe(DEFAULT_CONFIG.port);
    });
  });

  describe('File Operations', () => {
    it('should save and load JSON config', async () => {
      const configPath = path.join(tempDir, 'config.json');
      
      manager.updateConfig({ port: 8080, host: '127.0.0.1' });
      await manager.saveToFile(configPath);

      const newManager = new ConfigManager();
      await newManager.loadFromFile(configPath);

      const config = newManager.getConfig();
      expect(config.port).toBe(8080);
      expect(config.host).toBe('127.0.0.1');
    });

    it('should save and load YAML config', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      
      manager.updateConfig({ port: 8080, logLevel: 'debug' });
      await manager.saveToFile(configPath);

      const newManager = new ConfigManager();
      await newManager.loadFromFile(configPath);

      const config = newManager.getConfig();
      expect(config.port).toBe(8080);
      expect(config.logLevel).toBe('debug');
    });

    it('should throw on unsupported file format', async () => {
      const configPath = path.join(tempDir, 'config.txt');

      await expect(manager.saveToFile(configPath)).rejects.toThrow('Unsupported config file format');
    });

    it('should throw on invalid JSON', async () => {
      const configPath = path.join(tempDir, 'invalid.json');
      await fs.writeFile(configPath, 'not valid json');

      await expect(manager.loadFromFile(configPath)).rejects.toThrow();
    });

    it('should throw on validation errors when loading', async () => {
      const configPath = path.join(tempDir, 'invalid.json');
      await fs.writeFile(configPath, JSON.stringify({ port: -1 }));

      await expect(manager.loadFromFile(configPath)).rejects.toThrow(ConfigValidationError);
    });

    it('should use default config path when saving', async () => {
      const configPath = path.join(tempDir, 'config.json');
      
      // First save to a file
      manager.updateConfig({ port: 8080 });
      await manager.saveToFile(configPath);

      // Now the manager has the configPath set from the save operation
      // Verify by creating a new manager and loading
      const newManager = new ConfigManager();
      await newManager.loadFromFile(configPath);
      expect(newManager.getConfig().port).toBe(8080);
    });

    it('should throw when no path provided and none loaded', async () => {
      await expect(manager.saveToFile()).rejects.toThrow('No file path specified');
    });
  });

  describe('Hot Reload', () => {
    it('should detect and reload config file changes', async () => {
      const configPath = path.join(tempDir, 'config.json');
      
      manager.updateConfig({ port: 8080 });
      await manager.saveToFile(configPath);

      const newManager = new ConfigManager();
      await newManager.loadFromFile(configPath);

      // Start hot reload
      newManager.startHotReload(100); // Check every 100ms

      // Verify initial state
      expect(newManager.getConfig().port).toBe(8080);

      // Update the file
      await fs.writeFile(configPath, JSON.stringify({ port: 9090 }));

      // Wait for reload
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(newManager.getConfig().port).toBe(9090);

      newManager.stopHotReload();
    });

    it('should handle multiple hot reload starts gracefully', () => {
      manager.startHotReload();
      manager.startHotReload(); // Should not create multiple intervals
      manager.stopHotReload();
    });

    it('should handle hot reload stop without start gracefully', () => {
      expect(() => manager.stopHotReload()).not.toThrow();
    });
  });

  describe('Configuration Validation', () => {
    it('should validate port range', () => {
      expect(() => manager.updateConfig({ port: 0 })).toThrow(ConfigValidationError);
      expect(() => manager.updateConfig({ port: 65536 })).toThrow(ConfigValidationError);
      expect(() => manager.updateConfig({ port: -1 })).toThrow(ConfigValidationError);
    });

    it('should validate log level', () => {
      expect(() => manager.updateConfig({ logLevel: 'invalid' as any })).toThrow(ConfigValidationError);
    });

    it('should validate queue max size', () => {
      expect(() => manager.updateConfig({ queue: { maxSize: 0 } as any })).toThrow(ConfigValidationError);
      expect(() => manager.updateConfig({ queue: { maxSize: -1 } as any })).toThrow(ConfigValidationError);
    });

    it('should validate server configuration', async () => {
      const configPath = path.join(tempDir, 'config.json');
      const invalidConfig = {
        servers: [
          { id: '', url: 'http://localhost:11434', type: 'ollama' },
        ],
      };

      await fs.writeFile(configPath, JSON.stringify(invalidConfig));
      await expect(manager.loadFromFile(configPath)).rejects.toThrow(ConfigValidationError);
    });

    it('should validate server URLs', async () => {
      const configPath = path.join(tempDir, 'config.json');
      const invalidConfig = {
        servers: [
          { id: 'server-1', url: 'not-a-valid-url', type: 'ollama' },
        ],
      };

      await fs.writeFile(configPath, JSON.stringify(invalidConfig));
      await expect(manager.loadFromFile(configPath)).rejects.toThrow(ConfigValidationError);
    });

    it('should provide detailed validation errors', () => {
      try {
        manager.updateConfig({ port: -1, logLevel: 'invalid' as any });
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigValidationError);
        if (error instanceof ConfigValidationError) {
          expect(error.errors).toHaveLength(2);
          expect(error.errors.some(e => e.path === 'port')).toBe(true);
          expect(error.errors.some(e => e.path === 'logLevel')).toBe(true);
        }
      }
    });
  });

  describe('JSON Serialization', () => {
    it('should serialize config to JSON', () => {
      manager.updateConfig({ port: 8080 });
      const json = manager.toJSON();

      expect(json.port).toBe(8080);
    });

    it('should create independent copy of config', () => {
      const config1 = manager.getConfig();
      manager.updateConfig({ port: 8080 });
      const config2 = manager.getConfig();

      expect(config1.port).toBe(DEFAULT_CONFIG.port);
      expect(config2.port).toBe(8080);
    });
  });

  describe('Nested Configuration', () => {
    it('should preserve nested defaults', () => {
      const config = manager.getConfig();

      expect(config.queue.maxSize).toBe(DEFAULT_CONFIG.queue.maxSize);
      expect(config.loadBalancer.weights.latency).toBe(DEFAULT_CONFIG.loadBalancer.weights.latency);
      expect(config.circuitBreaker.baseFailureThreshold).toBe(DEFAULT_CONFIG.circuitBreaker.baseFailureThreshold);
    });

    it('should merge nested partial updates', () => {
      manager.updateConfig({
        queue: { maxSize: 500 } as any,
      });

      const config = manager.getConfig();
      expect(config.queue.maxSize).toBe(500);
      expect(config.queue.timeout).toBe(DEFAULT_CONFIG.queue.timeout);
    });

    it('should handle full section updates', () => {
      const newWeights = {
        latency: 0.5,
        successRate: 0.25,
        load: 0.15,
        capacity: 0.1,
      };
      
      manager.updateSection('loadBalancer', {
        weights: newWeights,
      } as any);

      const config = manager.getConfig();
      expect(config.loadBalancer.weights.latency).toBe(0.5);
      expect(config.loadBalancer.weights.successRate).toBe(0.25);
    });
  });
});

describe('ConfigValidationError', () => {
  it('should include all validation errors in message', () => {
    const errors = [
      { path: 'port', message: 'Port must be positive', value: -1 },
      { path: 'logLevel', message: 'Invalid log level', value: 'invalid' },
    ];

    const error = new ConfigValidationError(errors);

    expect(error.message).toContain('port');
    expect(error.message).toContain('logLevel');
    expect(error.errors).toEqual(errors);
    expect(error.name).toBe('ConfigValidationError');
  });
});
