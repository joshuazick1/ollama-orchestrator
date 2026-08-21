/**
 * probe-executor.ts
 * Real HTTP probe executor function for the probe subsystem.
 *
 * Makes HTTP requests against server endpoints and classifies the result
 * using the probe subsystem's failure classifier.
 */

import { API_ENDPOINTS } from '../constants/api-endpoints.js';
import { classify } from '../probe/failure-classifier.js';
import type { Tuple, Classification } from '../probe/types.js';
import { httpProbeWithTimeout } from '../utils/http-probe-with-timeout.js';

/**
 * Maps ProbeEndpoint types to their HTTP URL paths.
 */
export const ENDPOINT_PATHS: Record<Tuple['endpoint'], string> = {
  ollama_chat: API_ENDPOINTS.OLLAMA.CHAT,
  ollama_generate: API_ENDPOINTS.OLLAMA.GENERATE,
  ollama_embeddings: API_ENDPOINTS.OLLAMA.EMBEDDINGS,
  openai_chat: API_ENDPOINTS.OPENAI.CHAT_COMPLETIONS,
  openai_completions: API_ENDPOINTS.OPENAI.COMPLETIONS,
  openai_embeddings: API_ENDPOINTS.OPENAI.EMBEDDINGS,
  anthropic_messages: API_ENDPOINTS.ANTHROPIC.MESSAGES,
};

/**
 * Request bodies for each endpoint type (minimal valid payloads).
 */
export const ENDPOINT_BODIES: Record<Tuple['endpoint'], Record<string, unknown>> = {
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
};

/**
 * Default probe timeout in milliseconds.
 */
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

/**
 * Execute a real HTTP probe against a server:model:endpoint tuple.
 *
 * @param tuple - The tuple to probe (serverId, model, endpoint)
 * @param options - Optional configuration (serverUrl, apiKey, timeoutMs)
 * @returns Promise resolving to { success, classification }
 */
export async function probeExecutor(
  tuple: Tuple,
  options: {
    serverUrl: string;
    apiKey?: string;
    timeoutMs?: number;
  }
): Promise<{ success: boolean; classification?: Classification }> {
  const { serverUrl, apiKey, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = options;

  const path = ENDPOINT_PATHS[tuple.endpoint];
  const body = ENDPOINT_BODIES[tuple.endpoint];
  const url = `${serverUrl.replace(/\/$/, '')}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const result = await httpProbeWithTimeout(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
    timeoutMs,
    apiKey,
  });

  if (result.aborted) {
    const classification = classify(new Error('AbortError'), { endpoint: tuple.endpoint });
    return { success: false, classification };
  }

  if (result.ok) {
    return { success: true };
  }

  const retryAfterHeader = result.headers?.get('Retry-After') ?? undefined;
  const classification = classify(new Error(`HTTP ${result.status}`), {
    endpoint: tuple.endpoint,
    httpStatus: result.status,
    retryAfterHeader,
  });
  return { success: false, classification };
}
