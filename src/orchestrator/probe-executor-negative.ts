/**
 * probe-executor-negative.ts
 * Negative probe executor for detecting server-side capability gaps.
 *
 * Sends intentionally invalid requests (with impossible model names)
 * and inspects response bodies/status codes to detect:
 * - Model not found (server has model but not this one)
 * - Endpoint absent (server doesn't support this endpoint)
 * - Mid-stream errors (server validates after accepting request)
 * - Suspicious validation bypass (200 OK on invalid model = no validation)
 *
 * Used to determine what capabilities a server truly supports.
 */

import { API_ENDPOINTS } from '../constants/api-endpoints.js';
import { classify } from '../probe/failure-classifier.js';
import type { Classification, ProbeEndpoint } from '../probe/types.js';

/**
 * Maps Endpoint types to their HTTP URL paths.
 * Includes all 11 endpoints: 7 inference + 4 admin/listing.
 */
const ENDPOINT_PATHS: Record<Endpoint, string> = {
  ollama_chat: API_ENDPOINTS.OLLAMA.CHAT,
  ollama_generate: API_ENDPOINTS.OLLAMA.GENERATE,
  ollama_embeddings: API_ENDPOINTS.OLLAMA.EMBEDDINGS,
  openai_chat: API_ENDPOINTS.OPENAI.CHAT_COMPLETIONS,
  openai_completions: API_ENDPOINTS.OPENAI.COMPLETIONS,
  openai_embeddings: API_ENDPOINTS.OPENAI.EMBEDDINGS,
  anthropic_messages: API_ENDPOINTS.ANTHROPIC.MESSAGES,
  ollama_tags: API_ENDPOINTS.OLLAMA.TAGS,
  ollama_ps: API_ENDPOINTS.OLLAMA.PS,
  ollama_version: API_ENDPOINTS.OLLAMA.VERSION,
  openai_models: API_ENDPOINTS.OPENAI.MODELS,
};

/**
 * Request bodies for inference endpoint types (minimal valid payloads).
 * Admin endpoints use GET with no body.
 */
const ENDPOINT_BODIES: Record<Endpoint, Record<string, unknown>> = {
  ollama_chat: {
    model: '__probe__',
    messages: [{ role: 'user', content: 'probe' }],
    stream: false,
  },
  ollama_generate: { model: '__probe__', prompt: 'probe', stream: false },
  ollama_embeddings: { model: '__probe__', prompt: 'probe' },
  openai_chat: {
    model: '__probe__',
    messages: [{ role: 'user', content: 'probe' }],
    stream: false,
  },
  openai_completions: { model: '__probe__', prompt: 'probe', stream: false },
  openai_embeddings: { model: '__probe__', input: 'probe' },
  anthropic_messages: { model: '__probe__', messages: [{ role: 'user', content: 'probe' }] },
  ollama_tags: {},
  ollama_ps: {},
  ollama_version: {},
  openai_models: {},
};

/**
 * All supported endpoint types for the negative probe.
 */
export type Endpoint =
  | 'ollama_chat'
  | 'ollama_generate'
  | 'ollama_embeddings'
  | 'openai_chat'
  | 'openai_completions'
  | 'openai_embeddings'
  | 'anthropic_messages'
  | 'ollama_tags'
  | 'ollama_ps'
  | 'ollama_version'
  | 'openai_models';

/**
 * Admin/listing endpoints that use GET and don't require model capability.
 */
const ADMIN_ENDPOINTS: readonly Endpoint[] = [
  'ollama_tags',
  'ollama_ps',
  'ollama_version',
  'openai_models',
];

/**
 * Invalid model name used to probe for validation behavior.
 * This model name is designed to never exist on any server.
 */
export const INVALID_MODEL_NAME = '__neg_probe_definitely_not_a_model_xyz_12345__';

/**
 * Default probe timeout in milliseconds.
 */
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

/**
 * Result of a negative probe execution.
 */
