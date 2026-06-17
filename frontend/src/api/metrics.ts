// Metrics API methods
// Extracted from frontend/src/api.ts

import type { MetricsExport, ServerModelMetrics } from '../types';
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

export const getMetrics = async (): Promise<MetricsExport> => {
  return apiCall(async () => {
    const response = await apiClient.get('/metrics');
    return response.data;
  });
};

export const getServerModelMetrics = async (
  serverId: string,
  model: string
): Promise<ServerModelMetrics> => {
  return apiCall(async () => {
    const decodedSid = serverId.includes('%') ? decodeURIComponent(serverId) : serverId;
    const sid = encodeURIComponent(decodedSid);
    const m = encodeURIComponent(model);
    const response = await apiClient.get(`/metrics/${sid}/${m}`);
    return response.data;
  });
};

export const getStats = async () => {
  return apiCall(async () => {
    const response = await apiClient.get('/stats');
    return response.data;
  });
};

export const getInFlightByServer = async () => {
  return apiCall(async () => {
    const response = await apiClient.get('/in-flight');
    return response.data;
  });
};
