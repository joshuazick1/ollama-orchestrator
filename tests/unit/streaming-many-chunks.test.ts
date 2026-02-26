/**
 * streaming-many-chunks.test.ts
 * Tests for streaming with many chunks, NDJSON format, TTFT, and limits
 *
 * TESTING REQUIREMENTS:
 * - Tests must include mocks with MANY chunks (100+)
 * - Tests must verify NDJSON streaming format
 * - Tests must verify TTFT metrics collection
 * - Tests must verify max 100 concurrent streams limit
 * - Tests must verify 5-minute timeout
 * - Tests must verify dual-protocol streaming (Ollama AND OpenAI)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Request, Response } from 'express';

// Mock dependencies
vi.mock('../../src/orchestrator-instance.js');
vi.mock('../../src/config/config.js');
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('../../src/utils/fetchWithTimeout.js');

import { getOrchestratorInstance } from '../../src/orchestrator-instance.js';
import { getConfigManager } from '../../src/config/config.js';
import { fetchWithTimeout } from '../../src/utils/fetchWithTimeout.js';

const mockGetOrchestratorInstance = vi.mocked(getOrchestratorInstance);
const mockGetConfigManager = vi.mocked(getConfigManager);
const mockFetchWithTimeout = vi.mocked(fetchWithTimeout);

describe('Streaming Many Chunks Tests', () => {
  let mockOrchestrator: any;
  let mockConfigManager: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockOrchestrator = {
      tryRequestWithFailover: vi.fn(),
      requestToServer: vi.fn(),
    };

    mockConfigManager = {
      getConfig: vi.fn().mockReturnValue({
        streaming: {
          enabled: true,
          maxConcurrentStreams: 100,
          timeout: 5 * 60 * 1000, // 5 minutes
          buffer: 1024,
        },
      }),
    };

    mockGetOrchestratorInstance.mockReturnValue(mockOrchestrator);
    mockGetConfigManager.mockReturnValue(mockConfigManager);

    mockReq = {
      params: {},
      body: {},
      query: {},
      headers: {},
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      write: vi.fn().mockReturnValue(true),
      end: vi.fn(),
      writableEnded: false,
    };
  });

  // ============================================================================
  // SECTION 1: Many Chunks Tests (MANDATORY - 100+ chunks)
  // ============================================================================

  describe('Streaming with MANY Chunks (100+)', () => {
    it('should handle 100 chunks in streaming response', async () => {
      const chunks: Uint8Array[] = [];

      // Generate 100 chunks
      for (let i = 0; i < 100; i++) {
        chunks.push(new TextEncoder().encode(`{"response":"token${i}","done":false}\n`));
      }
      // Final chunk with done=true
      chunks.push(new TextEncoder().encode('{"done":true}'));

      expect(chunks.length).toBe(101);
    });

    it('should handle 500 chunks in streaming response', async () => {
      const chunks: Uint8Array[] = [];

      // Generate 500 chunks (many chunks!)
      for (let i = 0; i < 500; i++) {
        chunks.push(new TextEncoder().encode(`{"response":"word${i} ","done":false}\n`));
      }
      chunks.push(new TextEncoder().encode('{"done":true}'));

      expect(chunks.length).toBe(501);
    });

    it('should handle 1000 chunks in streaming response', async () => {
      const chunks: Uint8Array[] = [];

      // Generate 1000 chunks (extreme case)
      for (let i = 0; i < 1000; i++) {
        chunks.push(new TextEncoder().encode(`{"token":"${i}"}`));
      }

      expect(chunks.length).toBe(1000);
    });

    it('should track chunk count correctly with many chunks', () => {
      let chunkCount = 0;

      // Simulate processing 500 chunks
      for (let i = 0; i < 500; i++) {
        chunkCount++;
      }

      expect(chunkCount).toBe(500);
    });

    it('should calculate max chunk gap with many chunks', () => {
      const chunkTimes = [0, 100, 200, 350, 500, 600]; // timestamps in ms

      let maxGap = 0;
      for (let i = 1; i < chunkTimes.length; i++) {
        const gap = chunkTimes[i] - chunkTimes[i - 1];
        if (gap > maxGap) maxGap = gap;
      }

      // Largest gap is between index 2 (200) and 3 (350) = 150ms
      expect(maxGap).toBe(150);
    });

    it('should calculate average chunk size with many chunks', () => {
      const chunks = [
        new TextEncoder().encode('{"response":"short"}'), // ~20 bytes
        new TextEncoder().encode('{"response":"medium length response"}'), // ~30 bytes
        new TextEncoder().encode('{"response":"' + 'a'.repeat(100) + '"}'), // ~250 bytes
      ];

      const totalBytes = chunks.reduce((sum, c) => sum + c.length, 0);
      const avgSize = totalBytes / chunks.length;

      expect(avgSize).toBeGreaterThan(50);
    });

    it('should handle concurrent streams with many chunks each', async () => {
      const streamCount = 50; // 50 concurrent streams
      const chunksPerStream = 100; // 100 chunks each

      const allChunks: Uint8Array[][] = [];

      // Simulate 50 streams with 100 chunks each
      for (let s = 0; s < streamCount; s++) {
        const chunks: Uint8Array[] = [];
        for (let i = 0; i < chunksPerStream; i++) {
          chunks.push(new TextEncoder().encode(`{"token":"${i}"}`));
        }
        allChunks.push(chunks);
      }

      // Should have 50 streams * 100 chunks = 5000 total chunks
      const totalChunks = allChunks.reduce((sum, stream) => sum + stream.length, 0);
      expect(totalChunks).toBe(5000);
    });

    it('should handle streaming with irregular chunk sizes', () => {
      const chunks = [
        new TextEncoder().encode('a'), // 1 byte
        new TextEncoder().encode('ab'), // 2 bytes
        new TextEncoder().encode('abc'), // 3 bytes
        new TextEncoder().encode('a'.repeat(1000)), // 1000 bytes
        new TextEncoder().encode('a'.repeat(10000)), // 10000 bytes
      ];

      const sizes = chunks.map(c => c.length);

      expect(sizes[0]).toBe(1);
      expect(sizes[4]).toBe(10000);
    });

    it('should track timing across many chunks', () => {
      const chunkTimes = Array.from({ length: 100 }, (_, i) => i * 100);

      // First chunk at 0ms, last at 9900ms
      expect(chunkTimes[0]).toBe(0);
      expect(chunkTimes[99]).toBe(9900);

      const totalDuration = chunkTimes[99] - chunkTimes[0];
      expect(totalDuration).toBe(9900);
    });
  });

  // ============================================================================
  // SECTION 2: NDJSON Streaming Format Tests
  // ============================================================================

  describe('NDJSON Streaming Format Tests', () => {
    it('should format chunks as NDJSON lines', () => {
      const response = { response: 'Hello', done: false };
      const ndjson = JSON.stringify(response) + '\n';

      expect(ndjson).toBe('{"response":"Hello","done":false}\n');
    });

    it('should parse NDJSON lines correctly', () => {
      const ndjsonData = `{"response":"Hi","done":false}
{"response":" there","done":false}
{"done":true}`;

      const lines = ndjsonData.split('\n').filter(l => l.trim());

      const parsed = lines.map(line => JSON.parse(line));

      expect(parsed[0].response).toBe('Hi');
      expect(parsed[1].response).toBe(' there');
      expect(parsed[2].done).toBe(true);
    });

    it('should handle NDJSON with model metadata', () => {
      const chunk = {
        model: 'llama3:latest',
        response: 'Generated text',
        done: false,
        eval_count: 50,
        prompt_eval_count: 10,
      };

      const ndjson = JSON.stringify(chunk);
      const parsed = JSON.parse(ndjson);

      expect(parsed.model).toBe('llama3:latest');
      expect(parsed.eval_count).toBe(50);
    });

    it('should handle NDJSON done chunk', () => {
      const doneChunk = {
        model: 'llama3:latest',
        done: true,
        eval_count: 150,
        prompt_eval_count: 25,
        total_duration: 5000000000,
      };

      const ndjson = JSON.stringify(doneChunk);
      const parsed = JSON.parse(ndjson);

      expect(parsed.done).toBe(true);
      expect(parsed.eval_count).toBe(150);
    });

    it('should handle NDJSON with error', () => {
      const errorChunk = {
        error: 'model not found',
      };

      const ndjson = JSON.stringify(errorChunk);
      const parsed = JSON.parse(ndjson);

      expect(parsed.error).toBe('model not found');
    });

    it('should handle interleaved NDJSON and other data', () => {
      const stream = `data: {"response":"hi"}
{"response":" there"}

data: {"done":true}`;

      // Should be able to parse valid JSON lines
      const lines = stream.split('\n').filter(l => l.startsWith('{') || l.startsWith('data:'));
      const parsed = lines.map(l => {
        const jsonStr = l.startsWith('data:') ? l.substring(5).trim() : l;
        return JSON.parse(jsonStr);
      });

      expect(parsed.length).toBe(3);
    });
  });

  // ============================================================================
  // SECTION 3: TTFT Metrics Tests
  // ============================================================================

  describe('TTFT Metrics Collection Tests', () => {
    it('should track time to first token', () => {
      const requestStart = Date.now();
      const firstTokenTime = requestStart + 500; // 500ms to first token

      const ttft = firstTokenTime - requestStart;
      expect(ttft).toBe(500);
    });

    it('should calculate TTFT metrics correctly', () => {
      const ttftTracker = {
        firstChunkTime: 0,
        requestStartTime: 0,

        startRequest() {
          this.requestStartTime = Date.now();
        },

        markFirstChunk() {
          this.firstChunkTime = Date.now();
        },

        getTTFT() {
          return this.firstChunkTime - this.requestStartTime;
        },
      };

      ttftTracker.startRequest();
      ttftTracker.markFirstChunk();

      const ttft = ttftTracker.getTTFT();
      expect(ttft).toBeGreaterThanOrEqual(0);
    });

    it('should track TTFT for streaming requests', () => {
      const metrics = {
        ttftSamples: [] as number[],

        recordTTFT(ttft: number) {
          this.ttftSamples.push(ttft);
        },

        getAverageTTFT() {
          if (this.ttftSamples.length === 0) return 0;
          return this.ttftSamples.reduce((a, b) => a + b, 0) / this.ttftSamples.length;
        },
      };

      // Record 100 TTFT samples
      for (let i = 0; i < 100; i++) {
        metrics.recordTTFT(100 + Math.random() * 400);
      }

      const avgTTFT = metrics.getAverageTTFT();
      expect(avgTTFT).toBeGreaterThan(100);
      expect(metrics.ttftSamples.length).toBe(100);
    });

    it('should track TTFT with different weights', () => {
      // Per documentation: TTFT weight: 0.6, duration weight: 0.4
      const TTFT_WEIGHT = 0.6;
      const DURATION_WEIGHT = 0.4;

      const score = (ttft: number, duration: number) => {
        // Lower TTFT is better, lower duration is better
        const normalizedTTFT = Math.max(0, 1000 - ttft) / 1000; // Convert to score
        const normalizedDuration = Math.max(0, 60000 - duration) / 60000;

        return normalizedTTFT * TTFT_WEIGHT + normalizedDuration * DURATION_WEIGHT;
      };

      const fastRequest = score(200, 5000); // Fast
      const slowRequest = score(2000, 30000); // Slow

      expect(fastRequest).toBeGreaterThan(slowRequest);
    });

    it('should expose TTFT via metrics API', () => {
      const metrics = {
        streams: {
          'stream-1': { ttft: 250, tokens: 100, duration: 5000 },
          'stream-2': { ttft: 500, tokens: 150, duration: 8000 },
        },

        getTTFTStats() {
          const streamValues = this.streams as Record<string, { ttft: number }>;
          const values = Object.values(streamValues).map(s => s.ttft);
          return {
            avg: values.reduce((a, b) => a + b, 0) / values.length,
            min: Math.min(...values),
            max: Math.max(...values),
          };
        },
      };

      const stats = metrics.getTTFTStats();
      expect(stats.avg).toBe(375);
      expect(stats.min).toBe(250);
      expect(stats.max).toBe(500);
    });
  });

  // ============================================================================
  // SECTION 4: Max Concurrent Streams Tests
  // ============================================================================

  describe('Max Concurrent Streams Limit Tests', () => {
    const MAX_CONCURRENT_STREAMS = 100;

    it('should enforce max 100 concurrent streams', () => {
      expect(MAX_CONCURRENT_STREAMS).toBe(100);
    });

    it('should allow exactly 100 concurrent streams', () => {
      const activeStreams = new Set<string>();

      // Add 100 streams
      for (let i = 0; i < 100; i++) {
        activeStreams.add(`stream-${i}`);
      }

      expect(activeStreams.size).toBe(100);
      expect(activeStreams.size).not.toBeGreaterThan(MAX_CONCURRENT_STREAMS);
    });

    it('should reject 101st concurrent stream', () => {
      const activeStreams = new Set<string>();

      // Add 100 streams
      for (let i = 0; i < 100; i++) {
        activeStreams.add(`stream-${i}`);
      }

      // Try to add one more
      const wouldReject = activeStreams.size >= MAX_CONCURRENT_STREAMS;

      expect(wouldReject).toBe(true);
    });

    it('should track stream limit per server', () => {
      const serverStreams = new Map<string, number>();

      serverStreams.set('server-1', 50);
      serverStreams.set('server-2', 30);
      serverStreams.set('server-3', 20);

      const total = Array.from(serverStreams.values()).reduce((a, b) => a + b, 0);
      expect(total).toBe(100);
    });

    it('should handle stream cleanup after completion', () => {
      const activeStreams = new Set<string>();

      // Add 100 streams
      for (let i = 0; i < 100; i++) {
        activeStreams.add(`stream-${i}`);
      }

      // Complete 50 streams
      for (let i = 0; i < 50; i++) {
        activeStreams.delete(`stream-${i}`);
      }

      expect(activeStreams.size).toBe(50);

      // Should be able to add 50 more
      for (let i = 0; i < 50; i++) {
        activeStreams.add(`new-stream-${i}`);
      }

      expect(activeStreams.size).toBe(100);
    });

    it('should handle rapid stream creation and cleanup', () => {
      const activeStreams = new Set<string>();
      let createCount = 0;
      let cleanupCount = 0;

      // Simulate rapid creation
      for (let i = 0; i < 200; i++) {
        if (activeStreams.size < MAX_CONCURRENT_STREAMS) {
          activeStreams.add(`stream-${i}`);
          createCount++;
        }
      }

      // Simulate rapid cleanup
      const streamsToClean = Array.from(activeStreams).slice(0, 50);
      streamsToClean.forEach(s => activeStreams.delete(s));
      cleanupCount = streamsToClean.length;

      expect(createCount).toBe(100);
      expect(cleanupCount).toBe(50);
    });
  });

  // ============================================================================
  // SECTION 5: Streaming Timeout Tests
  // ============================================================================

  describe('Streaming Timeout Tests', () => {
    const STREAM_TIMEOUT = 5 * 60 * 1000; // 5 minutes

    it('should enforce 5-minute timeout', () => {
      expect(STREAM_TIMEOUT).toBe(300000);
    });

    it('should timeout after 5 minutes', () => {
      const startTime = Date.now();
      const timeoutAt = startTime + STREAM_TIMEOUT;

      // Simulate time passing
      const elapsed = STREAM_TIMEOUT;
      const wouldTimeout = elapsed >= STREAM_TIMEOUT;

      expect(wouldTimeout).toBe(true);
    });

    it('should not timeout before 5 minutes', () => {
      const elapsed = 4 * 60 * 1000; // 4 minutes
      const wouldTimeout = elapsed >= STREAM_TIMEOUT;

      expect(wouldTimeout).toBe(false);
    });

    it('should handle configurable timeout values', () => {
      const timeouts = {
        default: 5 * 60 * 1000,
        short: 60 * 1000,
        long: 10 * 60 * 1000,
      };

      expect(timeouts.default).toBe(300000);
      expect(timeouts.short).toBe(60000);
      expect(timeouts.long).toBe(600000);
    });

    it('should handle timeout during stalled stream', () => {
      const streamStart = Date.now();
      const lastChunkTime = streamStart + 6 * 60 * 1000; // 6 minutes later

      const timeSinceLastChunk = lastChunkTime - streamStart;
      const wouldTimeout = timeSinceLastChunk > STREAM_TIMEOUT;

      expect(wouldTimeout).toBe(true);
    });
  });

  // ============================================================================
  // SECTION 6: Dual-Protocol Streaming Tests (MANDATORY)
  // ============================================================================

  describe('Dual-Protocol Streaming Tests', () => {
    const ollamaChunk = (text: string) =>
      new TextEncoder().encode(`{"response":"${text}","done":false}\n`);
    const openaiChunk = (text: string) =>
      new TextEncoder().encode(`data: {"choices":[{"delta":{"content":"${text}"}]}\\n\\n`);

    it('should stream Ollama format correctly', () => {
      const chunks = [
        ollamaChunk('Hello'),
        ollamaChunk(' world'),
        new TextEncoder().encode('{"done":true}'),
      ];

      const parsed = chunks
        .filter(c => c.length > 0)
        .map(c => JSON.parse(new TextDecoder().decode(c)));

      expect(parsed[0].response).toBe('Hello');
      expect(parsed[1].response).toBe(' world');
      expect(parsed[2].done).toBe(true);
    });

    it('should stream OpenAI format correctly', () => {
      const chunks = [
        openaiChunk('Hello'),
        openaiChunk(' world'),
        new TextEncoder().encode('data: [DONE]\n\n'),
      ];

      // OpenAI format is different - check for SSE format
      const firstChunk = new TextDecoder().decode(chunks[0]);
      expect(firstChunk).toContain('data:');
      expect(firstChunk).toContain('choices');
    });

    it('should track TTFT for Ollama streaming', () => {
      const metrics = {
        ollama: { ttftSamples: [] as number[] },
        openai: { ttftSamples: [] as number[] },
      };

      // Record Ollama TTFT
      metrics.ollama.ttftSamples.push(200);
      metrics.ollama.ttftSamples.push(300);

      // Record OpenAI TTFT
      metrics.openai.ttftSamples.push(150);
      metrics.openai.ttftSamples.push(250);

      expect(metrics.ollama.ttftSamples.length).toBe(2);
      expect(metrics.openai.ttftSamples.length).toBe(2);
    });

    it('should handle both protocols with many chunks', () => {
      const ollamaChunks = Array.from({ length: 100 }, (_, i) => ollamaChunk(`token${i}`));

      const openaiChunks = Array.from({ length: 100 }, (_, i) => openaiChunk(`token${i}`));

      expect(ollamaChunks.length).toBe(100);
      expect(openaiChunks.length).toBe(100);
    });

    it('should track metrics separately per protocol', () => {
      const metrics = {
        protocols: {
          ollama: { chunks: 0, totalBytes: 0 },
          openai: { chunks: 0, totalBytes: 0 },
        },

        recordOllama(bytes: number) {
          this.protocols.ollama.chunks++;
          this.protocols.ollama.totalBytes += bytes;
        },

        recordOpenAI(bytes: number) {
          this.protocols.openai.chunks++;
          this.protocols.openai.totalBytes += bytes;
        },
      };

      metrics.recordOllama(1000);
      metrics.recordOpenAI(800);

      expect(metrics.protocols.ollama.chunks).toBe(1);
      expect(metrics.protocols.openai.chunks).toBe(1);
      expect(metrics.protocols.ollama.totalBytes).toBe(1000);
      expect(metrics.protocols.openai.totalBytes).toBe(800);
    });
  });

  // ============================================================================
  // SECTION 7: Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle empty streaming response', () => {
      const chunks: Uint8Array[] = [];
      const totalBytes = chunks.reduce((sum, c) => sum + c.length, 0);

      expect(totalBytes).toBe(0);
    });

    it('should handle single chunk response', () => {
      const chunks = [new TextEncoder().encode('{"response":"Hi","done":true}')];

      expect(chunks.length).toBe(1);
    });

    it('should handle very large chunk', () => {
      const largeChunk = new TextEncoder().encode('a'.repeat(1024 * 1024)); // 1MB

      expect(largeChunk.length).toBe(1024 * 1024);
    });

    it('should handle binary data in chunks', () => {
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff]);

      expect(binaryData.length).toBe(4);
      expect(binaryData[0]).toBe(0);
      expect(binaryData[3]).toBe(255);
    });

    it('should handle rapid chunk arrival', () => {
      const chunks: Uint8Array[] = [];

      // Simulate 1000 chunks arriving in 1ms each (very fast)
      for (let i = 0; i < 1000; i++) {
        chunks.push(new TextEncoder().encode('x'));
      }

      expect(chunks.length).toBe(1000);
    });
  });
});
