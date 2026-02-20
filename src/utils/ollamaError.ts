/**
 * ollamaError.ts
 * Shared utility for parsing Ollama error responses
 */

import { safeJsonParse } from './json-utils.js';
import { logger } from './logger.js';

/**
 * Parse error response body from Ollama to extract meaningful error message
 * Ollama returns errors in various formats, this function handles them all
 */
export async function parseOllamaError(response: Response): Promise<string> {
  const statusText = `HTTP ${response.status}: ${response.statusText}`;

  try {
    const text = await response.text();

    // Try to parse as JSON first
    try {
      const json = safeJsonParse(text) as { error?: string; message?: string };
      if (json?.error) {
        return `HTTP ${response.status}: ${json.error}`;
      }
      if (json?.message) {
        return `HTTP ${response.status}: ${json.message}`;
      }
    } catch {
      // Not JSON, use text directly
    }

    // If we have text content, use it
    if (text && text.length > 0 && text.length < 500) {
      return `HTTP ${response.status}: ${text}`;
    }

    return statusText;
  } catch {
    // Failed to read body
    return statusText;
  }
}

/**
 * Parse error response from a global Response object (for fetch)
 */
export async function parseOllamaErrorGlobal(response: globalThis.Response): Promise<string> {
  try {
    const contentType = response.headers.get('content-type');

    if (contentType?.includes('application/json')) {
      const data = (await response.json()) as { error?: string };
      return data.error ?? `HTTP ${response.status}: ${response.statusText}`;
    }

    const text = await response.text();
    return text || `HTTP ${response.status}: ${response.statusText}`;
  } catch (error) {
    logger.error('Error parsing Ollama error response:', error);
    return `HTTP ${response.status}: ${response.statusText}`;
  }
}
