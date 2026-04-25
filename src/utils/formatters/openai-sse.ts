import type { SSECopy } from '../sse-stream-base.js';
import { waitForDrain } from '../sse-stream-base.js';

export function formatOpenAIChunk(data: string): string {
  return `data: ${data}\n\n`;
}

export function formatOpenAIDone(): string {
  return 'data: [DONE]\n\n';
}

export async function writeOpenAIChunk(clientResponse: SSECopy, data: string): Promise<boolean> {
  const formatted = formatOpenAIChunk(data);
  const result = clientResponse.write(formatted);
  if (!result) {
    await waitForDrain(clientResponse);
    return false;
  }
  return true;
}

export async function writeOpenAIDone(clientResponse: SSECopy): Promise<boolean> {
  const formatted = formatOpenAIDone();
  const result = clientResponse.write(formatted);
  if (!result) {
    await waitForDrain(clientResponse);
    return false;
  }
  return true;
}
