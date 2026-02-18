import { z } from 'zod';

export interface ValidationResult {
  success: boolean;
  errors: Record<string, string>;
  warnings: Record<string, string>;
}

export const validateConfig = (config: Record<string, unknown>): ValidationResult => {
  const errors: Record<string, string> = {};
  const warnings: Record<string, string> = {};

  if (config.port) {
    const port = Number(config.port);
    if (isNaN(port) || port < 1 || port > 65535) {
      errors.port = 'Port must be between 1 and 65535';
    }
  }

  if (config.host) {
    const host = String(config.host);
    const hostnameRegex =
      /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    if (!hostnameRegex.test(host) && host !== '0.0.0.0' && host !== 'localhost') {
      warnings.host = 'Invalid hostname format';
    }
  }

  const queue = config.queue as Record<string, unknown> | undefined;
  if (queue?.maxSize) {
    const maxSize = Number(queue.maxSize);
    if (maxSize < 1) {
      errors['queue.maxSize'] = 'Queue max size must be at least 1';
    }
    if (maxSize > 10000) {
      warnings['queue.maxSize'] = 'Very large queue size may impact memory';
    }
  }

  if (queue?.timeout) {
    const timeout = Number(queue.timeout);
    if (timeout < 1000) {
      warnings['queue.timeout'] = 'Timeout less than 1 second may cause issues';
    }
    if (timeout > 600000) {
      warnings['queue.timeout'] = 'Very long timeout may cause requests to hang';
    }
  }

  const loadBalancer = config.loadBalancer as Record<string, unknown> | undefined;
  if (loadBalancer?.weights) {
    const weights = loadBalancer.weights as Record<string, number>;
    const totalWeight = Object.values(weights).reduce((sum, w) => sum + (w || 0), 0);
    if (Math.abs(totalWeight - 1) > 0.01) {
      warnings['loadBalancer.weights'] =
        `Weights should sum to 1 (currently ${totalWeight.toFixed(2)})`;
    }
  }

  const circuitBreaker = config.circuitBreaker as Record<string, unknown> | undefined;
  if (circuitBreaker?.baseFailureThreshold) {
    const threshold = Number(circuitBreaker.baseFailureThreshold);
    if (threshold < 1) {
      errors['circuitBreaker.baseFailureThreshold'] = 'Failure threshold must be at least 1';
    }
    if (threshold > 20) {
      warnings['circuitBreaker.baseFailureThreshold'] =
        'Very high threshold may delay circuit breaking';
    }
  }

  if (circuitBreaker?.openTimeout) {
    const timeout = Number(circuitBreaker.openTimeout);
    if (timeout < 5000) {
      warnings['circuitBreaker.openTimeout'] = 'Very short open timeout may cause flapping';
    }
  }

  const security = config.security as Record<string, unknown> | undefined;
  if (security?.rateLimitMax) {
    const rateLimit = Number(security.rateLimitMax);
    if (rateLimit < 1) {
      errors['security.rateLimitMax'] = 'Rate limit must be at least 1';
    }
    if (rateLimit > 10000) {
      warnings['security.rateLimitMax'] = 'Very high rate limit may not provide protection';
    }
  }

  const streaming = config.streaming as Record<string, unknown> | undefined;
  if (streaming?.maxConcurrentStreams) {
    const streams = Number(streaming.maxConcurrentStreams);
    if (streams < 1) {
      errors['streaming.maxConcurrentStreams'] = 'Max concurrent streams must be at least 1';
    }
    if (streams > 1000) {
      warnings['streaming.maxConcurrentStreams'] = 'Very high stream count may impact performance';
    }
  }

  return {
    success: Object.keys(errors).length === 0,
    errors,
    warnings,
  };
};

export const validateQueueConfig = (config: {
  maxSize?: number;
  timeout?: number;
  priorityBoostInterval?: number;
  priorityBoostAmount?: number;
}) => {
  const schema = z.object({
    maxSize: z.number().min(1).max(10000).optional(),
    timeout: z.number().min(1000).max(600000).optional(),
    priorityBoostInterval: z.number().min(1000).optional(),
    priorityBoostAmount: z.number().min(1).max(100).optional(),
  });

  const result = schema.safeParse(config);
  if (!result.success) {
    const errors: Record<string, string> = {};
    result.error.issues.forEach((err: z.ZodIssue) => {
      if (err.path[0]) {
        errors[err.path[0] as string] = err.message;
      }
    });
    return { success: false, errors };
  }
  return { success: true, errors: {} as Record<string, string> };
};

