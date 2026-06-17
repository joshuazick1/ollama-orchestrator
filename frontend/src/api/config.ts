// Config API methods
// Extracted from frontend/src/api.ts

import type { OrchestratorConfig } from '../types';
import type { ConfigExport, ImportConfigResult } from './types';
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

export const getConfig = async (): Promise<OrchestratorConfig> => {
  return apiCall(async () => {
    const response = await apiClient.get('/config');
    return response.data.config;
  });
};

export const updateConfig = async (config: Partial<OrchestratorConfig>) => {
  return apiCall(async () => {
    const response = await apiClient.post('/config', config);
    return response.data;
  });
};

export const saveConfig = async () => {
  return apiCall(async () => {
    const response = await apiClient.post('/config/save');
    return response.data;
  });
};

export const reloadConfig = async () => {
  return apiCall(async () => {
    const response = await apiClient.post('/config/reload');
    return response.data;
  });
};

export const exportConfig = async (): Promise<ConfigExport> => {
  return apiCall(async () => {
    const response = await apiClient.get('/config/export');
    return response.data;
  });
};

export const importConfig = async (
  config: Partial<OrchestratorConfig>,
  mode: 'merge' | 'replace' = 'merge'
): Promise<ImportConfigResult> => {
  return apiCall(async () => {
    const response = await apiClient.post(
      '/config/import',
      { config, version: 1 },
      {
        params: { mode },
      }
    );
    return response.data;
  });
};
