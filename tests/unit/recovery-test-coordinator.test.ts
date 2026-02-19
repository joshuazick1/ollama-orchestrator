import { describe, it, expect, beforeEach } from 'vitest';
import { RecoveryTestCoordinator } from '../../src/recovery-test-coordinator';

describe('RecoveryTestCoordinator', () => {
  let coordinator: RecoveryTestCoordinator;

  beforeEach(() => {
    coordinator = new RecoveryTestCoordinator();
  });

  describe('constructor', () => {
    it('should create coordinator with default config', () => {
      expect(coordinator).toBeDefined();
    });

    it('should accept custom config', () => {
      const custom = new RecoveryTestCoordinator({
        serverCooldownMs: 5000,
        maxWaitForInFlightMs: 2000,
      });
      expect(custom).toBeDefined();
    });
  });

  describe('setServerUrlProvider', () => {
    it('should accept a server URL provider', () => {
      const provider = (serverId: string) => `http://server-${serverId}:11434`;
      coordinator.setServerUrlProvider(provider);
    });
  });

  describe('setInFlightProvider', () => {
    it('should accept an in-flight provider', () => {
      const provider = (serverId: string) => 0;
      coordinator.setInFlightProvider(provider);
    });
  });

  describe('setIncrementInFlight', () => {
    it('should accept increment function', () => {
      const increment = (serverId: string, model: string) => {};
      coordinator.setIncrementInFlight(increment);
    });
  });

  describe('setDecrementInFlight', () => {
    it('should accept decrement function', () => {
      const decrement = (serverId: string, model: string) => {};
      coordinator.setDecrementInFlight(decrement);
    });
  });
});