export const validateLoadBalancerConfig = (config: {
  weights?: {
    latency?: number;
    successRate?: number;
    load?: number;
    capacity?: number;
  };
  thresholds?: {
    maxP95Latency?: number;
    minSuccessRate?: number;
  };
}) => {
  const schema = z.object({
    weights: z
      .object({
        latency: z.number().min(0).max(1).optional(),
        successRate: z.number().min(0).max(1).optional(),
        load: z.number().min(0).max(1).optional(),
        capacity: z.number().min(0).max(1).optional(),
      })
      .optional(),
    thresholds: z
      .object({
        maxP95Latency: z.number().min(100).optional(),
        minSuccessRate: z.number().min(0).max(1).optional(),
      })
      .optional(),
  });

  const result = schema.safeParse(config);
  if (!result.success) {
    const errors: Record<string, string> = {};
    result.error.issues.forEach((err: z.ZodIssue) => {
      const path = err.path.join('.');
      errors[path] = err.message;
    });
    return { success: false, errors };
  }

  if (config.weights) {
    const weights = config.weights;
    const total =
      (weights.latency || 0) +
      (weights.successRate || 0) +
      (weights.load || 0) +
      (weights.capacity || 0);
    if (Math.abs(total - 1) > 0.01) {
      return {
        success: false,
        errors: {},
        warnings: { weights: `Total weight should be 1, currently ${total.toFixed(2)}` },
      };
    }
  }

  return { success: true, errors: {} };
};

export const validateCircuitBreakerConfig = (config: {
  baseFailureThreshold?: number;
  maxFailureThreshold?: number;
  minFailureThreshold?: number;
  openTimeout?: number;
  halfOpenTimeout?: number;
  recoverySuccessThreshold?: number;
}) => {
  const schema = z.object({
    baseFailureThreshold: z.number().min(1).max(20).optional(),
    maxFailureThreshold: z.number().min(1).max(50).optional(),
    minFailureThreshold: z.number().min(1).max(10).optional(),
    openTimeout: z.number().min(1000).optional(),
    halfOpenTimeout: z.number().min(1000).optional(),
    recoverySuccessThreshold: z.number().min(1).max(10).optional(),
  });

  const result = schema.safeParse(config);
  if (!result.success) {
    const errors: Record<string, string> = {};
    result.error.issues.forEach((err: z.ZodIssue) => {
      if (err.path[0]) {
        errors[err.path[0] as string] = err.message;
      }
    });
    return { success: false, errors };
  }

  if (
    config.baseFailureThreshold &&
    config.maxFailureThreshold &&
    config.baseFailureThreshold > config.maxFailureThreshold
  ) {
    return {
      success: false,
      errors: { baseFailureThreshold: 'Base threshold cannot exceed max threshold' },
    };
  }

  if (
    config.baseFailureThreshold &&
    config.minFailureThreshold &&
    config.baseFailureThreshold < config.minFailureThreshold
  ) {
    return {
      success: false,
      errors: { baseFailureThreshold: 'Base threshold cannot be less than min threshold' },
    };
  }

  return { success: true, errors: {} as Record<string, string> };
};

export const suggestConfigImprovements = (config: Record<string, unknown>): string[] => {
  const suggestions: string[] = [];

  const queue = config.queue as { maxSize?: number } | undefined;
  if (queue?.maxSize && Number(queue.maxSize) < 100) {
    suggestions.push('Consider increasing queue maxSize for better handling of traffic spikes');
  }

  const circuitBreaker = config.circuitBreaker as { adaptiveThresholds?: boolean } | undefined;
  if (circuitBreaker?.adaptiveThresholds === false) {
    suggestions.push('Enable adaptive thresholds for better handling of varying traffic patterns');
  }

  const healthCheck = config.healthCheck as { enabled?: boolean } | undefined;
  if (healthCheck?.enabled === false) {
    suggestions.push('Enable health checks to automatically detect and remove unhealthy servers');
  }

  const metrics = config.metrics as { enabled?: boolean } | undefined;
  if (metrics?.enabled === false) {
    suggestions.push('Enable metrics to monitor system performance and identify issues');
  }

  const streaming = config.streaming as { enabled?: boolean } | undefined;
  if (!streaming?.enabled) {
    suggestions.push('Enable streaming for better user experience with long-form responses');
  }

  const security = config.security as { corsOrigins?: string[] } | undefined;
  if (security?.corsOrigins?.includes('*')) {
    suggestions.push('Consider restricting CORS origins for better security');
  }

  return suggestions;
};
