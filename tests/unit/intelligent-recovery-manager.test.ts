import { describe, it, expect, beforeEach } from 'vitest';
import { IntelligentRecoveryManager } from '../../src/intelligent-recovery-manager';

describe('IntelligentRecoveryManager', () => {
  let manager: IntelligentRecoveryManager;

  beforeEach(() => {
    manager = new IntelligentRecoveryManager();
  });

  describe('constructor', () => {
    it('should create manager', () => {
      expect(manager).toBeDefined();
    });
  });

  describe('setServerUrlProvider', () => {
    it('should accept a server URL provider', () => {
      const provider = (serverId: string) => `http://server-${serverId}:11434`;
      manager.setServerUrlProvider(provider);
    });
  });

  describe('strategy selection', () => {
    it('should exist as a class', () => {
      expect(IntelligentRecoveryManager).toBeDefined();
    });
  });
});
