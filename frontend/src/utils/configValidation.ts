import { z } from 'zod';

export interface ValidationResult {
  success: boolean;
  errors: Record<string, string>;
  warnings: Record<string, string>;
}

const baseConfigSchema = z.object({
  port: z.number().min(1).max(65535).optional(),
  host: z.string().optional(),
  loadBalancer: z
    .object({
      strategy: z
        .enum(['round-robin', 'least-connections', 'weighted', 'latency', 'random'])
        .optional(),
      weights: z.record(z.string(), z.number()).optional(),
      thresholds: z
        .object({
          maxP95Latency: z.number().min(0).optional(),
          minSuccessRate: z.number().min(0).max(1).optional(),
        })
        .optional(),
    })
    .optional(),
  circuitBreaker: z
    .object({
      enabled: z.boolean().optional(),
      baseFailureThreshold: z.number().min(1).max(50).optional(),
      maxFailureThreshold: z.number().min(1).max(100).optional(),
      minFailureThreshold: z.number().min(1).max(20).optional(),
      openTimeout: z.number().min(1000).optional(),
      halfOpenTimeout: z.number().min(1000).optional(),
      recoverySuccessThreshold: z.number().min(1).max(20).optional(),
    })
    .optional(),
  security: z
    .object({
      rateLimitMax: z.number().min(1).optional(),
      corsOrigins: z.array(z.string()).optional(),
    })
    .optional(),
  streaming: z
    .object({
      enabled: z.boolean().optional(),
      maxConcurrentStreams: z.number().min(1).max(10000).optional(),
      stallThresholdMs: z.number().min(1000).optional(),
      stallCheckIntervalMs: z.number().min(100).optional(),
      maxHandoffAttempts: z.number().min(0).max(10).optional(),
    })
    .optional(),
});

function parseErrors(result: z.ZodSafeParseResult<unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!result.success) {
    result.error.issues.forEach((issue: z.ZodIssue) => {
      const path = issue.path.join('.');
      errors[path] = issue.message;
    });
  }
  return errors;
}

export const validateConfig = (config: unknown): ValidationResult => {
  const result = baseConfigSchema.safeParse(config);

  const errors: Record<string, string> = parseErrors(result);
  const warnings: Record<string, string> = {};

  if (result.success && result.data) {
    const data = result.data;

    if (data.loadBalancer?.weights) {
      const weights = data.loadBalancer.weights;
      const totalWeight = Object.values(weights).reduce((sum, w) => sum + (w || 0), 0);
      if (Math.abs(totalWeight - 1) > 0.01 && totalWeight > 0) {
        warnings['loadBalancer.weights'] =
          `Weights should sum to 1 (currently ${totalWeight.toFixed(2)})`;
      }
    }

    if (data.circuitBreaker?.baseFailureThreshold && data.circuitBreaker?.maxFailureThreshold) {
      if (data.circuitBreaker.baseFailureThreshold > data.circuitBreaker.maxFailureThreshold) {
        errors['circuitBreaker.baseFailureThreshold'] =
          'Base threshold cannot exceed max threshold';
      }
    }

    if (data.circuitBreaker?.baseFailureThreshold && data.circuitBreaker?.minFailureThreshold) {
      if (data.circuitBreaker.baseFailureThreshold < data.circuitBreaker.minFailureThreshold) {
        errors['circuitBreaker.baseFailureThreshold'] =
          'Base threshold cannot be less than min threshold';
      }
    }

    if (data.security?.corsOrigins?.includes('*')) {
      warnings['security.corsOrigins'] = 'Consider restricting CORS origins for better security';
    }
  }

  return {
    success: Object.keys(errors).length === 0,
    errors,
    warnings,
  };
};

export const validateLoadBalancerConfig = (
  config: unknown
): { success: boolean; errors: Record<string, string>; warnings: Record<string, string> } => {
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
    const errors = parseErrors(result);
    return { success: false, errors, warnings: {} };
  }

  if (result.data?.weights) {
    const weights = result.data.weights;
    const total =
      (weights.latency || 0) +
      (weights.successRate || 0) +
      (weights.load || 0) +
      (weights.capacity || 0);
    if (Math.abs(total - 1) > 0.01 && total > 0) {
      return {
        success: false,
        errors: {},
        warnings: { weights: `Total weight should be 1, currently ${total.toFixed(2)}` },
      };
    }
  }

  return { success: true, errors: {}, warnings: {} };
};

export const validateCircuitBreakerConfig = (
  config: unknown
): { success: boolean; errors: Record<string, string>; warnings: Record<string, string> } => {
  const schema = z.object({
    baseFailureThreshold: z.number().min(1).max(50).optional(),
    maxFailureThreshold: z.number().min(1).max(100).optional(),
    minFailureThreshold: z.number().min(1).max(20).optional(),
    openTimeout: z.number().min(1000).optional(),
    halfOpenTimeout: z.number().min(1000).optional(),
    recoverySuccessThreshold: z.number().min(1).max(20).optional(),
  });

  const result = schema.safeParse(config);

  if (!result.success) {
    const errors = parseErrors(result);
    return { success: false, errors, warnings: {} };
  }

  const data = result.data;
  const errors: Record<string, string> = {};
  const warnings: Record<string, string> = {};

  if (data.baseFailureThreshold && data.maxFailureThreshold) {
    if (data.baseFailureThreshold > data.maxFailureThreshold) {
      errors.baseFailureThreshold = 'Base threshold cannot exceed max threshold';
    }
  }

  if (data.baseFailureThreshold && data.minFailureThreshold) {
    if (data.baseFailureThreshold < data.minFailureThreshold) {
      errors.baseFailureThreshold = 'Base threshold cannot be less than min threshold';
    }
  }

  return { success: Object.keys(errors).length === 0, errors, warnings };
};

export const suggestConfigImprovements = (config: unknown): string[] => {
  const suggestions: string[] = [];

  const result = baseConfigSchema.safeParse(config);
  if (!result.success || !result.data) {
    return suggestions;
  }

  const data = result.data;

  if (data.circuitBreaker?.enabled === false) {
    suggestions.push('Enable circuit breaker for better error handling');
  }

  if (data.security?.corsOrigins?.includes('*')) {
    suggestions.push('Consider restricting CORS origins for better security');
  }

  if (data.loadBalancer?.strategy === 'round-robin') {
    suggestions.push('Consider using latency-based routing for better performance');
  }

  return suggestions;
};
