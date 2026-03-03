import { describe, it, expect } from 'vitest';
import {
  validateConfig,
  validateLoadBalancerConfig,
  validateCircuitBreakerConfig,
  suggestConfigImprovements,
} from '../configValidation';

describe('configValidation utils', () => {
  describe('validateConfig', () => {
    it('should validate a correct full config', () => {
      const config = {
        port: 8080,
        loadBalancer: {
          strategy: 'latency',
          weights: { latency: 1 },
        },
        circuitBreaker: {
          enabled: true,
          baseFailureThreshold: 5,
          maxFailureThreshold: 10,
          minFailureThreshold: 2,
        },
      };

      const result = validateConfig(config);
      expect(result.success).toBe(true);
      expect(Object.keys(result.errors).length).toBe(0);
    });

    it('should fail validation for invalid base values', () => {
      const config = { port: -1 };
      const result = validateConfig(config);
      expect(result.success).toBe(false);
      expect(result.errors.port).toBeDefined();
    });

    it('should validate threshold dependencies', () => {
      const config = {
        circuitBreaker: {
          baseFailureThreshold: 15,
          maxFailureThreshold: 10, // base > max is invalid
        },
      };
      const result = validateConfig(config);
      expect(result.success).toBe(false);
      expect(result.errors['circuitBreaker.baseFailureThreshold']).toBeDefined();
    });

    it('should provide warnings for invalid weights sum', () => {
      const config = {
        loadBalancer: {
          weights: { a: 0.5, b: 0.6 }, // sum = 1.1
        },
      };
      const result = validateConfig(config);
      expect(result.success).toBe(true);
      expect(result.warnings['loadBalancer.weights']).toBeDefined();
    });
  });

  describe('validateLoadBalancerConfig', () => {
    it('should validate correct load balancer config', () => {
      const config = {
        weights: { latency: 0.5, successRate: 0.5 },
      };
      const result = validateLoadBalancerConfig(config);
      // Note: returns success=false if weights don't sum to 1 in this function due to logic returning {success: false, warnings}
      expect(result.success).toBe(true);
    });

    it('should fail and return warning if weights do not sum to 1', () => {
      const config = {
        weights: { latency: 0.8, successRate: 0.5 }, // sum = 1.3
      };
      const result = validateLoadBalancerConfig(config);
      expect(result.success).toBe(false);
      expect(result.warnings.weights).toBeDefined();
    });
  });

  describe('validateCircuitBreakerConfig', () => {
    it('should validate correct circuit breaker config', () => {
      const config = {
        baseFailureThreshold: 5,
        maxFailureThreshold: 10,
        minFailureThreshold: 2,
      };
      const result = validateCircuitBreakerConfig(config);
      expect(result.success).toBe(true);
    });

    it('should fail if base threshold exceeds max', () => {
      const config = {
        baseFailureThreshold: 15,
        maxFailureThreshold: 10,
      };
      const result = validateCircuitBreakerConfig(config);
      expect(result.success).toBe(false);
      expect(result.errors.baseFailureThreshold).toBeDefined();
    });
  });

  describe('suggestConfigImprovements', () => {
    it('should suggest enabling circuit breaker if disabled', () => {
      const suggestions = suggestConfigImprovements({
        circuitBreaker: { enabled: false },
      });
      expect(suggestions).toContain('Enable circuit breaker for better error handling');
    });

    it('should suggest restricting CORS origins if * is used', () => {
      const suggestions = suggestConfigImprovements({
        security: { corsOrigins: ['*'] },
      });
      expect(suggestions).toContain('Consider restricting CORS origins for better security');
    });

    it('should suggest changing strategy if round-robin is used', () => {
      const suggestions = suggestConfigImprovements({
        loadBalancer: { strategy: 'round-robin' },
      });
      expect(suggestions).toContain('Consider using latency-based routing for better performance');
    });
  });
});
