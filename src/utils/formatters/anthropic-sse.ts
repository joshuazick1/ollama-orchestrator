import type { SSECopy } from '../sse-stream-base.js';

import { formatSSE, writeSSE } from './_base.js';

export function formatAnthropicChunk(eventType: string, data: string): string {
  return formatSSE(data, eventType);
}

export function formatAnthropicMessageStart(data: string): string {
  return formatAnthropicChunk('message_start', data);
}

export function formatAnthropicContentBlockStart(data: string): string {
  return formatAnthropicChunk('content_block_start', data);
}

export function formatAnthropicContentBlockDelta(data: string): string {
  return formatAnthropicChunk('content_block_delta', data);
}

export function formatAnthropicMessageDelta(data: string): string {
  return formatAnthropicChunk('message_delta', data);
}

export async function writeAnthropicChunk(
  clientResponse: SSECopy,
  eventType: string,
  data: string
): Promise<boolean> {
  return writeSSE(clientResponse, data, eventType);
}
