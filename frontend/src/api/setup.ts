import { apiClient } from './client';
import { ApiError } from './errors';

export interface SetupInput {
  username: string;
  email?: string;
  password: string;
}

export interface SetupResult {
  success: boolean;
  message: string;
}

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

export const setup = async (data: SetupInput): Promise<SetupResult> => {
  return apiCall(async () => {
    const response = await apiClient.post('/setup', data);
    return response.data;
  });
};
