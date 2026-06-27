// Health check API methods
// Extracted from frontend/src/api.ts

import { apiClient } from './client';
import { ApiError } from './errors';

async function apiCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError('Unexpected error occurred', undefined, error);
  }
}

export const getHealth = async () => {
  return apiCall(async () => {
    const response = await apiClient.get('/health');
    return response.data;
  });
};

export const triggerHealthCheck = async () => {
  return apiCall(async () => {
    const response = await apiClient.post('/health-check');
    return response.data;
  });
};

export interface ClusterStatus {
  totalServers: number;
  healthyServers: number;
  degradedServers: number;
  downServers: number;
  averageResponseTime: number;
  totalInFlight: number;
  errorRate: number;
  servers: ClusterServerStatus[];
}

export interface ClusterServerStatus {
  serverId: string;
  status: 'healthy' | 'degraded' | 'down';
  lastHealthCheck: number;
  responseTime: number;
  inFlight: number;
  errorRate: number;
}

export const getClusterStatus = async (): Promise<ClusterStatus> => {
  return apiCall(async () => {
    const response = await apiClient.get('/cluster-status');
    return response.data;
  });
};
