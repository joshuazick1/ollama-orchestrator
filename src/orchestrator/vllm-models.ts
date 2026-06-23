import { z } from 'zod';
import { API_ENDPOINTS } from '../constants/api-endpoints.js';
import { logger } from '../utils/logger.js';

export const VLLMModelMetadataSchema = z.object({
  max_model_len: z.number().optional(),
  quantization: z.string().optional(),
  supports_tool_calling: z.boolean().optional(),
  supports_vision: z.boolean().optional(),
});

export type VLLMModelMeta = z.infer<typeof VLLMModelMetadataSchema>;

export const VLLMModelsResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(
    z.object({
      id: z.string(),
      object: z.literal('model'),
      created: z.number().optional(),
      owned_by: z.string().optional(),
      metadata: VLLMModelMetadataSchema.optional(),
    })
  ),
});

export type VLLMModelsResponse = z.infer<typeof VLLMModelsResponseSchema>;

export function isVLLMServer(serverUrl: string): boolean {
  return serverUrl.toLowerCase().includes('vllm');
}

export function isVLLMResponse(body: unknown): boolean {
  if (!body || typeof body !== 'object') {
    return false;
  }

  const record = body as Record<string, unknown>;

  if (record.data && Array.isArray(record.data)) {
    for (const item of record.data) {
      if (item && typeof item === 'object') {
        const model = item as Record<string, unknown>;
        if (model.metadata && typeof model.metadata === 'object') {
          return true;
        }
        if (model.owned_by === 'vllm') {
          return true;
        }
      }
    }
  }

  return false;
}

export type VLLMProbeResult = {
  models: string[];
  metadata: Record<string, VLLMModelMeta>;
  isVLLM: boolean;
  error?: { endpoint: '/v1/models'; status?: number; reason: string };
};

export async function probeVLLMModels(
  serverUrl: string,
  apiKey: string | undefined,
  timeoutMs: number
): Promise<VLLMProbeResult> {
  const url = `${serverUrl.replace(/\/$/, '')}${API_ENDPOINTS.OPENAI.MODELS}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        models: [],
        metadata: {},
        isVLLM: false,
        error: {
          endpoint: '/v1/models',
          status: response.status,
          reason: response.status === 401 ? 'unauthorized' : 'request failed',
        },
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        models: [],
        metadata: {},
        isVLLM: false,
        error: { endpoint: '/v1/models', reason: 'invalid JSON response' },
      };
    }

    const parsed = VLLMModelsResponseSchema.safeParse(body);
    const isVLLM = isVLLMResponse(body);

    if (!parsed.success) {
      logger.debug('vLLM schema validation failed, using best-effort parsing', {
        serverUrl,
        error: parsed.error.message,
      });
      return extractBestEffort(body, isVLLM);
    }

    const models: string[] = [];
    const metadata: Record<string, VLLMModelMeta> = {};

    for (const item of parsed.data.data) {
      if (item.id) {
        models.push(item.id);
        if (item.metadata) {
          metadata[item.id] = item.metadata;
        }
      }
    }

    return { models, metadata, isVLLM };
  } catch (err) {
    clearTimeout(timeoutId);
    const reason = err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'network error';
    return {
      models: [],
      metadata: {},
      isVLLM: false,
      error: { endpoint: '/v1/models', reason },
    };
  }
}

function extractBestEffort(body: unknown, isVLLMFlag: boolean): VLLMProbeResult {
  const models: string[] = [];
  const metadata: Record<string, VLLMModelMeta> = {};

  if (!body || typeof body !== 'object') {
    return { models, metadata, isVLLM: isVLLMFlag };
  }

  const record = body as Record<string, unknown>;

  if (record.data && Array.isArray(record.data)) {
    for (const item of record.data) {
      if (item && typeof item === 'object') {
        const model = item as Record<string, unknown>;
        const id = model.id;
        if (id && typeof id === 'string') {
          models.push(id);

          const modelMetadata = model.metadata;
          if (modelMetadata && typeof modelMetadata === 'object') {
            const meta = modelMetadata as Record<string, unknown>;
            const extracted: VLLMModelMeta = {};

            if (typeof meta.max_model_len === 'number') {
              extracted.max_model_len = meta.max_model_len;
            }
            if (typeof meta.quantization === 'string') {
              extracted.quantization = meta.quantization;
            }
            if (typeof meta.supports_tool_calling === 'boolean') {
              extracted.supports_tool_calling = meta.supports_tool_calling;
            }
            if (typeof meta.supports_vision === 'boolean') {
              extracted.supports_vision = meta.supports_vision;
            }

            if (Object.keys(extracted).length > 0) {
              metadata[id] = extracted;
            }
          }
        }
      }
    }
  }

  return { models, metadata, isVLLM: isVLLMFlag };
}
