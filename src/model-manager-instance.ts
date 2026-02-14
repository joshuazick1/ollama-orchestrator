/**
 * model-manager-instance.ts
 * Singleton instance for ModelManager
 */

import { ModelManager } from './model-manager.js';

let instance: ModelManager | null = null;

/**
 * Get or create the ModelManager singleton instance
 */
export function getModelManager(): ModelManager {
  if (!instance) {
    instance = new ModelManager();
  }
  return instance;
}

/**
 * Set the ModelManager instance (for testing)
 */
export function setModelManager(manager: ModelManager): void {
  instance = manager;
}

/**
 * Reset the ModelManager instance (for testing)
 */
export function resetModelManager(): void {
  if (instance) {
    instance.reset();
  }
  instance = null;
}
