import { describe, it, expect, beforeEach } from 'vitest';
import {
  getModelManager,
  setModelManager,
  resetModelManager,
} from '../../src/model-manager-instance';
import { ModelManager } from '../../src/model-manager';

describe('ModelManagerInstance', () => {
  beforeEach(() => {
    resetModelManager();
  });

  describe('getModelManager', () => {
    it('should return a ModelManager instance', () => {
      const manager = getModelManager();
      expect(manager).toBeInstanceOf(ModelManager);
    });

    it('should return same instance on multiple calls', () => {
      const manager1 = getModelManager();
      const manager2 = getModelManager();
      expect(manager1).toBe(manager2);
    });
  });

  describe('setModelManager', () => {
    it('should allow setting custom manager', () => {
      const customManager = new ModelManager();
      setModelManager(customManager);

      const manager = getModelManager();
      expect(manager).toBe(customManager);
    });
  });

  describe('resetModelManager', () => {
    it('should reset the instance', () => {
      const manager1 = getModelManager();
      resetModelManager();
      const manager2 = getModelManager();

      expect(manager1).not.toBe(manager2);
    });
  });
});
