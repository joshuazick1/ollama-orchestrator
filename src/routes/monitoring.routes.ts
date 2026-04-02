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
} from '../controllers/analytics-controller.js';
import {
  getMetrics,
  getServerModelMetrics,
  getPrometheusMetrics,
  getRecoveryTestMetrics,
  getBreakerRecoveryMetrics,
  getInFlight,
} from '../controllers/metrics-controller.js';
import {
  getAllModelsStatus,
  getWarmupRecommendations,
  getIdleModels,
  getModelStatus,
} from '../controllers/model-controller.js';
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

// Async handler wrapper
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => void | Promise<void>) =>
  (req: any, res: any, next: any) => {
    void Promise.resolve(fn(req as Request, res as Response, next as NextFunction)).catch(
      next as (err: unknown) => void
    );
  };

export const monitoringRouter = Router();

// Basic monitoring endpoints
monitoringRouter.get('/servers', getServers);
monitoringRouter.get('/model-map', getModelMap);
monitoringRouter.get('/models', getModels);
monitoringRouter.get('/health', getHealth);
monitoringRouter.post('/health-check', asyncHandler(healthCheck));
monitoringRouter.get('/stats', getStats);
monitoringRouter.get('/circuit-breakers', getCircuitBreakers);

// Metrics
monitoringRouter.get('/metrics', getMetrics);
monitoringRouter.get('/metrics/prometheus', getPrometheusMetrics);
// Model names can contain slashes. Support both encoded param and wildcard tail.
monitoringRouter.get('/metrics/:serverId/*', getServerModelMetrics);
monitoringRouter.get('/metrics/:serverId/:model', getServerModelMetrics);

// In-flight requests
monitoringRouter.get('/in-flight', getInFlight);

// Recovery Test Metrics
monitoringRouter.get('/metrics/recovery-tests', getRecoveryTestMetrics);
monitoringRouter.get('/metrics/recovery-tests/:breakerName', getBreakerRecoveryMetrics);

// Model monitoring
monitoringRouter.get('/models/status', getAllModelsStatus);
monitoringRouter.get('/models/recommendations', getWarmupRecommendations);
monitoringRouter.get('/models/idle', getIdleModels);
monitoringRouter.get('/models/:model/status', getModelStatus);

// Fleet model stats
monitoringRouter.get('/models/fleet-stats', getFleetModelStats);

// Analytics
monitoringRouter.get('/analytics/top-models', getTopModels);
monitoringRouter.get('/analytics/server-performance', getServerPerformance);
monitoringRouter.get('/analytics/errors', getErrorAnalysis);
monitoringRouter.get('/analytics/capacity', getCapacityAnalysis);
monitoringRouter.get('/analytics/trends/:metric', getTrendAnalysis);
monitoringRouter.get('/analytics/summary', getAnalyticsSummary);

// Decision History
monitoringRouter.get('/analytics/decisions', getDecisionHistory);
monitoringRouter.get('/analytics/decisions/trends/:serverId/:model', getServerModelDecisionTrend);
monitoringRouter.get('/analytics/selection-stats', getSelectionStats);
monitoringRouter.get('/analytics/algorithms', getAlgorithmStats);
monitoringRouter.get('/analytics/score-timeline', getScoreTimeline);
monitoringRouter.get('/analytics/metrics-impact', getMetricsImpact);

// Request History
monitoringRouter.get('/analytics/servers-with-history', getServersWithHistory);
monitoringRouter.get('/analytics/summary-snapshots', getSummarySnapshots);
// Note: /requests/search must be registered before /requests/:serverId to avoid route conflict
monitoringRouter.get('/analytics/requests/search', searchRequests);
monitoringRouter.get('/analytics/requests/:serverId', getServerRequestHistory);
monitoringRouter.get('/analytics/request-stats/:serverId', getServerRequestStats);
monitoringRouter.get('/analytics/request-timeline', getRequestTimeline);

// Phase 2: SQLite rollup and request browser endpoints
monitoringRouter.get('/analytics/rollups/hourly', getHourlyRollups);
monitoringRouter.get('/analytics/rollups/daily', getDailyRollups);
monitoringRouter.get('/analytics/requests/browse', browseRequests);

// Phase 3: Temporal scoring endpoints
monitoringRouter.get('/analytics/temporal-profile', getTemporalProfile);
monitoringRouter.get('/analytics/temporal-adjustment', getTemporalAdjustment);

// Get detailed circuit breaker info for a server:model (monitoring)
monitoringRouter.get('/servers/:serverId/models/:model/circuit-breaker', getCircuitBreakerDetails);
