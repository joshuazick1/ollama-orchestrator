import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getConfigManager } from '../../src/config/config.js';
import { resetOrchestratorInstance } from '../../src/orchestrator/orchestrator-instance.js';
import { InFlightManager } from '../../src/utils/in-flight-manager.js';

describe('Token-Weighted Load Integration', () => {
  let manager: InFlightManager;

  beforeEach(() => {
    resetOrchestratorInstance();
    manager = new InFlightManager({
      promptTokenWeight: 1.0,
      outputTokenWeight: 4.0,
    });
  });

  afterEach(() => {
    manager.clear();
  });

  describe('token-weighted load tracking in load scoring', () => {
    it('should use token-weighted load when enabled in config', () => {
      // Configure token-weighted load
      const config = getConfigManager().getConfig();
      expect(config.loadBalancer.tokenWeightedLoad?.enabled).toBe(true);

      // Simulate server with in-flight requests
      manager.incrementInFlightWithTokens('server-1', 'llama3:8b', 100, 50);

      // Token-weighted load should be: 100*1 + 50*4 = 300
      expect(manager.getTokenWeightedLoad('server-1', 'llama3:8b')).toBe(300);

      // Total server load should include all models
      expect(manager.getTotalTokenWeightedLoad('server-1')).toBe(300);
    });

    it('should accumulate weighted load from multiple requests', () => {
      manager.incrementInFlightWithTokens('server-1', 'llama3:8b', 100, 50);
      manager.incrementInFlightWithTokens('server-1', 'llama3:8b', 200, 100);

      // Total: (100*1 + 50*4) + (200*1 + 100*4) = 300 + 600 = 900
      expect(manager.getTokenWeightedLoad('server-1', 'llama3:8b')).toBe(900);
    });

    it('should track load across multiple models on same server', () => {
      manager.incrementInFlightWithTokens('server-1', 'llama3:8b', 100, 50);
      manager.incrementInFlightWithTokens('server-1', 'codellama:7b', 200, 100);

      // Model-specific load
      expect(manager.getTokenWeightedLoad('server-1', 'llama3:8b')).toBe(300);
      expect(manager.getTokenWeightedLoad('server-1', 'codellama:7b')).toBe(600);

      // Total server load
      expect(manager.getTotalTokenWeightedLoad('server-1')).toBe(900);
    });

    it('should properly decrement token-weighted load', () => {
      manager.incrementInFlightWithTokens('server-1', 'llama3:8b', 100, 50);
      manager.incrementInFlightWithTokens('server-1', 'llama3:8b', 200, 100);
      manager.decrementInFlightWithTokens('server-1', 'llama3:8b', 100, 50);

      // Remaining: (200*1 + 100*4) = 600
      expect(manager.getTokenWeightedLoad('server-1', 'llama3:8b')).toBe(600);
    });

    it('should clamp token-weighted load to zero on over-decrement', () => {
      manager.incrementInFlightWithTokens('server-1', 'llama3:8b', 100, 50);
      manager.decrementInFlightWithTokens('server-1', 'llama3:8b', 200, 100);

      // Should not go negative
      expect(manager.getTokenWeightedLoad('server-1', 'llama3:8b')).toBe(0);
    });
  });

  describe('backward compatibility with simple in-flight', () => {
    it('should coexist with simple increment/decrement', () => {
      manager.incrementInFlight('server-1', 'llama3:8b');
      manager.incrementInFlightWithTokens('server-1', 'llama3:8b', 100, 50);

      // Simple count: 2
      expect(manager.getInFlight('server-1', 'llama3:8b')).toBe(2);
      // Token-weighted: 300
      expect(manager.getTokenWeightedLoad('server-1', 'llama3:8b')).toBe(300);
    });

    it('should handle mixed simple and token-weighted operations', () => {
      manager.incrementInFlight('server-1', 'llama3:8b');
      manager.incrementInFlightWithTokens('server-1', 'llama3:8b', 100, 50);
      manager.incrementInFlightWithTokens('server-1', 'llama3:8b', 200, 100);
      manager.decrementInFlight('server-1', 'llama3:8b');

      // Simple: 1 + 1 + 1 - 1 = 2
      expect(manager.getInFlight('server-1', 'llama3:8b')).toBe(2);
      // Token-weighted: 300 + 600 = 900
      expect(manager.getTokenWeightedLoad('server-1', 'llama3:8b')).toBe(900);
    });
  });

  describe('token-weighted load formula verification', () => {
    it('should use formula: promptTokens * promptTokenWeight + outputTokens * outputTokenWeight', () => {
      // With default weights (prompt=1.0, output=4.0)
      const mgr1 = new InFlightManager();
      mgr1.incrementInFlightWithTokens('s', 'm', 100, 50);
      // 100*1.0 + 50*4.0 = 100 + 200 = 300
      expect(mgr1.getTokenWeightedLoad('s', 'm')).toBe(300);

      // With custom weights (prompt=2.0, output=8.0)
      const mgr2 = new InFlightManager({ promptTokenWeight: 2.0, outputTokenWeight: 8.0 });
      mgr2.incrementInFlightWithTokens('s', 'm', 100, 50);
      // 100*2.0 + 50*8.0 = 200 + 400 = 600
      expect(mgr2.getTokenWeightedLoad('s', 'm')).toBe(600);
    });
  });
});
