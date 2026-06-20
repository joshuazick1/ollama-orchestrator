import { describe, it, expect } from 'vitest';
import { parseTupleKey } from '../../src/probe/types.js';

describe('parseTupleKey', () => {
  describe('valid tuple keys', () => {
    it('should parse simple serverId:model:endpoint', () => {
      const result = parseTupleKey('srv-1:llama3:ollama_chat');
      expect(result).toEqual({
        serverId: 'srv-1',
        model: 'llama3',
        endpoint: 'ollama_chat',
      });
    });

    it('should parse model name with single colon (llama3.2:1b)', () => {
      const result = parseTupleKey('srv-1:llama3.2:1b:ollama_generate');
      expect(result).toEqual({
        serverId: 'srv-1',
        model: 'llama3.2:1b',
        endpoint: 'ollama_generate',
      });
    });

    it('should parse model name with multiple colons (instruct-q4_K_M variant)', () => {
      const result = parseTupleKey('srv-1:llama3.2:1b:instruct-q4_K_M:ollama_generate');
      expect(result).toEqual({
        serverId: 'srv-1',
        model: 'llama3.2:1b:instruct-q4_K_M',
        endpoint: 'ollama_generate',
      });
    });

    it('should parse srv-1:model:ollama_chat', () => {
      const result = parseTupleKey('srv-1:model:ollama_chat');
      expect(result).toEqual({
        serverId: 'srv-1',
        model: 'model',
        endpoint: 'ollama_chat',
      });
    });

    it('should parse openai_chat endpoint', () => {
      const result = parseTupleKey('srv-1:llama3.2:1b:openai_chat');
      expect(result).toEqual({
        serverId: 'srv-1',
        model: 'llama3.2:1b',
        endpoint: 'openai_chat',
      });
    });

    it('should parse openai_embeddings endpoint with colon model', () => {
      const result = parseTupleKey('srv-1:mxbai-embed:large:openai_embeddings');
      expect(result).toEqual({
        serverId: 'srv-1',
        model: 'mxbai-embed:large',
        endpoint: 'openai_embeddings',
      });
    });

    it('should parse anthropic_messages endpoint with complex model', () => {
      const result = parseTupleKey('srv-1:claude-3.5:sonnet:anthropic_messages');
      expect(result).toEqual({
        serverId: 'srv-1',
        model: 'claude-3.5:sonnet',
        endpoint: 'anthropic_messages',
      });
    });

    it('should parse pipe-separated key with colon in model name (huihui_ai/qwen3.6-abliterated:27b)', () => {
      const result = parseTupleKey('srv-1|huihui_ai/qwen3.6-abliterated:27b|ollama_generate');
      expect(result).toEqual({
        serverId: 'srv-1',
        model: 'huihui_ai/qwen3.6-abliterated:27b',
        endpoint: 'ollama_generate',
      });
    });

    it('should parse pipe-separated key with simple model', () => {
      const result = parseTupleKey('srv-1|model|ollama_chat');
      expect(result).toEqual({
        serverId: 'srv-1',
        model: 'model',
        endpoint: 'ollama_chat',
      });
    });

    it('should parse pipe-separated key with multi-part model name', () => {
      const result = parseTupleKey('srv-1|llama3.2:1b:instruct-q4_K_M|ollama_generate');
      expect(result).toEqual({
        serverId: 'srv-1',
        model: 'llama3.2:1b:instruct-q4_K_M',
        endpoint: 'ollama_generate',
      });
    });
  });

  describe('invalid tuple keys', () => {
    it('should throw on missing parts (serverId only)', () => {
      expect(() => parseTupleKey('srv-1')).toThrow('Invalid tuple key');
    });

    it('should throw on missing parts (serverId:model only)', () => {
      expect(() => parseTupleKey('srv-1:llama3')).toThrow('Invalid tuple key');
    });

    it('should throw on unknown endpoint', () => {
      expect(() => parseTupleKey('srv-1:llama3:unknown_endpoint')).toThrow('Invalid tuple key');
    });

    it('should throw on invalid endpoint (random string)', () => {
      expect(() => parseTupleKey('srv-1:llama3:foobar')).toThrow('Invalid tuple key');
    });
  });
});
