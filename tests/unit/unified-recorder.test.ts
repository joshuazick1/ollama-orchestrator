import { describe, it, expect, beforeEach } from 'vitest';
import { UnifiedMetricsRecorder, type MetricsRecorder } from '../../src/metrics/unified-recorder';
import type { RequestContext } from '../../src/orchestrator.types';

describe('UnifiedMetricsRecorder', () => {
  let recorder: UnifiedMetricsRecorder;

  beforeEach(() => {
    recorder = new UnifiedMetricsRecorder();
  });

  describe('constructor', () => {
    it('should create recorder', () => {
      expect(recorder).toBeDefined();
    });

    it('should accept options', () => {
      const custom = new UnifiedMetricsRecorder({
        continueOnError: false,
        awaitAsync: true,
      });
      expect(custom).toBeDefined();
    });
  });

  describe('register', () => {
    it('should register a metrics recorder', () => {
      const mockRecorder: MetricsRecorder = {
        name: 'test-recorder',
        record: () => {},
      };
      recorder.register(mockRecorder);
    });
  });

  describe('unregister', () => {
    it('should unregister a recorder by name', () => {
      const mockRecorder: MetricsRecorder = {
        name: 'test-recorder',
        record: () => {},
      };
      recorder.register(mockRecorder);
      recorder.unregister('test-recorder');
    });
  });

  describe('record', () => {
    it('should call all registered recorders', async () => {
      const mockRecorder1: MetricsRecorder = {
        name: 'recorder-1',
        record: () => {},
      };
      const mockRecorder2: MetricsRecorder = {
        name: 'recorder-2',
        record: () => {},
      };

      recorder.register(mockRecorder1);
      recorder.register(mockRecorder2);

      const context = {} as RequestContext;
      await recorder.record(context);
    });

    it('should handle async recorders', async () => {
      const mockRecorder: MetricsRecorder = {
        name: 'async-recorder',
        record: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
        },
      };

      recorder.register(mockRecorder);

      const context = {} as RequestContext;
      await recorder.record(context);
    });
  });
});
