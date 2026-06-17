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
