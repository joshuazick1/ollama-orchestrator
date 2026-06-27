// Anthropic API methods

import { apiClient } from './client';
import { ApiError } from './errors';

export interface AnthropicModel {
  id: string;
  type: 'model';
  display_name?: string;
  created_at?: number;
}

export interface AnthropicModelsResponse {
  object: 'list';
  data: AnthropicModel[];
}

export interface AnthropicWarmupRequest {
  servers?: string[];
}

export interface AnthropicWarmupResult {
  serverId: string;
  success: boolean;
  error?: string;
}

export interface AnthropicWarmupResponse {
  success: boolean;
  model: string;
  results: AnthropicWarmupResult[];
  summary: {
    totalServers: number;
    successful: number;
    failed: number;
  };
}

export interface AnthropicUnloadResponse {
  success: boolean;
  model: string;
  results: AnthropicWarmupResult[];
  summary: {
    totalServers: number;
    successful: number;
    failed: number;
  };
}

export interface AnthropicIdleModel {
  serverId: string;
  model: string;
  idleTime: number;
  idleTimeMinutes: number;
}

export interface AnthropicIdleResponse {
  success: boolean;
  threshold: number;
  models: AnthropicIdleModel[];
  count: number;
}

export interface AnthropicRecommendation {
  serverId: string;
  model: string;
  reason: string;
}

export interface AnthropicRecommendationsResponse {
  success: boolean;
  recommendations: AnthropicRecommendation[];
  count: number;
}

export interface AnthropicServerCapabilities {
  serverId: string;
  type: 'saas' | 'self-hosted';
  supportsLifecycle: boolean;
  supportsModels: boolean;
  supportsThinking: boolean;
  supportsCaching: boolean;
  capabilityStatus: 'unknown' | 'declared' | 'confirmed' | 'softRevoked' | 'pending';
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

export const getAnthropicModels = async (): Promise<AnthropicModel[]> => {
  return apiCall(async () => {
    const response = await apiClient.get<AnthropicModelsResponse>('/v1/models');
    return response.data.data;
  });
};

export const warmupAnthropicModel = async (
  model: string,
  servers?: string[]
): Promise<AnthropicWarmupResponse> => {
  return apiCall(async () => {
    const body: AnthropicWarmupRequest = servers ? { servers } : {};
    const response = await apiClient.post<AnthropicWarmupResponse>(
      `/anthropic/${encodeURIComponent(model)}/warmup`,
      body
    );
    return response.data;
  });
};

export const unloadAnthropicModel = async (
  model: string,
  servers?: string[]
): Promise<AnthropicUnloadResponse> => {
  return apiCall(async () => {
    const body: AnthropicWarmupRequest = servers ? { servers } : {};
    const response = await apiClient.post<AnthropicUnloadResponse>(
      `/anthropic/${encodeURIComponent(model)}/unload`,
      body
    );
    return response.data;
  });
};

export const getAnthropicIdleModels = async (
  thresholdMs?: number
): Promise<AnthropicIdleResponse> => {
  return apiCall(async () => {
    const params = thresholdMs !== undefined ? { threshold: String(thresholdMs) } : {};
    const response = await apiClient.get<AnthropicIdleResponse>('/anthropic/idle', { params });
    return response.data;
  });
};

export const getAnthropicRecommendations = async (): Promise<AnthropicRecommendationsResponse> => {
  return apiCall(async () => {
    const response = await apiClient.get<AnthropicRecommendationsResponse>(
      '/anthropic/recommendations'
    );
    return response.data;
  });
};

export const getAnthropicServerCapabilities = async (
  serverId: string
): Promise<AnthropicServerCapabilities> => {
  return apiCall(async () => {
    const response = await apiClient.get<AnthropicServerCapabilities>(
      `/anthropic/servers/${encodeURIComponent(serverId)}/capabilities`
    );
    return response.data;
  });
};
