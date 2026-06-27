// User management API methods
// Extracted from frontend/src/api.ts

import { apiClient } from './client';
import type { UserResponse, UserAccess, CreateUserData, UpdateUserData } from './types';
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

export const getUsers = async (): Promise<UserResponse[]> => {
  return apiCall(async () => {
    const response = await apiClient.get('/users');
    return response.data.users;
  });
};

export const createUser = async (data: CreateUserData) => {
  return apiCall(async () => {
    const response = await apiClient.post('/users', data);
    return response.data;
  });
};

export const updateUser = async (id: string, data: UpdateUserData) => {
  return apiCall(async () => {
    const response = await apiClient.put(`/users/${id}`, data);
    return response.data;
  });
};

export const deleteUser = async (id: string) => {
  return apiCall(async () => {
    const response = await apiClient.delete(`/users/${id}`);
    return response.data;
  });
};

export const grantServerAccess = async (userId: string, serverId: string) => {
  return apiCall(async () => {
    const response = await apiClient.post(`/users/${userId}/access/server`, { serverId });
    return response.data;
  });
};

export const revokeServerAccess = async (userId: string, serverId: string) => {
  return apiCall(async () => {
    const response = await apiClient.delete(`/users/${userId}/access/server/${serverId}`);
    return response.data;
  });
};

export const grantModelAccess = async (userId: string, serverId: string, model: string) => {
  return apiCall(async () => {
    const response = await apiClient.post(`/users/${userId}/access/model`, { serverId, model });
    return response.data;
  });
};

export const revokeModelAccess = async (userId: string, serverId: string, model: string) => {
  return apiCall(async () => {
    const response = await apiClient.delete(
      `/users/${userId}/access/model/${encodeURIComponent(serverId)}/${encodeURIComponent(model)}`
    );
    return response.data;
  });
};

export const getUserAccess = async (userId: string): Promise<UserAccess> => {
  return apiCall(async () => {
    const response = await apiClient.get(`/users/${userId}/access`);
    return response.data;
  });
};

export const rotateApiKey = async (
  userId: string
): Promise<{ apiKey: string; message: string }> => {
  return apiCall(async () => {
    const response = await apiClient.post(`/users/${userId}/rotate-api-key`);
    return response.data;
  });
};
