import { describe, it, expect, beforeEach, vi } from 'vitest';

import { EndpointRegistry } from '../../../src/probe/endpoint-registry.js';
import type { ProbeEndpoint } from '../../../src/probe/types.js';

const ENDPOINTS: ProbeEndpoint[] = [
  'ollama_chat',
  'ollama_generate',
  'ollama_embeddings',
  'openai_chat',
  'openai_completions',
  'openai_embeddings',
  'anthropic_messages',
];

describe('EndpointRegistry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  describe('declare', () => {
    it('should register a new endpoint capability', () => {
      const registry = new EndpointRegistry();
      registry.declare('srv1', 'ollama_chat');
      const caps = registry.getCapabilities('srv1');
      expect(caps.size).toBe(1);
      expect(caps.get('ollama_chat')?.declared).toBe(true);
      expect(caps.get('ollama_chat')?.confirmed).toBe(false);
    });

    it('should preserve confirmed state when re-declaring', () => {
      const registry = new EndpointRegistry();
      registry.declare('srv1', 'ollama_chat');
      registry.confirm('srv1', 'ollama_chat');
      registry.declare('srv1', 'ollama_chat');
      const cap = registry.getCapabilities('srv1').get('ollama_chat');
      expect(cap?.declared).toBe(true);
      expect(cap?.confirmed).toBe(true);
    });
  });

  describe('confirm', () => {
    it('should confirm an undeclared endpoint (auto-declare)', () => {
      const registry = new EndpointRegistry();
      registry.confirm('srv1', 'ollama_chat');
      const cap = registry.getCapabilities('srv1').get('ollama_chat');
      expect(cap?.declared).toBe(true);
      expect(cap?.confirmed).toBe(true);
    });

    it('should set lastSeen to current time', () => {
      const registry = new EndpointRegistry();
      const now = Date.now();
      registry.confirm('srv1', 'ollama_chat');
      const cap = registry.getCapabilities('srv1').get('ollama_chat');
      expect(cap?.lastSeen).toBe(now);
    });

    it('should reset failureCount on confirm', () => {
      const registry = new EndpointRegistry();
      registry.confirm('srv1', 'ollama_chat');
      registry.recordFailure('srv1', 'ollama_chat');
      registry.recordFailure('srv1', 'ollama_chat');
      registry.confirm('srv1', 'ollama_chat');
      const cap = registry.getCapabilities('srv1').get('ollama_chat');
      expect(cap?.failureCount).toBe(0);
    });
  });

  describe('revoke', () => {
    it('should remove a specific endpoint', () => {
      const registry = new EndpointRegistry();
      registry.declare('srv1', 'ollama_chat');
      registry.revoke('srv1', 'ollama_chat');
      expect(registry.getCapabilities('srv1').has('ollama_chat')).toBe(false);
    });
  });

  describe('revokeAll', () => {
    it('should remove all endpoints for a server', () => {
      const registry = new EndpointRegistry();
      registry.declare('srv1', 'ollama_chat');
      registry.declare('srv1', 'ollama_generate');
      registry.declare('srv2', 'ollama_chat');
      registry.revokeAll('srv1');
      expect(registry.getCapabilities('srv1').size).toBe(0);
      expect(registry.getCapabilities('srv2').size).toBe(1);
    });
  });

  describe('recordFailure', () => {
    it('should increment failureCount', () => {
      const registry = new EndpointRegistry();
      registry.declare('srv1', 'ollama_chat');
      registry.recordFailure('srv1', 'ollama_chat');
      registry.recordFailure('srv1', 'ollama_chat');
      const cap = registry.getCapabilities('srv1').get('ollama_chat');
      expect(cap?.failureCount).toBe(2);
    });
  });

  describe('getActiveEndpoints', () => {
    it('should return generation endpoints for a generation model', () => {
      const registry = new EndpointRegistry();
      registry.confirm('srv1', 'ollama_chat');
      registry.confirm('srv1', 'ollama_generate');
      registry.confirm('srv1', 'ollama_embeddings');
      const active = registry.getActiveEndpoints('srv1', 'llama3');
      expect(active).toContain('ollama_chat');
      expect(active).toContain('ollama_generate');
      expect(active).not.toContain('ollama_embeddings');
    });

    it('should return embedding endpoints only for an embedding model', () => {
      const registry = new EndpointRegistry();
      registry.confirm('srv1', 'ollama_chat');
      registry.confirm('srv1', 'ollama_embeddings');
      registry.confirm('srv1', 'openai_embeddings');
      const active = registry.getActiveEndpoints('srv1', 'nomic-embed-text-v1.5');
      expect(active).not.toContain('ollama_chat');
      expect(active).toContain('ollama_embeddings');
      expect(active).toContain('openai_embeddings');
    });

    it('should not return unconfirmed endpoints', () => {
      const registry = new EndpointRegistry();
      registry.declare('srv1', 'ollama_chat');
      const active = registry.getCapabilities('srv1');
      expect(active.get('ollama_chat')?.confirmed).toBe(false);
    });

    it('should return empty array for unknown server', () => {
      const registry = new EndpointRegistry();
      const active = registry.getActiveEndpoints('unknown-srv', 'llama3');
      expect(active).toEqual([]);
    });
  });

  describe('evictCold', () => {
    it('should mark stale endpoints as unconfirmed', () => {
      const registry = new EndpointRegistry();
      registry.confirm('srv1', 'ollama_chat');
      vi.advanceTimersByTime(60_000);
      registry.evictCold(30_000);
      const cap = registry.getCapabilities('srv1').get('ollama_chat');
      expect(cap?.confirmed).toBe(false);
    });

    it('should not affect recent endpoints', () => {
      const registry = new EndpointRegistry();
      registry.confirm('srv1', 'ollama_chat');
      vi.advanceTimersByTime(10_000);
      registry.evictCold(30_000);
      const cap = registry.getCapabilities('srv1').get('ollama_chat');
      expect(cap?.confirmed).toBe(true);
    });
  });

  describe('isEmbeddingModel', () => {
    it('should return true for nomic-embed', () => {
      const registry = new EndpointRegistry();
      expect(registry.isEmbeddingModel('nomic-embed-text-v1.5')).toBe(true);
    });

    it('should return true for all-minilm', () => {
      const registry = new EndpointRegistry();
      expect(registry.isEmbeddingModel('all-minilm-l6-v2')).toBe(true);
    });

    it('should return true for mxbai-embed', () => {
      const registry = new EndpointRegistry();
      expect(registry.isEmbeddingModel('mxbai-embed-large')).toBe(true);
    });

    it('should return true for names containing embed', () => {
      const registry = new EndpointRegistry();
      expect(registry.isEmbeddingModel('some-embed-model')).toBe(true);
    });

    it('should return false for generation models', () => {
      const registry = new EndpointRegistry();
      expect(registry.isEmbeddingModel('llama3')).toBe(false);
      expect(registry.isEmbeddingModel('mistral')).toBe(false);
      expect(registry.isEmbeddingModel('codellama')).toBe(false);
    });
  });

  describe('isGenerationModel', () => {
    it('should return true for non-embedding models', () => {
      const registry = new EndpointRegistry();
      expect(registry.isGenerationModel('llama3')).toBe(true);
      expect(registry.isGenerationModel('mistral')).toBe(true);
    });

    it('should return false for embedding models', () => {
      const registry = new EndpointRegistry();
      expect(registry.isGenerationModel('nomic-embed-text-v1.5')).toBe(false);
    });
  });

  describe('getCapabilities', () => {
    it('should return empty Map for unknown server', () => {
      const registry = new EndpointRegistry();
      const caps = registry.getCapabilities('unknown');
      expect(caps.size).toBe(0);
    });

    it('should return all capabilities for a server', () => {
      const registry = new EndpointRegistry();
      registry.declare('srv1', 'ollama_chat');
      registry.declare('srv1', 'ollama_embeddings');
      const caps = registry.getCapabilities('srv1');
      expect(caps.size).toBe(2);
    });
  });
});
