// Circuit breaker and ban management API methods
// Extracted from frontend/src/api.ts

import { apiClient } from './client';
import type { CircuitBreakerInfo, BanEntry } from './types';
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

export const getCircuitBreakers = async () => {
  return apiCall(async () => {
    const response = await apiClient.get('/circuit-breakers');
    return response.data;
  });
};

export const getServersCircuitBreakers = async () => {
  return apiCall(async () => {
    const response = await apiClient.get('/servers/circuit-breakers');
    return response.data.circuitBreakers as Record<string, CircuitBreakerInfo>;
  });
};

export const resetCircuitBreaker = async (serverId: string, model?: string) => {
  return apiCall(async () => {
    const endpoint = model
      ? `/circuit-breakers/${serverId}/${encodeURIComponent(model)}/reset`
      : `/circuit-breakers/${serverId}/reset`;
    const response = await apiClient.post(endpoint);
    return response.data;
  });
};

export const forceOpenCircuitBreaker = async (serverId: string, model?: string) => {
  return apiCall(async () => {
    const endpoint = model
      ? `/circuit-breakers/${serverId}/${encodeURIComponent(model)}/open`
      : `/circuit-breakers/${serverId}/open`;
    const response = await apiClient.post(endpoint);
    return response.data;
  });
};

export const forceCloseCircuitBreaker = async (serverId: string, model?: string) => {
  return apiCall(async () => {
    const endpoint = model
      ? `/circuit-breakers/${serverId}/${encodeURIComponent(model)}/close`
      : `/circuit-breakers/${serverId}/close`;
    const response = await apiClient.post(endpoint);
    return response.data;
  });
};

export const forceHalfOpenCircuitBreaker = async (serverId: string, model?: string) => {
  return apiCall(async () => {
    const endpoint = model
      ? `/circuit-breakers/${serverId}/${encodeURIComponent(model)}/half-open`
      : `/circuit-breakers/${serverId}/half-open`;
    const response = await apiClient.post(endpoint);
    return response.data;
  });
};

export const getBans = async (): Promise<BanEntry[]> => {
  return apiCall(async () => {
    const response = await apiClient.get('/bans');
    return response.data.bans;
  });
};

export const removeBan = async (serverId: string, model: string) => {
  return apiCall(async () => {
    const response = await apiClient.delete(
      `/bans/${encodeURIComponent(serverId)}/${encodeURIComponent(model)}`
    );
    return response.data;
  });
};

export const removeBansByServer = async (serverId: string) => {
  return apiCall(async () => {
    const response = await apiClient.delete(`/bans/server/${encodeURIComponent(serverId)}`);
    return response.data;
  });
};

export const removeBansByModel = async (model: string) => {
  return apiCall(async () => {
    const response = await apiClient.delete(`/bans/model/${encodeURIComponent(model)}`);
    return response.data;
  });
};

export const clearAllBans = async () => {
  return apiCall(async () => {
    const response = await apiClient.delete('/bans');
    return response.data;
  });
};
