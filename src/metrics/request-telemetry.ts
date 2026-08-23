/**
 * request-telemetry.ts
 * Single normalized request-completion boundary (Task 2 of orchestrator-runtime-data-cohesion).
 *
 * Replaces the manual `metricsAggregator.recordRequest(...) +
 * getRequestHistory().recordRequest(...) + getMetricsStore().recordRequest(...)`
 * triplet that previously appeared at every completion site (probe feeder,
 * `tryRequestOnServerNoRetry`, `tryRequestOnServerWithRetries`, and the
 * `AIOrchestrator.requestToServer` direct-server path).
 *
 * Design contract (per plan):
 *   - Thin dispatcher; never a state owner and never a persistence layer.
 *   - Accepts one immutable `RequestContext` plus extracted outcome metadata.
 *   - Invokes the existing `MetricsAggregators`, `RequestHistory`, `MetricsStore`,
 *     and `AnalyticsEngine` through injected interfaces.
 *   - Sync, single try/catch per sink, hot-path friendly.
 *   - Optional `decisionId` is propagated through every sink (Task 6 consumes
 *     it for direct decision-to-outcome correlation).
 *   - The optional `recordError` method is the boundary for structured error
 *     event ingestion (fully wired in Task 4 — analytics/error projection).
 */

import type { RequestContext } from '../orchestrator/orchestrator.types.js';
import { logger } from '../utils/logger.js';

/**
 * Sink accessors. Each callback returns the same sink instance every call so
 * the boundary is stateless; tests inject vi.fn() doubles via these.
 *
 * `getAnalyticsEngine` is optional so the boundary remains constructible when
 * the optional sink is unavailable (legacy tests or probe paths that pre-date
 * analytics ingestion wiring).
 */
export interface RequestTelemetryDeps {
  /** In-process sliding-window metrics aggregator (`MetricsAggregator`). */
  metricsAggregators: { recordRequest: (ctx: RequestContext) => unknown };
  /** Request history store (`RequestHistory`). */
  getRequestHistory: () => {
    recordRequest: (ctx: RequestContext, queueWaitTime?: number) => unknown;
  };
  /** Long-term SQLite metrics store (`MetricsStore`). */
  getMetricsStore: () => {
    recordRequest: (ctx: RequestContext, opts?: unknown) => unknown;
  };
  /** Analytics engine ingestion path. Optional so the boundary is constructible
   *  in tests that have not yet wired analytics. */
  getAnalyticsEngine?: () => { recordRequest: (ctx: RequestContext) => unknown };
}

/**
 * Optional structured-error sink accessor. Captured for Task 4 wiring; not
 * yet invoked by `recordRequest`. Exposed here so the boundary's five-sink
 * contract is documented and the production constructor can wire it without
 * another schema change later.
 */
export interface RequestTelemetryErrorDeps {
  /** Structured error store (`ErrorEventStore`). Optional. */
  getErrorEventStore?: () => { recordError: (event: unknown) => Promise<unknown> };
}

export class RequestTelemetry {
  private readonly deps: RequestTelemetryDeps;
  private readonly errorDeps: RequestTelemetryErrorDeps;

  constructor(deps: RequestTelemetryDeps, errorDeps: RequestTelemetryErrorDeps = {}) {
    this.deps = deps;
    this.errorDeps = errorDeps;
  }

  /**
   * Dispatch a completed `RequestContext` to all sinks exactly once.
   *
   * Each sink is invoked in its own try/catch so a single failure never
   * starves the other sinks. Failures are logged at warn level. The boundary
   * never throws — telemetry is best-effort and must never break a user
   * request.
   */
  recordRequest(context: RequestContext): void {
    const queueWaitTime = context.queueWaitTime;

    try {
      this.deps.metricsAggregators.recordRequest(context);
    } catch (err) {
      logger.warn('[RequestTelemetry] metricsAggregators.recordRequest failed', {
        serverId: context.serverId,
        model: context.model,
        err: formatError(err),
      });
    }

    try {
      this.deps.getRequestHistory().recordRequest(context, queueWaitTime);
    } catch (err) {
      logger.warn('[RequestTelemetry] getRequestHistory().recordRequest failed', {
        serverId: context.serverId,
        model: context.model,
        err: formatError(err),
      });
    }

    try {
      const storeOpts = context.isProbe ? { isProbe: true } : undefined;
      this.deps.getMetricsStore().recordRequest(context, storeOpts);
    } catch (err) {
      logger.warn('[RequestTelemetry] getMetricsStore().recordRequest failed', {
        serverId: context.serverId,
        model: context.model,
        err: formatError(err),
      });
    }

    if (this.deps.getAnalyticsEngine) {
      try {
        this.deps.getAnalyticsEngine().recordRequest(context);
      } catch (err) {
        logger.warn('[RequestTelemetry] getAnalyticsEngine().recordRequest failed', {
          serverId: context.serverId,
          model: context.model,
          err: formatError(err),
        });
      }
    }
  }

  /**
   * Optional structured-error sink. Wired in Task 4. Kept here so the boundary
   * exposes the full five-sink contract and so production code can begin
   * constructing it without a schema change later.
   */
  recordError(context: RequestContext): void {
    if (!this.errorDeps.getErrorEventStore) {
      return;
    }
    if (context.success !== false || !context.error) {
      return;
    }
    if (context.isProbe) {
      return;
    }
    const event = {
      id: `${context.id}-err`,
      timestamp: context.endTime ?? Date.now(),
      serverId: context.serverId,
      model: context.model,
      errorMessage: context.error.message,
      decisionId: context.decisionId,
      parentRequestId: context.parentRequestId,
      isRetry: context.isRetry,
    };
    try {
      void this.errorDeps
        .getErrorEventStore()
        .recordError(event)
        .catch(err => {
          logger.warn('[RequestTelemetry] getErrorEventStore().recordError failed', {
            serverId: context.serverId,
            model: context.model,
            err: formatError(err),
          });
        });
    } catch (err) {
      logger.warn('[RequestTelemetry] getErrorEventStore().recordError sync setup failed', {
        serverId: context.serverId,
        model: context.model,
        err: formatError(err),
      });
    }
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
