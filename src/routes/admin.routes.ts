/**
 * admin.routes.ts
 * Admin endpoints – more restrictive rate limiting.
 * Covers server management, model actions, config, bans, circuit breakers, and recovery failure tracking.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';

import { resetBreaker, getBreakerDetails } from '../controllers/circuit-breaker-controller.js';
import {
  getConfig,
  updateConfig,
  updateConfigSection,
  reloadConfig,
  saveConfig,
  getConfigSchema,
} from '../controllers/config-controller.js';
import { getLogs, clearLogs } from '../controllers/logs-controller.js';
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
  resetServerCircuitBreaker,
  getServerCircuitBreaker,
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
  getBans,
  removeBan,
  removeBansByServer,
  removeBansByModel,
  clearAllBans,
  manualRecoveryTest,
  forceOpenBreaker,
  forceCloseBreaker,
  forceHalfOpenBreaker,
} from '../controllers/servers-controller.js';

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
