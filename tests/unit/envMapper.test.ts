/**
 * envMapper.test.ts
 * Tests for environment variable to config mapping
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ENV_CONFIG_MAPPING,
  applyEnvOverrides,
  getConfigurableEnvVars,
} from '../../src/config/envMapper.js';

describe('envMapper', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('ENV_CONFIG_MAPPING', () => {
    it('should have mapping for port', () => {
      expect(ENV_CONFIG_MAPPING.ORCHESTRATOR_PORT).toBe('port');
    });

    it('should have mapping for queue settings', () => {
      expect(ENV_CONFIG_MAPPING.ORCHESTRATOR_QUEUE_MAX_SIZE).toBe('queue.maxSize');
    });

    it('should have mapping for load balancer weights', () => {
      expect(ENV_CONFIG_MAPPING.ORCHESTRATOR_LB_WEIGHT_LATENCY).toBe(
        'loadBalancer.weights.latency'
      );
    });

    it('should have mapping for circuit breaker settings', () => {
      expect(ENV_CONFIG_MAPPING.ORCHESTRATOR_CB_FAILURE_THRESHOLD).toBe(
        'circuitBreaker.baseFailureThreshold'
      );
    });

    it('should have mapping for health check settings', () => {
      expect(ENV_CONFIG_MAPPING.ORCHESTRATOR_HC_ENABLED).toBe('healthCheck.enabled');
    });
  });

  describe('applyEnvOverrides', () => {
    it('should return original config when no env vars set', () => {
      const config = { port: 3000 };
      const result = applyEnvOverrides(config);
      expect(result.port).toBe(3000);
    });

    it('should override port from env var', () => {
      process.env.ORCHESTRATOR_PORT = '4000';
      const config = { port: 3000 };
      const result = applyEnvOverrides(config);
      expect(result.port).toBe(4000);
    });

    it('should parse boolean true', () => {
      process.env.ORCHESTRATOR_ENABLE_QUEUE = 'true';
      const config = { enableQueue: false };
      const result = applyEnvOverrides(config);
      expect(result.enableQueue).toBe(true);
    });

    it('should parse boolean false', () => {
      process.env.ORCHESTRATOR_ENABLE_METRICS = 'false';
      const config = { enableMetrics: true };
      const result = applyEnvOverrides(config);
      expect(result.enableMetrics).toBe(false);
    });

    it('should parse number', () => {
      process.env.ORCHESTRATOR_QUEUE_MAX_SIZE = '5000';
      const config = { queue: { maxSize: 1000 } };
      const result = applyEnvOverrides(config);
      expect(result.queue.maxSize).toBe(5000);
    });

    it('should parse float number', () => {
      process.env.ORCHESTRATOR_LB_WEIGHT_LATENCY = '0.5';
      const config = { loadBalancer: { weights: { latency: 0.35 } } };
      const result = applyEnvOverrides(config);
      expect(result.loadBalancer.weights.latency).toBe(0.5);
    });

    it('should parse comma-separated array', () => {
      process.env.ORCHESTRATOR_CORS_ORIGINS = 'http://localhost:3000,http://localhost:4000';
      const config = { security: { corsOrigins: [] } };
      const result = applyEnvOverrides(config);
      expect(result.security.corsOrigins).toEqual([
        'http://localhost:3000',
        'http://localhost:4000',
      ]);
    });

    it('should parse array of numbers', () => {
      process.env.ORCHESTRATOR_RETRY_STATUS_CODES = '408,429,500,502,503,504';
      const config = { retry: { retryableStatusCodes: [] } };
      const result = applyEnvOverrides(config);
      expect(result.retry.retryableStatusCodes).toEqual([408, 429, 500, 502, 503, 504]);
    });

    it('should set nested config path', () => {
      process.env.ORCHESTRATOR_QUEUE_TIMEOUT = '60000';
      const config = { queue: { timeout: 30000 } };
      const result = applyEnvOverrides(config);
      expect(result.queue.timeout).toBe(60000);
    });

    it('should handle multiple env vars', () => {
      process.env.ORCHESTRATOR_PORT = '5000';
      process.env.ORCHESTRATOR_ENABLE_QUEUE = 'false';
      const config = { port: 3000, enableQueue: true };
      const result = applyEnvOverrides(config);
      expect(result.port).toBe(5000);
      expect(result.enableQueue).toBe(false);
    });
  });

  describe('getConfigurableEnvVars', () => {
    it('should return array of configurable env vars', () => {
      const result = getConfigurableEnvVars();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return env var with config path and description', () => {
      const result = getConfigurableEnvVars();
      const port = result.find(r => r.envVar === 'ORCHESTRATOR_PORT');
      expect(port).toBeDefined();
      expect(port?.configPath).toBe('port');
      expect(port?.description).toBeDefined();
    });
  });
});
