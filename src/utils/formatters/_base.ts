/**
 * _base.ts
 * Shared SSE formatting base used by all per-provider formatters.
 */

import type { SSECopy } from '../sse-stream-base.js';
import { waitForDrain } from '../sse-stream-base.js';

/**
 * Format SSE data payload.
 * When eventType is provided, includes the "event:" prefix line.
 */
export function formatSSE(data: string, eventType?: string): string {
  if (eventType) {
    return `event: ${eventType}\ndata: ${data}\n\n`;
  }
  return `data: ${data}\n\n`;
}

/**
 * Write SSE data to a client response, waiting for drain if needed.
 * Returns false if the client is no longer writable.
 */
export async function writeSSE(
  clientResponse: SSECopy,
  data: string,
  eventType?: string
): Promise<boolean> {
  const formatted = formatSSE(data, eventType);
  const result = clientResponse.write(formatted);
  if (!result) {
    await waitForDrain(clientResponse);
    return false;
  }
  return true;
}
