/**
 * validation.ts
 * Input validation middleware using Zod
 */

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

// Custom error for validation failures
export class ValidationError extends Error {
  constructor(
    message: string,
    public errors: Array<{ field: string; message: string }>
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Middleware factory that validates request body against a Zod schema
 */
export function validateRequest<T extends z.ZodTypeAny>(
  schema: T,
  source: 'body' | 'query' | 'params' = 'body'
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const data: unknown =
        source === 'body' ? req.body : source === 'query' ? req.query : req.params;
      const result = schema.safeParse(data);

      if (!result.success) {
        const errors = result.error.issues.map((err: z.ZodIssue) => ({
          field: err.path.join('.'),
          message: err.message,
        }));

        res.status(400).json({
          error: 'Validation failed',
          details: errors,
        });
        return;
      }

      // Replace the original data with validated/parsed data
      if (source === 'body') {
        req.body = result.data;
      } else if (source === 'query') {
        req.query = result.data as Record<string, string | string[]>;
      } else {
        req.params = result.data as Record<string, string>;
      }

      next();
    } catch (error) {
      res.status(500).json({
        error: 'Validation error',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };
}

// Server validation schemas
export const serverIdSchema = z
  .string()
  .min(1, 'Server ID is required')
  .max(100, 'Server ID too long')
  .regex(/^[a-zA-Z0-9-_]+$/, 'Server ID must be alphanumeric with dashes/underscores');

export const addServerSchema = z.object({
  id: serverIdSchema.optional(),
  url: z.string().url('Invalid URL format'),
  maxConcurrency: z.number().int().min(1).max(1000).optional().default(4),
  type: z.enum(['ollama']).optional().default('ollama'),
  apiKey: z.string().optional(),
});

export const updateServerSchema = z.object({
  maxConcurrency: z.number().int().min(1).max(1000).optional(),
});

// Model validation schemas
export const modelNameSchema = z
  .string()
  .min(1, 'Model name is required')
  .max(200, 'Model name too long')
  .regex(/^[a-zA-Z0-9-_:./]+$/, 'Invalid characters in model name');

export const generateRequestSchema = z.object({
  model: modelNameSchema,
  prompt: z.string().min(1, 'Prompt is required').max(100000, 'Prompt too long'),
  stream: z.boolean().optional().default(false),
  context: z.array(z.number()).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});

export const chatRequestSchema = z.object({
  model: modelNameSchema,
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().min(1, 'Message content is required'),
      })
    )
    .min(1, 'At least one message is required'),
  stream: z.boolean().optional().default(false),
  options: z.record(z.string(), z.unknown()).optional(),
});

export const embeddingsRequestSchema = z.object({
  model: modelNameSchema,
  prompt: z.string().min(1, 'Prompt is required').max(100000, 'Prompt too long'),
});

// Config validation schemas
export const configUpdateSchema = z.object({
  queue: z
    .object({
      maxSize: z.number().int().min(1).max(10000).optional(),
      timeout: z.number().int().min(1000).optional(),
      priorityBoostInterval: z.number().int().min(1000).optional(),
      priorityBoostAmount: z.number().int().min(1).optional(),
    })
    .optional(),
  loadBalancer: z
    .object({
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
          maxP95Latency: z.number().int().min(100).optional(),
          minSuccessRate: z.number().min(0).max(1).optional(),
        })
        .optional(),
    })
    .optional(),
  circuitBreaker: z
    .object({
      baseFailureThreshold: z.number().int().min(1).optional(),
      openTimeout: z.number().int().min(1000).optional(),
      halfOpenTimeout: z.number().int().min(1000).optional(),
    })
    .optional(),
});

export const configPathSchema = z.object({
  configPath: z
    .string()
    .min(1, 'Config path is required')
    .regex(/\.json$/, 'Config path must end with .json'),
});

// Queue management schemas
export const queueActionSchema = z.object({
  timeout: z.string().regex(/^\d+$/, 'Timeout must be a number').optional(),
});

// Log query schemas
export const logsQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/, 'Limit must be a number').optional().default('100'),
  since: z.string().datetime().optional(),
});

// Analytics query schemas
export const analyticsQuerySchema = z.object({
  timeRange: z.enum(['1m', '5m', '15m', '1h', '6h', '24h']).optional().default('1h'),
  limit: z.string().regex(/^\d+$/, 'Limit must be a number').optional().default('10'),
});

// Model management schemas
export const pullModelSchema = z.object({
  model: modelNameSchema,
});

export const warmupModelSchema = z.object({
  serverId: serverIdSchema.optional(),
  priority: z.enum(['low', 'normal', 'high']).optional().default('normal'),
});

export const unloadModelSchema = z.object({
  serverId: serverIdSchema.optional(),
});

// Metrics query schemas
export const metricsQuerySchema = z.object({
  serverId: serverIdSchema.optional(),
  model: modelNameSchema.optional(),
});
