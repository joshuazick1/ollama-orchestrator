/**
 * complex-model-operations.test.ts
 * Complex tests for handling hundreds of models, invalid responses, and stream issues
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ModelManager } from '../../src/model-manager.js';
import type { AIServer } from '../../src/orchestrator.types.js';

describe('Complex Model Operations - Hundreds of Models', () => {
  let modelManager: ModelManager;

  const createOllamaServer = (id: string, models: string[]): AIServer => ({
    id,
    url: `http://localhost:${11434 + parseInt(id.split('-')[1])}`,
    type: 'ollama',
    healthy: true,
    supportsOllama: true,
    lastResponseTime: 100,
    models,
    maxConcurrency: 4,
  });

  const generateModelList = (prefix: string, count: number): string[] => {
    const models: string[] = [];
    for (let i = 0; i < count; i++) {
      models.push(`${prefix}-model-${i}:latest`);
    }
    return models;
  };

  beforeEach(() => {
    modelManager = new ModelManager({});
    vi.clearAllMocks();
  });

  // ============================================================================
  // SECTION 1: Hundreds of Models Across Multiple Servers
  // ============================================================================

  describe('Hundreds of Models - Server with 100+ Models', () => {
    it('should handle server with 100 models', () => {
      const models = generateModelList('llama3', 100);
      const server = createOllamaServer('ollama-1', models);
      modelManager.registerServer(server);

      for (const model of models) {
        modelManager.updateModelState('ollama-1', model, { loaded: true, loadTime: 5000 });
      }

      const summary = modelManager.getSummary();
      expect(summary.totalModels).toBe(100);
    });

    it('should handle server with 500 models', () => {
      const models = generateModelList('mixtral', 500);
      const server = createOllamaServer('ollama-1', models);
      modelManager.registerServer(server);

      for (let i = 0; i < models.length; i += 10) {
        modelManager.updateModelState('ollama-1', models[i], {
          loaded: true,
          loadTime: 3000 + (i % 50) * 100,
        });
      }

      const summary = modelManager.getSummary();
      expect(summary.totalModels).toBe(50);
    });

    it('should find model across 10 servers with 50 models each', () => {
      const servers: AIServer[] = [];

      for (let s = 0; s < 10; s++) {
        const models = generateModelList(`model${s}`, 50);
        const server = createOllamaServer(`ollama-${s}`, models);
        servers.push(server);
        modelManager.registerServer(server);

        for (const model of models.slice(0, 25)) {
          modelManager.updateModelState(`ollama-${s}`, model, { loaded: true });
        }
      }

      const serversWithModel = modelManager.getServersWithModelLoaded('model0-model-0:latest');
      expect(serversWithModel.length).toBe(1);
      expect(serversWithModel).toContain('ollama-0');
    });

    it('should handle model list with unique models on each server', () => {
      for (let s = 0; s < 20; s++) {
        const uniqueModels = generateModelList(`server${s}model`, 30);
        const server = createOllamaServer(`ollama-${s}`, uniqueModels);
        modelManager.registerServer(server);

        for (const model of uniqueModels.slice(0, 10)) {
          modelManager.updateModelState(`ollama-${s}`, model, { loaded: true });
        }
      }

      const summary = modelManager.getSummary();
      expect(summary.totalServers).toBe(20);
      expect(summary.totalModels).toBeGreaterThanOrEqual(200);
    });

    it('should track loading state for 200 concurrent warmup requests', async () => {
      const server = createOllamaServer('ollama-1', generateModelList('llama', 200));
      modelManager.registerServer(server);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });

      const results = await Promise.all(
        Array.from({ length: 200 }, (_, i) =>
          modelManager.warmupModel(`llama${i % 10}:latest`, { serverIds: ['ollama-1'] })
        )
      );

      expect(results.length).toBe(200);
    });

    it('should get servers without model for large fleet', () => {
      for (let s = 0; s < 50; s++) {
        const models = generateModelList(`model${s}`, 20);
        const server = createOllamaServer(`ollama-${s}`, models);
        modelManager.registerServer(server);
      }

      const serversWithout = modelManager.getServersWithoutModel('nonexistent-model');
      expect(serversWithout.length).toBe(50);
    });

    it('should track usage patterns across many models', () => {
      const server = createOllamaServer('ollama-1', generateModelList('llama', 100));
      modelManager.registerServer(server);

      for (let i = 0; i < 100; i++) {
        const modelIndex = i % 100;
        for (let j = 0; j <= modelIndex; j++) {
          modelManager.markModelUsed('ollama-1', `llama${j % 10}:latest`);
        }
      }

      const state1 = modelManager.getModelState('ollama-1', 'llama0:latest');
      const state2 = modelManager.getModelState('ollama-1', 'llama9:latest');
      expect(state1?.lastUsed).toBeGreaterThanOrEqual(state2?.lastUsed || 0);
    });
  });

  // ============================================================================
  // SECTION 2: Complex Streaming Responses
  // ============================================================================

  describe('Complex Streaming Responses', () => {
    const createStreamingChunks = (tokenCount: number): string[] => {
      const chunks: string[] = [];
      const responses = [
        'The',
        'quick',
        'brown',
        'fox',
        'jumps',
        'over',
        'the',
        'lazy',
        'dog.',
        'This',
        'is',
        'a',
        'test',
        'of',
        'streaming',
        'capabilities.',
        'We',
        'need',
        'many',
        'chunks',
        'to',
        'simulate',
        'real-world',
        'usage.',
      ];

      for (let i = 0; i < tokenCount; i++) {
        const response = responses[i % responses.length];
        chunks.push(`{"response":"${response}","done":false}`);
      }
      chunks.push(
        '{"response":"","done":true,"context":[1,2,3],"total_duration":5000000000,"load_duration":1000000000,"prompt_eval_count":10,"eval_count":100}'
      );
      return chunks;
    };

    it('should handle 100 streaming chunks', () => {
      const chunks = createStreamingChunks(100);
      expect(chunks.length).toBe(101);

      let validChunks = 0;
      for (const chunk of chunks) {
        try {
          const parsed = JSON.parse(chunk);
          if (parsed.response !== undefined) {validChunks++;}
        } catch {}
      }
      expect(validChunks).toBe(101);
    });

    it('should handle 500 streaming chunks', () => {
      const chunks = createStreamingChunks(500);
      expect(chunks.length).toBe(501);

      let totalResponseLength = 0;
      for (const chunk of chunks) {
        const parsed = JSON.parse(chunk);
        totalResponseLength += parsed.response.length;
      }
      expect(totalResponseLength).toBeGreaterThan(0);
    });

    it('should parse chunks with special characters', () => {
      const specialChunks = [
        '{"response":"Hello \\n world","done":false}',
        '{"response":"Tab\\there","done":false}',
        '{"response":"Quotes\\"inside","done":false}',
        '{"response":"Unicode: 你好世界","done":false}',
        '{"response":"Emoji 🚀","done":false}',
      ];

      for (const chunk of specialChunks) {
        const parsed = JSON.parse(chunk);
        expect(parsed.done).toBe(false);
      }
    });

    it('should handle chunks with varying response lengths', () => {
      const varyingChunks = [
        '{"response":"a","done":false}',
        '{"response":"short","done":false}',
        '{"response":"medium length response","done":false}',
        '{"response":"' + 'a'.repeat(100) + '","done":false}',
        '{"response":"' + 'a'.repeat(1000) + '","done":false}',
      ];

      for (const chunk of varyingChunks) {
        const parsed = JSON.parse(chunk);
        expect(parsed.response).toBeDefined();
      }
    });

    it('should handle done chunk with all metadata', () => {
      const doneChunk = JSON.stringify({
        response: '',
        done: true,
        context: [1, 2, 3, 4, 5],
        total_duration: 5000000000,
        load_duration: 1000000000,
        prompt_eval_count: 10,
        eval_count: 100,
        model: 'llama3:latest',
      });

      const parsed = JSON.parse(doneChunk);
      expect(parsed.done).toBe(true);
      expect(parsed.total_duration).toBe(5000000000);
      expect(parsed.eval_count).toBe(100);
    });

    it('should handle interleaved streaming from multiple servers', () => {
      const server1Chunks = createStreamingChunks(50);
      const server2Chunks = createStreamingChunks(50);

      const interleaved: string[] = [];
      for (let i = 0; i < 50; i++) {
        if (i % 2 === 0) {
          interleaved.push(server1Chunks[i]);
        } else {
          interleaved.push(server2Chunks[i]);
        }
      }

      expect(interleaved.length).toBe(50);
    });
  });

  // ============================================================================
  // SECTION 3: Invalid JSON Responses
  // ============================================================================

  describe('Invalid JSON Responses from Ollama', () => {
    it('should handle completely invalid JSON', () => {
      const invalidResponses = [
        'not valid json',
        'just plain text',
        '{invalid',
        '}',
        '',
        'null',
        'undefined',
      ];

      for (const response of invalidResponses) {
        let parsed = null;
        try {
          parsed = JSON.parse(response);
        } catch (e) {
          parsed = null;
        }
        expect(parsed).toBeNull();
      }
    });

    it('should handle malformed JSON objects', () => {
      const malformedJson = [
        '{"response":',
        '"response":"value"}',
        '{"response":"value",',
        '{"response": undefined}',
        '{"response": NaN}',
        '{"response": Infinity}',
        '{"response": -Infinity}',
      ];

      for (const json of malformedJson) {
        let parsed = null;
        try {
          parsed = JSON.parse(json);
        } catch (e) {
          parsed = null;
        }
        expect(parsed).toBeNull();
      }
    });

    it('should handle JSON with missing fields', () => {
      const incompleteJson = [
        '{}',
        '{"response":"test"}',
        '{"done":true}',
        '{"response":"","done":false}',
      ];

      for (const json of incompleteJson) {
        const parsed = JSON.parse(json);
        expect(parsed).toBeDefined();
      }
    });

    it('should handle JSON with extra fields', () => {
      const jsonWithExtra =
        '{"response":"test","done":false,"extraField":"value","another":123,"nested":{"a":1}}';
      const parsed = JSON.parse(jsonWithExtra);

      expect(parsed.response).toBe('test');
      expect(parsed.done).toBe(false);
      expect(parsed.extraField).toBe('value');
    });

    it('should handle server returning HTML instead of JSON', () => {
      const htmlResponses = [
        '<html><body>Not Found</body></html>',
        '<!DOCTYPE html><html>Error</html>',
        'Internal Server Error',
        '<error>Something went wrong</error>',
      ];

      for (const response of htmlResponses) {
        let parsed = null;
        try {
          parsed = JSON.parse(response);
        } catch (e) {
          parsed = null;
        }
        expect(parsed).toBeNull();
      }
    });

    it('should handle server returning truncated JSON', () => {
      const truncatedJson = [
        '{"response":"test"',
        '{"response":"test",',
        '{"response":"test',
        '{"res',
      ];

      for (const json of truncatedJson) {
        let parsed = null;
        try {
          parsed = JSON.parse(json);
        } catch (e) {
          parsed = null;
        }
        expect(parsed).toBeNull();
      }
    });

    it('should handle server returning array instead of object', () => {
      const arrayJson = '["item1","item2","item3"]';
      const parsed = JSON.parse(arrayJson);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(3);
    });

    it('should handle null response from server', () => {
      const nullJson = 'null';
      const parsed = JSON.parse(nullJson);
      expect(parsed).toBeNull();
    });

    it('should handle SSE format with non-JSON data', () => {
      const sseData = [
        'data: plain text without JSON',
        'data:',
        'data: {invalid json',
        'data: ',
        'data:',
      ];

      for (const data of sseData) {
        const jsonPart = data.replace(/^data:\s*/, '');
        let parsed = null;
        try {
          parsed = JSON.parse(jsonPart);
        } catch (e) {
          parsed = null;
        }
        expect(parsed === null || parsed === '').toBe(true);
      }
    });
  });

  // ============================================================================
  // SECTION 4: Interrupted and Stalled Streams
  // ============================================================================

  describe('Interrupted and Stalled Streams', () => {
    it('should handle stream with very long gaps between chunks', () => {
      const now = Date.now();
      const chunkTimestamps = [
        now,
        now + 100,
        now + 200,
        now + 300,
        now + 60000,
        now + 60001,
        now + 120000,
      ];

      const gaps: number[] = [];
      for (let i = 1; i < chunkTimestamps.length; i++) {
        gaps.push(chunkTimestamps[i] - chunkTimestamps[i - 1]);
      }

      const longGaps = gaps.filter(g => g > 5000);
      expect(longGaps.length).toBeGreaterThanOrEqual(2);
    });

    it('should detect stalled stream (no chunks for extended period)', () => {
      const stalledAfterMs = 30000;
      const chunkIntervals = [100, 100, 100, 5000, 10000, 20000, 30000, 31000];

      let lastChunkTime = Date.now();
      const stallPoints: number[] = [];

      for (const interval of chunkIntervals) {
        lastChunkTime += interval;
        if (lastChunkTime - (lastChunkTime - interval) > stalledAfterMs) {
          stallPoints.push(interval);
        }
      }

      expect(stallPoints.length).toBeGreaterThan(0);
    });

    it('should handle stream that gets interrupted mid-chunk', () => {
      const partialChunks = [
        '{"response":"Hello',
        ' world","done":false}',
        '{"response":"This',
        ' is","done":false}',
      ];

      const validChunks = partialChunks.filter(c => {
        try {
          JSON.parse(c);
          return true;
        } catch {
          return false;
        }
      });

      expect(validChunks.length).toBe(0);
    });

    it('should handle stream with connection reset', () => {
      const chunksBeforeReset = 5;
      const totalChunks = 20;

      const receivedChunks = Array.from(
        { length: chunksBeforeReset },
        (_, i) => `{"response":"token${i}","done":false}`
      );

      const finalChunk = '{"response":"token5","done":true}';

      expect(receivedChunks.length).toBe(5);
      expect(finalChunk).toContain('done":true');
    });

    it('should handle stream timeout after inactivity', () => {
      const activityTimeoutMs = 60000;
      const chunkTimes = [0, 100, 200, 61000, 61100, 120000];

      let lastTimeout = -1;
      for (let i = 1; i < chunkTimes.length; i++) {
        if (chunkTimes[i] - chunkTimes[i - 1] > activityTimeoutMs) {
          lastTimeout = chunkTimes[i];
        }
      }

      expect(lastTimeout).toBe(61000);
    });

    it('should handle partial done chunk received', () => {
      const partialDoneChunks = [
        '{"done":true}',
        '{"done":true,"response":""}',
        '{"done":true,"total_duration":5000}',
        '{"done":true,"response":"","total_duration":5000,"eval_count":100}',
      ];

      for (const chunk of partialDoneChunks) {
        const parsed = JSON.parse(chunk);
        expect(parsed.done).toBe(true);
      }
    });

    it('should handle rapid fire chunks (no delay)', () => {
      const rapidChunks = Array.from(
        { length: 100 },
        (_, i) => `{"response":"token${i}","done":${i === 99}}`
      );

      const allParsed = rapidChunks.map(c => JSON.parse(c));
      expect(allParsed.length).toBe(100);
      expect(allParsed[99].done).toBe(true);
    });

    it('should handle chunks arriving out of order', () => {
      const orderedChunks = [
        '{"response":"first","index":0}',
        '{"response":"second","index":1}',
        '{"response":"third","index":2}',
      ];

      const outOfOrder = [orderedChunks[2], orderedChunks[0], orderedChunks[1]];

      const parsed = outOfOrder.map(c => JSON.parse(c));
      expect(parsed[0].index).toBe(2);
      expect(parsed[1].index).toBe(0);
      expect(parsed[2].index).toBe(1);
    });

    it('should handle empty response chunks', () => {
      const emptyChunks = ['{"response":"","done":false}', '{"response":"","done":false}'];

      for (const chunk of emptyChunks) {
        const parsed = JSON.parse(chunk);
        expect(parsed.response).toBe('');
      }
    });

    it('should handle stream with only error responses', () => {
      const errorChunks = [
        '{"error":"model not found"}',
        '{"error":"insufficient resources"}',
        '{"error":"timeout"}',
      ];

      for (const chunk of errorChunks) {
        const parsed = JSON.parse(chunk);
        expect(parsed.error).toBeDefined();
      }
    });

    it('should handle mixed success and error chunks', () => {
      const mixedChunks = [
        '{"response":"Hello","done":false}',
        '{"error":"connection lost"}',
        '{"response":" world","done":false}',
        '{"error":"server error"}',
        '{"response":"!","done":true}',
      ];

      let successCount = 0;
      let errorCount = 0;

      for (const chunk of mixedChunks) {
        const parsed = JSON.parse(chunk);
        if (parsed.error) {errorCount++;}
        else if (parsed.response !== undefined) {successCount++;}
      }

      expect(successCount).toBe(3);
      expect(errorCount).toBe(2);
    });
  });

  // ============================================================================
  // SECTION 5: Complex Multi-Server Scenarios
  // ============================================================================

  describe('Complex Multi-Server Scenarios', () => {
    it('should handle heterogeneous model distribution', () => {
      const serverConfigs = [
        { id: 'ollama-1', modelCount: 10, type: 'small' },
        { id: 'ollama-2', modelCount: 50, type: 'medium' },
        { id: 'ollama-3', modelCount: 100, type: 'large' },
        { id: 'ollama-4', modelCount: 200, type: 'xlarge' },
        { id: 'ollama-5', modelCount: 5, type: 'tiny' },
      ];

      for (const config of serverConfigs) {
        const models = generateModelList('model', config.modelCount);
        const server = createOllamaServer(config.id, models);
        modelManager.registerServer(server);

        for (const model of models.slice(0, Math.floor(config.modelCount / 2))) {
          modelManager.updateModelState(config.id, model, { loaded: true });
        }
      }

      const summary = modelManager.getSummary();
      expect(summary.totalServers).toBe(5);
      expect(summary.totalModels).toBe(100);
    });

    it('should handle model overlap across servers', () => {
      const sharedModels = ['llama3:latest', 'mistral:latest', 'codellama:latest'];

      for (let s = 0; s < 10; s++) {
        const models = [...sharedModels, ...generateModelList(`unique${s}`, 20)];
        const server = createOllamaServer(`ollama-${s}`, models);
        modelManager.registerServer(server);

        modelManager.updateModelState(`ollama-${s}`, 'llama3:latest', { loaded: true });
        if (s < 5) {
          modelManager.updateModelState(`ollama-${s}`, 'mistral:latest', { loaded: true });
        }
      }

      const llamaServers = modelManager.getServersWithModelLoaded('llama3:latest');
      const mistralServers = modelManager.getServersWithModelLoaded('mistral:latest');

      expect(llamaServers.length).toBe(10);
      expect(mistralServers.length).toBe(5);
    });

    it('should handle servers with no overlap (disjoint model sets)', () => {
      for (let s = 0; s < 10; s++) {
        const models = generateModelList(`uniqueserver${s}`, 50);
        const server = createOllamaServer(`ollama-${s}`, models);
        modelManager.registerServer(server);

        for (const model of models.slice(0, 10)) {
          modelManager.updateModelState(`ollama-${s}`, model, { loaded: true });
        }
      }

      const llamaServers = modelManager.getServersWithModelLoaded('llama3:latest');
      expect(llamaServers.length).toBe(0);
    });

    it('should handle fleet-wide model migration', () => {
      const servers = ['ollama-1', 'ollama-2', 'ollama-3'];

      for (const serverId of servers) {
        const server = createOllamaServer(serverId, ['old-model:latest']);
        modelManager.registerServer(server);
        modelManager.updateModelState(serverId, 'old-model:latest', { loaded: true });
      }

      for (const serverId of servers) {
        modelManager.updateModelState(serverId, 'old-model:latest', { loaded: false });
        modelManager.updateModelState(serverId, 'new-model:latest', { loaded: true });
      }

      const oldServers = modelManager.getServersWithModelLoaded('old-model:latest');
      const newServers = modelManager.getServersWithModelLoaded('new-model:latest');

      expect(oldServers.length).toBe(0);
      expect(newServers.length).toBe(3);
    });
  });

  // ============================================================================
  // SECTION 6: Edge Cases with Model Names
  // ============================================================================

  describe('Edge Cases with Model Names', () => {
    it('should handle models with special characters in names', () => {
      const specialModels = [
        'model-with-dashes:latest',
        'model_with_underscores:latest',
        'model.with.dots:latest',
        'model@version:latest',
        'model:tag:latest',
        'model with spaces:latest',
        '模型:latest',
        'модель:latest',
        'model🦄:latest',
      ];

      for (const model of specialModels) {
        const server = createOllamaServer('ollama-1', [model]);
        modelManager.registerServer(server);
        modelManager.updateModelState('ollama-1', model, { loaded: true });

        const state = modelManager.getModelState('ollama-1', model);
        expect(state?.loaded).toBe(true);
      }
    });

    it('should handle very long model names', () => {
      const longName = 'a'.repeat(500) + ':latest';
      const server = createOllamaServer('ollama-1', [longName]);
      modelManager.registerServer(server);
      modelManager.updateModelState('ollama-1', longName, { loaded: true });

      const state = modelManager.getModelState('ollama-1', longName);
      expect(state?.loaded).toBe(true);
    });

    it('should handle duplicate model names with different tags', () => {
      const models = ['llama3:latest', 'llama3:v0.1', 'llama3:v0.2', 'llama3:v0.3', 'llama3:v1.0'];

      const server = createOllamaServer('ollama-1', models);
      modelManager.registerServer(server);

      for (const model of models) {
        modelManager.updateModelState('ollama-1', model, { loaded: true });
      }

      const summary = modelManager.getSummary();
      expect(summary.totalModels).toBe(5);
    });
  });
});
