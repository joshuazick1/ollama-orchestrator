/**
 * header-forwarder.ts
 * Header forwarding utility for upstream requests.
 * Strips hop-by-hop headers (RFC 7230 §6.1) and orchestrator-internal headers,
 * preserves all other client headers verbatim, and injects per-provider auth.
 */

import type { AIServer } from '../orchestrator/orchestrator.types.js';

import { resolveApiKey } from './api-keys.js';

/**
 * Hop-by-hop headers defined in RFC 7230 §6.1.
 * These must be stripped before forwarding to upstream servers.
 */
export const HOP_BY_HOP_HEADERS = new Set<string>([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  // content-length must be recomputed by the sending agent — forwarding a
  // client-supplied value that doesn't match the re-serialized body makes
  // undici throw "fetch failed: Request body length does not match
  // content-length header", breaking every proxied request.
  'content-length',
]);

/**
 * Prefixes for orchestrator-internal headers that must be stripped.
 * These headers are added by the orchestrator and should not reach upstream servers.
 */
const INTERNAL_HEADER_PREFIXES: string[] = ['x-orchestrator-', 'x-failover-'];

/**
 * Specific internal header names that must be stripped.
 */
const INTERNAL_HEADER_NAMES = new Set<string>(['x-algorithm', 'x-selected-server']);

/**
 * Provider type for per-provider auth injection.
 */
export type ProviderType = 'anthropic' | 'openai' | 'ollama';

/**
 * Configuration for the header forwarder.
 */
export interface HeaderForwarderConfig {
  /** Additional headers to strip beyond hop-by-hop and internal headers */
  stripHeaders?: string[];
}

/**
 * Check if a header name is a hop-by-hop header (case-insensitive).
 */
function isHopByHopHeader(name: string): boolean {
  return HOP_BY_HOP_HEADERS.has(name.toLowerCase());
}

/**
 * Check if a header name is an internal orchestrator header (case-insensitive).
 */
function isInternalHeader(name: string): boolean {
  const lowerName = name.toLowerCase();
  if (INTERNAL_HEADER_NAMES.has(lowerName)) {
    return true;
  }
  for (const prefix of INTERNAL_HEADER_PREFIXES) {
    if (lowerName.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a header name should be stripped (case-insensitive).
 */
function shouldStripHeader(name: string, stripHeaders: Set<string>): boolean {
  return stripHeaders.has(name.toLowerCase());
}

/**
 * Forward request headers from client to upstream server.
 *
 * - Strips hop-by-hop headers per RFC 7230 §6.1
 * - Strips orchestrator-internal headers (x-orchestrator-*, x-failover-*, x-algorithm, x-selected-server)
 * - Preserves all other client headers verbatim (case-preserved)
 * - Injects per-provider auth headers
 *
 * @param clientHeaders - Headers from the incoming client request (Record or Headers)
 * @param provider - The provider type for auth injection
 * @param server - The target AIServer for auth configuration
 * @param config - Optional header forwarder configuration
 * @returns Record of headers to send to the upstream server
 */
export function forwardRequestHeaders(
  clientHeaders: Record<string, string | string[] | undefined>,
  provider: ProviderType,
  server: AIServer,
  config?: HeaderForwarderConfig
): Record<string, string> {
  // Build set of additional headers to strip (case-insensitive)
  const stripHeadersSet = new Set<string>((config?.stripHeaders ?? []).map(h => h.toLowerCase()));

  const result: Record<string, string> = {};

  // Process client headers
  for (const [name, value] of Object.entries(clientHeaders)) {
    // Skip undefined values
    if (value === undefined) {
      continue;
    }

    // Skip hop-by-hop headers
    if (isHopByHopHeader(name)) {
      continue;
    }

    // Skip internal orchestrator headers
    if (isInternalHeader(name)) {
      continue;
    }

    // Skip additional configured headers to strip
    if (shouldStripHeader(name, stripHeadersSet)) {
      continue;
    }

    // For array values (multi-value headers), take the first value
    const headerValue = Array.isArray(value) ? value[0] : value;
    if (headerValue !== undefined) {
      result[name] = headerValue;
    }
  }

  // Inject per-provider auth headers
  injectAuthHeaders(result, provider, server);

  return result;
}

/**
 * Inject authentication headers based on provider type.
 *
 * - Anthropic: prefer client's x-api-key, else use server's apiKey as x-api-key
 * - OpenAI: prefer client's Authorization: Bearer, else build from server's apiKey
 * - Ollama: only add Authorization: Bearer if server has apiKey configured
 */
function injectAuthHeaders(
  headers: Record<string, string>,
  provider: ProviderType,
  server: AIServer
): void {
  switch (provider) {
    case 'anthropic': {
      // Prefer client's x-api-key, else use server's apiKey
      if (headers['x-api-key']) {
        // Client provided x-api-key, keep as-is
        return;
      }
      // Inject server's apiKey as x-api-key (no Bearer prefix for Anthropic)
      const anthropicKey = resolveApiKey(server.apiKey);
      if (anthropicKey) {
        headers['x-api-key'] = anthropicKey;
      }
      break;
    }

    case 'openai': {
      // Prefer client's Authorization: Bearer, else build from server's apiKey
      const authHeader = headers['authorization'] ?? headers['Authorization'];
      if (
        authHeader &&
        typeof authHeader === 'string' &&
        authHeader.toLowerCase().startsWith('bearer ')
      ) {
        // Client provided Authorization: Bearer, keep as-is
        return;
      }
      // Inject server's apiKey as Authorization: Bearer
      const openaiKey = resolveApiKey(server.apiKey);
      if (openaiKey) {
        headers['Authorization'] = `Bearer ${openaiKey}`;
      }
      break;
    }

    case 'ollama': {
      // Only add Authorization: Bearer if server has apiKey configured
      // Do NOT override if client already provided one
      if (headers['authorization'] ?? headers['Authorization']) {
        return;
      }
      const ollamaKey = resolveApiKey(server.apiKey);
      if (ollamaKey) {
        headers['Authorization'] = `Bearer ${ollamaKey}`;
      }
      break;
    }
  }
}
