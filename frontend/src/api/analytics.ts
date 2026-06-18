// Analytics API methods
// Extracted from frontend/src/api.ts

import { apiClient } from './client';
import type { MetricsSummarySnapshot, ErrorEvent } from './types';
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

export const getAnalyticsSummary = async () => {
  return apiCall(async () => {
    const response = await apiClient.get('/analytics/summary');
    return response.data.summary;
  });
};

export const getTopModels = async () => {
  return apiCall(async () => {
    const response = await apiClient.get('/analytics/top-models');
    return response.data.models;
  });
};

export const getServerPerformance = async (timeRange = '1h') => {
  return apiCall(async () => {
    const response = await apiClient.get(`/analytics/server-performance?timeRange=${timeRange}`);
    return response.data.servers;
  });
};

export const getErrorAnalysis = async (timeRange = '24h') => {
  return apiCall(async () => {
    const response = await apiClient.get(`/analytics/errors?timeRange=${timeRange}`);
    return response.data;
  });
};

export const getCapacityAnalysis = async (timeRange = '24h') => {
  return apiCall(async () => {
    const response = await apiClient.get(`/analytics/capacity?timeRange=${timeRange}`);
    return response.data;
  });
};

export const getTrendAnalysis = async (
  metric: 'latency' | 'errors' | 'throughput',
  timeRange = '24h'
) => {
  return apiCall(async () => {
    const response = await apiClient.get(`/analytics/trends/${metric}?timeRange=${timeRange}`);
    return response.data.analysis;
  });
};

export const getDecisionHistory = async (params?: {
  limit?: number;
  model?: string;
  serverId?: string;
  hours?: number;
}) => {
  return apiCall(async () => {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.model) queryParams.append('model', params.model);
    if (params?.serverId) queryParams.append('serverId', params.serverId);
    if (params?.hours) queryParams.append('hours', params.hours.toString());

    const response = await apiClient.get(`/analytics/decisions?${queryParams.toString()}`);
    return response.data;
  });
};

export const getServerModelDecisionTrend = async (serverId: string, model: string, hours = 24) => {
  return apiCall(async () => {
    const response = await apiClient.get(
      `/analytics/decisions/trends/${serverId}/${model}?hours=${hours}`
    );
    return response.data;
  });
};

export const getSelectionStats = async (hours = 24) => {
  return apiCall(async () => {
    const response = await apiClient.get(`/analytics/selection-stats?hours=${hours}`);
    return response.data;
  });
};

export const getAlgorithmStats = async (hours = 24) => {
  return apiCall(async () => {
    const response = await apiClient.get(`/analytics/algorithms?hours=${hours}`);
    return response.data;
  });
};

export const getScoreTimeline = async (hours = 24, intervalMinutes = 15) => {
  return apiCall(async () => {
    const response = await apiClient.get(
      `/analytics/score-timeline?hours=${hours}&interval=${intervalMinutes}`
    );
    return response.data;
  });
};

export const getMetricsImpact = async (hours = 24) => {
  return apiCall(async () => {
    const response = await apiClient.get(`/analytics/metrics-impact?hours=${hours}`);
    return response.data;
  });
};

export const getServerRequestHistory = async (
  serverId: string,
  params?: { limit?: number; offset?: number }
) => {
  return apiCall(async () => {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.offset) queryParams.append('offset', params.offset.toString());

    const response = await apiClient.get(
      `/analytics/requests/${serverId}?${queryParams.toString()}`
    );
    return response.data;
  });
};

export const getServerRequestStats = async (serverId: string, hours = 24) => {
  return apiCall(async () => {
    const response = await apiClient.get(`/analytics/request-stats/${serverId}?hours=${hours}`);
    return response.data;
  });
};

export const getRequestTimeline = async (params?: {
  serverId?: string;
  hours?: number;
  interval?: number;
}) => {
  return apiCall(async () => {
    const queryParams = new URLSearchParams();
    if (params?.serverId) queryParams.append('serverId', params.serverId);
    if (params?.hours) queryParams.append('hours', params.hours.toString());
    if (params?.interval) queryParams.append('interval', params.interval.toString());

    const response = await apiClient.get(`/analytics/request-timeline?${queryParams.toString()}`);
    return response.data;
  });
};

export const searchRequests = async (params: {
  serverId?: string;
  model?: string;
  endpoint?: string;
  success?: boolean;
  startTime?: number;
  endTime?: number;
  limit?: number;
}) => {
  return apiCall(async () => {
    const queryParams = new URLSearchParams();
    if (params.serverId) queryParams.append('serverId', params.serverId);
    if (params.model) queryParams.append('model', params.model);
    if (params.endpoint) queryParams.append('endpoint', params.endpoint);
    if (params.success !== undefined) queryParams.append('success', params.success.toString());
    if (params.startTime) queryParams.append('startTime', params.startTime.toString());
    if (params.endTime) queryParams.append('endTime', params.endTime.toString());
    if (params.limit) queryParams.append('limit', params.limit.toString());

    const response = await apiClient.get(`/analytics/requests/search?${queryParams.toString()}`);
    return response.data;
  });
};

export const getServersWithHistory = async () => {
  return apiCall(async () => {
    const response = await apiClient.get('/analytics/servers-with-history');
    return response.data;
  });
};

export const getSummarySnapshots = async (): Promise<{
  success: boolean;
  count: number;
  snapshots: MetricsSummarySnapshot[];
}> => {
  return apiCall(async () => {
    const response = await apiClient.get('/analytics/summary-snapshots');
    return response.data;
  });
};

export const getRecoveryFailuresSummary = async () => {
  return apiCall(async () => {
    const response = await apiClient.get('/recovery-failures');
    return response.data;
  });
};

export const getAllServerRecoveryStats = async () => {
  return apiCall(async () => {
    const response = await apiClient.get('/recovery-failures/stats/all');
    return response.data.stats;
  });
};

export const getServerRecoveryStats = async (serverId: string) => {
  return apiCall(async () => {
    const response = await apiClient.get(`/recovery-failures/${encodeURIComponent(serverId)}`);
    return response.data;
  });
};

export const getRecentFailureRecords = async (limit = 50) => {
  return apiCall(async () => {
    const response = await apiClient.get(`/recovery-failures/recent?limit=${limit}`);
    return response.data;
  });
};

export const resetServerRecoveryStats = async (serverId: string) => {
  return apiCall(async () => {
    const response = await apiClient.post(
      `/recovery-failures/${encodeURIComponent(serverId)}/reset`
    );
    return response.data;
  });
};

export const getErrors = async (queryParams?: string): Promise<ErrorEvent[]> => {
  return apiCall(async () => {
    const response = await apiClient.get(`/errors${queryParams || ''}`);
    return response.data.errors;
  });
};
