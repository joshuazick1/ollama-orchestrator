import { describe, it, expect, beforeEach, vi } from 'vitest';

import { EndpointRegistry } from '../../../src/probe/endpoint-registry.js';

describe('EndpointRegistry v1 endpoint capabilities', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const advanceTime = (ms: number) => {
    vi.advanceTimersByTime(ms);
  };

  describe('v1 endpoint registration', () => {
    it('should register openai_chat endpoint', () => {
      const registry = new EndpointRegistry();
      registry.declare('srv1', 'openai_chat');
      const caps = registry.getCapabilities('srv1');
      expect(caps.size).toBe(1);
      expect(caps.get('openai_chat')?.declared).toBe(true);
    });

    it('should register openai_completions endpoint', () => {
      const registry = new EndpointRegistry();
      registry.declare('srv1', 'openai_completions');
      const caps = registry.getCapabilities('srv1');
      expect(caps.get('openai_completions')?.declared).toBe(true);
    });

    it('should register openai_embeddings endpoint', () => {
      const registry = new EndpointRegistry();
      registry.declare('srv1', 'openai_embeddings');
      const caps = registry.getCapabilities('srv1');
      expect(caps.get('openai_embeddings')?.declared).toBe(true);
    });

    it('should register anthropic_messages endpoint', () => {
      const registry = new EndpointRegistry();
      registry.declare('srv1', 'anthropic_messages');
      const caps = registry.getCapabilities('srv1');
      expect(caps.get('anthropic_messages')?.declared).toBe(true);
    });
  });

  describe('v1 endpoint confirmation', () => {
    it('should confirm v1 endpoint and set lastSeen', () => {
      const registry = new EndpointRegistry();
      advanceTime(1000);
      registry.confirm('srv1', 'openai_chat');
      const cap = registry.getCapabilities('srv1').get('openai_chat');
      expect(cap?.confirmed).toBe(true);
      expect(cap?.lastSeen).toBeGreaterThan(0);
    });

    it('confirmed v1 endpoint appears in getActiveEndpoints for generation model', () => {
      const registry = new EndpointRegistry();
      advanceTime(1000);
      registry.confirm('srv1', 'openai_chat');
      registry.confirm('srv1', 'openai_completions');
      registry.confirm('srv1', 'openai_embeddings');
      const active = registry.getActiveEndpoints('srv1', 'gpt-4');
      expect(active).toContain('openai_chat');
      expect(active).toContain('openai_completions');
    });

    it('openai_embeddings appears in getActiveEndpoints for embedding model', () => {
      const registry = new EndpointRegistry();
      advanceTime(1000);
      registry.confirm('srv1', 'openai_embeddings');
      const active = registry.getActiveEndpoints('srv1', 'nomic-embed-text-v1.5');
      expect(active).toContain('openai_embeddings');
    });

    it('anthropic_messages appears for generation model', () => {
      const registry = new EndpointRegistry();
      advanceTime(1000);
      registry.confirm('srv1', 'anthropic_messages');
      const active = registry.getActiveEndpoints('srv1', 'claude-3-opus');
      expect(active).toContain('anthropic_messages');
    });
  });

  describe('v1 endpoint revocation', () => {
    it('should revoke specific v1 endpoint', () => {
      const registry = new EndpointRegistry();
      registry.declare('srv1', 'openai_chat');
      registry.revoke('srv1', 'openai_chat');
      expect(registry.getCapabilities('srv1').has('openai_chat')).toBe(false);
    });

    it('should revoke all endpoints for server', () => {
      const registry = new EndpointRegistry();
      registry.declare('srv1', 'openai_chat');
      registry.declare('srv1', 'openai_completions');
      registry.declare('srv1', 'ollama_chat');
      registry.revokeAll('srv1');
      expect(registry.getCapabilities('srv1').size).toBe(0);
    });
  });

  describe('v1 endpoint failure tracking', () => {
    it('should record failure for v1 endpoint', () => {
      const registry = new EndpointRegistry();
      registry.declare('srv1', 'openai_chat');
      registry.recordFailure('srv1', 'openai_chat');
      registry.recordFailure('srv1', 'openai_chat');
      const cap = registry.getCapabilities('srv1').get('openai_chat');
      expect(cap?.failureCount).toBe(2);
    });

    it('confirm resets failureCount for v1 endpoint', () => {
      const registry = new EndpointRegistry();
      registry.confirm('srv1', 'openai_chat');
      registry.recordFailure('srv1', 'openai_chat');
      registry.recordFailure('srv1', 'openai_chat');
      registry.confirm('srv1', 'openai_chat');
      const cap = registry.getCapabilities('srv1').get('openai_chat');
      expect(cap?.failureCount).toBe(0);
    });
  });

  describe('v1 model type detection', () => {
    it('isEmbeddingModel returns true for embedding model names', () => {
      const registry = new EndpointRegistry();
      expect(registry.isEmbeddingModel('nomic-embed-text-v1.5')).toBe(true);
      expect(registry.isEmbeddingModel('all-minilm-l6-v2')).toBe(true);
      expect(registry.isEmbeddingModel('mxbai-embed-large')).toBe(true);
      expect(registry.isEmbeddingModel('some-embed-model')).toBe(true);
    });

    it('isEmbeddingModel returns false for v1 chat model names', () => {
      const registry = new EndpointRegistry();
      expect(registry.isEmbeddingModel('gpt-4')).toBe(false);
      expect(registry.isEmbeddingModel('gpt-3.5-turbo')).toBe(false);
      expect(registry.isEmbeddingModel('claude-3-opus')).toBe(false);
    });

    it('isGenerationModel returns true for chat model names', () => {
      const registry = new EndpointRegistry();
      expect(registry.isGenerationModel('gpt-4')).toBe(true);
      expect(registry.isGenerationModel('claude-3-opus')).toBe(true);
      expect(registry.isGenerationModel('llama3')).toBe(true);
    });

    it('isGenerationModel returns false for embedding models', () => {
      const registry = new EndpointRegistry();
      expect(registry.isGenerationModel('nomic-embed-text-v1.5')).toBe(false);
    });
  });

  describe('v1 endpoint eviction', () => {
    it('should evict stale v1 endpoints', () => {
      const registry = new EndpointRegistry();
      advanceTime(1000);
      registry.confirm('srv1', 'openai_chat');
      advanceTime(400_000);
      registry.evictCold(300_000);
      const cap = registry.getCapabilities('srv1').get('openai_chat');
      expect(cap?.confirmed).toBe(false);
    });

    it('should not evict recent v1 endpoints', () => {
      const registry = new EndpointRegistry();
      registry.confirm('srv1', 'openai_chat');
      advanceTime(60_000);
      registry.evictCold(300_000);
      const cap = registry.getCapabilities('srv1').get('openai_chat');
      expect(cap?.confirmed).toBe(true);
    });
  });

  describe('mixed v1 and ollama endpoints', () => {
    it('server can have both ollama and v1 endpoints', () => {
      const registry = new EndpointRegistry();
      advanceTime(1000);
      registry.confirm('srv1', 'ollama_chat');
      registry.confirm('srv1', 'openai_chat');
      registry.confirm('srv1', 'anthropic_messages');
      const caps = registry.getCapabilities('srv1');
      expect(caps.size).toBe(3);
    });

    it('getActiveEndpoints returns correct endpoints for generation model', () => {
      const registry = new EndpointRegistry();
      advanceTime(1000);
      registry.confirm('srv1', 'ollama_chat');
      registry.confirm('srv1', 'openai_chat');
      registry.confirm('srv1', 'openai_embeddings');
      const active = registry.getActiveEndpoints('srv1', 'gpt-4');
      expect(active).toContain('ollama_chat');
      expect(active).toContain('openai_chat');
      expect(active).not.toContain('openai_embeddings');
    });

    it('getActiveEndpoints returns only embedding endpoints for embedding model', () => {
      const registry = new EndpointRegistry();
      advanceTime(1000);
      registry.confirm('srv1', 'ollama_embeddings');
      registry.confirm('srv1', 'openai_embeddings');
      registry.confirm('srv1', 'openai_chat');
      const active = registry.getActiveEndpoints('srv1', 'nomic-embed-text-v1.5');
      expect(active).toContain('ollama_embeddings');
      expect(active).toContain('openai_embeddings');
      expect(active).not.toContain('openai_chat');
    });
  });
});
