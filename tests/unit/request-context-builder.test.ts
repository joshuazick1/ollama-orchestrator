/**
 * request-context-builder.test.ts
 * Tests for RequestContextBuilder utility
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  RequestContextBuilder,
  createRequestContext,
} from '../../src/utils/request-context-builder.js';

describe('RequestContextBuilder', () => {
  describe('create', () => {
    it('should create a new builder', () => {
      const builder = RequestContextBuilder.create('server-1', 'llama3:latest');
      expect(builder).toBeDefined();
    });

    it('should set serverId and model', () => {
      const context = RequestContextBuilder.create('server-1', 'llama3:latest').build();
      expect(context.serverId).toBe('server-1');
      expect(context.model).toBe('llama3:latest');
    });

    it('should generate unique id for each request', () => {
      const context1 = RequestContextBuilder.create('server-1', 'llama3:latest').build();
      const context2 = RequestContextBuilder.create('server-1', 'llama3:latest').build();
      expect(context1.id).not.toBe(context2.id);
    });

    it('should set success to false by default', () => {
      const context = RequestContextBuilder.create('server-1', 'llama3:latest').build();
      expect(context.success).toBe(false);
    });

    it('should set startTime', () => {
      const context = RequestContextBuilder.create('server-1', 'llama3:latest').build();
      // Timer is enabled by default, so startTime will be 0 (elapsed time from Timer)
      expect(context.startTime).toBeDefined();
    });
  });

  describe('withEndpoint', () => {
    it('should set the endpoint', () => {
      const builder = RequestContextBuilder.create('server-1', 'llama3:latest');
      const withEndpoint = builder.withEndpoint('generate');
      expect(withEndpoint).toBeDefined();
    });

    it('should allow chaining', () => {
      const context = RequestContextBuilder.create('server-1', 'llama3:latest')
        .withEndpoint('generate')
        .withEndpoint('chat')
        .build();
      expect(context.endpoint).toBe('chat');
    });
  });

  describe('withStreaming', () => {
    it('should set streaming flag to true', () => {
      const builder = RequestContextBuilder.create('server-1', 'llama3:latest');
      const withStreaming = builder.withStreaming(true);
      expect(withStreaming).toBeDefined();
    });

    it('should set streaming flag to false', () => {
      const builder = RequestContextBuilder.create('server-1', 'llama3:latest');
      const withStreaming = builder.withStreaming(false);
      expect(withStreaming).toBeDefined();
    });
  });

  describe('withMetadata', () => {
    it('should add metadata to context', () => {
      const context = RequestContextBuilder.create('server-1', 'llama3:latest')
        .withMetadata({ userId: 'user-123', sessionId: 'session-456' })
        .build();
      expect((context as any).metadata).toEqual({ userId: 'user-123', sessionId: 'session-456' });
    });

    it('should allow multiple metadata calls', () => {
      const context = RequestContextBuilder.create('server-1', 'llama3:latest')
        .withMetadata({ key1: 'value1' })
        .withMetadata({ key2: 'value2' })
        .build();
      expect((context as any).metadata).toEqual({ key2: 'value2' });
    });
  });

  describe('build', () => {
    it('should build complete context', () => {
      const context = RequestContextBuilder.create('server-1', 'llama3:latest')
        .withEndpoint('generate')
        .withStreaming(false)
        .build();

      expect(context.serverId).toBe('server-1');
      expect(context.model).toBe('llama3:latest');
      expect(context.endpoint).toBe('generate');
      expect(context.streaming).toBe(false);
    });

    it('should throw if serverId is missing', () => {
      const builder = new RequestContextBuilder();
      (builder as any).context = { model: 'llama3:latest' };
      expect(() => builder.build()).toThrow('RequestContext must have serverId and model');
    });

    it('should throw if model is missing', () => {
      const builder = new RequestContextBuilder();
      (builder as any).context = { serverId: 'server-1' };
      expect(() => builder.build()).toThrow('RequestContext must have serverId and model');
    });
  });

  describe('complete', () => {
    it('should mark request as successful', () => {
      const context = RequestContextBuilder.create('server-1', 'llama3:latest').build();
      const completed = RequestContextBuilder.create('server-1', 'llama3:latest').complete(
        context,
        true
      );
      expect(completed.success).toBe(true);
    });

    it('should mark request as failed', () => {
      const context = RequestContextBuilder.create('server-1', 'llama3:latest').build();
      const completed = RequestContextBuilder.create('server-1', 'llama3:latest').complete(
        context,
        false
      );
      expect(completed.success).toBe(false);
    });

    it('should set endTime and duration', () => {
      const context = RequestContextBuilder.create('server-1', 'llama3:latest').build();
      const completed = RequestContextBuilder.create('server-1', 'llama3:latest').complete(
        context,
        true
      );
      expect(completed.endTime).toBeDefined();
      expect(completed.duration).toBeDefined();
    });
  });

  describe('completeWithError', () => {
    it('should mark request as failed with error', () => {
      const context = RequestContextBuilder.create('server-1', 'llama3:latest').build();
      const error = new Error('Test error');
      const completed = RequestContextBuilder.create('server-1', 'llama3:latest').completeWithError(
        context,
        error
      );
      expect(completed.success).toBe(false);
      expect(completed.error).toBe(error);
    });

    it('should set endTime and duration', () => {
      const context = RequestContextBuilder.create('server-1', 'llama3:latest').build();
      const error = new Error('Test error');
      const completed = RequestContextBuilder.create('server-1', 'llama3:latest').completeWithError(
        context,
        error
      );
      expect(completed.endTime).toBeDefined();
      expect(completed.duration).toBeDefined();
    });
  });

  describe('withStreamingMetrics', () => {
    it('should add ttft to context', () => {
      const context = RequestContextBuilder.create('server-1', 'llama3:latest').build();
      const withMetrics = RequestContextBuilder.create(
        'server-1',
        'llama3:latest'
      ).withStreamingMetrics(context, { ttft: 100 });
      expect(withMetrics.ttft).toBe(100);
    });

    it('should add streamingDuration to context', () => {
      const context = RequestContextBuilder.create('server-1', 'llama3:latest').build();
      const withMetrics = RequestContextBuilder.create(
        'server-1',
        'llama3:latest'
      ).withStreamingMetrics(context, { streamingDuration: 500 });
      expect(withMetrics.streamingDuration).toBe(500);
    });

    it('should add both metrics', () => {
      const context = RequestContextBuilder.create('server-1', 'llama3:latest').build();
      const withMetrics = RequestContextBuilder.create(
        'server-1',
        'llama3:latest'
      ).withStreamingMetrics(context, { ttft: 100, streamingDuration: 500 });
      expect(withMetrics.ttft).toBe(100);
      expect(withMetrics.streamingDuration).toBe(500);
    });
  });

  describe('withTokenMetrics', () => {
    it('should add tokensGenerated to context', () => {
      const context = RequestContextBuilder.create('server-1', 'llama3:latest').build();
      const withMetrics = RequestContextBuilder.create(
        'server-1',
        'llama3:latest'
      ).withTokenMetrics(context, { tokensGenerated: 150 });
      expect(withMetrics.tokensGenerated).toBe(150);
    });

    it('should add tokensPrompt to context', () => {
      const context = RequestContextBuilder.create('server-1', 'llama3:latest').build();
      const withMetrics = RequestContextBuilder.create(
        'server-1',
        'llama3:latest'
      ).withTokenMetrics(context, { tokensPrompt: 50 });
      expect(withMetrics.tokensPrompt).toBe(50);
    });

    it('should add both token metrics', () => {
      const context = RequestContextBuilder.create('server-1', 'llama3:latest').build();
      const withMetrics = RequestContextBuilder.create(
        'server-1',
        'llama3:latest'
      ).withTokenMetrics(context, { tokensGenerated: 150, tokensPrompt: 50 });
      expect(withMetrics.tokensGenerated).toBe(150);
      expect(withMetrics.tokensPrompt).toBe(50);
    });
  });
});

describe('createRequestContext', () => {
  it('should create context with all parameters', () => {
    const context = createRequestContext('server-1', 'llama3:latest', 'generate', false);
    expect(context.serverId).toBe('server-1');
    expect(context.model).toBe('llama3:latest');
    expect(context.endpoint).toBe('generate');
    expect(context.streaming).toBe(false);
  });

  it('should create context for streaming request', () => {
    const context = createRequestContext('server-1', 'llama3:latest', 'chat', true);
    expect(context.streaming).toBe(true);
    expect(context.endpoint).toBe('chat');
  });

  it('should set default values', () => {
    const context = createRequestContext('server-1', 'llama3:latest', 'generate', false);
    expect(context.id).toBeDefined();
    expect(context.startTime).toBeDefined();
    expect(context.success).toBe(false);
  });
});
