import type { SSECopy } from '../sse-stream-base.js';

import { formatSSE, writeSSE } from './_base.js';

export function formatOpenAIChunk(data: string): string {
  return formatSSE(data);
}

export function formatOpenAIDone(): string {
  return formatSSE('[DONE]');
}

export async function writeOpenAIChunk(clientResponse: SSECopy, data: string): Promise<boolean> {
  return writeSSE(clientResponse, data);
}

export async function writeOpenAIDone(clientResponse: SSECopy): Promise<boolean> {
  return writeSSE(clientResponse, '[DONE]');
}
