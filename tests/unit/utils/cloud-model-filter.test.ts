import { describe, it, expect } from 'vitest';

import { isCloudModel, filterNonCloudModels } from '../../../src/utils/cloud-model-filter.js';

describe('cloud-model-filter', () => {
  describe('isCloudModel', () => {
    describe(':cloud$ pattern (colon suffix)', () => {
      it('should match deepseek-v4-pro:cloud', () => {
        expect(isCloudModel('deepseek-v4-pro:cloud')).toBe(true);
      });

      it('should match llama3:cloud', () => {
        expect(isCloudModel('llama3:cloud')).toBe(true);
      });

      it('should match with uppercase CLOUD', () => {
        expect(isCloudModel('DeepSeek-V4-PRO:CLOUD')).toBe(true);
      });

      it('should match with mixed case', () => {
        expect(isCloudModel('MyModel:Cloud')).toBe(true);
      });

      it('should not match regular model without :cloud suffix', () => {
        expect(isCloudModel('llama3.2:3b')).toBe(false);
      });
    });

    describe('^cloud- pattern (cloud prefix with hyphen)', () => {
      it('should match cloud-foo', () => {
        expect(isCloudModel('cloud-foo')).toBe(true);
      });

      it('should match cloud-gpt4', () => {
        expect(isCloudModel('cloud-gpt4')).toBe(true);
      });

      it('should match CLOUD-bar (case insensitive)', () => {
        expect(isCloudModel('CLOUD-bar')).toBe(true);
      });

      it('should not match foocloud-bar (no hyphen after cloud)', () => {
        expect(isCloudModel('foocloud-bar')).toBe(false);
      });
    });

    describe('^-cloud$ pattern (hyphen + cloud at end)', () => {
      it('should match foo-cloud', () => {
        expect(isCloudModel('foo-cloud')).toBe(true);
      });

      it('should match meta-cloud', () => {
        expect(isCloudModel('meta-cloud')).toBe(true);
      });

      it('should match FOO-CLOUD (case insensitive)', () => {
        expect(isCloudModel('FOO-CLOUD')).toBe(true);
      });

      it('should not match fooCloud (no hyphen before cloud)', () => {
        expect(isCloudModel('fooCloud')).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should return false for empty string', () => {
        expect(isCloudModel('')).toBe(false);
      });

      it('should return false for "cloud" alone (no boundary match)', () => {
        expect(isCloudModel('cloud')).toBe(false);
      });

      it('should return true for "cloud-model" (cloud as prefix with hyphen separator)', () => {
        expect(isCloudModel('cloud-model')).toBe(true);
      });

      it('should handle whitespace - leading space still matches pattern', () => {
        expect(isCloudModel(' model:cloud')).toBe(true);
        expect(isCloudModel('model:cloud ')).toBe(false);
      });
    });
  });

  describe('filterNonCloudModels', () => {
    it('should filter out cloud models from mixed list', () => {
      const result = filterNonCloudModels(['a:cloud', 'llama3', 'b:cloud']);
      expect(result).toEqual(['llama3']);
    });

    it('should return all models when none are cloud models', () => {
      const result = filterNonCloudModels(['llama3.2:3b', 'mistral:7b', 'codellama:13b']);
      expect(result).toEqual(['llama3.2:3b', 'mistral:7b', 'codellama:13b']);
    });

    it('should return empty array when all models are cloud models', () => {
      const result = filterNonCloudModels(['a:cloud', 'cloud-foo', 'bar-cloud']);
      expect(result).toEqual([]);
    });

    it('should return empty array for empty input', () => {
      const result = filterNonCloudModels([]);
      expect(result).toEqual([]);
    });

    it('should preserve order of non-cloud models', () => {
      const result = filterNonCloudModels(['cloud-x', 'model1', 'cloud-y', 'model2', 'cloud-z']);
      expect(result).toEqual(['model1', 'model2']);
    });
  });
});
