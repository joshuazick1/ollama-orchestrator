// Server management API methods
// Extracted from frontend/src/api.ts

import type { AIServer } from './types';
import { streamFetch } from '../utils/stream-fetch';
import { apiClient } from './client';
import type { PullProgressEvent } from './types';
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

export const getServers = async (): Promise<AIServer[]> => {
  return apiCall(async () => {
    const response = await apiClient.get('/servers');
    return response.data.servers;
  });
};

export const addServer = async (server: {
  id: string;
  url: string;
  type?: 'ollama' | 'openai' | 'auto';
  maxConcurrency?: number;
  apiKey?: string;
  v1Models?: string;
  forceOllama?: boolean;
  forceV1?: boolean;
  forceAnthropic?: boolean;
  anthropicPathOverride?: string;
}) => {
  return apiCall(async () => {
    const backendPayload: Record<string, unknown> = {
      id: server.id,
      url: server.url,
      type: server.type,
      maxConcurrency: server.maxConcurrency,
      apiKey: server.apiKey,
    };

    if (server.anthropicPathOverride) {
      backendPayload.endpointOverrides = {
        anthropic_messages: server.anthropicPathOverride,
      };
    }

    if (
      server.forceOllama !== undefined ||
      server.forceV1 !== undefined ||
      server.forceAnthropic !== undefined
    ) {
      backendPayload.forcedCapabilities = {
        supportsOllama: server.forceOllama ?? false,
        supportsV1: server.forceV1 ?? false,
        supportsAnthropic: server.forceAnthropic ?? false,
      };
    }

    if (server.v1Models) {
      backendPayload.v1Models = server.v1Models;
    }

    const response = await apiClient.post('/servers/add', backendPayload);
    return response.data;
  });
};

export const removeServer = async (id: string) => {
  return apiCall(async () => {
    const response = await apiClient.delete(`/servers/${id}`);
    return response.data;
  });
};

export const updateServer = async (id: string, updates: Partial<AIServer>) => {
  return apiCall(async () => {
    const response = await apiClient.patch(`/servers/${id}`, updates);
    return response.data;
  });
};

export const drainServer = async (serverId: string) => {
  return apiCall(async () => {
    const response = await apiClient.post(`/servers/${serverId}/drain`);
    return response.data;
  });
};

export const undrainServer = async (serverId: string) => {
  return apiCall(async () => {
    const response = await apiClient.post(`/servers/${serverId}/undrain`);
    return response.data;
  });
};

export const setServerMaintenance = async (serverId: string, enabled: boolean) => {
  return apiCall(async () => {
    const response = await apiClient.post(`/servers/${serverId}/maintenance`, { enabled });
    return response.data;
  });
};

export const refreshV1Models = async (serverId: string) => {
  return apiCall(async () => {
    const response = await apiClient.post(`/servers/${serverId}/refresh-v1-models`);
    return response.data;
  });
};

export const listServerModels = async (serverId: string) => {
  return apiCall(async () => {
    const response = await apiClient.get(`/servers/${serverId}/models`);
    return response.data;
  });
};

/**
 * Start a streaming model pull via SSE.
 * Returns an AbortController so the caller can cancel, and calls onProgress for each event.
 */
export function streamPullModelToServer(
  serverId: string,
  model: string,
  onProgress: (event: PullProgressEvent) => void,
  onError: (error: Error) => void
): AbortController {
  return streamFetch<PullProgressEvent>({
    url: `/api/orchestrator/servers/${serverId}/models/pull`,
    body: { model },
    onEvent: onProgress,
    onError,
  });
}

/**
 * Start a streaming model copy via SSE.
 * Returns an AbortController so the caller can cancel.
 */
export function streamCopyModelToServer(
  serverId: string,
  model: string,
  sourceServerId: string | undefined,
  onProgress: (event: PullProgressEvent) => void,
  onError: (error: Error) => void
): AbortController {
  return streamFetch<PullProgressEvent>({
    url: `/api/orchestrator/servers/${serverId}/models/copy`,
    body: { model, sourceServerId },
    onEvent: onProgress,
    onError,
  });
}

/** @deprecated Use streamPullModelToServer instead for progress tracking */
export const pullModelToServer = async (serverId: string, model: string) => {
  return apiCall(async () => {
    const response = await apiClient.post(`/servers/${serverId}/models/pull`, { model });
    return response.data;
  });
};

export const deleteModelFromServer = async (serverId: string, model: string) => {
  return apiCall(async () => {
    const response = await apiClient.delete(
      `/servers/${encodeURIComponent(serverId)}/models/${encodeURIComponent(model)}`
    );
    return response.data;
  });
};

/** @deprecated Use streamCopyModelToServer instead for progress tracking */
export const copyModelToServer = async (
  serverId: string,
  model: string,
  sourceServerId?: string
) => {
  return apiCall(async () => {
    const response = await apiClient.post(`/servers/${serverId}/models/copy`, {
      model,
      sourceServerId,
    });
    return response.data;
  });
};
