/**
 * token-metrics-extractor.ts
 * Centralized token metrics extraction from various response formats
 */

import { featureFlags } from '../config/feature-flags.js';

export interface TokenMetrics {
  tokensGenerated?: number;
  tokensPrompt?: number;
  totalTokens?: number;
}

export interface StreamingMetrics {
  ttft?: number;
  streamingDuration?: number;
  tokensGenerated?: number;
  tokensPrompt?: number;
}

export class TokenMetricsExtractor {
  /**
   * Extract token metrics from Ollama API response
   */
  static fromOllamaResponse(response: unknown): TokenMetrics {
    if (!response || typeof response !== 'object') {
      return {};
    }

    const result: TokenMetrics = {};
    const r = response as Record<string, unknown>;

    // eval_count = generated tokens
    if (typeof r.eval_count === 'number' && r.eval_count >= 0) {
      result.tokensGenerated = r.eval_count;
    }

    // prompt_eval_count = prompt tokens
    if (typeof r.prompt_eval_count === 'number' && r.prompt_eval_count >= 0) {
      result.tokensPrompt = r.prompt_eval_count;
    }

    // Calculate total if both are available
    if (result.tokensGenerated !== undefined && result.tokensPrompt !== undefined) {
      result.totalTokens = result.tokensGenerated + result.tokensPrompt;
    }

    return result;
  }

  /**
   * Extract streaming metrics from internal format
   */
  static fromStreamingResponse(metrics: unknown): StreamingMetrics & TokenMetrics {
    if (!metrics || typeof metrics !== 'object') {
      return {};
    }

    const result: StreamingMetrics & TokenMetrics = {};
    const m = metrics as Record<string, unknown>;

    // Streaming metrics
    if (typeof m.ttft === 'number') {
      result.ttft = m.ttft;
    }
    if (typeof m.streamingDuration === 'number') {
      result.streamingDuration = m.streamingDuration;
    }

    // Token metrics from streaming
    if (typeof m.tokensGenerated === 'number') {
      result.tokensGenerated = m.tokensGenerated;
    }
    if (typeof m.tokensPrompt === 'number') {
      result.tokensPrompt = m.tokensPrompt;
    }

    return result;
  }

  /**
   * Extract from nested _tokenMetrics property
   */
  static fromNestedResponse(response: unknown): TokenMetrics {
    if (!response || typeof response !== 'object') {
      return {};
    }

    const r = response as Record<string, unknown>;

    if (r._tokenMetrics && typeof r._tokenMetrics === 'object') {
      const tm = r._tokenMetrics as Record<string, unknown>;
      const result: TokenMetrics = {};

      if (typeof tm.tokensGenerated === 'number') {
        result.tokensGenerated = tm.tokensGenerated;
      }
      if (typeof tm.tokensPrompt === 'number') {
        result.tokensPrompt = tm.tokensPrompt;
      }
      if (result.tokensGenerated !== undefined && result.tokensPrompt !== undefined) {
        result.totalTokens = result.tokensGenerated + result.tokensPrompt;
      }

      return result;
    }

    return {};
  }

  /**
   * Extract from nested _streamingMetrics property
   */
  static fromNestedStreamingMetrics(response: unknown): StreamingMetrics {
    if (!response || typeof response !== 'object') {
      return {};
    }

    const r = response as Record<string, unknown>;

    if (r._streamingMetrics && typeof r._streamingMetrics === 'object') {
      const sm = r._streamingMetrics as Record<string, unknown>;
      const result: StreamingMetrics = {};

      if (typeof sm.ttft === 'number') {
        result.ttft = sm.ttft;
      }
      if (typeof sm.streamingDuration === 'number') {
        result.streamingDuration = sm.streamingDuration;
      }

      return result;
    }

    return {};
  }

  /**
   * Combine all extraction methods for maximum coverage
   */
  static extractAll(response: unknown): TokenMetrics & StreamingMetrics {
    // If feature flag is disabled, return empty
    if (!featureFlags.get('useTokenExtractor')) {
      return {};
    }

    if (!response || typeof response !== 'object') {
      return {};
    }

    // Try direct extraction first
    const direct = this.fromOllamaResponse(response);

    // Then nested extractions
    const nestedTokens = this.fromNestedResponse(response);
    const nestedStreaming = this.fromNestedStreamingMetrics(response);

    // Merge with precedence (direct > nested)
    return {
      ...nestedStreaming,
      ...nestedTokens,
      ...direct,
    };
  }

  /**
   * Validate that metrics are reasonable
   */
  static validate(metrics: TokenMetrics): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (metrics.tokensGenerated !== undefined) {
      if (metrics.tokensGenerated < 0) {
        errors.push('tokensGenerated cannot be negative');
      }
      if (metrics.tokensGenerated > 1000000) {
        errors.push('tokensGenerated seems unreasonably high (>1M)');
      }
    }

    if (metrics.tokensPrompt !== undefined) {
      if (metrics.tokensPrompt < 0) {
        errors.push('tokensPrompt cannot be negative');
      }
      if (metrics.tokensPrompt > 1000000) {
        errors.push('tokensPrompt seems unreasonably high (>1M)');
      }
    }

    return { valid: errors.length === 0, errors };
  }
}
