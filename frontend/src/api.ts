import axios, { AxiosError } from 'axios';
import type { AIServer, MetricsExport, ServerModelMetrics, OrchestratorConfig } from './types';

export type { OrchestratorConfig };

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  details?: unknown;
}

export interface ApiErrorInfo {
  message: string;
  status?: number;
  code?: string;
  details?: unknown;
}

const api = axios.create({
  baseURL: '/api/orchestrator',
  timeout: 30000, // 30 second timeout
});

// Add request interceptor for auth if needed
api.interceptors.request.use(
  config => {
    // Add auth headers if needed
    return config;
  },
  error => Promise.reject(error)
);

// Add response interceptor for error handling
api.interceptors.response.use(
  response => response,
  (error: AxiosError) => {
    if (error.response) {
      // Server responded with error status
      const status = error.response.status;
      const data = error.response.data as { error?: string; details?: unknown };

      let message = 'An error occurred';
      if (data?.error) {
        message = data.error;
      } else if (status === 404) {
        message = 'Resource not found';
      } else if (status === 500) {
        message = 'Internal server error';
      } else if (status >= 400 && status < 500) {
        message = 'Request error';
      }

      throw new ApiError(message, status, data?.details);
    } else if (error.request) {
      // Network error
      throw new ApiError(
        'Network error - please check your connection',
        undefined,
        'NETWORK_ERROR'
      );
    } else {
      // Other error
      throw new ApiError(error.message || 'Unknown error', undefined, error.code);
    }
  }
);

// Custom error class
export class ApiError extends Error {
  public status?: number;
  public details?: unknown;

  constructor(message: string, status?: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

// Helper function to wrap API calls with consistent error handling
async function apiCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    // Wrap unknown errors
    throw new ApiError('Unexpected error occurred', undefined, error);
  }
}

// API functions with error handling
export const getServers = async (): Promise<AIServer[]> => {
  return apiCall(async () => {
    const response = await api.get('/servers');
    return response.data.servers;
  });
};

export const addServer = async (server: { id: string; url: string; maxConcurrency?: number }) => {
  return apiCall(async () => {
    const response = await api.post('/servers/add', server);
    return response.data;
  });
};

export const removeServer = async (id: string) => {
  return apiCall(async () => {
    const response = await api.delete(`/servers/${id}`);
    return response.data;
  });
};

export const updateServer = async (id: string, updates: Partial<AIServer>) => {
  return apiCall(async () => {
    const response = await api.patch(`/servers/${id}`, updates);
    return response.data;
  });
};

export const getMetrics = async (): Promise<MetricsExport> => {
  return apiCall(async () => {
    const response = await api.get('/metrics');
    return response.data;
  });
};

export const getServerModelMetrics = async (
  serverId: string,
  model: string
): Promise<ServerModelMetrics> => {
  return apiCall(async () => {
    const response = await api.get(`/metrics/${serverId}/${model}`);
    return response.data;
  });
};

export const getHealth = async () => {
  return apiCall(async () => {
    const response = await axios.get('/health');
    return response.data;
  });
};

export const getStats = async () => {
  return apiCall(async () => {
    const response = await api.get('/stats');
    return response.data.stats;
  });
};

export const getQueueStatus = async () => {
  return apiCall(async () => {
    const response = await api.get('/queue');
    return response.data;
  });
};

export const getInFlightByServer = async () => {
  return apiCall(async () => {
    const response = await api.get('/in-flight');
    return response.data;
  });
};

export interface CircuitBreakerInfo {
  serverId: string;
  state: 'OPEN' | 'CLOSED' | 'HALF-OPEN';
  failureCount: number;
  successCount: number;
  lastFailure: number;
  lastSuccess: number;
  nextRetryAt: number;
  errorRate: number;
  errorCounts: {
    retryable: number;
    'non-retryable': number;
    transient: number;
    permanent: number;
  };
  consecutiveSuccesses: number;
  modelType?: 'embedding' | 'generation';
  lastFailureReason?: string;
  halfOpenStartedAt?: number;
  halfOpenAttempts?: number;
  lastErrorType?: string;
}

export const getCircuitBreakers = async () => {
  return apiCall(async () => {
    const response = await api.get('/circuit-breakers');
    return response.data;
  });
};

export const getConfig = async (): Promise<OrchestratorConfig> => {
  return apiCall(async () => {
    const response = await api.get('/config');
    return response.data.config;
  });
};

export const updateConfig = async (config: Partial<OrchestratorConfig>) => {
  return apiCall(async () => {
    const response = await api.post('/config', config);
    return response.data;
  });
};

export const saveConfig = async () => {
  return apiCall(async () => {
    const response = await api.post('/config/save');
    return response.data;
  });
};

export const reloadConfig = async () => {
  return apiCall(async () => {
    const response = await api.post('/config/reload');
    return response.data;
  });
};

