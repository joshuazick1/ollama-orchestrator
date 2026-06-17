/**
 * probe-executor.ts
 * Real HTTP probe executor function for the probe subsystem.
 *
 * Makes HTTP requests against server endpoints and classifies the result
 * using the probe subsystem's failure classifier.
 */

import type { Tuple, Classification } from '../probe/types.js';
import { classify } from '../probe/failure-classifier.js';

/**
 * Maps ProbeEndpoint types to their HTTP URL paths.
 */
export const ENDPOINT_PATHS: Record<Tuple['endpoint'], string> = {
  ollama_chat: '/api/chat',
  ollama_generate: '/api/generate',
  ollama_embeddings: '/api/embeddings',
  openai_chat: '/v1/chat/completions',
  openai_completions: '/v1/completions',
  openai_embeddings: '/v1/embeddings',
  anthropic_messages: '/v1/messages',
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      return { success: true };
    }

    // Classify non-OK responses based on status code and headers
    const retryAfterHeader = response.headers.get('Retry-After') ?? undefined;
    const classification = classify(new Error(`HTTP ${response.status}`), {
      endpoint: tuple.endpoint,
      httpStatus: response.status,
      retryAfterHeader,
    });

    return { success: false, classification };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      const classification = classify(new Error('AbortError'), { endpoint: tuple.endpoint });
      return { success: false, classification };
    }

    const classification = classify(error instanceof Error ? error : String(error), {
      endpoint: tuple.endpoint,
    });
    return { success: false, classification };
  }
}
