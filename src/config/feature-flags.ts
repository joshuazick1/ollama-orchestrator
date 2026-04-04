/**
 * Feature flags for gradual rollout of metrics centralization
 * Allows selective enabling/disabling of new centralized implementations
 */

export interface FeatureFlags {
  // Phase 1: Foundation
  /** Enable Timer utility instead of Date.now() */
  useTimerUtility: boolean;

  // Phase 3: Statistics
  /** Enable Statistics utility for percentile calculation */
  useStatisticsUtility: boolean;
  /** Enable TokenMetricsExtractor */
  useTokenExtractor: boolean;
}

// Default: Enable all features for new deployments
// Set to false for gradual rollout
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  useTimerUtility: true, // Phase 1 - enabled
  useStatisticsUtility: true, // Phase 3 - enabled
  useTokenExtractor: true, // Phase 3 - enabled
};

// Feature flag manager
class FeatureFlagManager {
  private flags: FeatureFlags;

  constructor() {
    this.flags = { ...DEFAULT_FEATURE_FLAGS };
    this.loadFromEnvironment();
  }

  private loadFromEnvironment(): void {
    // Allow environment variables to override flags
    // Format: ORCHESTRATOR_FF_<FLAG_NAME>=true|false
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('ORCHESTRATOR_FF_')) {
        const flagName = key.replace('ORCHESTRATOR_FF_', '').replace(/_/g, '').toLowerCase();

        const flagKey = Object.keys(this.flags).find(k => k.toLowerCase() === flagName) as
          | keyof FeatureFlags
          | undefined;

        if (flagKey) {
          this.flags[flagKey] = value === 'true';
        }
      }
    }
  }

  get<K extends keyof FeatureFlags>(flag: K): FeatureFlags[K] {
    return this.flags[flag];
  }

  set<K extends keyof FeatureFlags>(flag: K, value: FeatureFlags[K]): void {
    this.flags[flag] = value;
  }

  getAll(): FeatureFlags {
    return { ...this.flags };
  }
}

export const featureFlags = new FeatureFlagManager();
