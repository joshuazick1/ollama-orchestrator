import { describe, it, expect } from 'vitest';

import {
  estimatePromptTokens,
  estimateChatTokens,
  getDefaultContextSize,
  canHandleContext,
} from '../../src/utils/prompt-estimator.js';

describe('prompt-estimator', () => {
  describe('estimatePromptTokens', () => {
    it('should return 0 for empty string', () => {
      expect(estimatePromptTokens('')).toBe(0);
    });

    it('should return 0 for null/undefined', () => {
      expect(estimatePromptTokens(null as any)).toBe(0);
      expect(estimatePromptTokens(undefined as any)).toBe(0);
    });

    it('should return 1 for very short strings', () => {
      expect(estimatePromptTokens('Hi')).toBe(1);
    });

    it('should estimate ~3.5 chars per token', () => {
      const prompt = 'The quick brown fox jumps over the lazy dog';
      const tokens = estimatePromptTokens(prompt);
      // 44 chars / 3.5 = 12.57 -> Math.ceil = 13
      expect(tokens).toBe(13);
    });

    it('should handle whitespace-only strings', () => {
      expect(estimatePromptTokens('   ')).toBe(0);
      expect(estimatePromptTokens('\n\t')).toBe(0);
    });

    it('should trim whitespace before estimating', () => {
      const prompt = '   Hello world   ';
      const tokens = estimatePromptTokens(prompt);
      // "Hello world" = 11 chars / 3.5 = 3.14 -> 4 tokens
      expect(tokens).toBe(4);
    });
  });

  describe('estimateChatTokens', () => {
    it('should return 0 for empty array', () => {
      expect(estimateChatTokens([])).toBe(0);
    });

    it('should return 0 for null/undefined', () => {
      expect(estimateChatTokens(null as any)).toBe(0);
    });

    it('should sum content tokens from messages', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];
      const tokens = estimateChatTokens(messages);
      // "Hello" = 5 chars / 3.5 = 1.43 -> 2 tokens + 2 for role = 4
      // "Hi there!" = 8 chars / 3.5 = 2.29 -> 3 tokens + 2 for role = 5
      // Total = 9
      expect(tokens).toBe(9);
    });

    it('should handle messages without content', () => {
      const messages = [{ role: 'system' }];
      const tokens = estimateChatTokens(messages);
      // No content, but role adds 2 tokens
      expect(tokens).toBe(2);
    });

    it('should handle messages without role', () => {
      const messages = [{ content: 'Hello' }];
      const tokens = estimateChatTokens(messages);
      // "Hello" = 5 chars / 3.5 = 1.43 -> 2 tokens
      expect(tokens).toBe(2);
    });
  });

  describe('getDefaultContextSize', () => {
    it('should return defaults for known model families', () => {
      // Note: prefix matching means shorter prefixes match before longer ones
      expect(getDefaultContextSize('mistral')).toBe(8192);
      expect(getDefaultContextSize('mixtral')).toBe(32768);
      expect(getDefaultContextSize('gemma2')).toBe(8192);
      // phi3 matches 'phi' (2048) first since 'phi3'.includes('phi')
      expect(getDefaultContextSize('phi3')).toBe(2048);
    });

    it('should return default 4096 for unknown models', () => {
      expect(getDefaultContextSize('unknown-model')).toBe(4096);
    });

    it('should be case-insensitive', () => {
      expect(getDefaultContextSize('Mistral')).toBe(8192);
      expect(getDefaultContextSize('MIXTRAL')).toBe(32768);
    });

    it('should match partial names', () => {
      // codellama contains 'llama' so gets llama's 4096
      expect(getDefaultContextSize('codellama')).toBe(4096);
    });
  });

  describe('canHandleContext', () => {
    it('should return true when no context limit is set', () => {
      expect(canHandleContext(undefined, 1000, 'some-model')).toBe(true);
    });

    it('should return true when prompt fits in context', () => {
      expect(canHandleContext(8192, 4000, 'some-model')).toBe(true);
    });

    it('should return false when prompt exceeds context (with 10% buffer)', () => {
      // 8192 * 0.9 = 7372 is the effective limit
      expect(canHandleContext(8192, 8000, 'some-model')).toBe(false);
      expect(canHandleContext(8192, 7372, 'some-model')).toBe(true);
    });

    it('should use default context size when limit is undefined', () => {
      // Default is 4096, effective = 3686
      expect(canHandleContext(undefined, 3000, 'unknown-model')).toBe(true);
      expect(canHandleContext(undefined, 4000, 'unknown-model')).toBe(false);
    });
  });
});
