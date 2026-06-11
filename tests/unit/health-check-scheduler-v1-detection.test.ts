/**
 * health-check-scheduler-v1-detection.test.ts
 * Tests for v1 capability detection methods in HealthCheckScheduler
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import type { HealthCheckConfig } from '../../src/config/config.js';
import { HealthCheckScheduler } from '../../src/health-check-scheduler.js';
import type { AIServer } from '../../src/orchestrator/orchestrator.types.js';
import { fetchWithTimeout } from '../../src/utils/fetch-with-timeout.js';

vi.mock('../../src/utils/fetch-with-timeout.js', () => ({
  fetchWithTimeout: vi.fn(),
}));

describe('HealthCheckScheduler V1 Capability Detection', () => {
  let config: HealthCheckConfig;
  let mockServer: AIServer;
  let scheduler: HealthCheckScheduler;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let getServers: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onHealthCheck: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onAllChecksComplete: any;

  beforeEach(() => {
    config = {
      enabled: true,
      intervalMs: 30000,
      timeoutMs: 5000,
      maxConcurrentChecks: 10,
      retryAttempts: 2,
      retryDelayMs: 1000,
      recoveryIntervalMs: 60000,
      failureThreshold: 3,
      successThreshold: 2,
      backoffMultiplier: 1.5,
    };

    mockServer = {
      id: 'test-server',
      url: 'http://localhost:11434',
      type: 'ollama',
      healthy: true,
      lastResponseTime: 1000,
      models: ['llama3:latest'],
      maxConcurrency: 10,
    };

    getServers = vi.fn(() => [mockServer]);
    onHealthCheck = vi.fn();
    onAllChecksComplete = vi.fn();

    scheduler = new HealthCheckScheduler(config, getServers, onHealthCheck, onAllChecksComplete);
  });

  afterEach(() => {
    scheduler.stop();
    vi.clearAllMocks();
  });

  describe('interpretV1Status', () => {
    it('should return "exists" for 2xx status codes', () => {
      expect((scheduler as any).interpretV1Status(200)).toBe('exists');
      expect((scheduler as any).interpretV1Status(201)).toBe('exists');
      expect((scheduler as any).interpretV1Status(204)).toBe('exists');
      expect((scheduler as any).interpretV1Status(299)).toBe('exists');
    });

    it('should return "exists" for 400 status code', () => {
      expect((scheduler as any).interpretV1Status(400)).toBe('exists');
    });

    it('should return "exists" for 401 status code', () => {
      expect((scheduler as any).interpretV1Status(401)).toBe('exists');
    });

    it('should return "exists" for 403 status code', () => {
      expect((scheduler as any).interpretV1Status(403)).toBe('exists');
    });

    it('should return "exists" for 422 status code', () => {
      expect((scheduler as any).interpretV1Status(422)).toBe('exists');
    });

    it('should return "exists" for 429 status code', () => {
      expect((scheduler as any).interpretV1Status(429)).toBe('exists');
    });

    it('should return "not_exists" for 404 status code', () => {
      expect((scheduler as any).interpretV1Status(404)).toBe('not_exists');
    });

    it('should return "not_exists" for 405 status code', () => {
      expect((scheduler as any).interpretV1Status(405)).toBe('not_exists');
    });

    it('should return "not_exists" for 410 status code', () => {
      expect((scheduler as any).interpretV1Status(410)).toBe('not_exists');
    });

    it('should return "exists" for other 4xx status codes (e.g., 500)', () => {
      expect((scheduler as any).interpretV1Status(500)).toBe('exists');
      expect((scheduler as any).interpretV1Status(502)).toBe('exists');
      expect((scheduler as any).interpretV1Status(503)).toBe('exists');
      expect((scheduler as any).interpretV1Status(418)).toBe('exists');
    });

    it('should return "error" for unknown status codes', () => {
      expect((scheduler as any).interpretV1Status(0)).toBe('error');
      expect((scheduler as any).interpretV1Status(-1)).toBe('error');
    });
  });

  describe('probeV1EndpointExistence', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return exists=true, healthy=true for status 200', async () => {
      vi.mocked(fetchWithTimeout).mockResolvedValue({
        status: 200,
      } as Response);

      const result = await (scheduler as any).probeV1EndpointExistence(mockServer);

      expect(result.exists).toBe(true);
      expect(result.healthy).toBe(true);
      expect(result.status).toBe(200);
    });

    it('should return exists=true, healthy=false for status 400', async () => {
      vi.mocked(fetchWithTimeout).mockResolvedValue({
        status: 400,
      } as Response);

      const result = await (scheduler as any).probeV1EndpointExistence(mockServer);

      expect(result.exists).toBe(true);
      expect(result.healthy).toBe(false);
      expect(result.status).toBe(400);
    });

    it('should return exists=true, healthy=false for status 401', async () => {
      vi.mocked(fetchWithTimeout).mockResolvedValue({
        status: 401,
      } as Response);

      const result = await (scheduler as any).probeV1EndpointExistence(mockServer);

      expect(result.exists).toBe(true);
      expect(result.healthy).toBe(false);
      expect(result.status).toBe(401);
    });

    it('should return exists=false, healthy=false for status 404', async () => {
      vi.mocked(fetchWithTimeout).mockResolvedValue({
        status: 404,
      } as Response);

      const result = await (scheduler as any).probeV1EndpointExistence(mockServer);

      expect(result.exists).toBe(false);
      expect(result.healthy).toBe(false);
      expect(result.status).toBe(404);
    });

    it('should return exists=false, healthy=false for status 405', async () => {
      vi.mocked(fetchWithTimeout).mockResolvedValue({
        status: 405,
      } as Response);

      const result = await (scheduler as any).probeV1EndpointExistence(mockServer);

      expect(result.exists).toBe(false);
      expect(result.healthy).toBe(false);
      expect(result.status).toBe(405);
    });

    it('should return exists=false, healthy=false for status 410', async () => {
      vi.mocked(fetchWithTimeout).mockResolvedValue({
        status: 410,
      } as Response);

      const result = await (scheduler as any).probeV1EndpointExistence(mockServer);

      expect(result.exists).toBe(false);
      expect(result.healthy).toBe(false);
      expect(result.status).toBe(410);
    });

    it('should return exists=true, healthy=false for status 500', async () => {
      vi.mocked(fetchWithTimeout).mockResolvedValue({
        status: 500,
      } as Response);

      const result = await (scheduler as any).probeV1EndpointExistence(mockServer);

      expect(result.exists).toBe(true);
      expect(result.healthy).toBe(false);
      expect(result.status).toBe(500);
    });

    it('should return exists=false, healthy=false for network errors', async () => {
      vi.mocked(fetchWithTimeout).mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await (scheduler as any).probeV1EndpointExistence(mockServer);

      expect(result.exists).toBe(false);
      expect(result.healthy).toBe(false);
      expect(result.status).toBe(0);
    });

    it('should use server apiKey in Authorization header', async () => {
      const serverWithKey: AIServer = {
        ...mockServer,
        apiKey: 'test-secret-key',
      };

      let capturedHeaders: Record<string, string> = {};
      vi.mocked(fetchWithTimeout).mockImplementation((...args: unknown[]) => {
        const [, options] = args as [string, { headers?: Record<string, string> }];
        capturedHeaders = options.headers || {};
        return Promise.resolve({ status: 200 } as Response);
      });

      await (scheduler as any).probeV1EndpointExistence(serverWithKey);

      expect(capturedHeaders['Authorization']).toBe('Bearer test-secret-key');
    });
  });

  describe('probeV1EndpointsLightweight', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return exists=true, healthy=true for status 200', async () => {
      vi.mocked(fetchWithTimeout).mockResolvedValue({
        status: 200,
      } as Response);

      const result = await scheduler.probeV1EndpointsLightweight(mockServer);

      expect(result.exists).toBe(true);
      expect(result.healthy).toBe(true);
      expect(result.status).toBe(200);
    });

    it('should return exists=true, healthy=false for status 400', async () => {
      vi.mocked(fetchWithTimeout).mockResolvedValue({
        status: 400,
      } as Response);

      const result = await scheduler.probeV1EndpointsLightweight(mockServer);

      expect(result.exists).toBe(true);
      expect(result.healthy).toBe(false);
      expect(result.status).toBe(400);
    });

    it('should return exists=true, healthy=false for status 422', async () => {
      vi.mocked(fetchWithTimeout).mockResolvedValue({
        status: 422,
      } as Response);

      const result = await scheduler.probeV1EndpointsLightweight(mockServer);

      expect(result.exists).toBe(true);
      expect(result.healthy).toBe(false);
      expect(result.status).toBe(422);
    });

    it('should return exists=true, healthy=false for status 500', async () => {
      vi.mocked(fetchWithTimeout).mockResolvedValue({
        status: 500,
      } as Response);

      const result = await scheduler.probeV1EndpointsLightweight(mockServer);

      expect(result.exists).toBe(true);
      expect(result.healthy).toBe(false);
      expect(result.status).toBe(500);
    });

    it('should return exists=true, healthy=false, status=0 for timeout', async () => {
      vi.mocked(fetchWithTimeout).mockRejectedValue(new Error('Request timeout after 2000ms'));

      const result = await scheduler.probeV1EndpointsLightweight(mockServer);

      expect(result.exists).toBe(true);
      expect(result.healthy).toBe(false);
      expect(result.status).toBe(0);
    });

    it('should return exists=true, healthy=false for AbortError', async () => {
      vi.mocked(fetchWithTimeout).mockRejectedValue(
        new Error('Request timeout after 2000ms: /v1/chat/completions')
      );

      const result = await scheduler.probeV1EndpointsLightweight(mockServer);

      expect(result.exists).toBe(true);
      expect(result.healthy).toBe(false);
      expect(result.status).toBe(0);
    });

    it('should return exists=true, healthy=false for network error', async () => {
      vi.mocked(fetchWithTimeout).mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await scheduler.probeV1EndpointsLightweight(mockServer);

      expect(result.exists).toBe(true);
      expect(result.healthy).toBe(false);
      expect(result.status).toBe(0);
    });

    it('should use server apiKey in Authorization header', async () => {
      const serverWithKey: AIServer = {
        ...mockServer,
        apiKey: 'test-api-key',
      };

      let capturedHeaders: Record<string, string> = {};
      let capturedBody: { model?: string; messages?: unknown[]; max_tokens?: number } = {};

      vi.mocked(fetchWithTimeout).mockImplementation((...args: unknown[]) => {
        const [, options] = args as [string, { headers?: Record<string, string>; body?: string }];
        capturedHeaders = options.headers || {};
        if (options.body) {
          capturedBody = JSON.parse(options.body);
        }
        return Promise.resolve({ status: 200 } as Response);
      });

      await scheduler.probeV1EndpointsLightweight(serverWithKey);

      expect(capturedHeaders['Authorization']).toBe('Bearer test-api-key');
      expect(capturedBody.model).toBe('__probe__');
      expect(capturedBody.messages).toEqual([]);
      expect(capturedBody.max_tokens).toBe(1);
    });
  });
});
