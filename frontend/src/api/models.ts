// Model management API methods
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

export const getModels = async () => {
  return apiCall(async () => {
    const response = await apiClient.get('/models');
    return response.data.models;
  });
};

export const getModelMap = async () => {
  return apiCall(async () => {
    const response = await apiClient.get('/model-map');
    return response.data.modelToServers;
  });
};

export const getFleetModelStats = async () => {
  return apiCall(async () => {
    const response = await apiClient.get('/models/fleet-stats');
    return response.data;
  });
};

export const getAllModelsStatus = async () => {
  return apiCall(async () => {
    const response = await apiClient.get('/models/status');
    return response.data;
  });
};

export const getWarmupRecommendations = async () => {
  return apiCall(async () => {
    const response = await apiClient.get('/models/recommendations');
    return response.data;
  });
};

export const getIdleModels = async () => {
  return apiCall(async () => {
    const response = await apiClient.get('/models/idle');
    return response.data;
  });
};

export const warmupModel = async (model: string, servers?: string[], priority?: string) => {
  return apiCall(async () => {
    const response = await apiClient.post(`/models/${model}/warmup`, { servers, priority });
    return response.data;
  });
};

export const unloadModel = async (model: string, serverId?: string) => {
  return apiCall(async () => {
    const response = await apiClient.post(`/models/${model}/unload`, { serverId });
    return response.data;
  });
};

export const cancelModelWarmup = async (model: string) => {
  return apiCall(async () => {
    const response = await apiClient.post(`/models/${model}/cancel`);
    return response.data;
  });
};

export const getModelStatus = async (model: string) => {
  return apiCall(async () => {
    const response = await apiClient.get(`/models/${model}/status`);
    return response.data;
  });
};
