/**
 * unified-recorder.ts
 * Unified metrics recording system
 * Ensures all metrics stores receive consistent data
 * Provides error isolation - one recorder failing doesn't break others
 */

import type { RequestContext } from '../orchestrator.types.js';
import { logger } from '../utils/logger.js';
import { featureFlags } from '../config/feature-flags.js';

export interface MetricsRecorder {
  name: string;
  record(context: RequestContext): void | Promise<void>;
}

export interface UnifiedRecorderOptions {
  /** Handler for recorder errors */
  onError?: (error: Error, recorderName: string, context: RequestContext) => void;
  /** Whether to continue on error or throw */
  continueOnError?: boolean;
  /** Whether to await async recorders */
  awaitAsync?: boolean;
}

export class UnifiedMetricsRecorder {
  private recorders: MetricsRecorder[] = [];
  private options: Required<Pick<UnifiedRecorderOptions, 'continueOnError' | 'awaitAsync'>> &
    Pick<UnifiedRecorderOptions, 'onError'>;
  private enabled: boolean;

  constructor(options: UnifiedRecorderOptions = {}) {
    this.enabled = featureFlags.get('useUnifiedRecorder');
    this.options = {
      continueOnError: options.continueOnError ?? true,
      awaitAsync: options.awaitAsync ?? false,
      onError: options.onError,
    };
  }

  /**
   * Register a metrics recorder
   */
  register(recorder: MetricsRecorder): void {
    this.recorders.push(recorder);
    logger.debug(`Registered metrics recorder: ${recorder.name}`);
  }

  /**
   * Unregister a recorder by name
   */
  unregister(name: string): boolean {
    const index = this.recorders.findIndex(r => r.name === name);
    if (index >= 0) {
      this.recorders.splice(index, 1);
      logger.debug(`Unregistered metrics recorder: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * Record a request to all registered recorders
   */
  async record(context: RequestContext): Promise<void> {
    // If feature flag is disabled, do nothing
    if (!this.enabled) {
      return;
    }

    const errors: Array<{ recorder: string; error: Error }> = [];
    const promises: Promise<void>[] = [];

    for (const recorder of this.recorders) {
      try {
        const result = recorder.record(context);

        // Handle async recorders
        if (result instanceof Promise && this.options.awaitAsync) {
          promises.push(
            result.catch(error => {
              errors.push({ recorder: recorder.name, error: error as Error });
            })
          );
        }
      } catch (error) {
        errors.push({ recorder: recorder.name, error: error as Error });
      }
    }

    // Wait for async recorders if configured
    if (promises.length > 0) {
      await Promise.all(promises);
    }

    // Handle errors
    if (errors.length > 0) {
      const errorMessage = errors.map(e => `${e.recorder}: ${e.error.message}`).join('; ');
      const aggregateError = new Error(`Metrics recording errors: ${errorMessage}`);

      logger.error('Some metrics recorders failed', {
        requestId: context.id,
        errors: errors.map(e => ({ recorder: e.recorder, error: e.error.message })),
      });

      if (this.options.onError) {
        this.options.onError(aggregateError, 'UnifiedRecorder', context);
      }

      if (!this.options.continueOnError) {
        throw aggregateError;
      }
    }
  }

  /**
   * Get registered recorder names
   */
  getRecorderNames(): string[] {
    return this.recorders.map(r => r.name);
  }

  /**
   * Check if a recorder is registered
   */
  hasRecorder(name: string): boolean {
    return this.recorders.some(r => r.name === name);
  }

  /**
   * Check if unified recording is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

/**
 * Create recorder wrapper for existing functions
 */
export function createRecorder(
  name: string,
  fn: (context: RequestContext) => void | Promise<void>
): MetricsRecorder {
  return { name, record: fn };
}
