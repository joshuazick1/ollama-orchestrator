// Performance probe API methods

import { apiClient } from './client';
import { ApiError } from './errors';

async function apiCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return (await call()) as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError('Unexpected error occurred', undefined, error);
  }
}

// ==========================================
// Types
// ==========================================

interface PerfProbeTaskBackend {
  id: string;
  status: string;
  createdAt: number;
  completedAt?: number;
  metadata?: {
    totalProbes?: number;
    probeDurationMs?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface PerfProbeHistoryParams {
  serverId: string;
  model?: string;
  startTime: number;
  endTime: number;
  intervalMinutes?: number;
  metrics?: string[];
}

export interface PerfProbeDataPoint {
  timestamp: number;
  count: number;
  ttft_avg: number | null;
  tokens_per_sec_avg: number | null;
  success_rate: number | null;
  latency_avg: number | null;
}

export interface PerfProbeHistoryResponse {
  success: boolean;
  serverId: string;
  model?: string | null;
  startTime: number;
  endTime: number;
  intervalMinutes: number;
  dataPoints: PerfProbeDataPoint[];
}

export interface SchedulerConfig {
  intervalMs: number;
  jitterMs: number;
  maxConcurrent: number;
  cooldownMs: number;
  probeModelCount: number;
}

export interface CurrentProbe {
  serverId: string;
  model: string;
  scheduledAt: number;
  firesAt: number;
  isRunning: boolean;
}

export interface SchedulerStats {
  totalScheduledToday: number;
  totalCompletedToday: number;
  totalFailedToday: number;
  totalSkippedCooldown: number;
  totalSkippedConcurrency: number;
}

export interface SchedulerStatusResponse {
  success: boolean;
  running: boolean;
  enabled: boolean;
  cycleStartedAt: number | null;
  cycleEndsAt: number | null;
  config: SchedulerConfig;
  currentProbes: CurrentProbe[];
  stats: SchedulerStats;
  lastError: string | null;
}

export interface RunPerfProbeOptions {
  concurrency?: number;
  probeModelCount?: number;
  timeoutMs?: number;
}

export interface RunPerfProbeResponse {
  taskId: string;
}

export interface PerfProbeTaskStatus {
  taskId: string;
  status: string;
  totalProbes: number;
  completedProbes: number;
  startedAt: number;
  completedAt?: number;
}

export interface CancelPerfProbeResponse {
  success: boolean;
}

export interface RecentPerfProbeTask {
  taskId: string;
  status: string;
  startedAt: number;
  completedAt?: number;
  totalProbes: number;
  durationMs?: number;
}

export interface PerfProbeCoverageCell {
  hourOfDay: number;
  dayOfWeek: number;
  count: number;
}

export interface PerfProbeCoverageGridResponse {
  success: boolean;
  days: number;
  grid: PerfProbeCoverageCell[];
}

export interface ScheduledProbe {
  serverId: string;
  serverUrl: string;
  scheduledAt: number;
  firesAt: number;
  models: string[];
}

export interface ScheduledProbesResponse {
  success: boolean;
  newServerProbes: ScheduledProbe[];
}

// ==========================================
// API Functions
// ==========================================

/**
 * Get performance probe history for a server:model over a time range.
 */
export const getPerfProbeHistory = async (
  params: PerfProbeHistoryParams
): Promise<PerfProbeHistoryResponse> => {
  return apiCall(async () => {
    const search = new URLSearchParams();
    search.set('serverId', params.serverId);
    if (params.model) search.set('model', params.model);
    search.set('startTime', String(params.startTime));
    search.set('endTime', String(params.endTime));
    if (params.intervalMinutes) {
      search.set('intervalMinutes', String(params.intervalMinutes));
    }
    if (params.metrics && params.metrics.length > 0) {
      search.set('metrics', params.metrics.join(','));
    }
    const response = await apiClient.get(`/performance-probe/history?${search.toString()}`);
    return response.data;
  });
};

/**
 * Get the current status of the performance probe scheduler.
 */
export const getPerfProbeSchedulerStatus = async (): Promise<SchedulerStatusResponse> => {
  return apiCall(async () => {
    const response = await apiClient.get('/performance-probe/scheduler-status');
    return response.data;
  });
};

/**
 * Manually trigger a performance probe run.
 */
export const runPerfProbe = async (
  options: RunPerfProbeOptions = {}
): Promise<RunPerfProbeResponse> => {
  return apiCall(async () => {
    const response = await apiClient.post('/performance-probe', options);
    return response.data;
  });
};

/**
 * Get the status of a specific performance probe task.
 */
export const getPerfProbeStatus = async (taskId: string): Promise<PerfProbeTaskStatus> => {
  return apiCall(async () => {
    const response = await apiClient.get(`/performance-probe/${encodeURIComponent(taskId)}`);
    return response.data;
  });
};

/**
 * Cancel a running performance probe task.
 */
export const cancelPerfProbe = async (taskId: string): Promise<CancelPerfProbeResponse> => {
  return apiCall(async () => {
    const response = await apiClient.delete(`/performance-probe/${encodeURIComponent(taskId)}`);
    return response.data;
  });
};

/**
 * Get recent performance probe tasks.
 */
export const getRecentPerfProbeTasks = async (limit = 5): Promise<RecentPerfProbeTask[]> => {
  return apiCall(async () => {
    const response = await apiClient.get(`/performance-probe/recent?limit=${limit}`);
    return (response.data as PerfProbeTaskBackend[]).map(task => ({
      taskId: task.id,
      status: task.status,
      startedAt: task.createdAt,
      completedAt: task.completedAt,
      totalProbes: task.metadata?.totalProbes ?? 0,
      durationMs:
        task.metadata?.probeDurationMs ??
        (task.completedAt && task.createdAt ? task.completedAt - task.createdAt : undefined),
    }));
  });
};

export interface ExportPerfProbeHistoryParams {
  serverId: string;
  model?: string;
  startTime: number;
  endTime: number;
  format?: 'csv' | 'json';
}

/**
 * Export historical probe data as CSV or JSON file download.
 * Returns a Blob containing the file contents.
 */
export const exportPerfProbeHistory = async (
  params: ExportPerfProbeHistoryParams
): Promise<{ blob: Blob; filename: string }> => {
  const search = new URLSearchParams();
  search.set('serverId', params.serverId);
  if (params.model) search.set('model', params.model);
  search.set('startTime', String(params.startTime));
  search.set('endTime', String(params.endTime));
  if (params.format) search.set('format', params.format);

  const response = await apiClient.get(`/performance-probe/history/export?${search.toString()}`, {
    responseType: 'blob',
  });

  const contentDisposition = response.headers['content-disposition'] as string | undefined;
  const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
  const filename = filenameMatch?.[1] ?? 'perf-probe-history.csv';

  return { blob: response.data, filename };
};

/**
 * Trigger a performance probe for a specific server.
 */
export const probeServer = async (
  serverId: string,
  options: RunPerfProbeOptions = {}
): Promise<RunPerfProbeResponse> => {
  return apiCall(async () => {
    const response = await apiClient.post(
      `/performance-probe/server/${encodeURIComponent(serverId)}`,
      options
    );
    return response.data;
  });
};

export interface PerfProbeCoverageGridParams {
  days?: number;
  serverId?: string;
}

/**
 * Get the 7×24 probe coverage grid (hour-of-day × day-of-week).
 */
export const getPerfProbeCoverageGrid = async (
  params: PerfProbeCoverageGridParams = {}
): Promise<PerfProbeCoverageGridResponse> => {
  return apiCall(async () => {
    const search = new URLSearchParams();
    if (params.days !== undefined) search.set('days', String(params.days));
    if (params.serverId) search.set('serverId', params.serverId);
    const response = await apiClient.get(`/performance-probe/coverage-grid?${search.toString()}`);
    return response.data;
  });
};

/**
 * Get upcoming auto-probes with server URL and model list.
 */
export const getPerfProbeScheduledProbes = async (): Promise<ScheduledProbesResponse> => {
  return apiCall(async () => {
    const response = await apiClient.get('/performance-probe/scheduled-probes');
    return response.data;
  });
};
