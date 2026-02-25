import { describe, it, expect } from 'vitest';
import { TTFTTracker } from '../../src/metrics/ttft-tracker.js';

describe('TTFTTracker', () => {
  describe('constructor', () => {
    it('should create tracker with default options', () => {
      const tracker = new TTFTTracker();
      expect(tracker).toBeDefined();
    });

    it('should accept custom options', () => {
      const tracker = new TTFTTracker({
        serverId: 'server-1',
        model: 'llama3:latest',
        requestId: 'req-123',
        trackFirstChunk: true,
        trackFirstContent: true,
        trackFirstToken: false,
      });
      expect(tracker).toBeDefined();
    });

    it('should accept trackFirstToken option', () => {
      const tracker = new TTFTTracker({
        trackFirstToken: true,
      });
      expect(tracker).toBeDefined();
    });
  });

  describe('markFirstChunk', () => {
    it('should increment chunk count on first call', () => {
      const tracker = new TTFTTracker();

      tracker.markFirstChunk(100);

      const metrics = tracker.getMetrics();
      expect(metrics.chunkCount).toBe(1);
      expect(metrics.timeToFirstChunk).toBeDefined();
      expect(metrics.hasContent).toBe(false);
    });

    it('should only track first chunk time once', () => {
      const tracker = new TTFTTracker();

      tracker.markFirstChunk(100);
      const firstChunkTime = tracker.getMetrics().timeToFirstChunk;

      tracker.markFirstChunk(100);
      const secondChunkTime = tracker.getMetrics().timeToFirstChunk;

      expect(firstChunkTime).toBe(secondChunkTime);
    });

    it('should increment chunk count on multiple calls', () => {
      const tracker = new TTFTTracker();

      tracker.markFirstChunk(100);
      tracker.incrementChunk();
      tracker.incrementChunk();

      const metrics = tracker.getMetrics();
      expect(metrics.chunkCount).toBe(3);
    });

    it('should not track first chunk when disabled', () => {
      const tracker = new TTFTTracker({ trackFirstChunk: false });

      tracker.markFirstChunk(100);

      const metrics = tracker.getMetrics();
      expect(metrics.timeToFirstChunk).toBeUndefined();
      expect(metrics.chunkCount).toBe(1);
    });
  });

  describe('markFirstContent', () => {
    it('should track first content and increment chunk count', () => {
      const tracker = new TTFTTracker();

      tracker.markFirstContent();

      const metrics = tracker.getMetrics();
      expect(metrics.timeToFirstContent).toBeDefined();
      expect(metrics.hasContent).toBe(true);
      expect(metrics.chunkCount).toBe(1);
    });

    it('should only track first content once', () => {
      const tracker = new TTFTTracker();

      tracker.markFirstContent();
      const firstContentTime = tracker.getMetrics().timeToFirstContent;

      tracker.markFirstContent();
      const secondContentTime = tracker.getMetrics().timeToFirstContent;

      expect(firstContentTime).toBe(secondContentTime);
    });

    it('should accept content preview', () => {
      const tracker = new TTFTTracker();

      tracker.markFirstContent('Hello world');

      const metrics = tracker.getMetrics();
      expect(metrics.hasContent).toBe(true);
    });

    it('should not track first content when disabled', () => {
      const tracker = new TTFTTracker({ trackFirstContent: false });

      tracker.markFirstContent();

      const metrics = tracker.getMetrics();
      expect(metrics.timeToFirstContent).toBeUndefined();
      expect(metrics.hasContent).toBe(false);
      expect(metrics.chunkCount).toBe(1);
    });

    it('should increment chunk count even when tracking disabled', () => {
      const tracker = new TTFTTracker({ trackFirstContent: false });

      tracker.markFirstContent();
      tracker.markFirstContent();

      const metrics = tracker.getMetrics();
      expect(metrics.chunkCount).toBe(2);
    });
  });

  describe('markFirstToken', () => {
    it('should track first token time when enabled', () => {
      const tracker = new TTFTTracker({ trackFirstToken: true });

      tracker.markFirstToken('token123');

      const metrics = tracker.getMetrics();
      expect(metrics.timeToFirstToken).toBeGreaterThanOrEqual(0);
    });

    it('should not track first token when disabled by default', () => {
      const tracker = new TTFTTracker();

      tracker.markFirstToken('token123');

      const metrics = tracker.getMetrics();
      expect(metrics.timeToFirstToken).toBeUndefined();
    });

    it('should only track first token once', () => {
      const tracker = new TTFTTracker({ trackFirstToken: true });

      tracker.markFirstToken('token1');
      const firstTokenTime = tracker.getMetrics().timeToFirstToken;

      tracker.markFirstToken('token2');
      const secondTokenTime = tracker.getMetrics().timeToFirstToken;

      expect(firstTokenTime).toBe(secondTokenTime);
    });

    it('should accept token preview', () => {
      const tracker = new TTFTTracker({ trackFirstToken: true });

      tracker.markFirstToken('token123');

      const metrics = tracker.getMetrics();
      expect(metrics.timeToFirstToken).toBeGreaterThanOrEqual(0);
    });

    it('should not increment chunk count for token', () => {
      const tracker = new TTFTTracker({ trackFirstToken: true });

      tracker.markFirstToken('token');

      const metrics = tracker.getMetrics();
      expect(metrics.chunkCount).toBe(0);
    });
  });

  describe('incrementChunk', () => {
    it('should increment chunk count', () => {
      const tracker = new TTFTTracker();

      tracker.incrementChunk();
      tracker.incrementChunk();
      tracker.incrementChunk();

      const metrics = tracker.getMetrics();
      expect(metrics.chunkCount).toBe(3);
    });

    it('should work without marking first chunk', () => {
      const tracker = new TTFTTracker();

      tracker.incrementChunk();
      tracker.incrementChunk();

      const metrics = tracker.getMetrics();
      expect(metrics.chunkCount).toBe(2);
      expect(metrics.timeToFirstChunk).toBeUndefined();
    });
  });

  describe('getMetrics', () => {
    it('should return metrics object with all properties', () => {
      const tracker = new TTFTTracker();

      tracker.markFirstChunk(100);

      const metrics = tracker.getMetrics();
      expect(metrics).toHaveProperty('timeToFirstChunk');
      expect(metrics).toHaveProperty('timeToFirstContent');
      expect(metrics).toHaveProperty('timeToFirstToken');
      expect(metrics).toHaveProperty('ttft');
      expect(metrics).toHaveProperty('hasContent');
      expect(metrics).toHaveProperty('chunkCount');
    });

    it('should use timeToFirstContent for ttft when available', () => {
      const tracker = new TTFTTracker();

      tracker.markFirstContent();

      const metrics = tracker.getMetrics();
      expect(metrics.ttft).toBeDefined();
      expect(metrics.ttft).toBe(metrics.timeToFirstContent);
    });

    it('should fall back to timeToFirstChunk for ttft when no content', () => {
      const tracker = new TTFTTracker();

      tracker.markFirstChunk(50);

      const metrics = tracker.getMetrics();
      expect(metrics.ttft).toBeDefined();
      expect(metrics.ttft).toBe(metrics.timeToFirstChunk);
    });

    it('should prefer content over chunk for ttft when both available', () => {
      const tracker = new TTFTTracker();

      tracker.markFirstChunk(50);
      tracker.markFirstContent('Hello');

      const metrics = tracker.getMetrics();
      expect(metrics.ttft).toBe(metrics.timeToFirstContent);
    });

    it('should return undefined ttft when no data', () => {
      const tracker = new TTFTTracker();

      const metrics = tracker.getMetrics();
      expect(metrics.ttft).toBeUndefined();
      expect(metrics.timeToFirstChunk).toBeUndefined();
      expect(metrics.timeToFirstContent).toBeUndefined();
      expect(metrics.hasContent).toBe(false);
      expect(metrics.chunkCount).toBe(0);
    });
  });

  describe('getCurrentElapsed', () => {
    it('should return elapsed time', () => {
      const tracker = new TTFTTracker();
      const elapsed = tracker.getCurrentElapsed();
      expect(elapsed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('TTFT option combinations', () => {
    it('should handle all tracking disabled', () => {
      const tracker = new TTFTTracker({
        trackFirstChunk: false,
        trackFirstContent: false,
        trackFirstToken: false,
      });

      tracker.markFirstChunk(100);
      tracker.markFirstContent('test');
      tracker.markFirstToken('token');

      const metrics = tracker.getMetrics();
      expect(metrics.timeToFirstChunk).toBeUndefined();
      expect(metrics.timeToFirstContent).toBeUndefined();
      expect(metrics.timeToFirstToken).toBeUndefined();
      expect(metrics.chunkCount).toBe(2);
    });
  });

  describe('chunkCount edge cases', () => {
    it('should handle rapid successive chunks', () => {
      const tracker = new TTFTTracker();

      for (let i = 0; i < 100; i++) {
        tracker.incrementChunk();
      }

      const metrics = tracker.getMetrics();
      expect(metrics.chunkCount).toBe(100);
    });

    it('should handle markFirstChunk and incrementChunk together', () => {
      const tracker = new TTFTTracker();

      tracker.markFirstChunk(50);
      tracker.incrementChunk();
      tracker.incrementChunk();

      const metrics = tracker.getMetrics();
      expect(metrics.chunkCount).toBe(3);
    });

    it('should handle multiple markFirstContent calls', () => {
      const tracker = new TTFTTracker();

      tracker.markFirstContent('first');
      tracker.markFirstContent('second');

      const metrics = tracker.getMetrics();
      expect(metrics.chunkCount).toBe(2);
    });

    it('should correctly track chunk count across different methods', () => {
      const tracker = new TTFTTracker();

      tracker.markFirstChunk(50);
      tracker.markFirstContent('hello');
      tracker.incrementChunk();
      tracker.incrementChunk();

      const metrics = tracker.getMetrics();
      expect(metrics.chunkCount).toBe(4);
    });
  });
});
