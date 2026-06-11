import type { SSECopy } from '../sse-stream-base.js';

import { formatSSE, writeSSE } from './_base.js';

export function formatOllamaChunk(data: string): string {
  return formatSSE(data);
}

export function formatOllamaEvent(eventType: string, data: string): string {
  return formatSSE(data, eventType);
}

export async function writeOllamaChunk(clientResponse: SSECopy, data: string): Promise<boolean> {
  return writeSSE(clientResponse, data);
}

export async function writeOllamaEvent(
  clientResponse: SSECopy,
  eventType: string,
  data: string
): Promise<boolean> {
  return writeSSE(clientResponse, data, eventType);
}
