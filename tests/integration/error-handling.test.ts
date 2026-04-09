/**
 * Error Handling Integration Tests
 * Tests full flow of error classification, recording, querying, and rate limit backoff
 */

import { describe, it, beforeAll, afterAll, expect, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';

import { setupIntegrationTest, teardownIntegrationTest, makeRequest } from './setup.js';
import { ErrorClassifier, ErrorCategory, ErrorSeverity } from '../../src/utils/error-classifier.js';
import { parseRetryAfter } from '../../src/utils/retry-after.js';
import { calculateRateLimitBackoff } from '../../src/utils/rate-limit-backoff.js';
import { getErrorEventStore, resetErrorEventStore } from '../../src/storage/error-event-store.js';
import type { RateLimitConfig } from '../../src/config/schema.js';

// Test data directory - using a unique path for isolation
const TEST_ERROR_EVENTS_DIR = './data/test-error-events';

describe('Error Handling Integration Tests', () => {
  beforeAll(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    // Clean up test error events directory
    await cleanupTestDir(TEST_ERROR_EVENTS_DIR);
    resetErrorEventStore();
    await teardownIntegrationTest();
  });

  beforeEach(async () => {
    // Reset error event store singleton and clear test directory
    resetErrorEventStore();
    await cleanupTestDir(TEST_ERROR_EVENTS_DIR);
  });

  // ============================================================
  // Error Classification Tests
  // ============================================================

  describe('Error Classification', () => {
    it('should classify rate limit error as rateLimited type', () => {
      const classifier = new ErrorClassifier();
      const result = classifier.classify('rate limit exceeded');

      expect(result.type).toBe('rateLimited');
      expect(result.isRetryable).toBe(true);
      expect(result.isTransient).toBe(true);
      expect(result.shouldCircuitBreak).toBe(true);
      expect(result.severity).toBe(ErrorSeverity.MEDIUM);
    });

    it('should classify network timeout as transient', () => {
      const classifier = new ErrorClassifier();
      const result = classifier.classify('connection timeout');

      expect(result.type).toBe('transient');
      expect(result.isRetryable).toBe(true);
      expect(result.isTransient).toBe(true);
      expect(result.category).toBe(ErrorCategory.NETWORK);
    });

    it('should classify model not found as non-retryable', () => {
      const classifier = new ErrorClassifier();
      const result = classifier.classify('model llama2 not found');

      expect(result.type).toBe('non-retryable');
      expect(result.isRetryable).toBe(false);
      expect(result.isPermanent).toBe(true);
      expect(result.shouldCircuitBreak).toBe(true);
    });

    it('should classify HTTP 503 as transient', () => {
      const classifier = new ErrorClassifier();
      const result = classifier.classify('HTTP 503 service unavailable');

      expect(result.type).toBe('transient');
      expect(result.isRetryable).toBe(true);
      expect(result.matchedPattern).toBe('HTTP 503');
    });

    it('should classify HTTP 500 as transient (not permanent)', () => {
      const classifier = new ErrorClassifier();
      const result = classifier.classify('HTTP 500 internal server error');

      expect(result.type).toBe('transient');
      expect(result.isRetryable).toBe(true);
      expect(result.isPermanent).toBe(false);
    });

    it('should classify out of memory as non-retryable', () => {
      const classifier = new ErrorClassifier();
      const result = classifier.classify('out of memory error');

      expect(result.type).toBe('non-retryable');
      expect(result.isRetryable).toBe(false);
      expect(result.category).toBe(ErrorCategory.RESOURCE);
    });

    it('should classify context length exceeded as non-retryable', () => {
      const classifier = new ErrorClassifier();
      const result = classifier.classify('context length exceeded maximum');

      expect(result.type).toBe('non-retryable');
      expect(result.isRetryable).toBe(false);
      expect(result.matchedPattern).toBe('context length');
    });
  });

  // ============================================================
  // ErrorEventStore Recording Tests
  // ============================================================

  describe('ErrorEventStore Recording', () => {
    it('should record error event to file', async () => {
      const store = getErrorEventStore(TEST_ERROR_EVENTS_DIR);
      
      const event = {
        id: 'test-error-1',
        serverId: 'server-1',
        circuitId: 'server-1:llama2',
        errorType: 'transient' as const,
        errorMessage: 'connection timeout',
        timestamp: new Date().toISOString(),
        retryable: true,
        category: 'network' as const,
        severity: 'medium' as const,
        matchedPattern: 'timeout',
      };

      await store.recordError(event);

      // Verify file was created
      const filePath = store.getDailyFilePath(new Date(event.timestamp));
      expect(fs.existsSync(filePath)).toBe(true);

      // Verify content
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(content.trim());
      expect(parsed.id).toBe('test-error-1');
      expect(parsed.errorMessage).toBe('connection timeout');
    });

    it('should record multiple errors and query them', async () => {
      const store = getErrorEventStore(TEST_ERROR_EVENTS_DIR);
      
      const event1 = {
        id: 'test-error-2',
        serverId: 'server-1',
        circuitId: 'server-1:llama2',
        errorType: 'rate_limited' as const,
        errorMessage: 'rate limit exceeded',
        timestamp: new Date().toISOString(),
        retryable: true,
        category: 'network' as const,
        severity: 'medium' as const,
        matchedPattern: 'rate limit',
      };

      const event2 = {
        id: 'test-error-3',
        serverId: 'server-2',
        circuitId: 'server-2:codellama',
        errorType: 'non_retryable' as const,
        errorMessage: 'model not found',
        timestamp: new Date().toISOString(),
        retryable: false,
        category: 'config' as const,
        severity: 'critical' as const,
        matchedPattern: 'model.*not found',
      };

      await store.recordError(event1);
      await store.recordError(event2);

      // Query all errors
      const allErrors = await store.queryErrors({});
      expect(allErrors.length).toBe(2);

      // Query by serverId
      const server1Errors = await store.queryErrors({ serverId: 'server-1' });
      expect(server1Errors.length).toBe(1);
      expect(server1Errors[0].id).toBe('test-error-2');

      // Query by errorType
      const rateLimitedErrors = await store.queryErrors({ errorType: 'rate_limited' });
      expect(rateLimitedErrors.length).toBe(1);
      expect(rateLimitedErrors[0].id).toBe('test-error-2');
    });

    it('should query errors with time range filter', async () => {
      const store = getErrorEventStore(TEST_ERROR_EVENTS_DIR);
      
      const now = new Date();
      const pastEvent = {
        id: 'test-error-past',
        serverId: 'server-1',
        circuitId: 'server-1:llama2',
        errorType: 'transient' as const,
        errorMessage: 'old error',
        timestamp: new Date(now.getTime() - 86400000).toISOString(), // 1 day ago
        retryable: true,
        category: 'network' as const,
        severity: 'medium' as const,
        matchedPattern: null,
      };

      const recentEvent = {
        id: 'test-error-recent',
        serverId: 'server-1',
        circuitId: 'server-1:llama2',
        errorType: 'transient' as const,
        errorMessage: 'recent error',
        timestamp: now.toISOString(),
        retryable: true,
        category: 'network' as const,
        severity: 'medium' as const,
        matchedPattern: null,
      };

      await store.recordError(pastEvent);
      await store.recordError(recentEvent);

      // Query only recent errors
      const recentErrors = await store.queryErrors({
        startTime: new Date(now.getTime() - 3600000).toISOString(), // Last hour
      });

      expect(recentErrors.length).toBe(1);
      expect(recentErrors[0].id).toBe('test-error-recent');
    });
  });

  // ============================================================
  // API Endpoint Tests
  // ============================================================

  describe('Error API Endpoints', () => {
    it('should retrieve recorded errors via API', async () => {
      const store = getErrorEventStore(TEST_ERROR_EVENTS_DIR);
      
      const event = {
        id: 'api-test-error-1',
        serverId: 'test-server',
        circuitId: 'test-server:mistral',
        errorType: 'transient' as const,
        errorMessage: 'service temporarily unavailable',
        timestamp: new Date().toISOString(),
        retryable: true,
        category: 'network' as const,
        severity: 'medium' as const,
        matchedPattern: 'temporarily unavailable',
      };

      await store.recordError(event);

      // Query via API
      const response = await makeRequest('GET', '/api/orchestrator/errors');
      
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.count).toBeGreaterThan(0);
      
      // Find our specific error
      const foundError = response.data.errors.find((e: any) => e.id === 'api-test-error-1');
      expect(foundError).toBeDefined();
      expect(foundError.errorMessage).toBe('service temporarily unavailable');
    });

    it('should filter errors by serverId via API', async () => {
      const store = getErrorEventStore(TEST_ERROR_EVENTS_DIR);
      
      const event1 = {
        id: 'api-test-error-2',
        serverId: 'server-a',
        circuitId: 'server-a:llama2',
        errorType: 'transient' as const,
        errorMessage: 'timeout',
        timestamp: new Date().toISOString(),
        retryable: true,
        category: 'network' as const,
        severity: 'medium' as const,
        matchedPattern: 'timeout',
      };

      const event2 = {
        id: 'api-test-error-3',
        serverId: 'server-b',
        circuitId: 'server-b:codellama',
        errorType: 'transient' as const,
        errorMessage: 'timeout',
        timestamp: new Date().toISOString(),
        retryable: true,
        category: 'network' as const,
        severity: 'medium' as const,
        matchedPattern: 'timeout',
      };

      await store.recordError(event1);
      await store.recordError(event2);

      // Query specific server
      const response = await makeRequest('GET', '/api/orchestrator/errors/server-a');
      
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.serverId).toBe('server-a');
      expect(response.data.count).toBe(1);
      expect(response.data.errors[0].id).toBe('api-test-error-2');
    });

    it('should filter errors by circuitId via API', async () => {
      const store = getErrorEventStore(TEST_ERROR_EVENTS_DIR);
      
      const event = {
        id: 'api-test-error-4',
        serverId: 'server-x',
        circuitId: 'server-x:llama2:7b',
        errorType: 'non_retryable' as const,
        errorMessage: 'model not found',
        timestamp: new Date().toISOString(),
        retryable: false,
        category: 'config' as const,
        severity: 'critical' as const,
        matchedPattern: 'model.*not found',
      };

      await store.recordError(event);

      // Query specific circuit
      const response = await makeRequest('GET', '/api/orchestrator/errors/server-x/server-x:llama2:7b');
      
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.circuitId).toBe('server-x:llama2:7b');
      expect(response.data.count).toBe(1);
      expect(response.data.errors[0].id).toBe('api-test-error-4');
    });
  });

  // ============================================================
  // Retry-After Parsing Tests
  // ============================================================

  describe('parseRetryAfter', () => {
    it('should parse delta-seconds format', () => {
      expect(parseRetryAfter('120')).toBe(120000); // 120 seconds = 120000 ms
      expect(parseRetryAfter('60')).toBe(60000);  // 60 seconds = 60000 ms
      expect(parseRetryAfter('0')).toBe(0);
    });

    it('should parse HTTP-date format in the future', () => {
      // Future date: 1 hour from now
      const futureDate = new Date(Date.now() + 3600000);
      const httpDateStr = futureDate.toUTCString();
      
      const result = parseRetryAfter(httpDateStr);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(3600000 + 1000); // Allow 1 second tolerance
    });

    it('should return 0 for past HTTP-date', () => {
      // Past date: 1 hour ago
      const pastDate = new Date(Date.now() - 3600000);
      const httpDateStr = pastDate.toUTCString();
      
      expect(parseRetryAfter(httpDateStr)).toBe(0);
    });

    it('should return null for invalid input', () => {
      expect(parseRetryAfter(undefined)).toBe(null);
      expect(parseRetryAfter('')).toBe(null);
      expect(parseRetryAfter('invalid')).toBe(null);
      expect(parseRetryAfter('abc123')).toBe(null);
    });

    it('should handle whitespace in delta-seconds', () => {
      expect(parseRetryAfter('  120  ')).toBe(120000);
    });
  });

  // ============================================================
  // Rate Limit Backoff Tests
  // ============================================================

  describe('calculateRateLimitBackoff', () => {
    const defaultConfig: RateLimitConfig = {
      defaultRetryAfterMs: 60000,  // 1 minute
      maxRetryAfterMs: 300000,     // 5 minutes
      enableRetryAfterHeader: true,
    };

    it('should use exponential backoff for Ollama (ignores Retry-After)', () => {
      // Ollama should always use exponential backoff, never Retry-After
      const delay0 = calculateRateLimitBackoff('ollama', '120', defaultConfig, 0);
      const delay1 = calculateRateLimitBackoff('ollama', '120', defaultConfig, 1);
      const delay2 = calculateRateLimitBackoff('ollama', '120', defaultConfig, 2);

      expect(delay0).toBe(60000);   // base * 2^0 = 60000
      expect(delay1).toBe(120000);  // base * 2^1 = 120000
      expect(delay2).toBe(240000); // base * 2^2 = 240000
    });

    it('should honor Retry-After header for OpenAI when enabled', () => {
      // With Retry-After header of 120 seconds (120000ms)
      const delay = calculateRateLimitBackoff('openai', '120', defaultConfig, 0);
      
      // Should use the Retry-After value (120000ms), capped at maxRetryAfterMs
      expect(delay).toBe(120000);
    });

    it('should honor Retry-After header for Anthropic when enabled', () => {
      const delay = calculateRateLimitBackoff('anthropic', '60', defaultConfig, 0);
      
      expect(delay).toBe(60000);
    });

    it('should cap Retry-After at maxRetryAfterMs', () => {
      // Retry-After of 600 seconds (600000ms) should be capped to 300000ms
      const delay = calculateRateLimitBackoff('openai', '600', defaultConfig, 0);
      
      expect(delay).toBe(300000);
    });

    it('should fall back to exponential backoff when Retry-After is invalid', () => {
      // Invalid Retry-After should fall back to exponential backoff
      const delay = calculateRateLimitBackoff('openai', 'invalid', defaultConfig, 1);
      
      expect(delay).toBe(120000); // base * 2^1 = 120000
    });

    it('should fall back to exponential backoff when Retry-After header is disabled', () => {
      const configWithDisabledHeader: RateLimitConfig = {
        ...defaultConfig,
        enableRetryAfterHeader: false,
      };

      const delay = calculateRateLimitBackoff('openai', '120', configWithDisabledHeader, 0);
      
      // Should use base delay, not Retry-After value
      expect(delay).toBe(60000);
    });

    it('should respect maxRetryAfterMs cap in exponential backoff', () => {
      // Multiple retries should cap at maxRetryAfterMs
      const delay = calculateRateLimitBackoff('ollama', undefined, defaultConfig, 10);
      
      expect(delay).toBe(300000); // Should be capped at max
    });

    it('should handle undefined Retry-After gracefully', () => {
      const delay = calculateRateLimitBackoff('openai', undefined, defaultConfig, 0);
      
      expect(delay).toBe(60000); // Falls back to base delay
    });
  });

  // ============================================================
  // Full Flow Integration Tests
  // ============================================================

  describe('Full Error Flow', () => {
    it('should complete full error flow: classify -> record -> query -> API', async () => {
      // Step 1: Error occurs (simulated)
      const errorMessage = 'HTTP 429 rate limit exceeded for model llama2';

      // Step 2: Error is classified
      const classifier = new ErrorClassifier();
      const classification = classifier.classify(errorMessage);
      
      expect(classification.type).toBe('rateLimited');
      expect(classification.isRetryable).toBe(true);
      expect(classification.shouldCircuitBreak).toBe(true);

      // Step 3: Error is recorded to ErrorEventStore
      const store = getErrorEventStore(TEST_ERROR_EVENTS_DIR);
      const event = {
        id: 'flow-test-1',
        serverId: 'production-server-1',
        circuitId: 'production-server-1:llama2',
        errorType: 'rate_limited' as const,
        errorMessage,
        timestamp: new Date().toISOString(),
        retryable: classification.isRetryable,
        category: 'network' as const,
        severity: 'medium' as const,
        matchedPattern: classification.matchedPattern ?? null,
      };

      await store.recordError(event);

      // Step 4: Error is queryable via API
      const response = await makeRequest('GET', '/api/orchestrator/errors');
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);

      const foundError = response.data.errors.find((e: any) => e.id === 'flow-test-1');
      expect(foundError).toBeDefined();
      expect(foundError.errorType).toBe('rate_limited');
      expect(foundError.retryable).toBe(true);
    });

    it('should complete rate limit flow: receive -> parse Retry-After -> apply backoff', () => {
      // Step 1: Rate limit error received with Retry-After header
      const retryAfterHeader = '120'; // 120 seconds

      // Step 2: Retry-After is parsed
      const parsedDelay = parseRetryAfter(retryAfterHeader);
      expect(parsedDelay).toBe(120000);

      // Step 3: Backoff is calculated correctly for each provider
      const config: RateLimitConfig = {
        defaultRetryAfterMs: 60000,
        maxRetryAfterMs: 300000,
        enableRetryAfterHeader: true,
      };

      // OpenAI respects Retry-After
      const openaiDelay = calculateRateLimitBackoff('openai', retryAfterHeader, config, 0);
      expect(openaiDelay).toBe(120000);

      // Anthropic respects Retry-After
      const anthropicDelay = calculateRateLimitBackoff('anthropic', retryAfterHeader, config, 0);
      expect(anthropicDelay).toBe(120000);

      // Ollama ignores Retry-After (uses exponential backoff)
      const ollamaDelay = calculateRateLimitBackoff('ollama', retryAfterHeader, config, 0);
      expect(ollamaDelay).toBe(60000); // Base delay
    });
  });
});

// Helper function to clean up test directory
async function cleanupTestDir(dirPath: string): Promise<void> {
  const resolvedPath = path.resolve(dirPath);
  if (fs.existsSync(resolvedPath)) {
    fs.rmSync(resolvedPath, { recursive: true, force: true });
  }
}
