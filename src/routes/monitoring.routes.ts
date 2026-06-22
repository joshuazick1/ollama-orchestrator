/**
 * monitoring.routes.ts
 * Monitoring endpoints – more permissive rate limiting.
 * Covers server status, metrics, analytics, and circuit-breaker read endpoints.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';

import {
  getTopModels,
  getServerPerformance,
  getErrorAnalysis,
  getCapacityAnalysis,
  getTrendAnalysis,
  getAnalyticsSummary,
  getDecisionHistory,
  getServerModelDecisionTrend,
  getSelectionStats,
  getAlgorithmStats,
  getScoreTimeline,
  getMetricsImpact,
  getServerRequestHistory,
  getServerRequestStats,
  getRequestTimeline,
  searchRequests,
  getServersWithHistory,
  getSummarySnapshots,
  getHourlyRollups,
  getDailyRollups,
  browseRequests,
  getTemporalProfile,
  getTemporalAdjustment,
  getCircuitBreakerAnalytics,
} from '../controllers/analytics-controller.js';
import {
  getErrors,
  getServerErrors,
  getCircuitErrors,
} from '../controllers/error-events-controller.js';
import {
  getMetrics,
  getServerModelMetrics,
  getPrometheusMetrics,
  getRecoveryTestMetrics,
  getBreakerRecoveryMetrics,
  getInFlight,
  streamMetrics,
} from '../controllers/metrics-controller.js';
import {
  getAllModelsStatus,
  getWarmupRecommendations,
  getIdleModels,
  getModelStatus,
} from '../controllers/model-controller.js';
import {
  getPerfProbeStatus,
  cancelPerfProbe,
  runPerfProbe,
  getPerfProbeHistory,
} from '../controllers/perf-probe-controller.js';
import { getFleetModelStats } from '../controllers/server-models-controller.js';
import {
  getServers,
  getModelMap,
  getModels,
  getHealth,
  healthCheck,
  getStats,
  getCircuitBreakers,
  getCircuitBreakerDetails,
} from '../controllers/servers-controller.js';
import { requireAuth } from '../middleware/auth.js';
import { createMonitoringRateLimiter } from '../middleware/rate-limiter.js';
import { getOrchestratorInstance } from '../orchestrator/orchestrator-instance.js';

// Async handler wrapper
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => void | Promise<void>) =>
  (req: any, res: any, next: any) => {
    void Promise.resolve(fn(req as Request, res as Response, next as NextFunction)).catch(
      next as (err: unknown) => void
    );
  };

const monitoringRateLimit = createMonitoringRateLimiter();

export const monitoringRouter = Router();

// Basic monitoring endpoints
monitoringRouter.use(monitoringRateLimit);
monitoringRouter.get('/servers', requireAuth(), getServers);
monitoringRouter.get('/model-map', requireAuth(), getModelMap);
monitoringRouter.get('/models', requireAuth(), getModels);
monitoringRouter.get('/health', getHealth);
monitoringRouter.post('/health-check', requireAuth(), asyncHandler(healthCheck));
monitoringRouter.get('/stats', getStats);
monitoringRouter.get('/events', requireAuth(), streamMetrics);
monitoringRouter.get('/circuit-breakers', requireAuth(), getCircuitBreakers);

// Metrics
monitoringRouter.get('/metrics', requireAuth(), getMetrics);
monitoringRouter.get('/metrics/prometheus', requireAuth(), getPrometheusMetrics);
// Model names can contain slashes. Support both encoded param and wildcard tail.
monitoringRouter.get('/metrics/:serverId/*', requireAuth(), getServerModelMetrics);
monitoringRouter.get('/metrics/:serverId/:model', requireAuth(), getServerModelMetrics);

// In-flight requests
monitoringRouter.get('/in-flight', requireAuth(), getInFlight);

// Recovery Test Metrics
monitoringRouter.get('/metrics/recovery-tests', requireAuth(), getRecoveryTestMetrics);
monitoringRouter.get(
  '/metrics/recovery-tests/:breakerName',
  requireAuth(),
  getBreakerRecoveryMetrics
);

// Model monitoring
monitoringRouter.get('/models/status', requireAuth(), getAllModelsStatus);
monitoringRouter.get('/models/recommendations', requireAuth(), getWarmupRecommendations);
monitoringRouter.get('/models/idle', requireAuth(), getIdleModels);
monitoringRouter.get('/models/:model/status', requireAuth(), getModelStatus);

// Fleet model stats
monitoringRouter.get('/models/fleet-stats', requireAuth(), getFleetModelStats);

// Analytics
monitoringRouter.get('/analytics/top-models', requireAuth(), getTopModels);
monitoringRouter.get('/analytics/server-performance', requireAuth(), getServerPerformance);
monitoringRouter.get('/analytics/errors', requireAuth(), getErrorAnalysis);
monitoringRouter.get('/analytics/capacity', requireAuth(), getCapacityAnalysis);
monitoringRouter.get('/analytics/trends/:metric', requireAuth(), getTrendAnalysis);
monitoringRouter.get('/analytics/summary', requireAuth(), getAnalyticsSummary);
monitoringRouter.get('/analytics/circuit-breakers', requireAuth(), getCircuitBreakerAnalytics);

// Decision History
monitoringRouter.get('/analytics/decisions', requireAuth(), getDecisionHistory);
monitoringRouter.get(
  '/analytics/decisions/trends/:serverId/:model',
  requireAuth(),
  getServerModelDecisionTrend
);
monitoringRouter.get('/analytics/selection-stats', requireAuth(), getSelectionStats);
monitoringRouter.get('/analytics/algorithms', requireAuth(), getAlgorithmStats);
monitoringRouter.get('/analytics/score-timeline', requireAuth(), getScoreTimeline);
monitoringRouter.get('/analytics/metrics-impact', requireAuth(), getMetricsImpact);

// Request History
monitoringRouter.get('/analytics/servers-with-history', requireAuth(), getServersWithHistory);
monitoringRouter.get('/analytics/summary-snapshots', requireAuth(), getSummarySnapshots);
// Note: /requests/search must be registered before /requests/:serverId to avoid route conflict
monitoringRouter.get('/analytics/requests/search', requireAuth(), searchRequests);
monitoringRouter.get('/analytics/requests/:serverId', requireAuth(), getServerRequestHistory);
monitoringRouter.get('/analytics/request-stats/:serverId', requireAuth(), getServerRequestStats);
monitoringRouter.get('/analytics/request-timeline', requireAuth(), getRequestTimeline);

// Phase 2: SQLite rollup and request browser endpoints
monitoringRouter.get('/analytics/rollups/hourly', requireAuth(), getHourlyRollups);
monitoringRouter.get('/analytics/rollups/daily', requireAuth(), getDailyRollups);
monitoringRouter.get('/analytics/requests/browse', requireAuth(), browseRequests);

// Phase 3: Temporal scoring endpoints
monitoringRouter.get('/analytics/temporal-profile', requireAuth(), getTemporalProfile);
monitoringRouter.get('/analytics/temporal-adjustment', requireAuth(), getTemporalAdjustment);

// Get detailed circuit breaker info for a server:model (monitoring)
monitoringRouter.get(
  '/servers/:serverId/models/:model/circuit-breaker',
  requireAuth(),
  getCircuitBreakerDetails
);

monitoringRouter.get('/errors', requireAuth(), getErrors);
monitoringRouter.get('/errors/:serverId', requireAuth(), getServerErrors);
monitoringRouter.get('/errors/:serverId/:circuitId', requireAuth(), getCircuitErrors);

monitoringRouter.get(
  '/cluster-status',
  requireAuth(),
  asyncHandler((req: Request, res: Response) => {
    const orchestrator = getOrchestratorInstance();
    const stats = orchestrator.getStats();
    const servers = orchestrator.getServers();
    const circuitBreakerStates = stats.circuitBreakersByState || {};
    const totalCb =
      (circuitBreakerStates.UNHEALTHY || 0) +
      (circuitBreakerStates.HEALTHY || 0) +
      (circuitBreakerStates.RECOVERING || 0) +
      (circuitBreakerStates.SUSPECT || 0);
    const errorRate = totalCb > 0 ? (circuitBreakerStates.UNHEALTHY || 0) / totalCb : 0;
    res.json({
      status: 'ok',
      data: {
        totalServers: stats.totalServers,
        healthyServers: stats.healthyServers,
        degradedServers:
          (circuitBreakerStates.RECOVERING || 0) + (circuitBreakerStates.SUSPECT || 0),
        downServers: circuitBreakerStates.UNHEALTHY || 0,
        averageResponseTime: 0,
        totalInFlight: stats.inFlightRequests,
        errorRate,
        servers: servers.map(s => ({
          serverId: s.id,
          status: s.healthy ? 'healthy' : 'down',
          lastHealthCheck: 0,
          responseTime: 0,
          inFlight: 0,
          errorRate: 0,
        })),
      },
    });
  })
);

// Performance probe routes (async two-phase: POST starts task, GET status, DELETE cancel)
monitoringRouter.post('/performance-probe', requireAuth(), asyncHandler(runPerfProbe));
monitoringRouter.get(
  '/performance-probe/history',
  requireAuth(),
  asyncHandler(getPerfProbeHistory)
);
monitoringRouter.get('/performance-probe/:taskId', requireAuth(), asyncHandler(getPerfProbeStatus));
monitoringRouter.delete('/performance-probe/:taskId', requireAuth(), asyncHandler(cancelPerfProbe));
