import { describe, it, expect } from 'vitest';
import { TTFTTracker } from '../../src/metrics/ttft-tracker';

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
  });

  describe('markFirstChunk', () => {
    it('should track first chunk time', () => {
      const tracker = new TTFTTracker();

      tracker.markFirstChunk(100);

      const metrics = tracker.getMetrics();
      expect(metrics.chunkCount).toBe(1);
      expect(metrics.timeToFirstChunk).toBeDefined();
      expect(metrics.hasContent).toBe(false);
    });

    it('should increment chunk count on multiple calls', () => {
      const tracker = new TTFTTracker();

      tracker.markFirstChunk(100);
      tracker.incrementChunk();
      tracker.incrementChunk();

      const metrics = tracker.getMetrics();
      expect(metrics.chunkCount).toBe(3);
    });
  });

  describe('markFirstContent', () => {
    it('should track first content time', () => {
      const tracker = new TTFTTracker();

      tracker.markFirstContent();

      const metrics = tracker.getMetrics();
      expect(metrics.timeToFirstContent).toBeDefined();
      expect(metrics.hasContent).toBe(true);
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
  });

  describe('getMetrics', () => {
    it('should return metrics object', () => {
      const tracker = new TTFTTracker();

      tracker.markFirstChunk(100);

      const metrics = tracker.getMetrics();
      expect(metrics).toHaveProperty('timeToFirstChunk');
      expect(metrics).toHaveProperty('hasContent');
      expect(metrics).toHaveProperty('chunkCount');
      expect(metrics).toHaveProperty('ttft');
    });

    it('should use timeToFirstContent for ttft when available', () => {
      const tracker = new TTFTTracker();

      tracker.markFirstContent();

      const metrics = tracker.getMetrics();
      expect(metrics.ttft).toBeDefined();
      expect(metrics.ttft).toBe(metrics.timeToFirstContent);
    });

    it('should fall back to timeToFirstChunk for ttft', () => {
      const tracker = new TTFTTracker();

      tracker.markFirstChunk(100);

      const metrics = tracker.getMetrics();
      expect(metrics.ttft).toBeDefined();
      expect(metrics.ttft).toBe(metrics.timeToFirstChunk);
    });

    it('should return undefined ttft when no data', () => {
      const tracker = new TTFTTracker();

      const metrics = tracker.getMetrics();
      expect(metrics.ttft).toBeUndefined();
    });
  });
});
