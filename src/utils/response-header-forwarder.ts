/**
 * response-header-forwarder.ts
 * Forwards upstream response headers to the client, filtering hop-by-hop headers
 * and preserving critical provider-specific headers.
 */

import type { Response } from 'express';

/**
 * Hop-by-hop headers that should NOT be forwarded to clients.
 * These are meaningful only for the immediate connection and are handled
 * by the orchestrator's own proxying layer.
 * @see RFC 7230 §6.1
 */
export const HOP_BY_HOP_RESPONSE_HEADERS = new Set<string>([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
]);

/**
 * Orchestrator override headers — these may be transformed or stripped
 * because the orchestrator may modify the response body (e.g., encoding,
 * content transformation, streaming mode changes).
 */
export const ORCHESTRATOR_OVERRIDE_HEADERS = new Set<string>([
  'content-encoding',
  'content-length',
]);

/**
 * Critical provider-specific headers that must be preserved verbatim.
 * These carry important metadata like request IDs, rate limits, retry info.
 */
export const PROVIDER_HEADER_WHITELIST = new Set<string>([
  // Request identification
  'request-id',
  'x-request-id',
  // Retry and rate limit guidance
  'retry-after-ms',
  'retry-after',
  // OpenAI-specific headers
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-used',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-remaining-tokens',
  'openai-organization',
  'openai-version',
  'openai-processing-ms',
  // Retry decision headers
  'x-should-retry',
  // Anthropic-specific headers
  'anthropic-organization',
  'anthropic-version',
  'anthropic-warning',
  // Cloudflare and other CDN/proxy headers (may be set by upstream)
  'cf-ray',
  'cf-cache-status',
  'x-some-critical-header',
]);

/**
 * Provider-specific Content-Type overrides.
 * When streaming, some providers need their Content-Type overridden to SSE.
 */
export type ProviderType = 'openai' | 'anthropic' | 'ollama' | 'unknown';

export interface ForwardResponseHeadersOptions {
  /**
   * Override the Content-Type header for this response.
   * Useful when transforming between NDJSON and SSE formats.
   */
  contentTypeOverride?: string;
  /**
   * Additional headers to set (e.g., Cache-Control for SSE streams).
   * These are set AFTER forwarding upstream headers, so they can override.
   */
  additionalHeaders?: Record<string, string>;
  /**
   * Provider type for determining which headers to preserve.
   */
  provider?: ProviderType;
}

/**
 * Check if a header name matches a whitelist pattern.
 * Supports exact matches and wildcard patterns like `x-ratelimit-*`.
 */
function isHeaderWhitelisted(headerName: string): boolean {
  const lowerName = headerName.toLowerCase();

  // Check exact match
  if (PROVIDER_HEADER_WHITELIST.has(lowerName)) {
    return true;
  }

  // Check wildcard patterns
  if (lowerName.startsWith('x-ratelimit-')) {
    return true;
  }

  return false;
}

/**
 * Forward upstream response headers to the client response.
 *
 * @param upstreamHeaders - The upstream Response headers object
 * @param clientResponse - The Express Response object to set headers on
 * @param options - Optional configuration for header forwarding
 */
export function forwardResponseHeaders(
  upstreamHeaders: Headers,
  clientResponse: Response,
  options: ForwardResponseHeadersOptions = {}
): void {
  const { contentTypeOverride, additionalHeaders, provider } = options;

  // Iterate through all upstream headers
  upstreamHeaders.forEach((value, headerName) => {
    const lowerName = headerName.toLowerCase();

    // Skip hop-by-hop headers
    if (HOP_BY_HOP_RESPONSE_HEADERS.has(lowerName)) {
      return;
    }

    // Skip orchestrator override headers (may need transformation)
    if (ORCHESTRATOR_OVERRIDE_HEADERS.has(lowerName)) {
      return;
    }

    // Always preserve critical whitelisted headers
    if (isHeaderWhitelisted(lowerName)) {
      clientResponse.setHeader(headerName, value);
      return;
    }

    // For non-whitelisted headers, forward them verbatim (case-preserved)
    // This includes standard headers like Content-Type, Date, Server, etc.
    clientResponse.setHeader(headerName, value);
  });

  // Apply Content-Type override if specified (e.g., SSE for streaming)
  if (contentTypeOverride) {
    clientResponse.setHeader('Content-Type', contentTypeOverride);
  }

  // Apply additional headers last (can override forwarded headers)
  if (additionalHeaders) {
    for (const [key, value] of Object.entries(additionalHeaders)) {
      clientResponse.setHeader(key, value);
    }
  }
}

/**
 * Forward headers for a non-streaming response.
 * Preserves all upstream headers except hop-by-hop and orchestrator overrides.
 */
export function forwardNonStreamingResponseHeaders(
  upstreamResponse: globalThis.Response,
  clientResponse: Response,
  options: Omit<ForwardResponseHeadersOptions, 'contentTypeOverride'> = {}
): void {
  forwardResponseHeaders(upstreamResponse.headers, clientResponse, {
    ...options,
    // No content-type override for non-streaming - use upstream's
  });
}

/**
 * Forward headers for a streaming SSE response.
 * Overrides Content-Type to text/event-stream and adds SSE-appropriate headers.
 */
export function forwardStreamingResponseHeaders(
  upstreamResponse: globalThis.Response,
  clientResponse: Response,
  options: Omit<ForwardResponseHeadersOptions, 'contentTypeOverride'> & {
    /**
     * Override Content-Type. Defaults to 'text/event-stream' for SSE.
     */
    contentType?: string;
  } = {}
): void {
  const { contentType = 'text/event-stream', ...rest } = options;

  // SSE streaming defaults
  const sseDefaults: Record<string, string> = {
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };

  forwardResponseHeaders(upstreamResponse.headers, clientResponse, {
    ...rest,
    contentTypeOverride: contentType,
    additionalHeaders: {
      ...sseDefaults,
      ...rest.additionalHeaders,
    },
  });
}
