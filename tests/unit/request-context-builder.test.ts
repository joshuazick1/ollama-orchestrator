/**
 * request-context-builder.test.ts
 * Tests for RequestContextBuilder utility
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContextBuilder } from '../../src/utils/request-context-builder.js';

describe('RequestContextBuilder', () => {
  describe('create', () => {
    it('should create a new builder', () => {
      const builder = RequestContextBuilder.create('server-1', 'llama3:latest');
      expect(builder).toBeDefined();
    });
  });

  describe('withEndpoint', () => {
    it('should set the endpoint', () => {
      const builder = RequestContextBuilder.create('server-1', 'llama3:latest');
      const withEndpoint = builder.withEndpoint('generate');
      expect(withEndpoint).toBeDefined();
    });
  });

  describe('withStreaming', () => {
    it('should set streaming flag', () => {
      const builder = RequestContextBuilder.create('server-1', 'llama3:latest');
      const withStreaming = builder.withStreaming(true);
      expect(withStreaming).toBeDefined();
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
  });
});
