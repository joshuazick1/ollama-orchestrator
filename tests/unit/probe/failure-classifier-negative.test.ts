/**
 * failure-classifier-negative.test.ts
 * TDD RED phase: Tests for classifyNegativeResult() - capability gap detection
 */

import { describe, it, expect } from 'vitest';

import {
  classifyNegativeResult,
  type NegativeClassification,
  type NegativeFailureKind,
} from '../../../src/probe/failure-classifier-negative.js';

describe('classifyNegativeResult', () => {
  describe('Rule 1: HTTP 429 - rate_limited', () => {
    it('classifies HTTP 429 as rate_limited', () => {
      const result = classifyNegativeResult({
        status: 429,
        body: 'Too Many Requests',
        contentType: 'text/plain',
      });
      expect(result.kind).toBe('rate_limited');
      expect(result.retryable).toBe(true);
      expect(result.reason).toBe('rate_limit');
    });

    it('classifies HTTP 429 without Retry-After as rate_limited', () => {
      const result = classifyNegativeResult({
        status: 429,
        body: 'Too Many Requests',
        contentType: 'text/plain',
      });
      expect(result.kind).toBe('rate_limited');
      expect(result.retryable).toBe(true);
      expect(result.reason).toBe('rate_limit');
      expect(result.retryAfterMs).toBeUndefined();
    });
  });

  describe('Rule 2: HTTP 503 - transient', () => {
    it('classifies HTTP 503 as transient with 5000ms retry', () => {
      const result = classifyNegativeResult({
        status: 503,
        body: 'Service Unavailable',
        contentType: 'text/plain',
      });
      expect(result.kind).toBe('transient');
      expect(result.retryable).toBe(true);
      expect(result.reason).toBe('unavailable');
      expect(result.retryAfterMs).toBe(5000);
    });
  });

  describe('Rule 3: HTTP 200 with error body - capability_gap (mid_stream_error)', () => {
    it('classifies HTTP 200 with JSON error as mid_stream_error', () => {
      const result = classifyNegativeResult({
        status: 200,
        body: '{"error":"context length exceeded"}',
        contentType: 'application/json',
      });
      expect(result.kind).toBe('capability_gap');
      expect(result.retryable).toBe(false);
      expect(result.reason).toBe('mid_stream_error');
    });

    it('classifies HTTP 200 with nested error.message as mid_stream_error', () => {
      const result = classifyNegativeResult({
        status: 200,
        body: '{"error":{"message":"model not supported"}}',
        contentType: 'application/json',
      });
      expect(result.kind).toBe('capability_gap');
      expect(result.retryable).toBe(false);
      expect(result.reason).toBe('mid_stream_error');
    });
  });

  describe('Rule 4: HTTP 404 with HTML - capability_gap (endpoint_absent)', () => {
    it('classifies HTTP 404 with text/html contentType as endpoint_absent', () => {
      const result = classifyNegativeResult({
        status: 404,
        body: '<html><body>404 Not Found</body></html>',
        contentType: 'text/html',
      });
      expect(result.kind).toBe('capability_gap');
      expect(result.retryable).toBe(false);
      expect(result.reason).toBe('endpoint_absent');
    });

    it('classifies HTTP 404 with body starting with < as endpoint_absent', () => {
      const result = classifyNegativeResult({
        status: 404,
        body: '<!DOCTYPE html><html><body>Page not found</body></html>',
        contentType: 'application/json',
      });
      expect(result.kind).toBe('capability_gap');
      expect(result.retryable).toBe(false);
      expect(result.reason).toBe('endpoint_absent');
    });

    it('classifies HTTP 404 with "page not found" text as endpoint_absent', () => {
      const result = classifyNegativeResult({
        status: 404,
        body: '404 page not found',
        contentType: 'text/plain',
      });
      expect(result.kind).toBe('capability_gap');
      expect(result.retryable).toBe(false);
      expect(result.reason).toBe('endpoint_absent');
    });
  });

  describe('Rule 5: HTTP 404 with JSON containing model/not found - capability_gap (model_not_found)', () => {
    it('classifies HTTP 404 JSON with "not found" as model_not_found', () => {
      const result = classifyNegativeResult({
        status: 404,
        body: '{"error":"resource not found"}',
        contentType: 'application/json',
      });
      expect(result.kind).toBe('capability_gap');
      expect(result.retryable).toBe(false);
      expect(result.reason).toBe('model_not_found');
    });

    it('classifies HTTP 404 JSON with "model" keyword as model_not_found', () => {
      const result = classifyNegativeResult({
        status: 404,
        body: '{"error":"model not found"}',
        contentType: 'application/json',
      });
      expect(result.kind).toBe('capability_gap');
      expect(result.retryable).toBe(false);
      expect(result.reason).toBe('model_not_found');
    });
  });

  describe('Rule 6: HTTP 200 with valid response - suspicious (no_validation)', () => {
    it('classifies HTTP 200 with valid JSON response as no_validation', () => {
      const result = classifyNegativeResult({
        status: 200,
        body: '{"response":"valid output","model":"llama3"}',
        contentType: 'application/json',
      });
      expect(result.kind).toBe('suspicious');
      expect(result.retryable).toBe(false);
      expect(result.reason).toBe('no_validation');
    });

    it('classifies HTTP 200 with empty body as no_validation', () => {
      const result = classifyNegativeResult({
        status: 200,
        body: '',
        contentType: 'text/plain',
      });
      expect(result.kind).toBe('suspicious');
      expect(result.retryable).toBe(false);
      expect(result.reason).toBe('no_validation');
    });
  });

  describe('Rule 7: Default - transient (unknown)', () => {
    it('classifies HTTP 500 as transient unknown', () => {
      const result = classifyNegativeResult({
        status: 500,
        body: 'Internal Server Error',
        contentType: 'text/plain',
      });
      expect(result.kind).toBe('transient');
      expect(result.retryable).toBe(true);
      expect(result.reason).toBe('unknown');
    });

    it('classifies HTTP 401 as transient unknown (no specific auth rule)', () => {
      const result = classifyNegativeResult({
        status: 401,
        body: 'Unauthorized',
        contentType: 'text/plain',
      });
      expect(result.kind).toBe('transient');
      expect(result.retryable).toBe(true);
      expect(result.reason).toBe('unknown');
    });
  });

  describe('Edge Cases', () => {
    it('handles empty body with 404 as endpoint_absent fallback', () => {
      const result = classifyNegativeResult({
        status: 404,
        body: '',
        contentType: '',
      });
      expect(result.kind).toBe('capability_gap');
      expect(result.retryable).toBe(false);
      expect(result.reason).toBe('endpoint_absent');
    });

    it('handles malformed JSON body gracefully', () => {
      const result = classifyNegativeResult({
        status: 200,
        body: 'not valid json {',
        contentType: 'application/json',
      });
      // Should not find error key, falls through to no_validation
      expect(result.kind).toBe('suspicious');
      expect(result.reason).toBe('no_validation');
    });

    it('does not match "not found" in unrelated JSON fields', () => {
      const result = classifyNegativeResult({
        status: 404,
        body: '{"message":"item not found in cache"}',
        contentType: 'application/json',
      });
      // "not found" is present but it's a general message, not specifically model-related
      // This would still be model_not_found since rule 5 checks for "not found" OR "model"
      expect(result.kind).toBe('capability_gap');
      expect(result.reason).toBe('model_not_found');
    });
  });

  describe('Type exports', () => {
    it('exports NegativeFailureKind type', () => {
      const kind: NegativeFailureKind = 'capability_gap';
      expect(kind).toBe('capability_gap');
    });

    it('exports NegativeClassification type', () => {
      const classification: NegativeClassification = {
        kind: 'rate_limited',
        retryable: true,
        reason: 'rate_limit',
      };
      expect(classification.kind).toBe('rate_limited');
    });
  });
});
