import { describe, it, expect } from 'vitest';

import { isEmbeddingModel } from '../../../src/probe/endpoint-registry.js';

describe('EMBEDDING_MODEL_PATTERNS', () => {
  describe('bge family detection', () => {
    it('detects bge-m3 as embedding', () => {
      expect(isEmbeddingModel('bge-m3:latest')).toBe(true);
    });

    it('detects bge-large as embedding', () => {
      expect(isEmbeddingModel('bge-large:latest')).toBe(true);
    });

    it('detects bge-m3-32k as embedding', () => {
      expect(isEmbeddingModel('bge-m3-32k:latest')).toBe(true);
    });

    it('detects bge-m3-8k as embedding', () => {
      expect(isEmbeddingModel('bge-m3-8k:latest')).toBe(true);
    });
  });

  describe('other embedding model patterns', () => {
    it('detects nomic-embed-text as embedding', () => {
      expect(isEmbeddingModel('nomic-embed-text:latest')).toBe(true);
    });

    it('detects mxbai-embed-large as embedding', () => {
      expect(isEmbeddingModel('mxbai-embed-large:latest')).toBe(true);
    });

    it('detects all-minilm as embedding', () => {
      expect(isEmbeddingModel('all-minilm:latest')).toBe(true);
    });

    it('detects gte-qwen2-1.5b-instruct-embed-f16 as embedding (via embed)', () => {
      expect(isEmbeddingModel('gte-qwen2-1.5b-instruct-embed-f16:latest')).toBe(true);
    });
  });

  describe('negative cases — generation models must NOT be detected as embedding', () => {
    it('does NOT detect llama3:8b as embedding', () => {
      expect(isEmbeddingModel('llama3:8b')).toBe(false);
    });

    it('does NOT detect qwen2.5:7b as embedding', () => {
      expect(isEmbeddingModel('qwen2.5:7b')).toBe(false);
    });

    it('does NOT detect llama3.1:8b as embedding', () => {
      expect(isEmbeddingModel('llama3.1:8b')).toBe(false);
    });

    it('does NOT detect mistral:7b as embedding', () => {
      expect(isEmbeddingModel('mistral:7b')).toBe(false);
    });
  });
});
