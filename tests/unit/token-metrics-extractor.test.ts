/**
 * token-metrics-extractor.test.ts
 * Tests for TokenMetricsExtractor utility
 */

import { describe, it, expect } from 'vitest';
import { TokenMetricsExtractor } from '../../src/utils/token-metrics-extractor.js';

describe('TokenMetricsExtractor', () => {
  describe('fromOllamaResponse', () => {
    it('should extract tokens from valid response', () => {
      const response = {
        eval_count: 100,
        prompt_eval_count: 50,
      };

      const result = TokenMetricsExtractor.fromOllamaResponse(response);

      expect(result.tokensGenerated).toBe(100);
      expect(result.tokensPrompt).toBe(50);
      expect(result.totalTokens).toBe(150);
    });

    it('should return empty for null response', () => {
      const result = TokenMetricsExtractor.fromOllamaResponse(null);
      expect(result).toEqual({});
    });

    it('should return empty for undefined response', () => {
      const result = TokenMetricsExtractor.fromOllamaResponse(undefined);
      expect(result).toEqual({});
    });

    it('should return empty for non-object response', () => {
      const result = TokenMetricsExtractor.fromOllamaResponse('string');
      expect(result).toEqual({});
    });

    it('should handle missing token fields', () => {
      const response = { other: 'data' };
      const result = TokenMetricsExtractor.fromOllamaResponse(response);
      expect(result).toEqual({});
    });

    it('should ignore negative token values', () => {
      const response = { eval_count: -1, prompt_eval_count: 10 };
      const result = TokenMetricsExtractor.fromOllamaResponse(response);
      expect(result.tokensGenerated).toBeUndefined();
      expect(result.tokensPrompt).toBe(10);
    });
  });

  describe('fromStreamingResponse', () => {
    it('should extract streaming metrics', () => {
      const metrics = {
        ttft: 100,
        streamingDuration: 500,
        tokensGenerated: 50,
        tokensPrompt: 20,
      };

      const result = TokenMetricsExtractor.fromStreamingResponse(metrics);

      expect(result.ttft).toBe(100);
      expect(result.streamingDuration).toBe(500);
      expect(result.tokensGenerated).toBe(50);
      expect(result.tokensPrompt).toBe(20);
    });

    it('should return empty for null', () => {
      const result = TokenMetricsExtractor.fromStreamingResponse(null);
      expect(result).toEqual({});
    });
  });

  describe('fromNestedResponse', () => {
    it('should extract from nested _tokenMetrics', () => {
      const response = {
        _tokenMetrics: {
          tokensGenerated: 100,
          tokensPrompt: 50,
        },
      };

      const result = TokenMetricsExtractor.fromNestedResponse(response);

      expect(result.tokensGenerated).toBe(100);
      expect(result.tokensPrompt).toBe(50);
      expect(result.totalTokens).toBe(150);
    });

    it('should return empty when no nested metrics', () => {
      const response = { other: 'data' };
      const result = TokenMetricsExtractor.fromNestedResponse(response);
      expect(result).toEqual({});
    });
  });

  describe('fromNestedStreamingMetrics', () => {
    it('should extract from nested _streamingMetrics', () => {
      const response = {
        _streamingMetrics: {
          ttft: 100,
          streamingDuration: 500,
        },
      };

      const result = TokenMetricsExtractor.fromNestedStreamingMetrics(response);

      expect(result.ttft).toBe(100);
      expect(result.streamingDuration).toBe(500);
    });
  });

  describe('extractAll', () => {
    it('should combine all extraction methods', () => {
      const response = {
        eval_count: 100,
        _tokenMetrics: { tokensGenerated: 50 },
      };

      const result = TokenMetricsExtractor.extractAll(response);

      // Direct extraction takes precedence
      expect(result.tokensGenerated).toBe(100);
    });
  });

  describe('validate', () => {
    it('should validate correct metrics', () => {
      const metrics = { tokensGenerated: 100, tokensPrompt: 50 };
      const result = TokenMetricsExtractor.validate(metrics);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should catch negative tokens', () => {
      const metrics = { tokensGenerated: -1 };
      const result = TokenMetricsExtractor.validate(metrics);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('tokensGenerated cannot be negative');
    });

    it('should catch unreasonably high tokens', () => {
      const metrics = { tokensGenerated: 2000000 };
      const result = TokenMetricsExtractor.validate(metrics);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('tokensGenerated seems unreasonably high (>1M)');
    });
  });
});
