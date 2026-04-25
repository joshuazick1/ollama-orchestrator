import type { SSECopy } from '../sse-stream-base.js';
import { waitForDrain } from '../sse-stream-base.js';

export function formatOllamaChunk(data: string): string {
  return `data: ${data}\n\n`;
}

export function formatOllamaEvent(eventType: string, data: string): string {
  return `event: ${eventType}\ndata: ${data}\n\n`;
}

export async function writeOllamaChunk(clientResponse: SSECopy, data: string): Promise<boolean> {
  const formatted = formatOllamaChunk(data);
  const result = clientResponse.write(formatted);
  if (!result) {
    await waitForDrain(clientResponse);
    return false;
  }
  return true;
}

export async function writeOllamaEvent(
  clientResponse: SSECopy,
  eventType: string,
  data: string
): Promise<boolean> {
  const formatted = formatOllamaEvent(eventType, data);
  const result = clientResponse.write(formatted);
  if (!result) {
    await waitForDrain(clientResponse);
    return false;
  }
  return true;
}
