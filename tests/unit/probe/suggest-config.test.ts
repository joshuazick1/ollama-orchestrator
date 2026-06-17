import { describe, it, expect } from 'vitest';
import {
  suggestServerConfig,
  type SuggestServerConfigOptions,
  type SuggestedConfig,
} from '../../../src/probe/suggest-config.js';

describe('suggestServerConfig', () => {
  describe('latency-based configuration', () => {
    it('fast server (< 100ms) returns maxConcurrency 8 and timeout 10000', () => {
      const result = suggestServerConfig({ avgLatencyMs: 50 });
      expect(result.maxConcurrency).toBe(8);
      expect(result.requestTimeoutMs).toBe(10000);
    });

    it('medium server (100-1000ms) returns maxConcurrency 4 and timeout 30000', () => {
      const result = suggestServerConfig({ avgLatencyMs: 500 });
      expect(result.maxConcurrency).toBe(4);
      expect(result.requestTimeoutMs).toBe(30000);
    });

    it('slow server (> 1000ms) returns maxConcurrency 2 and timeout 60000', () => {
      const result = suggestServerConfig({ avgLatencyMs: 2000 });
      expect(result.maxConcurrency).toBe(2);
      expect(result.requestTimeoutMs).toBe(60000);
    });

    it('edge case: exactly 100ms returns medium configuration', () => {
      const result = suggestServerConfig({ avgLatencyMs: 100 });
      expect(result.maxConcurrency).toBe(4);
      expect(result.requestTimeoutMs).toBe(30000);
    });

    it('edge case: exactly 1000ms returns medium configuration', () => {
      const result = suggestServerConfig({ avgLatencyMs: 1000 });
      expect(result.maxConcurrency).toBe(4);
      expect(result.requestTimeoutMs).toBe(30000);
    });
  });

  describe('supportsStreaming passthrough', () => {
    it('passes through supportsStreaming true', () => {
      const result = suggestServerConfig({ avgLatencyMs: 50, supportsStreaming: true });
      expect(result.supportsStreaming).toBe(true);
    });

    it('passes through supportsStreaming false', () => {
      const result = suggestServerConfig({ avgLatencyMs: 50, supportsStreaming: false });
      expect(result.supportsStreaming).toBe(false);
    });
  });

  describe('defaults', () => {
    it('no options returns medium defaults with supportsStreaming false', () => {
      const result = suggestServerConfig();
      expect(result.maxConcurrency).toBe(4);
      expect(result.requestTimeoutMs).toBe(30000);
      expect(result.supportsStreaming).toBe(false);
    });
  });
});
