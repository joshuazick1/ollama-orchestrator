import type { SSECopy } from '../sse-stream-base.js';
import { waitForDrain } from '../sse-stream-base.js';

export function formatAnthropicChunk(eventType: string, data: string): string {
  if (eventType) {
    return `event: ${eventType}\ndata: ${data}\n\n`;
  }
  return `data: ${data}\n\n`;
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
  const formatted = formatAnthropicChunk(eventType, data);
  const result = clientResponse.write(formatted);
  if (!result) {
    await waitForDrain(clientResponse);
    return false;
  }
  return true;
}
