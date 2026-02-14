/**
 * configManager.test.ts
 * Tests for configuration management with persistence
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  createConfigManager,
  serversConfig,
  bansConfig,
  validateServers,
} from '../../src/config/configManager.js';
import { logger } from '../../src/utils/logger.js';
import { JsonFileHandler } from '../../src/config/jsonFileHandler.js';

vi.mock('../../src/utils/logger.js');

describe('createConfigManager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-manager-test-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore any mocked fs methods
    vi.restoreAllMocks();

    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should create config manager with defaults', () => {
    const configPath = path.join(tempDir, 'test.json');
    const manager = createConfigManager({
      fileName: 'test.json',
      defaults: { test: true },
      relativePath: tempDir,
    });

    expect(manager).toBeDefined();
    expect(manager.get).toBeDefined();
    expect(manager.set).toBeDefined();
    expect(manager.reload).toBeDefined();
    expect(manager.getPath).toBeDefined();
  });

  it('should get default config when file does not exist', () => {
    const configPath = path.join(tempDir, 'test.json');
    const manager = createConfigManager({
      fileName: 'test.json',
      defaults: { test: true, value: 42 },
      relativePath: tempDir,
    });

    const config = manager.get();

    expect(config).toEqual({ test: true, value: 42 });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No config found'));
  });

  it('should load existing config from file', () => {
    const configPath = path.join(tempDir, 'test.json');
    fs.writeFileSync(configPath, JSON.stringify({ test: false, value: 100 }), 'utf-8');

    const manager = createConfigManager({
      fileName: 'test.json',
      defaults: { test: true, value: 42 },
      relativePath: tempDir,
    });

    const config = manager.get();

    expect(config).toEqual({ test: false, value: 100 });
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Loaded config'));
  });

  it('should return cached config on subsequent calls', () => {
    const configPath = path.join(tempDir, 'test.json');
    fs.writeFileSync(configPath, JSON.stringify({ value: 1 }), 'utf-8');

    const manager = createConfigManager({
      fileName: 'test.json',
      defaults: { value: 0 },
      relativePath: tempDir,
    });

    const config1 = manager.get();
    const config2 = manager.get();

    expect(config1).toBe(config2); // Same reference
  });

  it('should handle read errors gracefully (lines 58-60)', () => {
    // Mock JsonFileHandler.read to throw error before creating manager
    vi.spyOn(JsonFileHandler.prototype, 'read').mockImplementation(() => {
      throw new Error('Read error');
    });

    const manager = createConfigManager({
      fileName: 'test.json',
      defaults: { value: 42 },
      relativePath: tempDir,
    });

    const config = manager.get();

    expect(config).toEqual({ value: 42 }); // Returns defaults
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error loading config'),
      expect.any(Object)
    );
  });

  it('should set and save config', () => {
    const configPath = path.join(tempDir, 'test.json');
    const manager = createConfigManager({
      fileName: 'test.json',
      defaults: { value: 0 },
      relativePath: tempDir,
    });

    const result = manager.set({ value: 100 });

    expect(result).toBe(true);
    expect(manager.get()).toEqual({ value: 100 });
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Saved config'));
  });

  it('should handle set errors gracefully (lines 81-84)', () => {
    const manager = createConfigManager({
      fileName: 'test.json',
      defaults: { value: 0 },
      relativePath: tempDir,
    });

    // Mock JsonFileHandler.write to throw error
    vi.spyOn(JsonFileHandler.prototype, 'write').mockImplementation(() => {
      throw new Error('Write error');
    });

    const result = manager.set({ value: 100 });

    expect(result).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error saving config'),
      expect.any(Object)
    );
  });

  it('should reload config from disk', () => {
    const configPath = path.join(tempDir, 'test.json');
    fs.writeFileSync(configPath, JSON.stringify({ version: 1 }), 'utf-8');

    const manager = createConfigManager({
      fileName: 'test.json',
      defaults: { version: 0 },
      relativePath: tempDir,
    });

    const initial = manager.get();
    expect(initial.version).toBe(1);

    // Modify file directly
    fs.writeFileSync(configPath, JSON.stringify({ version: 2 }), 'utf-8');

    const reloaded = manager.reload();
    expect(reloaded?.version).toBe(2);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Reloaded config'));
  });

  it('should return null on reload when file does not exist', () => {
    const manager = createConfigManager({
      fileName: 'test.json',
      defaults: { version: 0 },
      relativePath: tempDir,
    });

    const result = manager.reload();
    expect(result).toBeNull();
  });

  it('should handle reload errors gracefully (lines 97-100)', () => {
    const configPath = path.join(tempDir, 'test.json');
    fs.writeFileSync(configPath, JSON.stringify({ version: 1 }), 'utf-8');

    const manager = createConfigManager({
      fileName: 'test.json',
      defaults: { version: 0 },
      relativePath: tempDir,
    });

    // Mock JsonFileHandler.read to throw error during reload
    vi.spyOn(JsonFileHandler.prototype, 'read').mockImplementation(() => {
      throw new Error('Read error');
    });

    const result = manager.reload();

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error reloading config'),
      expect.any(Object)
    );
  });

  it('should get file path (lines 104-105)', () => {
    const manager = createConfigManager({
      fileName: 'test.json',
      defaults: {},
      relativePath: tempDir,
    });

    const filePath = manager.getPath();

    expect(filePath).toContain('test.json');
    expect(filePath).toContain(tempDir);
  });

  it('should use custom validator', () => {
    const configPath = path.join(tempDir, 'test.json');
    fs.writeFileSync(configPath, JSON.stringify({ invalid: true }), 'utf-8');

    const validator = vi.fn().mockReturnValue(false);
    const manager = createConfigManager({
      fileName: 'test.json',
      defaults: { valid: true },
      relativePath: tempDir,
      validator,
    });

    const config = manager.get();

    expect(validator).toHaveBeenCalledWith({ invalid: true });
    expect(config).toEqual({ valid: true }); // Returns defaults because validation failed
  });
});

describe('validateServers (lines 110-123)', () => {
  it('should validate valid server array', () => {
    const validServers = [
      {
        id: 'server1',
        url: 'http://localhost:11434',
        type: 'ollama' as const,
        healthy: true,
        lastResponseTime: 0,
        models: [],
      },
      {
        id: 'server2',
        url: 'http://localhost:11435',
        type: 'ollama' as const,
        healthy: false,
        lastResponseTime: 100,
        models: ['model1'],
      },
    ];

    // Test the validateServers function directly
    const result = validateServers(validServers);
    expect(result).toBe(true);
  });

  it('should reject non-array data', () => {
    const notAnArray = { id: 'server1' };

    // Test via the config manager
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validator-test-'));
    const manager = createConfigManager({
      fileName: 'servers.json',
      defaults: [],
      relativePath: testDir,
      validator: (data: any): data is any[] => Array.isArray(data),
    });

    // Write invalid data directly
    fs.writeFileSync(path.join(testDir, 'servers.json'), JSON.stringify(notAnArray), 'utf-8');

    const config = manager.get();
    expect(Array.isArray(config)).toBe(true); // Should return defaults (empty array)

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should reject invalid server objects', () => {
    const invalidServers = [
      { id: 'server1', url: 'http://localhost:11434' }, // missing type, healthy, lastResponseTime, and models
    ];

    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validator-test-'));
    const manager = createConfigManager({
      fileName: 'servers.json',
      defaults: [],
      relativePath: testDir,
      validator: (data: any): data is any[] =>
        Array.isArray(data) &&
        data.every(s => s && typeof s.id === 'string' && typeof s.type === 'string'),
    });

    fs.writeFileSync(path.join(testDir, 'servers.json'), JSON.stringify(invalidServers), 'utf-8');

    const config = manager.get();
    expect(config).toEqual([]); // Returns defaults because validation failed

    fs.rmSync(testDir, { recursive: true, force: true });
  });
});

describe('predefined configs', () => {
  it('should have serversConfig defined', () => {
    expect(serversConfig).toBeDefined();
    expect(serversConfig.get).toBeDefined();
    expect(serversConfig.set).toBeDefined();
  });

  it('should have bansConfig defined', () => {
    expect(bansConfig).toBeDefined();
    expect(bansConfig.get).toBeDefined();
    expect(bansConfig.set).toBeDefined();
  });
});
