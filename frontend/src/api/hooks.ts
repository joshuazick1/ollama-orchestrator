/**
 * React Query key factories following TanStack Query v5 recommended pattern.
 * Provides centralized, type-safe query key management across the app.
 *
 * Usage:
 *   useQuery({ queryKey: serverKeys.lists(), ... })
 *   useQuery({ queryKey: serverKeys.list(filters), ... })
 *   useQuery({ queryKey: serverKeys.detail(id), ... })
 */

import type { TimeRange } from '../pages/analytics';

// =============================================================================
// Server Keys
// =============================================================================

export const serverKeys = {
  all: ['servers'] as const,
  lists: () => [...serverKeys.all, 'list'] as const,
  list: (filters?: string) => [...serverKeys.lists(), { filters }] as const,
  details: () => [...serverKeys.all, 'detail'] as const,
  detail: (id: string) => [...serverKeys.details(), id] as const,

  // Server sub-resources
  serverModels: (serverId: string) => [...serverKeys.detail(serverId), 'models'] as const,
  serverCircuitBreakers: (serverId: string) =>
    [...serverKeys.detail(serverId), 'circuit-breakers'] as const,

  // Fleet-level
  fleetModelStats: ['fleet-model-stats'] as const,
  modelMap: ['modelMap'] as const,

  // Bans
  bans: ['bans'] as const,
};

// =============================================================================
// Model Keys
// =============================================================================

export const modelKeys = {
  all: ['models'] as const,
  lists: () => [...modelKeys.all, 'list'] as const,
  list: () => [...modelKeys.lists()] as const,
  details: () => [...modelKeys.all, 'detail'] as const,
  detail: (model: string) => [...modelKeys.details(), model] as const,

  // Model sub-resources
  modelStatus: (model: string) => [...modelKeys.detail(model), 'status'] as const,
  warmup: ['models', 'warmup'] as const,
  recommendations: ['models', 'recommendations'] as const,
  idle: ['models', 'idle'] as const,
  allStatus: ['models', 'all-status'] as const,
};

// =============================================================================
// Analytics Keys
// =============================================================================

export const analyticsKeys = {
  all: ['analytics'] as const,

  // Overview tab
  summary: ['analytics', 'summary'] as const,
  topModels: (timeRange: TimeRange) => ['analytics', 'topModels', timeRange] as const,
  serverPerformance: (timeRange: TimeRange) =>
    ['analytics', 'serverPerformance', timeRange] as const,
  errorAnalysis: (timeRange: TimeRange) => ['analytics', 'errorAnalysis', timeRange] as const,
  capacityAnalysis: (timeRange: TimeRange) => ['analytics', 'capacityAnalysis', timeRange] as const,

  // Health tab
  circuitBreakers: ['analytics', 'circuitBreakers'] as const,

  // Decisions tab
  decisionHistory: (hours?: number) => ['analytics', 'decisions', { hours }] as const,
  decisionsTrend: (serverId: string, model: string, timeRange: TimeRange) =>
    ['analytics', 'decisions-trend', serverId, model, timeRange] as const,

  // Requests tab
  serversWithHistory: ['analytics', 'servers-with-history'] as const,
  serverRequestHistory: (serverId: string) => ['analytics', 'request-history', serverId] as const,
  serverRequestStats: (serverId: string, timeRange: TimeRange) =>
    ['analytics', 'request-stats', serverId, timeRange] as const,
  requestTimeline: (params?: { serverId?: string; hours?: number }) =>
    ['analytics', 'request-timeline', params] as const,
  searchRequests: (params?: Record<string, unknown>) =>
    ['analytics', 'search-requests', params] as const,

  // Recovery tab
  recoveryFailuresSummary: ['analytics', 'recovery-failures-summary'] as const,
  allServerRecoveryStats: ['analytics', 'all-server-recovery-stats'] as const,
  serverRecoveryStats: (serverId: string) =>
    ['analytics', 'server-recovery-stats', serverId] as const,

  // Trends tab
  scoreTimeline: (hours?: number) => ['analytics', 'score-timeline', { hours }] as const,
  selectionStats: (hours?: number) => ['analytics', 'selection-stats', { hours }] as const,
  algorithmStats: (hours?: number) => ['analytics', 'algorithm-stats', { hours }] as const,
  metricsImpact: (hours?: number) => ['analytics', 'metrics-impact', { hours }] as const,

  // Summary snapshots
  summarySnapshots: ['analytics', 'summary-snapshots'] as const,
};

// =============================================================================
// Circuit Breaker Keys
// =============================================================================

export const circuitBreakerKeys = {
  all: ['circuit-breakers'] as const,
  lists: () => [...circuitBreakerKeys.all, 'list'] as const,
  list: () => [...circuitBreakerKeys.lists()] as const,
  details: () => [...circuitBreakerKeys.all, 'detail'] as const,
  detail: (serverId: string, model?: string) =>
    model
      ? ([...circuitBreakerKeys.details(), serverId, model] as const)
      : ([...circuitBreakerKeys.details(), serverId] as const),

  // Circuit breaker sub-resources
  circuitMetrics: (serverId: string, model: string) =>
    [...circuitBreakerKeys.detail(serverId, model), 'metrics'] as const,

  // Server-level (all breakers for a server)
  serverBreakers: (serverId: string) => [...circuitBreakerKeys.all, 'server', serverId] as const,
};

