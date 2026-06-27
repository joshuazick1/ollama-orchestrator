import { describe, it, expect } from 'vitest';

import {
  validateModelList,
  ValidateModelListResult,
} from '../../../src/utils/validate-model-list.js';

describe('validateModelList', () => {
  describe('empty input', () => {
    it('should return error for empty string', () => {
      const result = validateModelList('');
      expect(result.valid).toEqual([]);
      expect(result.errors).toContain('Input is empty');
    });
  });

  describe('single model', () => {
    it('should return valid result for single model', () => {
      const result = validateModelList('llama3:8b');
      expect(result.valid).toEqual(['llama3:8b']);
      expect(result.errors).toEqual([]);
    });
  });

  describe('multi-line input', () => {
    it('should parse newline-separated models', () => {
      const result = validateModelList('llama3\nmistral:7b\nqwen2');
      expect(result.valid).toEqual(['llama3', 'mistral:7b', 'qwen2']);
      expect(result.errors).toEqual([]);
    });
  });

  describe('comma-separated input', () => {
    it('should parse comma-separated models', () => {
      const result = validateModelList('llama3, mistral:7b, qwen2');
      expect(result.valid).toEqual(['llama3', 'mistral:7b', 'qwen2']);
      expect(result.errors).toEqual([]);
    });
  });

  describe('mixed separators', () => {
    it('should handle mixed newline and comma separators', () => {
      const result = validateModelList('llama3,mistral:7b\nqwen2\nnomic-embed');
      expect(result.valid).toEqual(['llama3', 'mistral:7b', 'qwen2', 'nomic-embed']);
      expect(result.errors).toEqual([]);
    });
  });

  describe('whitespace trimming', () => {
    it('should trim whitespace from model names', () => {
      const result = validateModelList('  llama3  \n  mistral  ');
      expect(result.valid).toEqual(['llama3', 'mistral']);
      expect(result.errors).toEqual([]);
    });
  });

  describe('deduplication', () => {
    it('should deduplicate case-insensitively, preserving first occurrence', () => {
      const result = validateModelList('llama3:8b\nLLAMA3:8B');
      expect(result.valid).toEqual(['llama3:8b']);
      expect(result.errors).toEqual([]);
    });

    it('should preserve original casing of first occurrence', () => {
      const result = validateModelList('LLAMA3\nllama3');
      expect(result.valid).toEqual(['LLAMA3']);
      expect(result.errors).toEqual([]);
    });
  });

  describe('empty lines', () => {
    it('should ignore empty lines', () => {
      const result = validateModelList('llama3\n\n\nmistral');
      expect(result.valid).toEqual(['llama3', 'mistral']);
      expect(result.errors).toEqual([]);
    });
  });

  describe('comments', () => {
    it('should ignore comment lines starting with #', () => {
      const result = validateModelList('# this is a comment\nllama3\n# another comment\nmistral');
      expect(result.valid).toEqual(['llama3', 'mistral']);
      expect(result.errors).toEqual([]);
    });
  });

  describe('max length validation', () => {
    it('should return error for model name exceeding 256 characters', () => {
      const longModel = 'a'.repeat(257);
      const result = validateModelList(longModel);
      expect(result.valid).toEqual([]);
      expect(result.errors.some(e => e.includes('256 characters'))).toBe(true);
    });

    it('should accept model name at exactly 256 characters', () => {
      const maxModel = 'a'.repeat(256);
      const result = validateModelList(maxModel);
      expect(result.valid).toEqual([maxModel]);
      expect(result.errors).toEqual([]);
    });
  });

  describe('max models validation', () => {
    it('should return error when exceeding 1000 models', () => {
      const models = Array.from({ length: 1001 }, (_, i) => `model${i}`).join('\n');
      const result = validateModelList(models);
      expect(result.valid).toEqual([]);
      expect(result.errors.some(e => e.includes('1000 models'))).toBe(true);
    });

    it('should accept exactly 1000 models', () => {
      const models = Array.from({ length: 1000 }, (_, i) => `model${i}`).join('\n');
      const result = validateModelList(models);
      expect(result.valid.length).toBe(1000);
      expect(result.errors).toEqual([]);
    });
  });

  describe('invalid characters detection', () => {
    it('should warn but still include model with invalid characters', () => {
      const result = validateModelList('llama3<script>');
      expect(result.valid).toContain('llama3<script>');
      expect(
        result.errors.some(
          e => e.toLowerCase().includes('warning') || e.toLowerCase().includes('invalid character')
        )
      ).toBe(true);
    });
  });
});
