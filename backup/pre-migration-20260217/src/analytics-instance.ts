/**
 * analytics-instance.ts
 * Singleton instance for AnalyticsEngine
 */

import { AnalyticsEngine } from './analytics/analytics-engine.js';

let instance: AnalyticsEngine | null = null;

/**
 * Get or create the AnalyticsEngine singleton instance
 */
export function getAnalyticsEngine(): AnalyticsEngine {
  if (!instance) {
    instance = new AnalyticsEngine();
  }
  return instance;
}

/**
 * Set the AnalyticsEngine instance (for testing)
 */
export function setAnalyticsEngine(engine: AnalyticsEngine): void {
  instance = engine;
}

/**
 * Reset the AnalyticsEngine instance (for testing)
 */
export function resetAnalyticsEngine(): void {
  if (instance) {
    instance.reset();
  }
  instance = null;
}
