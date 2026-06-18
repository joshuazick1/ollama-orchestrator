// Logs API methods
// Extracted from frontend/src/api.ts

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

export const getLogs = async () => {
  return apiCall(async () => {
    const response = await apiClient.get('/logs');
    return response.data.logs;
  });
};

export const clearLogs = async () => {
  return apiCall(async () => {
    const response = await apiClient.post('/logs/clear');
    return response.data;
  });
};
