import { describe, it, expect } from 'vitest';

import { featureFlags, DEFAULT_FEATURE_FLAGS } from '../../src/config/feature-flags';

describe('FeatureFlags', () => {
  describe('get', () => {
    it('should return true for enabled flags by default', () => {
      expect(featureFlags.get('useTimerUtility')).toBe(true);
      expect(featureFlags.get('useStatisticsUtility')).toBe(true);
      expect(featureFlags.get('useTokenExtractor')).toBe(true);
    });

    it('should return correct value for all flags', () => {
      const flags = featureFlags.getAll();
      expect(flags).toEqual(DEFAULT_FEATURE_FLAGS);
    });
  });

  describe('set', () => {
    it('should allow setting individual flags', () => {
      featureFlags.set('useTimerUtility', false);
      expect(featureFlags.get('useTimerUtility')).toBe(false);

      featureFlags.set('useTimerUtility', true);
      expect(featureFlags.get('useTimerUtility')).toBe(true);
    });

    it('should allow setting multiple flags', () => {
      featureFlags.set('useTimerUtility', false);
      featureFlags.set('useStatisticsUtility', false);

      expect(featureFlags.get('useTimerUtility')).toBe(false);
      expect(featureFlags.get('useStatisticsUtility')).toBe(false);

      featureFlags.set('useTimerUtility', true);
      featureFlags.set('useStatisticsUtility', true);
    });
  });

  describe('getAll', () => {
    it('should return all flags', () => {
      const all = featureFlags.getAll();
      expect(all).toHaveProperty('useTimerUtility');
      expect(all).toHaveProperty('useStatisticsUtility');
      expect(all).toHaveProperty('useTokenExtractor');
    });

    it('should return a copy of flags', () => {
      const all1 = featureFlags.getAll();
      const all2 = featureFlags.getAll();
      expect(all1).not.toBe(all2);
    });
  });
});
