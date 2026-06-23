/**
 * admin.routes.ts
 * Admin endpoints – more restrictive rate limiting.
 * Covers server management, model actions, config, bans, circuit breakers, and recovery failure tracking.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';

import {
  resetBreaker,
  getBreakerDetails,
  forceOpenBreaker,
  forceCloseBreaker,
  forceHalfOpenBreaker,
  resetAllBreakersForServer,
  deleteAllBreakersForServer,
} from '../controllers/circuit-breaker-controller.js';
import {
  getConfig,
  updateConfig,
  updateConfigSection,
  reloadConfig,
  reloadFromEnv,
  saveConfig,
  getConfigSchema,
  exportConfig,
  importConfig,
} from '../controllers/config-controller.js';
import { getLogs, clearLogs, logClientError } from '../controllers/logs-controller.js';
import { warmupModel, unloadModel, cancelWarmup } from '../controllers/model-controller.js';
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
} from '../controllers/recovery-failure-controller.js';
import {
  listServerModels,
  pullModelToServer,
  deleteModelFromServer,
  copyModelToServer,
} from '../controllers/server-models-controller.js';
import {
  addServer,
  removeServer,
  updateServer,
  updateServerConfig,
  refreshServerV1Models,
  drainServer,
  undrainServer,
  setMaintenanceMode,
  getBans,
  removeBan,
  removeBansByServer,
  removeBansByModel,
  clearAllBans,
  manualRecoveryTest,
  getServersCircuitBreakers,
  getCircuitBreakersByModel,
  getServerCircuitBreaker,
  resetServerCircuitBreaker,
  capabilityProbe,
  testConnection,
  getTestResult,
  testExistingServer,
} from '../controllers/servers-controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validateCsrfToken } from '../middleware/csrf.js';
import {
  validateRequest,
  addServerSchema,
  updateServerSchema,
  updateServerConfigSchema,
  pullModelSchema,
  warmupModelSchema,
  unloadModelSchema,
  testConnectionSchema,
} from '../middleware/validation.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => void | Promise<void>) =>
  (req: any, res: any, next: any) => {
    void Promise.resolve(fn(req as Request, res as Response, next as NextFunction)).catch(
      next as (err: unknown) => void
    );
  };

export const adminRouter = Router();

// Server management
adminRouter.post(
  '/servers/add',
  requireAdmin(),
  validateRequest(addServerSchema),
  asyncHandler(addServer)
);
adminRouter.delete('/servers/:id', requireAdmin(), removeServer);
adminRouter.patch(
  '/servers/:id',
  requireAuth(),
  validateRequest(updateServerSchema),
  asyncHandler(updateServer)
);
adminRouter.patch(
  '/servers/:id/config',
  requireAuth(),
  validateRequest(updateServerConfigSchema),
  asyncHandler(updateServerConfig)
);
adminRouter.post(
  '/servers/:id/refresh-v1-models',
  requireAuth(),
  asyncHandler(refreshServerV1Models)
);
adminRouter.post('/servers/:id/capability-probe', requireAdmin(), asyncHandler(capabilityProbe));
adminRouter.post(
  '/servers/test-connection',
  requireAdmin(),
  validateRequest(testConnectionSchema),
  asyncHandler(testConnection)
);
adminRouter.get('/servers/test-connection/:testId', requireAdmin(), asyncHandler(getTestResult));
adminRouter.post('/servers/:id/test', requireAdmin(), asyncHandler(testExistingServer));

// Server drain/undrain/maintenance
adminRouter.post('/servers/:id/drain', requireAdmin(), asyncHandler(drainServer));
adminRouter.post('/servers/:id/undrain', requireAdmin(), asyncHandler(undrainServer));
adminRouter.post('/servers/:id/maintenance', requireAdmin(), asyncHandler(setMaintenanceMode));

// Per-server model management
adminRouter.get('/servers/:id/models', requireAuth(), asyncHandler(listServerModels));
adminRouter.post(
  '/servers/:id/models/pull',
  requireAdmin(),
  validateRequest(pullModelSchema),
  asyncHandler(pullModelToServer)
);
adminRouter.delete(
  '/servers/:id/models/:model',
  requireAdmin(),
  asyncHandler(deleteModelFromServer)
);
adminRouter.post('/servers/:id/models/copy', requireAdmin(), asyncHandler(copyModelToServer));

// Model management actions
adminRouter.post(
  '/models/:model/warmup',
  requireAdmin(),
  validateRequest(warmupModelSchema),
  asyncHandler(warmupModel)
);
adminRouter.post(
  '/models/:model/unload',
  requireAdmin(),
  validateRequest(unloadModelSchema),
  asyncHandler(unloadModel)
);
adminRouter.post('/models/:model/cancel', requireAdmin(), cancelWarmup);

// Configuration
adminRouter.get('/config', requireAdmin(), getConfig);
adminRouter.get('/config/schema', requireAdmin(), getConfigSchema);
adminRouter.get('/config/export', requireAdmin(), exportConfig);
adminRouter.post('/config', requireAdmin(), asyncHandler(updateConfig));
adminRouter.patch('/config/:section', requireAdmin(), asyncHandler(updateConfigSection));
adminRouter.post('/config/reload', requireAdmin(), asyncHandler(reloadConfig));
adminRouter.post('/config/reload-from-env', requireAdmin(), asyncHandler(reloadFromEnv));
adminRouter.post('/config/save', requireAdmin(), asyncHandler(saveConfig));
adminRouter.post('/config/import', requireAdmin(), validateCsrfToken, asyncHandler(importConfig));

// Ban management
adminRouter.get('/bans', requireAdmin(), getBans);
adminRouter.delete('/bans', requireAdmin(), clearAllBans);
adminRouter.delete('/bans/server/:serverId', requireAdmin(), removeBansByServer);
adminRouter.delete('/bans/model/:model', requireAdmin(), removeBansByModel);
adminRouter.delete('/bans/:serverId/:model', requireAdmin(), removeBan);

// Circuit breaker management
adminRouter.get(
  '/circuit-breakers/:serverId/:model',
  requireAdmin(),
  asyncHandler(getBreakerDetails)
);
adminRouter.post(
  '/circuit-breakers/:serverId/:model/reset',
  requireAdmin(),
  asyncHandler(resetBreaker)
);
adminRouter.post(
  '/circuit-breakers/:serverId/:model/open',
  requireAdmin(),
  asyncHandler(forceOpenBreaker)
);
adminRouter.post(
  '/circuit-breakers/:serverId/:model/close',
  requireAdmin(),
  asyncHandler(forceCloseBreaker)
);
adminRouter.post(
  '/circuit-breakers/:serverId/:model/half-open',
  requireAdmin(),
  asyncHandler(forceHalfOpenBreaker)
);
adminRouter.get(
  '/circuit-breakers/:serverId',
  requireAdmin(),
  asyncHandler(getServerCircuitBreaker)
);
adminRouter.post(
  '/circuit-breakers/:serverId/reset',
  requireAdmin(),
  asyncHandler(resetServerCircuitBreaker)
);
adminRouter.post(
  '/circuit-breakers/server/:serverId/reset-all',
  requireAdmin(),
  asyncHandler(resetAllBreakersForServer)
);
adminRouter.delete(
  '/circuit-breakers/server/:serverId',
  requireAdmin(),
  asyncHandler(deleteAllBreakersForServer)
);
adminRouter.get(
  '/servers/circuit-breakers',
  requireAuth(),
  asyncHandler(getServersCircuitBreakers)
);
adminRouter.get('/models/circuit-breakers', requireAuth(), asyncHandler(getCircuitBreakersByModel));

// Manual recovery test for debugging (admin)
adminRouter.post(
  '/servers/:serverId/models/:model/recovery-test',
  requireAdmin(),
  asyncHandler(manualRecoveryTest)
);

// Recovery failure tracking and analysis
adminRouter.get('/recovery-failures', requireAdmin(), getRecoveryFailuresSummary);
adminRouter.get('/recovery-failures/stats/all', requireAdmin(), getAllServerRecoveryStats);
adminRouter.get('/recovery-failures/recent', requireAdmin(), getRecentFailureRecords);
adminRouter.get('/recovery-failures/:serverId', requireAdmin(), getServerRecoveryStats);
adminRouter.get('/recovery-failures/:serverId/history', requireAdmin(), getServerFailureHistory);
adminRouter.get('/recovery-failures/:serverId/analysis', requireAdmin(), analyzeServerFailures);
adminRouter.get(
  '/recovery-failures/:serverId/circuit-breaker-impact',
  requireAdmin(),
  analyzeCircuitBreakerImpact
);
adminRouter.get(
  '/recovery-failures/:serverId/circuit-breaker-transitions',
  requireAdmin(),
  getCircuitBreakerTransitions
);
adminRouter.post('/recovery-failures/:serverId/reset', requireAdmin(), resetServerRecoveryStats);

// Logging
adminRouter.get('/logs', requireAuth(), getLogs);
adminRouter.post('/logs/clear', requireAdmin(), clearLogs);
adminRouter.post('/logs/client-error', requireAdmin(), logClientError);
