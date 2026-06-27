import { describe, it, expect, beforeEach } from 'vitest';

import { BanManager } from '../../src/utils/ban-manager.js';

describe('BanManager - removeModelBans for colon models', () => {
  let manager: BanManager;

  beforeEach(() => {
    manager = new BanManager();
  });

  it('should remove bans for models with colons like llama2:7b', () => {
    manager.addBan('srv-1', 'llama2:7b', 'permanent');
    manager.addBan('srv-2', 'llama2:7b', 'permanent');
    manager.addBan('srv-1', 'mistral', 'permanent');

    const removed = manager.removeModelBans('llama2:7b');

    expect(removed).toBe(2);
    expect(manager.isBanned('srv-1', 'llama2:7b')).toBe(false);
    expect(manager.isBanned('srv-2', 'llama2:7b')).toBe(false);
    expect(manager.isBanned('srv-1', 'mistral')).toBe(true);
  });

  it('should handle complex model names with multiple colons', () => {
    manager.addBan('srv-1', 'qwen2.5:14b-instruct-q5_K_M', 'permanent');
    manager.addBan('srv-1', 'llama3:latest', 'permanent');

    const removed = manager.removeModelBans('qwen2.5:14b-instruct-q5_K_M');

    expect(removed).toBe(1);
    expect(manager.isBanned('srv-1', 'qwen2.5:14b-instruct-q5_K_M')).toBe(false);
    expect(manager.isBanned('srv-1', 'llama3:latest')).toBe(true);
  });

  it('should not affect other server bans for the same model', () => {
    manager.addBan('srv-1', 'llama2:7b', 'permanent');
    manager.addBan('srv-2', 'llama2:7b', 'permanent');
    manager.addBan('srv-3', 'mistral', 'permanent');

    const removed = manager.removeServerBans('srv-1');

    expect(removed).toBe(1);
    expect(manager.isBanned('srv-1', 'llama2:7b')).toBe(false);
    expect(manager.isBanned('srv-2', 'llama2:7b')).toBe(true);
    expect(manager.isBanned('srv-3', 'mistral')).toBe(true);
  });
});
