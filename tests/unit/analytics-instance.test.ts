import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAnalyticsEngine,
  setAnalyticsEngine,
  resetAnalyticsEngine,
} from '../../src/analytics-instance';
import { AnalyticsEngine } from '../../src/analytics/analytics-engine';

describe('AnalyticsInstance', () => {
  beforeEach(() => {
    resetAnalyticsEngine();
  });

  describe('getAnalyticsEngine', () => {
    it('should return an AnalyticsEngine instance', () => {
      const engine = getAnalyticsEngine();
      expect(engine).toBeInstanceOf(AnalyticsEngine);
    });

    it('should return same instance on multiple calls', () => {
      const engine1 = getAnalyticsEngine();
      const engine2 = getAnalyticsEngine();
      expect(engine1).toBe(engine2);
    });
  });

  describe('setAnalyticsEngine', () => {
    it('should allow setting custom engine', () => {
      const customEngine = new AnalyticsEngine();
      setAnalyticsEngine(customEngine);

      const engine = getAnalyticsEngine();
      expect(engine).toBe(customEngine);
    });
  });

  describe('resetAnalyticsEngine', () => {
    it('should reset the instance', () => {
      const engine1 = getAnalyticsEngine();
      resetAnalyticsEngine();
      const engine2 = getAnalyticsEngine();

      expect(engine1).not.toBe(engine2);
    });
  });
});
