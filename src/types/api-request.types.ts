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

/**
 * Logprobs content entry for chat completion choices.
 * @see https://platform.openai.com/docs/api-reference/chat/create#chat-create-logprobs
 */
export interface OpenAILogprobsContentEntry {
  token: string;
  bytes?: number[];
  logprob: number;
  top_logprobs: Array<{
    token: string;
    bytes?: number[];
    logprob: number;
  }>;
}

/**
 * Logprobs root for chat completion.
 * @see https://platform.openai.com/docs/api-reference/chat/create#chat-create-logprobs
 */
export interface OpenAILogprobs {
  content?: OpenAILogprobsContentEntry[];
}

/**
 * Chat completion chunk choice with optional logprobs.
 * Used in streaming responses (/v1/chat/completions stream).
 * @see https://platform.openai.com/docs/api-reference/chat/streaming#chat-stream-choices
 */
export interface OpenAIChatCompletionChunkChoice {
  index: number;
  delta: {
    role?: string;
    content?: string;
    tool_calls?: Array<{
      index: number;
      id?: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
  };
  finish_reason?: string | null;
  logprobs?: OpenAILogprobs;
}

/**
 * @see https://platform.openai.com/docs/api-reference/chat/create
 */
export interface OpenAIChatCompletionRequest {
  model: string;
  messages: OpenAIChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  // P0: num_samples
  /** Number of chat completion choices to generate. Defaults to 1, max 10. */
  n?: number;
  // P0: logprobs
  /** Whether to return log probabilities of the output tokens. */
  logprobs?: boolean;
  /** Max number of top logprobs to return per token. Only meaningful when logprobs=true. */
  top_logprobs?: number;
  stream?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  seed?: number;
  // P1: response_format with json_schema support
  /**
   * Response format constraint.
   * @see https://platform.openai.com/docs/api-reference/chat/create#chat-create-response_format
   */
  response_format?:
    | { type: 'text' }
    | { type: 'json_object' }
    | {
        type: 'json_schema';
        json_schema: {
          name: string;
          description?: string;
          schema?: object;
          strict?: boolean;
        };
      };
  tools?: Array<{
    type: 'function';
    function: { name: string; description?: string; parameters?: object };
  }>;
  // P1: parallel_tool_calls
  /**
   * Whether to allow parallel function calls.
   * @see https://platform.openai.com/docs/api-reference/chat/create#chat-create-parallel_tool_calls
   */
  parallel_tool_calls?: boolean;
  // P1: tool_choice
  /**
   * Controls which function is called. 'auto', 'none', 'required', or an explicit function object.
   * @see https://platform.openai.com/docs/api-reference/chat/create#chat-create-tool_choice
   */
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  stream_options?: { include_usage?: boolean };
}

/**
 * @see https://platform.openai.com/docs/api-reference/completions/create
 */
export interface OpenAICompletionRequest {
  model: string;
  prompt: string | string[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  // P0: logprobs (0-5 per spec)
  /**
   * Log probability of most likely tokens. Integer 0-5.
   * @see https://platform.openai.com/docs/api-reference/completions/create#completions-create-logprobs
   */
  logprobs?: number;
  /** Max number of top logprobs to return per token. Integer 0-20. */
  top_logprobs?: number;
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
