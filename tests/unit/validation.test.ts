/**
 * validation.test.ts
 * Tests for validation middleware
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  validateRequest,
  ValidationError,
  serverIdSchema,
  addServerSchema,
  updateServerSchema,
  modelNameSchema,
  generateRequestSchema,
  chatRequestSchema,
  embeddingsRequestSchema,
  configUpdateSchema,
  configPathSchema,
  queueActionSchema,
  logsQuerySchema,
  analyticsQuerySchema,
  pullModelSchema,
  warmupModelSchema,
  unloadModelSchema,
  metricsQuerySchema,
} from '../../src/middleware/validation.js';

describe('validation middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: Mock;

  beforeEach(() => {
    mockReq = {
      body: {},
      query: {},
      params: {},
    };
    mockRes = {
      status: vi.fn().mockReturnThis() as unknown as Response['status'],
      json: vi.fn().mockReturnThis() as unknown as Response['json'],
    };
    mockNext = vi.fn();
  });

  describe('validateRequest', () => {
    it('should call next() for valid body data', () => {
      const schema = z.object({ name: z.string() });
      const middleware = validateRequest(schema, 'body');

      mockReq.body = { name: 'test' };

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.body).toEqual({ name: 'test' });
    });

    it('should return 400 for invalid body data', () => {
      const schema = z.object({ name: z.string() });
      const middleware = validateRequest(schema, 'body');

      mockReq.body = { name: 123 };

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Validation failed',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should validate query parameters', () => {
      const schema = z.object({ limit: z.string() });
      const middleware = validateRequest(schema, 'query');

      mockReq.query = { limit: '10' };

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should validate route params', () => {
      const schema = z.object({ id: z.string() });
      const middleware = validateRequest(schema, 'params');

      mockReq.params = { id: 'abc' };

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('ValidationError', () => {
    it('should create ValidationError with correct properties', () => {
      const error = new ValidationError('Test failed', [{ field: 'name', message: 'Required' }]);

      expect(error.name).toBe('ValidationError');
      expect(error.message).toBe('Test failed');
      expect(error.errors).toHaveLength(1);
    });
  });

  describe('serverIdSchema', () => {
    it('should validate valid server IDs', () => {
      const result = serverIdSchema.safeParse('server-1');
      expect(result.success).toBe(true);
    });

    it('should reject server IDs with special characters', () => {
      const result = serverIdSchema.safeParse('server@1');
      expect(result.success).toBe(false);
    });

    it('should reject empty server IDs', () => {
      const result = serverIdSchema.safeParse('');
      expect(result.success).toBe(false);
    });
  });

  describe('addServerSchema', () => {
    it('should validate valid server config', () => {
      const result = addServerSchema.safeParse({
        url: 'http://localhost:11434',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid URL', () => {
      const result = addServerSchema.safeParse({
        url: 'not-a-url',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('modelNameSchema', () => {
    it('should validate valid model names', () => {
      const result = modelNameSchema.safeParse('llama2');
      expect(result.success).toBe(true);
    });

    it('should validate model names with special chars', () => {
      const result = modelNameSchema.safeParse('llama2:7b');
      expect(result.success).toBe(true);
    });
  });

  describe('generateRequestSchema', () => {
    it('should validate valid generate request', () => {
      const result = generateRequestSchema.safeParse({
        model: 'llama2',
        prompt: 'Hello',
      });
      expect(result.success).toBe(true);
    });

    it('should reject request without prompt', () => {
      const result = generateRequestSchema.safeParse({
        model: 'llama2',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('chatRequestSchema', () => {
    it('should validate valid chat request', () => {
      const result = chatRequestSchema.safeParse({
        model: 'llama2',
        messages: [{ role: 'user', content: 'Hello' }],
      });
      expect(result.success).toBe(true);
    });

    it('should reject request without messages', () => {
      const result = chatRequestSchema.safeParse({
        model: 'llama2',
        messages: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('embeddingsRequestSchema', () => {
    it('should validate valid embeddings request', () => {
      const result = embeddingsRequestSchema.safeParse({
        model: 'llama2',
        prompt: 'Hello world',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('configUpdateSchema', () => {
    it('should validate valid config update', () => {
      const result = configUpdateSchema.safeParse({
        queue: { maxSize: 1000 },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('queueActionSchema', () => {
    it('should validate valid queue action', () => {
      const result = queueActionSchema.safeParse({
        timeout: '30000',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('logsQuerySchema', () => {
    it('should validate valid logs query', () => {
      const result = logsQuerySchema.safeParse({
        limit: '100',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('analyticsQuerySchema', () => {
    it('should validate valid analytics query', () => {
      const result = analyticsQuerySchema.safeParse({
        timeRange: '1h',
        limit: '10',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('pullModelSchema', () => {
    it('should validate valid pull model request', () => {
      const result = pullModelSchema.safeParse({
        model: 'llama2',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('warmupModelSchema', () => {
    it('should validate valid warmup request', () => {
      const result = warmupModelSchema.safeParse({
        priority: 'high',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('unloadModelSchema', () => {
    it('should validate valid unload request', () => {
      const result = unloadModelSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('metricsQuerySchema', () => {
    it('should validate valid metrics query', () => {
      const result = metricsQuerySchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });
});
