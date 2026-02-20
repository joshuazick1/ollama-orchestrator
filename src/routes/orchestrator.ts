/**
 * orchestrator.ts
 * Orchestrator API routes - split into monitoring and admin sections
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
} from '../controllers/analyticsController.js';
import { resetBreaker, getBreakerDetails } from '../controllers/circuitBreakerController.js';
import {
  getConfig,
  updateConfig,
  updateConfigSection,
  reloadConfig,
  saveConfig,
  getConfigSchema,
} from '../controllers/configController.js';
import { getLogs, clearLogs } from '../controllers/logsController.js';
import {
  getMetrics,
  getServerModelMetrics,
  getPrometheusMetrics,
  getRecoveryTestMetrics,
  getBreakerRecoveryMetrics,
} from '../controllers/metricsController.js';
import {
  warmupModel,
  getModelStatus,
  getAllModelsStatus,
  getWarmupRecommendations,
  unloadModel,
  getIdleModels,
  cancelWarmup,
} from '../controllers/modelController.js';
import {
  handleTags,
  handleGenerate,
  handleChat,
  handleEmbeddings,
  handlePs,
  handleVersion,
  handleShow,
  handleEmbed,
  handleUnsupported,
  handleGenerateToServer,
  handleChatToServer,
  handleEmbeddingsToServer,
} from '../controllers/ollamaController.js';
import {
  handleChatCompletions,
  handleCompletions,
  handleOpenAIEmbeddings,
  handleListModels,
  handleGetModel,
  handleChatCompletionsToServer,
  handleCompletionsToServer,
  handleOpenAIEmbeddingsToServer,
} from '../controllers/openaiController.js';
import {
  getQueueStatus,
  pauseQueue,
  resumeQueue,
  drainServer,
  getInFlightByServer,
  drainSpecificServer,
  undrainSpecificServer,
  setServerMaintenance,
} from '../controllers/queueController.js';
import {
  getRecoveryFailuresSummary,
  getServerRecoveryStats,
  getServerFailureHistory,
  analyzeServerFailures,
  analyzeCircuitBreakerImpact,
  getCircuitBreakerTransitions,
  getAllServerRecoveryStats,
  getRecentFailureRecords,
  resetServerRecoveryStats,
  resetServerCircuitBreaker,
  getServerCircuitBreaker,
} from '../controllers/recoveryFailureController.js';
import {
  listServerModels,
  pullModelToServer,
  deleteModelFromServer,
  copyModelToServer,
  getFleetModelStats,
} from '../controllers/serverModelsController.js';
import {
  addServer,
  removeServer,
  updateServer,
  getServers,
  getModelMap,
  getModels,
  getHealth,
  healthCheck,
  getStats,
  getCircuitBreakers,
  getBans,
  removeBan,
  removeBansByServer,
  removeBansByModel,
  clearAllBans,
  manualRecoveryTest,
  getCircuitBreakerDetails,
  forceOpenBreaker,
  forceCloseBreaker,
  forceHalfOpenBreaker,
} from '../controllers/serversController.js';

// Create separate routers for different rate limiting needs
const monitoringRouter = Router(); // More permissive rate limiting
const adminRouter = Router(); // More restrictive rate limiting
const inferenceRouter = Router(); // Ollama-compatible endpoints at /api/*
const v1Router = Router(); // OpenAI-compatible endpoints at /v1/*

// Async handler wrapper
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => void | Promise<void>) =>
  (req: any, res: any, next: any) => {
    void Promise.resolve(fn(req as Request, res as Response, next as NextFunction)).catch(
      next as (err: unknown) => void
    );
  };

// === Monitoring Routes (more permissive rate limiting) ===

// Basic monitoring endpoints
monitoringRouter.get('/servers', getServers);
monitoringRouter.get('/model-map', getModelMap);
monitoringRouter.get('/models', getModels);
monitoringRouter.get('/health', getHealth);
monitoringRouter.post('/health-check', asyncHandler(healthCheck));
monitoringRouter.get('/stats', getStats);
monitoringRouter.get('/circuit-breakers', getCircuitBreakers);

// Queue monitoring
monitoringRouter.get('/queue', getQueueStatus);
monitoringRouter.get('/in-flight', getInFlightByServer);

// Metrics
monitoringRouter.get('/metrics', getMetrics);
monitoringRouter.get('/metrics/prometheus', getPrometheusMetrics);
monitoringRouter.get('/metrics/:serverId/:model', getServerModelMetrics);

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
monitoringRouter.get('/analytics/requests/:serverId', getServerRequestHistory);
monitoringRouter.get('/analytics/request-stats/:serverId', getServerRequestStats);
monitoringRouter.get('/analytics/request-timeline', getRequestTimeline);
monitoringRouter.get('/analytics/requests/search', searchRequests);

// === Admin Routes (more restrictive rate limiting) ===

// Server management
adminRouter.post('/servers/add', addServer);
adminRouter.delete('/servers/:id', removeServer);
adminRouter.patch('/servers/:id', updateServer);

// Per-server model management
adminRouter.get('/servers/:id/models', asyncHandler(listServerModels));
adminRouter.post('/servers/:id/models/pull', asyncHandler(pullModelToServer));
adminRouter.delete('/servers/:id/models/:model', asyncHandler(deleteModelFromServer));
adminRouter.post('/servers/:id/models/copy', asyncHandler(copyModelToServer));

// Model management actions
adminRouter.post('/models/:model/warmup', asyncHandler(warmupModel));
adminRouter.post('/models/:model/unload', unloadModel);
adminRouter.post('/models/:model/cancel', cancelWarmup);

// Queue management
adminRouter.post('/queue/pause', pauseQueue);
adminRouter.post('/queue/resume', resumeQueue);
adminRouter.post('/drain', asyncHandler(drainServer));

// Per-server drain and maintenance
adminRouter.post('/servers/:id/drain', asyncHandler(drainSpecificServer));
adminRouter.post('/servers/:id/undrain', asyncHandler(undrainSpecificServer));
adminRouter.post('/servers/:id/maintenance', asyncHandler(setServerMaintenance));

// Configuration
adminRouter.get('/config', getConfig);
adminRouter.get('/config/schema', getConfigSchema);
adminRouter.post('/config', asyncHandler(updateConfig));
adminRouter.patch('/config/:section', asyncHandler(updateConfigSection));
adminRouter.post('/config/reload', asyncHandler(reloadConfig));
adminRouter.post('/config/save', asyncHandler(saveConfig));

// Ban management
adminRouter.get('/bans', getBans);
adminRouter.delete('/bans', clearAllBans);
adminRouter.delete('/bans/server/:serverId', removeBansByServer);
adminRouter.delete('/bans/model/:model', removeBansByModel);
adminRouter.delete('/bans/:serverId/:model', removeBan);

// Circuit breaker management
adminRouter.get('/circuit-breakers/:serverId/:model', asyncHandler(getBreakerDetails));
adminRouter.post('/circuit-breakers/:serverId/:model/reset', asyncHandler(resetBreaker));
adminRouter.post('/circuit-breakers/:serverId/:model/open', asyncHandler(forceOpenBreaker));
adminRouter.post('/circuit-breakers/:serverId/:model/close', asyncHandler(forceCloseBreaker));
adminRouter.post(
  '/circuit-breakers/:serverId/:model/half-open',
  asyncHandler(forceHalfOpenBreaker)
);
adminRouter.get('/circuit-breakers/:serverId', asyncHandler(getServerCircuitBreaker));
adminRouter.post('/circuit-breakers/:serverId/reset', asyncHandler(resetServerCircuitBreaker));

// Get detailed circuit breaker info for a server:model (monitoring)
monitoringRouter.get('/servers/:serverId/models/:model/circuit-breaker', getCircuitBreakerDetails);

// Manual recovery test for debugging (admin)
adminRouter.post(
  '/servers/:serverId/models/:model/recovery-test',
  asyncHandler(manualRecoveryTest)
);

// Recovery failure tracking and analysis
adminRouter.get('/recovery-failures', getRecoveryFailuresSummary);
adminRouter.get('/recovery-failures/stats/all', getAllServerRecoveryStats);
adminRouter.get('/recovery-failures/recent', getRecentFailureRecords);
adminRouter.get('/recovery-failures/:serverId', getServerRecoveryStats);
adminRouter.get('/recovery-failures/:serverId/history', getServerFailureHistory);
adminRouter.get('/recovery-failures/:serverId/analysis', analyzeServerFailures);
adminRouter.get('/recovery-failures/:serverId/circuit-breaker-impact', analyzeCircuitBreakerImpact);
adminRouter.get(
  '/recovery-failures/:serverId/circuit-breaker-transitions',
  getCircuitBreakerTransitions
);
adminRouter.post('/recovery-failures/:serverId/reset', resetServerRecoveryStats);

// Logging
adminRouter.get('/logs', getLogs);
adminRouter.post('/logs/clear', clearLogs);

// === Ollama-Compatible Routes ===
inferenceRouter.get('/tags', asyncHandler(handleTags));
inferenceRouter.post('/generate', asyncHandler(handleGenerate));
inferenceRouter.post('/chat', asyncHandler(handleChat));
inferenceRouter.post('/embeddings', asyncHandler(handleEmbeddings));
inferenceRouter.get('/ps', asyncHandler(handlePs));
inferenceRouter.get('/version', handleVersion);

// New endpoints from audit
inferenceRouter.post('/show', asyncHandler(handleShow));
inferenceRouter.post('/embed', asyncHandler(handleEmbed));

// Multi-node incompatible endpoints - always reject with helpful message
inferenceRouter.post('/pull', handleUnsupported);
inferenceRouter.delete('/delete', handleUnsupported);
inferenceRouter.post('/copy', handleUnsupported);
inferenceRouter.post('/create', handleUnsupported);
inferenceRouter.head('/blobs/:digest', handleUnsupported);
inferenceRouter.post('/blobs/:digest', handleUnsupported);
inferenceRouter.post('/push', handleUnsupported);

// === OpenAI-Compatible Routes (/v1/*) - mounted at /v1 ===
v1Router.post('/chat/completions', asyncHandler(handleChatCompletions));
v1Router.post('/completions', asyncHandler(handleCompletions));
v1Router.post('/embeddings', asyncHandler(handleOpenAIEmbeddings));
v1Router.get('/models', asyncHandler(handleListModels));
v1Router.get('/models/:model', asyncHandler(handleGetModel));

// === Server-Specific Routes (/:endpoint--$serverid) ===
// These routes allow explicit routing to a specific server for testing/debugging
// Format: /api/generate--serverid, /api/chat--serverid, etc.
// The /v1/* variants will only work on servers that support OpenAI-compatible endpoints
inferenceRouter.post('/generate--:serverId', asyncHandler(handleGenerateToServer));
inferenceRouter.post('/chat--:serverId', asyncHandler(handleChatToServer));
inferenceRouter.post('/embeddings--:serverId', asyncHandler(handleEmbeddingsToServer));
v1Router.post('/chat/completions--:serverId', asyncHandler(handleChatCompletionsToServer));
v1Router.post('/completions--:serverId', asyncHandler(handleCompletionsToServer));
v1Router.post('/embeddings--:serverId', asyncHandler(handleOpenAIEmbeddingsToServer));

// Export the routers
export { monitoringRouter, adminRouter, inferenceRouter, v1Router };
