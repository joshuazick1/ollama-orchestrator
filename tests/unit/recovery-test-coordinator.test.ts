import { describe, it, expect, beforeEach } from 'vitest';

import { RecoveryTestCoordinator, isEmbeddingModel } from '../../src/recovery-test-coordinator';

describe('RecoveryTestCoordinator', () => {
  let coordinator: RecoveryTestCoordinator;

  beforeEach(() => {
    coordinator = new RecoveryTestCoordinator();
  });

  describe('constructor', () => {
    it('should create coordinator with default config', () => {
      expect(coordinator).toBeDefined();
    });

    it('should accept custom config', () => {
      const custom = new RecoveryTestCoordinator({
        serverCooldownMs: 5000,
        maxWaitForInFlightMs: 2000,
      });
      expect(custom).toBeDefined();
    });
  });

  describe('setServerUrlProvider', () => {
    it('should accept a server URL provider', () => {
      const provider = (serverId: string) => `http://server-${serverId}:11434`;
      coordinator.setServerUrlProvider(provider);
    });
  });

  describe('setInFlightProvider', () => {
    it('should accept an in-flight provider', () => {
      const provider = (serverId: string) => 0;
      coordinator.setInFlightProvider(provider);
    });
  });

  describe('setIncrementInFlight', () => {
    it('should accept increment function', () => {
      const increment = (serverId: string, model: string) => {};
      coordinator.setIncrementInFlight(increment);
    });
  });

  describe('setDecrementInFlight', () => {
    it('should accept decrement function', () => {
      const decrement = (serverId: string, model: string) => {};
      coordinator.setDecrementInFlight(decrement);
    });
  });
});

// REC-16: tests for the extracted isEmbeddingModel() helper
describe('isEmbeddingModel (REC-16)', () => {
  describe('positive cases – embedding models', () => {
    it('detects "embed" in name', () => {
      expect(isEmbeddingModel('nomic-embed-text')).toBe(true);
      expect(isEmbeddingModel('mxbai-embed-large')).toBe(true);
      expect(isEmbeddingModel('all-minilm-embed')).toBe(true);
    });

    it('detects "nomic-embed" in name', () => {
      expect(isEmbeddingModel('nomic-embed-text:latest')).toBe(true);
    });

    it('detects "text-embedding" in name', () => {
      expect(isEmbeddingModel('text-embedding-ada-002')).toBe(true);
      expect(isEmbeddingModel('text-embedding-3-small')).toBe(true);
    });

    it('detects "sentence" in name', () => {
      expect(isEmbeddingModel('sentence-transformers/all-MiniLM-L6-v2')).toBe(true);
    });

    it('detects "bge-" prefix', () => {
      expect(isEmbeddingModel('bge-m3')).toBe(true);
      expect(isEmbeddingModel('bge-large-en-v1.5')).toBe(true);
    });

    it('detects "gte-" prefix', () => {
      expect(isEmbeddingModel('gte-small')).toBe(true);
    });

    it('detects "e5-" prefix', () => {
      expect(isEmbeddingModel('e5-large-v2')).toBe(true);
    });

    it('detects "all-minilm" in name', () => {
      expect(isEmbeddingModel('all-minilm-l6-v2')).toBe(true);
    });

    it('detects "all-mpnet" in name', () => {
      expect(isEmbeddingModel('all-mpnet-base-v2')).toBe(true);
    });

    it('detects "pygmalion" in name', () => {
      expect(isEmbeddingModel('pygmalion-6b')).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(isEmbeddingModel('NOMIC-EMBED-TEXT')).toBe(true);
      expect(isEmbeddingModel('Text-Embedding-Ada-002')).toBe(true);
      expect(isEmbeddingModel('BGE-M3')).toBe(true);
    });
  });

  describe('negative cases – generative models', () => {
    it('does not flag llama models', () => {
      expect(isEmbeddingModel('llama3.1:8b')).toBe(false);
      expect(isEmbeddingModel('llama3:latest')).toBe(false);
    });

    it('does not flag mistral models', () => {
      expect(isEmbeddingModel('mistral:7b')).toBe(false);
      expect(isEmbeddingModel('mistral-instruct')).toBe(false);
    });

    it('does not flag codellama', () => {
      expect(isEmbeddingModel('codellama:13b')).toBe(false);
    });

    it('does not flag phi models', () => {
      expect(isEmbeddingModel('phi3:mini')).toBe(false);
    });

    it('does not flag qwen models', () => {
      expect(isEmbeddingModel('qwen2:7b')).toBe(false);
    });

    it('does not flag deepseek models', () => {
      expect(isEmbeddingModel('deepseek-r1:8b')).toBe(false);
    });
  });
});
