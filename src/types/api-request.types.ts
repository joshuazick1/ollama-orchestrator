/**
 * api-request.types.ts
 * Centralized API request and response type definitions.
 * Extracted from controller inline types (Audit C-5).
 */

import type { OllamaDurations } from '../streaming.js';

/** Request body for /api/generate */
export interface GenerateRequestBody {
  model?: string;
  prompt?: string;
  stream?: boolean;
  context?: number[];
  options?: Record<string, unknown>;
  keep_alive?: number;
}

/** Request body for /api/chat */
export interface ChatRequestBody {
  model?: string;
  messages?: unknown[];
  stream?: boolean;
  options?: Record<string, unknown>;
  keep_alive?: number;
}

/** Request body for /api/embeddings */
export interface EmbeddingsRequestBody {
  model?: string;
  prompt?: string;
}

/** Request body for /api/show */
export interface ShowRequestBody {
  model?: string;
}

/** Request body for /api/embed */
export interface EmbedRequestBody {
  model?: string;
  input?: string | string[];
  prompt?: string;
  truncate?: boolean;
  options?: Record<string, unknown>;
  keep_alive?: number;
  dimensions?: number;
}

/** Response from /api/ps */
export interface PsModelEntry {
  name?: string;
  model?: string;
  size?: number;
  digest?: string;
  expires_at?: string;
  size_vram?: number;
  [key: string]: unknown;
}

export interface PsResponse {
  models?: PsModelEntry[];
}

/** Streaming metrics returned from streaming requests */
export interface OllamaStreamingMetrics {
  _streamingMetrics: {
    ttft: number | undefined;
    streamingDuration: number;
  };
  _tokenMetrics?: {
    tokensGenerated: number;
    tokensPrompt: number;
  };
  _chunkData?: {
    chunkCount: number;
    totalBytes: number;
    maxChunkGapMs: number;
    avgChunkSizeBytes: number;
  };
  _ollamaDurations?: OllamaDurations;
}

/** Shape of a request body containing a model name */
export interface ModelRequestBody {
  model?: string;
}

/** Shape of a request body for copying a model (includes source server) */
export interface CopyModelRequestBody extends ModelRequestBody {
  sourceServerId?: string;
}

/** Shape of an Ollama API error response */
export interface OllamaErrorResponse {
  error?: string;
}

/** Shape of an Ollama API pull response */
export interface OllamaPullResponse {
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
}

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: string; text?: string; image_url?: string | { url: string } }>;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface OpenAIChatCompletionRequest {
  model: string;
  messages: OpenAIChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  seed?: number;
  response_format?: { type: 'text' | 'json_object' };
  tools?: Array<{
    type: 'function';
    function: { name: string; description?: string; parameters?: object };
  }>;
  stream_options?: { include_usage?: boolean };
}

export interface OpenAICompletionRequest {
  model: string;
  prompt: string | string[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  seed?: number;
  suffix?: string;
  stream_options?: { include_usage?: boolean };
}

export interface OpenAIEmbeddingRequest {
  model: string;
  input: string | string[];
  encoding_format?: 'float' | 'base64';
  dimensions?: number;
}