// =============================================================================
// Metrics Keys
// =============================================================================

export const metricsKeys = {
  all: ['metrics'] as const,
  lists: () => [...metricsKeys.all, 'list'] as const,
  list: () => [...metricsKeys.lists()] as const,
  details: () => [...metricsKeys.all, 'detail'] as const,
  detail: (serverId: string, model: string) => [...metricsKeys.details(), serverId, model] as const,

  // Server metrics
  serverModel: (serverId: string, model: string) =>
    [...metricsKeys.detail(serverId, model)] as const,
};

// =============================================================================
// Config Keys
// =============================================================================

export const configKeys = {
  all: ['config'] as const,
  details: () => [...configKeys.all, 'detail'] as const,
  detail: () => [...configKeys.details()] as const,
  schema: ['config', 'schema'] as const,
  export: ['config', 'export'] as const,
};

// =============================================================================
// Logs Keys
// =============================================================================

export const logKeys = {
  all: ['logs'] as const,
  lists: () => [...logKeys.all, 'list'] as const,
  list: () => [...logKeys.lists()] as const,
};

// =============================================================================
// Auth Keys
// =============================================================================

export const authKeys = {
  all: ['auth'] as const,
  me: ['auth', 'me'] as const,
  users: ['auth', 'users'] as const,
  user: (id: string) => [...authKeys.users, id] as const,
  userAccess: (id: string) => [...authKeys.user(id), 'access'] as const,
};

// =============================================================================
// Health Keys
// =============================================================================

export const healthKeys = {
  all: ['health'] as const,
  lists: () => [...healthKeys.all, 'list'] as const,
  list: () => [...healthKeys.lists()] as const,
  details: () => [...healthKeys.all, 'detail'] as const,
  detail: () => [...healthKeys.details()] as const,
  inFlight: ['in-flight'] as const,
  stats: ['stats'] as const,
  errors: (params?: string) => ['errors', params] as const,
};

// =============================================================================
// Mutation Keys
// =============================================================================

export const mutationKeys = {
  // Server mutations
  addServer: ['mutations', 'addServer'] as const,
  removeServer: ['mutations', 'removeServer'] as const,
  updateServer: ['mutations', 'updateServer'] as const,
  drainServer: ['mutations', 'drainServer'] as const,
  undrainServer: ['mutations', 'undrainServer'] as const,
  setServerMaintenance: ['mutations', 'setServerMaintenance'] as const,
  refreshV1Models: ['mutations', 'refreshV1Models'] as const,

  // Model mutations
  warmupModel: ['mutations', 'warmupModel'] as const,
  unloadModel: ['mutations', 'unloadModel'] as const,
  cancelModelWarmup: ['mutations', 'cancelModelWarmup'] as const,
  pullModel: ['mutations', 'pullModel'] as const,
  copyModel: ['mutations', 'copyModel'] as const,
  deleteModel: ['mutations', 'deleteModel'] as const,

  // Circuit breaker mutations
  resetCircuitBreaker: ['mutations', 'resetCircuitBreaker'] as const,
  forceOpenCircuitBreaker: ['mutations', 'forceOpenCircuitBreaker'] as const,
  forceCloseCircuitBreaker: ['mutations', 'forceCloseCircuitBreaker'] as const,
  forceHalfOpenCircuitBreaker: ['mutations', 'forceHalfOpenCircuitBreaker'] as const,

  // Config mutations
  updateConfig: ['mutations', 'updateConfig'] as const,
  saveConfig: ['mutations', 'saveConfig'] as const,
  reloadConfig: ['mutations', 'reloadConfig'] as const,
  importConfig: ['mutations', 'importConfig'] as const,

  // Logs mutations
  clearLogs: ['mutations', 'clearLogs'] as const,

  // Health mutations
  triggerHealthCheck: ['mutations', 'triggerHealthCheck'] as const,

  // Ban mutations
  removeBan: ['mutations', 'removeBan'] as const,
  removeBansByServer: ['mutations', 'removeBansByServer'] as const,
  removeBansByModel: ['mutations', 'removeBansByModel'] as const,
  clearAllBans: ['mutations', 'clearAllBans'] as const,

  // Recovery mutations
  resetServerRecoveryStats: ['mutations', 'resetServerRecoveryStats'] as const,

  // User mutations
  createUser: ['mutations', 'createUser'] as const,
  updateUser: ['mutations', 'updateUser'] as const,
  deleteUser: ['mutations', 'deleteUser'] as const,
  grantServerAccess: ['mutations', 'grantServerAccess'] as const,
  revokeServerAccess: ['mutations', 'revokeServerAccess'] as const,
  grantModelAccess: ['mutations', 'grantModelAccess'] as const,
  revokeModelAccess: ['mutations', 'revokeModelAccess'] as const,
  rotateApiKey: ['mutations', 'rotateApiKey'] as const,
};
