import { describe, it, expect, beforeEach } from 'vitest';

import { InFlightManager } from '../../src/utils/in-flight-manager';

describe('InFlightManager Token-Weighted Methods', () => {
  let manager: InFlightManager;

  beforeEach(() => {
    manager = new InFlightManager();
  });

  describe('incrementInFlightWithTokens', () => {
    it('should increment both weighted load and simple counter', () => {
      manager.incrementInFlightWithTokens('server-1', 'llama3:8b', 100, 50);

      expect(manager.getInFlight('server-1', 'llama3:8b')).toBe(1);
      expect(manager.getTokenWeightedLoad('server-1', 'llama3:8b')).toBe(300); // 100*1 + 50*4
    });

    it('should accumulate weighted load for multiple requests', () => {
      manager.incrementInFlightWithTokens('server-1', 'llama3:8b', 100, 50);
      manager.incrementInFlightWithTokens('server-1', 'llama3:8b', 200, 100);

      // Total: (100*1 + 50*4) + (200*1 + 100*4) = 300 + 600 = 900
      expect(manager.getTokenWeightedLoad('server-1', 'llama3:8b')).toBe(900);
      expect(manager.getInFlight('server-1', 'llama3:8b')).toBe(2);
    });

    it('should handle bypass flag correctly', () => {
      manager.incrementInFlightWithTokens('server-1', 'llama3:8b', 100, 50, true);

      expect(manager.getInFlight('server-1', 'llama3:8b')).toBe(1);
      expect(manager.getTokenWeightedLoad('server-1', 'llama3:8b')).toBe(300);
    });
  });

  describe('decrementInFlightWithTokens', () => {
    it('should decrement both weighted load and simple counter', () => {
      manager.incrementInFlightWithTokens('server-1', 'llama3:8b', 100, 50);
      manager.decrementInFlightWithTokens('server-1', 'llama3:8b', 100, 50);

      expect(manager.getInFlight('server-1', 'llama3:8b')).toBe(0);
      expect(manager.getTokenWeightedLoad('server-1', 'llama3:8b')).toBe(0);
    });

    it('should balance multiple increments and decrements', () => {
      manager.incrementInFlightWithTokens('server-1', 'llama3:8b', 100, 50);
      manager.incrementInFlightWithTokens('server-1', 'llama3:8b', 200, 100);
      manager.decrementInFlightWithTokens('server-1', 'llama3:8b', 100, 50);

      // Remaining: (200*1 + 100*4) = 600
      expect(manager.getTokenWeightedLoad('server-1', 'llama3:8b')).toBe(600);
      expect(manager.getInFlight('server-1', 'llama3:8b')).toBe(1);
    });

    it('should clamp weighted load to zero on over-decrement', () => {
      manager.incrementInFlightWithTokens('server-1', 'llama3:8b', 100, 50);
      manager.decrementInFlightWithTokens('server-1', 'llama3:8b', 200, 100);

      // 300 - 600 = clamped to 0
      expect(manager.getTokenWeightedLoad('server-1', 'llama3:8b')).toBe(0);
      expect(manager.getInFlight('server-1', 'llama3:8b')).toBe(0);
    });
  });

  describe('getTokenWeightedLoad', () => {
    it('should return correct formula: promptTokens * 1.0 + outputTokens * 4.0', () => {
      manager.incrementInFlightWithTokens('server-1', 'llama3:8b', 100, 50);

      // Default weights: promptTokenWeight=1.0, outputTokenWeight=4.0
      // 100 * 1.0 + 50 * 4.0 = 100 + 200 = 300
      expect(manager.getTokenWeightedLoad('server-1', 'llama3:8b')).toBe(300);
    });

    it('should return 0 for non-existent server:model', () => {
      expect(manager.getTokenWeightedLoad('nonexistent', 'model')).toBe(0);
    });
  });

  describe('getTotalTokenWeightedLoad', () => {
    it('should sum weighted load across all models for a server', () => {
      manager.incrementInFlightWithTokens('server-1', 'llama3:8b', 100, 50);
      manager.incrementInFlightWithTokens('server-1', 'codellama:7b', 200, 100);

      // llama3: 100*1 + 50*4 = 300
      // codellama: 200*1 + 100*4 = 600
      // Total: 900
      expect(manager.getTotalTokenWeightedLoad('server-1')).toBe(900);
    });

    it('should return 0 when no requests on server', () => {
      expect(manager.getTotalTokenWeightedLoad('nonexistent')).toBe(0);
    });

    it('should only sum for specific server prefix', () => {
      manager.incrementInFlightWithTokens('server-1', 'llama3:8b', 100, 50);
      manager.incrementInFlightWithTokens('server-2', 'llama3:8b', 200, 100);

      // Only server-1 total
      expect(manager.getTotalTokenWeightedLoad('server-1')).toBe(300);
      expect(manager.getTotalTokenWeightedLoad('server-2')).toBe(600);
    });
  });

  describe('custom token weights', () => {
    it('should use custom weights from config', () => {
      const customManager = new InFlightManager({
        promptTokenWeight: 2.0,
        outputTokenWeight: 8.0,
      });

      customManager.incrementInFlightWithTokens('server-1', 'llama3:8b', 100, 50);

      // Custom weights: 100 * 2.0 + 50 * 8.0 = 200 + 400 = 600
      expect(customManager.getTokenWeightedLoad('server-1', 'llama3:8b')).toBe(600);
    });

    it('should default to promptTokenWeight=1.0 and outputTokenWeight=4.0', () => {
      const defaultManager = new InFlightManager();

      defaultManager.incrementInFlightWithTokens('server-1', 'llama3:8b', 100, 50);

      // Default: 100 * 1.0 + 50 * 4.0 = 100 + 200 = 300
      expect(defaultManager.getTokenWeightedLoad('server-1', 'llama3:8b')).toBe(300);
    });
  });

  describe('backward compatibility', () => {
    it('should coexist with regular increment/decrement', () => {
      manager.incrementInFlight('server-1', 'llama3:8b');
      manager.incrementInFlightWithTokens('server-1', 'llama3:8b', 100, 50);

      expect(manager.getInFlight('server-1', 'llama3:8b')).toBe(2);
      expect(manager.getTokenWeightedLoad('server-1', 'llama3:8b')).toBe(300);

      manager.decrementInFlight('server-1', 'llama3:8b');
      manager.decrementInFlightWithTokens('server-1', 'llama3:8b', 100, 50);

      expect(manager.getInFlight('server-1', 'llama3:8b')).toBe(0);
      expect(manager.getTokenWeightedLoad('server-1', 'llama3:8b')).toBe(0);
    });
  });
});
