import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnifiedMetricsRecorder, type MetricsRecorder } from '../../src/metrics/unified-recorder';
import type { RequestContext } from '../../src/orchestrator.types';

vi.mock('../../src/config/feature-flags.js', () => ({
  featureFlags: {
    get: vi.fn().mockReturnValue(true),
  },
}));

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

    it('should handle recorder errors and continue', async () => {
      const errorRecorder: MetricsRecorder = {
        name: 'error-recorder',
        record: () => {
          throw new Error('Recorder failed');
        },
      };
      recorder.register(errorRecorder);

      const context = { id: 'test-req' } as RequestContext;
      await recorder.record(context);
    });

    it('should call onError callback when errors occur', async () => {
      const onError = vi.fn();
      const errorRecorder = new UnifiedMetricsRecorder({ onError, continueOnError: true });

      errorRecorder.register({
        name: 'failing',
        record: () => {
          throw new Error('Test error');
        },
      });

      await errorRecorder.record({ id: 'test' } as RequestContext);
      expect(onError).toHaveBeenCalled();
    });

    it('should throw when continueOnError is false', async () => {
      const errorRecorder = new UnifiedMetricsRecorder({ continueOnError: false });

      errorRecorder.register({
        name: 'failing',
        record: () => {
          throw new Error('Test error');
        },
      });

      await expect(errorRecorder.record({ id: 'test' } as RequestContext)).rejects.toThrow();
    });

    it('should handle async recorder when awaitAsync is true', async () => {
      const asyncRecorder = new UnifiedMetricsRecorder({ awaitAsync: true });

      const asyncErrorRecorder: MetricsRecorder = {
        name: 'async-error',
        record: async () => {
          throw new Error('Async error');
        },
      };
      asyncRecorder.register(asyncErrorRecorder);

      const context = { id: 'test-async' } as RequestContext;
      await asyncRecorder.record(context);
    });

    it('should return recorder names', () => {
      recorder.register({ name: 'rec1', record: () => {} });
      recorder.register({ name: 'rec2', record: () => {} });

      expect(recorder.getRecorderNames()).toEqual(['rec1', 'rec2']);
    });

    it('should check if recorder exists', () => {
      recorder.register({ name: 'test-rec', record: () => {} });

      expect(recorder.hasRecorder('test-rec')).toBe(true);
      expect(recorder.hasRecorder('non-existent')).toBe(false);
    });
  });

  describe('createRecorder', () => {
    it('should create a recorder wrapper', () => {
      const fn = vi.fn();
      const recorder = {
        name: 'wrapped',
        record: fn,
      };

      expect(recorder.name).toBe('wrapped');
      recorder.record({} as RequestContext);
      expect(fn).toHaveBeenCalled();
    });
  });
});
