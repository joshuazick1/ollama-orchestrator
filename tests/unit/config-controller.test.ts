/**
 * config-controller.test.ts
 * Tests for configuration management controllers
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';

import {
  getConfig,
  updateConfig,
  updateConfigSection,
  reloadConfig,
  saveConfig,
  getConfigSchema,
} from '../../src/controllers/configController.js';
import { getConfigManager } from '../../src/config/config.js';

vi.mock('../../src/config/config.js');

describe('Config Controller', () => {
  let mockConfigManager: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    mockConfigManager = {
      getConfig: vi.fn(),
      updateConfig: vi.fn(),
      updateSection: vi.fn(),
      loadFromFile: vi.fn(),
      saveToFile: vi.fn(),
    };

    (getConfigManager as any).mockReturnValue(mockConfigManager);

    mockReq = {};
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    // Mock process.env
    process.env.ORCHESTRATOR_CONFIG_FILE = '/path/to/config.json';
  });

  describe('getConfig', () => {
    it('should return current configuration', () => {
      const mockConfig = {
        port: 5100,
        host: '0.0.0.0',
        logLevel: 'info',
        enableQueue: true,
      };
      mockConfigManager.getConfig.mockReturnValue(mockConfig);

      getConfig(mockReq as Request, mockRes as Response);

      expect(mockConfigManager.getConfig).toHaveBeenCalledTimes(1);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        config: mockConfig,
        source: '/path/to/config.json',
      });
    });

    it('should sanitize sensitive configuration data', () => {
      const mockConfig = {
        port: 5100,
        security: {
          apiKeys: ['key1', 'key2'],
          corsOrigins: ['*'],
        },
      };
      mockConfigManager.getConfig.mockReturnValue(mockConfig);

      getConfig(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        config: {
          port: 5100,
          security: {
            apiKeys: ['***REDACTED***', '***REDACTED***'],
            corsOrigins: ['*'],
          },
        },
        source: '/path/to/config.json',
      });
    });
  });

  describe('updateConfig', () => {
    it('should update configuration successfully', async () => {
      const updates = { port: 8080, logLevel: 'debug' };
      const updatedConfig = { ...updates, host: '0.0.0.0' };
      mockReq.body = updates;
      mockConfigManager.getConfig.mockReturnValue(updatedConfig);

      await updateConfig(mockReq as Request, mockRes as Response);

      expect(mockConfigManager.updateConfig).toHaveBeenCalledWith(updates);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: 'Configuration updated successfully',
        config: updatedConfig,
      });
    });

    it('should return 400 for invalid request body', async () => {
      mockReq.body = null;

      await updateConfig(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Invalid request body',
        details: 'Configuration updates must be a valid object',
      });
    });

    it('should handle validation errors', async () => {
      const error = new Error('Invalid port number');
      error.name = 'ConfigValidationError';
      mockConfigManager.updateConfig.mockImplementation(() => {
        throw error;
      });
      mockReq.body = { port: 'invalid' };

      await updateConfig(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Configuration validation failed',
        details: 'Invalid port number',
      });
    });

    it('should handle general update errors', async () => {
      const error = new Error('Update failed');
      mockConfigManager.updateConfig.mockImplementation(() => {
        throw error;
      });
      mockReq.body = { port: 8080 };

      await updateConfig(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to update configuration',
        details: 'Update failed',
      });
    });
  });

  describe('updateConfigSection', () => {
    it('should update configuration section successfully', async () => {
      const section = 'queue';
      const updates = { maxSize: 500 };
      const updatedConfig = { queue: updates };
      mockReq.params = { section };
      mockReq.body = updates;
      mockConfigManager.getConfig.mockReturnValue(updatedConfig);

      await updateConfigSection(mockReq as Request, mockRes as Response);

      expect(mockConfigManager.updateSection).toHaveBeenCalledWith(section, updates);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: `Configuration section '${section}' updated successfully`,
        section,
        config: updatedConfig,
      });
    });

    it('should return 400 for missing section parameter', async () => {
      mockReq.params = {};

      await updateConfigSection(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Section parameter is required',
      });
    });

    it('should return 400 for invalid section', async () => {
      mockReq.params = { section: 'invalidSection' };
      mockReq.body = { some: 'data' };

      await updateConfigSection(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Invalid configuration section',
        validSections: [
          'queue',
          'loadBalancer',
          'circuitBreaker',
          'security',
          'metrics',
          'streaming',
        ],
      });
    });

    it('should return 400 for invalid request body', async () => {
      mockReq.params = { section: 'queue' };
      mockReq.body = null;

      await updateConfigSection(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Invalid request body',
        details: 'Section updates must be a valid object',
      });
    });
  });

  describe('reloadConfig', () => {
    it('should reload configuration successfully', async () => {
      const configPath = process.cwd() + '/config.json';
      const reloadedConfig = { port: 3000 };
      mockReq.body = { configPath };
      mockConfigManager.getConfig.mockReturnValue(reloadedConfig);

      await reloadConfig(mockReq as Request, mockRes as Response);

      expect(mockConfigManager.loadFromFile).toHaveBeenCalledWith(configPath);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: 'Configuration reloaded successfully',
        config: reloadedConfig,
      });
    });

    it('should return 400 for invalid config path', async () => {
      mockReq.body = { configPath: '/custom/config.json' };

      await reloadConfig(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 if no config file specified', async () => {
      mockReq.body = {};
      delete process.env.ORCHESTRATOR_CONFIG_FILE;

      await reloadConfig(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'No configuration file specified',
        details:
          'Provide configPath in request body or set ORCHESTRATOR_CONFIG_FILE environment variable',
      });
    });

    it('should handle reload errors', async () => {
      const error = new Error('Reload failed');
      mockConfigManager.loadFromFile.mockImplementation(() => {
        throw error;
      });
      mockReq.body = { configPath: process.cwd() + '/config.json' };

      await reloadConfig(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to reload configuration',
        details: 'Reload failed',
      });
    });
  });

  describe('saveConfig', () => {
    it('should save configuration successfully', async () => {
      const configPath = process.cwd() + '/config.json';
      mockReq.body = { configPath };

      await saveConfig(mockReq as Request, mockRes as Response);

      expect(mockConfigManager.saveToFile).toHaveBeenCalledWith(configPath);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: 'Configuration saved successfully',
        path: configPath,
      });
    });

    it('should return 400 for invalid config path', async () => {
      mockReq.body = { configPath: '/custom/config.json' };

      await saveConfig(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 if no config file specified', async () => {
      mockReq.body = {};
      delete process.env.ORCHESTRATOR_CONFIG_FILE;

      await saveConfig(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'No configuration file specified',
        details:
          'Provide configPath in request body or set ORCHESTRATOR_CONFIG_FILE environment variable',
      });
    });

    it('should handle save errors', async () => {
      const error = new Error('Save failed');
      mockConfigManager.saveToFile.mockImplementation(() => {
        throw error;
      });
      mockReq.body = { configPath: process.cwd() + '/config.json' };

      await saveConfig(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to save configuration',
        details: 'Save failed',
      });
    });
  });

  describe('getConfigSchema', () => {
    it('should return configuration schema', () => {
      getConfigSchema(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        schema: expect.any(Object),
      });
    });
  });
});
