/**
 * Streaming mock helpers for Ollama Orchestrator tests
 *
 * Provides `createMockBody` and `createMockUpstreamResponse` extracted from
 * inline copies in b1-streaming-drain-deadlock, streaming,
 * streaming-stall-detection, and ollama-duration-fields tests.
 *
 * Usage:
 *   import { createMockBody, createMockUpstreamResponse } from '../utils/streaming-mocks.js';
 *
 *   const body = createMockBody(['{"response":"hello"}', '{"response":"world"}']);
 *   const response = createMockUpstreamResponse(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
 */

/**
 * Create a ReadableStream that emits each chunk as Uint8Array then closes.
 *
 * @param chunks - Array of string chunks to emit in order
 * @returns A ReadableStream<Uint8Array> that yields each chunk encoded via TextEncoder
 */
export function createMockBody(chunks: string[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(new TextEncoder().encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

/**
 * Create a mock Response-like object wrapping a body stream.
 *
 * @param body - A ReadableStream (typically from createMockBody)
 * @param opts - Optional overrides for status and headers
 * @param opts.status - HTTP status code (default: 200)
 * @param opts.headers - Record of header key-value pairs (default: {})
 * @returns A Partial<Response>-shaped object with .body, .status, .headers, .ok
 */
export function createMockUpstreamResponse(
  body: ReadableStream<Uint8Array>,
  opts: { status?: number; headers?: Record<string, string> } = {}
): Partial<Response> & { body: ReadableStream<Uint8Array> } {
  const { status = 200, headers = {} } = opts;
  return {
    body,
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : String(status),
    headers: new Headers(headers),
  };
}