export const getLogs = async () => {
  return apiCall(async () => {
    const response = await api.get('/logs');
    return response.data.logs;
  });
};

export const clearLogs = async () => {
  return apiCall(async () => {
    const response = await api.post('/logs/clear');
    return response.data;
  });
};

export const getModels = async () => {
  return apiCall(async () => {
    const response = await api.get('/models');
    return response.data.models;
  });
};

export const getModelMap = async () => {
  return apiCall(async () => {
    const response = await api.get('/model-map');
    return response.data.modelToServers;
  });
};

export const getAnalyticsSummary = async () => {
  return apiCall(async () => {
    const response = await api.get('/analytics/summary');
    return response.data.summary;
  });
};

export const getTopModels = async () => {
  return apiCall(async () => {
    const response = await api.get('/analytics/top-models');
    return response.data.models;
  });
};

export const getServerPerformance = async (timeRange = '1h') => {
  return apiCall(async () => {
    const response = await api.get(`/analytics/server-performance?timeRange=${timeRange}`);
    return response.data.servers;
  });
};

export const getErrorAnalysis = async (timeRange = '24h') => {
  return apiCall(async () => {
    const response = await api.get(`/analytics/errors?timeRange=${timeRange}`);
    return response.data;
  });
};

export const getCapacityAnalysis = async (timeRange = '24h') => {
  return apiCall(async () => {
    const response = await api.get(`/analytics/capacity?timeRange=${timeRange}`);
    return response.data;
  });
};

export const getTrendAnalysis = async (
  metric: 'latency' | 'errors' | 'throughput',
  timeRange = '24h'
) => {
  return apiCall(async () => {
    const response = await api.get(`/analytics/trends/${metric}?timeRange=${timeRange}`);
    return response.data.analysis;
  });
};

// === Decision History API ===

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

    const response = await api.get(`/analytics/decisions?${queryParams.toString()}`);
    return response.data;
  });
};

export const getServerModelDecisionTrend = async (serverId: string, model: string, hours = 24) => {
  return apiCall(async () => {
    const response = await api.get(
      `/analytics/decisions/trends/${serverId}/${model}?hours=${hours}`
    );
    return response.data;
  });
};

export const getSelectionStats = async (hours = 24) => {
  return apiCall(async () => {
    const response = await api.get(`/analytics/selection-stats?hours=${hours}`);
    return response.data;
  });
};

export const getAlgorithmStats = async (hours = 24) => {
  return apiCall(async () => {
    const response = await api.get(`/analytics/algorithms?hours=${hours}`);
    return response.data;
  });
};

export const getScoreTimeline = async (hours = 24, intervalMinutes = 15) => {
  return apiCall(async () => {
    const response = await api.get(
      `/analytics/score-timeline?hours=${hours}&interval=${intervalMinutes}`
    );
    return response.data;
  });
};

export const getMetricsImpact = async (hours = 24) => {
  return apiCall(async () => {
    const response = await api.get(`/analytics/metrics-impact?hours=${hours}`);
    return response.data;
  });
};

// === Request History API ===

export const getServerRequestHistory = async (
  serverId: string,
  params?: { limit?: number; offset?: number }
) => {
  return apiCall(async () => {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.offset) queryParams.append('offset', params.offset.toString());

    const response = await api.get(`/analytics/requests/${serverId}?${queryParams.toString()}`);
    return response.data;
  });
};

export const getServerRequestStats = async (serverId: string, hours = 24) => {
  return apiCall(async () => {
    const response = await api.get(`/analytics/request-stats/${serverId}?hours=${hours}`);
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

    const response = await api.get(`/analytics/request-timeline?${queryParams.toString()}`);
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

    const response = await api.get(`/analytics/requests/search?${queryParams.toString()}`);
    return response.data;
  });
};

export const getServersWithHistory = async () => {
  return apiCall(async () => {
    const response = await api.get('/analytics/servers-with-history');
    return response.data;
  });
};

// === Per-Server Model Management ===

export const listServerModels = async (serverId: string) => {
  return apiCall(async () => {
    const response = await api.get(`/servers/${serverId}/models`);
    return response.data;
  });
};

export const pullModelToServer = async (serverId: string, model: string) => {
  return apiCall(async () => {
    const response = await api.post(`/servers/${serverId}/models/pull`, { model });
    return response.data;
  });
};

export const deleteModelFromServer = async (serverId: string, model: string) => {
  return apiCall(async () => {
    const response = await api.delete(`/servers/${serverId}/models/${model}`);
    return response.data;
  });
};

export const copyModelToServer = async (
  serverId: string,
  model: string,
  sourceServerId?: string
) => {
  return apiCall(async () => {
    const response = await api.post(`/servers/${serverId}/models/copy`, { model, sourceServerId });
    return response.data;
  });
};

export const getFleetModelStats = async () => {
  return apiCall(async () => {
    const response = await api.get('/models/fleet-stats');
    return response.data;
  });
};