export type NegativeProbeResult = {
  /** Whether the request completed successfully (server reached, no network error) */
  success: boolean;
  /** Whether the server confirmed it has the capability (even if model not found) */
  capabilityConfirmed: boolean;
  /** Whether the response indicates the specific model doesn't exist */
  modelNotFound: boolean;
  /** Whether the endpoint doesn't exist on this server */
  endpointAbsent: boolean;
  /** Whether an error occurred mid-stream (after accepting request) */
  midStreamError: boolean;
  /** Whether server returned 200 for invalid model (suspicious behavior) */
  suspicious: boolean;
  /** Whether a network-level error occurred */
  networkError: boolean;
  /** Whether the request timed out */
  timedOut: boolean;
  /** Whether this error can be retried */
  retryable: boolean;
  /** Suggested retry delay in milliseconds */
  retryAfterMs?: number;
  /** Classification result from failure classifier */
  classification?: Classification;
  /** HTTP status code if response was received */
  status?: number;
  /** Response body text (truncated) */
  body?: string;
  /** How long the request took in milliseconds */
  durationMs?: number;
  /** Error message for unexpected errors */
  error?: string;
};

/**
 * Input tuple for negative probe.
 */
interface NegativeProbeTuple {
  serverId: string;
  model: string;
  endpoint: Endpoint;
}

/**
 * Execute a negative probe against a server:model:endpoint tuple.
 *
 * The negative probe sends intentionally invalid requests to detect:
 * - Whether the server validates model names (modelNotFound vs suspicious)
 * - Whether the endpoint exists (endpointAbsent vs capabilityConfirmed)
 * - Whether the server validates mid-stream (midStreamError)
 *
 * @param tuple - The tuple to probe (serverId, model, endpoint)
 * @param options - Optional configuration (serverUrl, apiKey, timeoutMs)
 * @returns Promise resolving to NegativeProbeResult
 */
export async function probeExecutorNegative(
  tuple: NegativeProbeTuple,
  options: {
    serverUrl: string;
    apiKey?: string;
    timeoutMs?: number;
  }
): Promise<NegativeProbeResult> {
  const { serverUrl, apiKey, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = options;
  const { endpoint } = tuple;

  const isAdminEndpoint = ADMIN_ENDPOINTS.includes(endpoint);
  const path = ENDPOINT_PATHS[endpoint];
  const url = `${serverUrl.replace(/\/$/, '')}${path}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startTime = Date.now();

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    let response: Response;

    if (isAdminEndpoint) {
      // Admin endpoints: GET request, no body
      response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
    } else {
      // Inference endpoints: POST with invalid model name
      const bodyTemplate = ENDPOINT_BODIES[endpoint];
      const body = replaceModelInBody(bodyTemplate, INVALID_MODEL_NAME);

      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    }

    clearTimeout(timeoutId);
    const durationMs = Date.now() - startTime;

    // Handle rate limiting first (applies to all endpoints)
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('Retry-After') ?? undefined;
      const body = await safeReadBody(response);
      const classification = classify(new Error(`HTTP ${response.status}`), {
        endpoint: endpoint as ProbeEndpoint,
        httpStatus: 429,
        retryAfterHeader,
      });

      return {
        success: true,
        capabilityConfirmed: false,
        modelNotFound: false,
        endpointAbsent: false,
        midStreamError: false,
        suspicious: false,
        networkError: false,
        timedOut: false,
        retryable: true,
        retryAfterMs: classification.retryAfterMs,
        classification,
        status: 429,
        body,
        durationMs,
      };
    }

    // Handle admin endpoints (GET - simpler classification)
    if (isAdminEndpoint) {
      return handleAdminEndpointResponse(response, durationMs);
    }

    // Handle inference endpoints (POST - body inspection required)
    return handleInferenceEndpointResponse(response, durationMs, endpoint);
  } catch (error) {
    clearTimeout(timeoutId);
    const durationMs = Date.now() - startTime;

    if (error instanceof Error) {
      // AbortError means timeout
      if (error.name === 'AbortError') {
        return {
          success: false,
          capabilityConfirmed: false,
          modelNotFound: false,
          endpointAbsent: false,
          midStreamError: false,
          suspicious: false,
          networkError: true,
          timedOut: true,
          retryable: true,
          durationMs,
        };
      }

      // Connection errors indicate network issues
      const errorMsg = error.message.toLowerCase();
      if (
        errorMsg.includes('econnrefused') ||
        errorMsg.includes('etimedout') ||
        errorMsg.includes('enotfound') ||
        errorMsg.includes('econnreset') ||
        errorMsg.includes('connection refused') ||
        errorMsg.includes('connection reset') ||
        errorMsg.includes('timeout')
      ) {
        return {
          success: false,
          capabilityConfirmed: false,
          modelNotFound: false,
          endpointAbsent: false,
          midStreamError: false,
          suspicious: false,
          networkError: true,
          timedOut: false,
          retryable: true,
          durationMs,
        };
      }

      // Other errors
      return {
        success: false,
        capabilityConfirmed: false,
        modelNotFound: false,
        endpointAbsent: false,
        midStreamError: false,
        suspicious: false,
        networkError: true,
        timedOut: false,
        retryable: false,
        error: error.message,
        durationMs,
      };
    }

    // Unknown error type
    return {
      success: false,
      capabilityConfirmed: false,
      modelNotFound: false,
      endpointAbsent: false,
      midStreamError: false,
      suspicious: false,
      networkError: true,
      timedOut: false,
      retryable: false,
      error: String(error),
      durationMs,
    };
  }
}

/**
 * Handle response from admin/listing endpoints (GET, no model needed).
 */
async function handleAdminEndpointResponse(
  response: Response,
  durationMs: number
): Promise<NegativeProbeResult> {
  const status = response.status;
  const body = await safeReadBody(response);

  if (response.ok) {
    return {
      success: true,
      capabilityConfirmed: true,
      modelNotFound: false,
      endpointAbsent: false,
      midStreamError: false,
      suspicious: false,
      networkError: false,
      timedOut: false,
      retryable: false,
      status,
      body,
      durationMs,
    };
  }

  // Non-OK response for admin endpoint - determine retryability from status code
  // (don't use classify() since it only accepts ProbeEndpoint, not admin endpoints)
  const isRetryableStatus = status === 429 || status >= 500;
  const retryAfterHeader = response.headers.get('Retry-After') ?? undefined;

  return {
    success: false,
    capabilityConfirmed: false,
    modelNotFound: false,
    endpointAbsent: status === 404,
    midStreamError: false,
    suspicious: false,
    networkError: false,
    timedOut: false,
    retryable: isRetryableStatus,
    retryAfterMs: retryAfterHeader ? parseRetryAfterMs(retryAfterHeader) : undefined,
    status,
    body,
    durationMs,
  };
}

/**
 * Handle response from inference endpoints (POST, body inspection required).
 */
async function handleInferenceEndpointResponse(
  response: Response,
  durationMs: number,
  endpoint: Endpoint
): Promise<NegativeProbeResult> {
  const status = response.status;
  const body = await safeReadBody(response);

  // 404: distinguish model-not-found from endpoint-absent
  if (status === 404) {
    return classify404Response(response, body, endpoint, durationMs);
  }

  // 200: check for mid-stream errors or suspicious validation bypass
  if (status === 200) {
    return classify200Response(response, body, durationMs);
  }

  // Other non-OK status: use failure classifier
  const retryAfterHeader = response.headers.get('Retry-After') ?? undefined;
  const classification = classify(new Error(`HTTP ${status}`), {
    endpoint: endpoint as ProbeEndpoint,
    httpStatus: status,
    retryAfterHeader,
  });

  return {
    success: false,
    capabilityConfirmed: false,
    modelNotFound: false,
    endpointAbsent: false,
    midStreamError: false,
    suspicious: false,
    networkError: false,
    timedOut: false,
    retryable: classification.retryable,
    retryAfterMs: classification.retryAfterMs,
    classification,
    status,
    body,
    durationMs,
  };
}

/**
 * Classify a 404 response by inspecting the body.
 */
function classify404Response(
  response: Response,
  body: string,
  endpoint: Endpoint,
  durationMs: number
): NegativeProbeResult {
  // Try to parse as JSON and check for model-not-found pattern
  try {
    const json = JSON.parse(body);
    const errorMessage = json.error?.message || json.error?.error || json.error || '';

    // Check for model-not-found patterns
    if (
      typeof errorMessage === 'string' &&
      (errorMessage.includes('not found') ||
        errorMessage.includes('does not exist') ||
        errorMessage.includes("model '") ||
        errorMessage.includes('model "'))
    ) {
      return {
        success: false,
        capabilityConfirmed: true,
        modelNotFound: true,
        endpointAbsent: false,
        midStreamError: false,
        suspicious: false,
        networkError: false,
        timedOut: false,
        retryable: false,
        status: 404,
        body,
        durationMs,
      };
    }
  } catch {
    // Not JSON, fall through to HTML detection
  }

  // Check for HTML body (endpoint absent)
  if (isHtmlBody(body)) {
    return {
      success: false,
      capabilityConfirmed: false,
      modelNotFound: false,
      endpointAbsent: true,
      midStreamError: false,
      suspicious: false,
      networkError: false,
      timedOut: false,
      retryable: false,
      status: 404,
      body,
      durationMs,
    };
  }

  // 404 but not clearly model-not-found or HTML
  const retryAfterHeader = response.headers.get('Retry-After') ?? undefined;
  const classification = classify(new Error(`HTTP 404`), {
    endpoint: endpoint as ProbeEndpoint,
    httpStatus: 404,
    retryAfterHeader,
  });

  return {
    success: false,
    capabilityConfirmed: false,
    modelNotFound: false,
    endpointAbsent: true,
    midStreamError: false,
    suspicious: false,
    networkError: false,
    timedOut: false,
    retryable: classification.retryable,
    classification,
    status: 404,
    body,
    durationMs,
  };
}

/**
 * Classify a 200 response for suspicious behavior or mid-stream errors.
 */
function classify200Response(
  response: Response,
  body: string,
  durationMs: number
): NegativeProbeResult {
  const contentType = response.headers.get('Content-Type') ?? '';

  // Check for NDJSON error stream
  if (contentType.includes('x-ndjson') || contentType.includes('ndjson')) {
    // NDJSON error format: {"error":...} or {"error":{"message":...}}
    if (body.includes('"error"') || body.includes("'error'")) {
      return {
        success: true,
        capabilityConfirmed: true,
        modelNotFound: false,
        endpointAbsent: false,
        midStreamError: true,
        suspicious: false,
        networkError: false,
        timedOut: false,
        retryable: true,
        status: 200,
        body,
        durationMs,
      };
    }
  }

  // Try to parse as JSON and check for error field
  try {
    const json = JSON.parse(body);

    // Check for error field at various locations
    const hasError =
      json.error !== undefined ||
      json.error?.message !== undefined ||
      json.error?.error !== undefined;

    if (hasError) {
      return {
        success: true,
        capabilityConfirmed: true,
        modelNotFound: false,
        endpointAbsent: false,
        midStreamError: true,
        suspicious: false,
        networkError: false,
        timedOut: false,
        retryable: true,
        status: 200,
        body,
        durationMs,
      };
    }
  } catch {
    // Not JSON
  }

  // 200 OK with valid-looking response = suspicious (no validation)
  return {
    success: true,
    capabilityConfirmed: false,
    modelNotFound: false,
    endpointAbsent: false,
    midStreamError: false,
    suspicious: true,
    networkError: false,
    timedOut: false,
    retryable: false,
    status: 200,
    body,
    durationMs,
  };
}

/**
 * Replace model name in request body template.
 */
function replaceModelInBody(
  bodyTemplate: Record<string, unknown>,
  invalidModel: string
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(bodyTemplate)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = replaceModelInBody(value as Record<string, unknown>, invalidModel);
    } else if (
      value === '__probe__' ||
      (typeof value === 'string' && value.startsWith('__probe'))
    ) {
      result[key] = invalidModel;
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Safely read response body, handling non-text responses.
 */
async function safeReadBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    // Truncate to prevent huge strings
    return text.length > 10000 ? text.substring(0, 10000) + '...[truncated]' : text;
  } catch {
    return '[could not read body]';
  }
}

/**
 * Check if body looks like HTML (404 page or similar).
 */
function isHtmlBody(body: string): boolean {
  if (!body || body.length === 0) {
    return false;
  }

  const trimmed = body.trim();

  // Starts with HTML tag
  if (trimmed.startsWith('<')) {
    return true;
  }

  // Contains typical HTML 404 phrases
  if (trimmed.toLowerCase().includes('page not found')) {
    return true;
  }
  if (trimmed.toLowerCase().includes('not found')) {
    return true;
  }
  if (trimmed.toLowerCase().includes('404')) {
    return true;
  }

  return false;
}

/**
 * Parse Retry-After header value to milliseconds.
 * Supports seconds (integer or decimal) and HTTP date formats.
 */
function parseRetryAfterMs(header: string): number | undefined {
  const trimmed = header.trim();
  const seconds = Number(trimmed);
  if (!isNaN(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const date = new Date(trimmed);
  if (!isNaN(date.getTime())) {
    const msUntilRetry = date.getTime() - Date.now();
    return msUntilRetry > 0 ? msUntilRetry : undefined;
  }
  return undefined;
}
