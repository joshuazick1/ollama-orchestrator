/**
 * streaming.ts
 * Server-Sent Events (SSE) streaming support for Ollama
 */

import type { Response } from 'express';

import { TTFTTracker, type TTFTOptions } from './metrics/ttft-tracker.js';
import { safeJsonParse } from './utils/json-utils.js';
import { logger } from './utils/logger.js';

export interface StreamResponseOptions {
  /** Callback when first token is received */
  onFirstToken?: () => void;
  /** Callback when streaming is complete */
  onComplete?: (duration: number, tokens: number) => void;
  /** Callback on each chunk received (useful for resetting activity timeout) */
  onChunk?: () => void;
  /** TTFT tracking options */
  ttftOptions?: TTFTOptions;
}

// Re-export TTFTOptions for convenience
export type { TTFTOptions } from './metrics/ttft-tracker.js';

/**
 * Try to parse and extract info from a streaming chunk
 * Ollama sends JSON lines with structure like: {"model":"...","response":"...","done":false}
 */
export interface OllamaStreamChunk {
  done?: boolean;
  error?: string;
  response?: string;
  message?: { content?: string };
  eval_count?: number;
  prompt_eval_count?: number;
}

function parseStreamChunk(chunk: Uint8Array): {
  done?: boolean;
  error?: string;
  hasContent: boolean;
  preview?: string;
} {
  try {
    const text = new TextDecoder().decode(chunk);
    const lines = text.split('\n').filter(l => l.trim());

    for (const line of lines) {
      try {
        const parsed = safeJsonParse(line) as OllamaStreamChunk;
        if (parsed.done === true) {
          return { done: true, hasContent: false, preview: line.slice(0, 200) };
        }
        if (parsed.error) {
          return { error: parsed.error, hasContent: false, preview: line.slice(0, 200) };
        }
        // Check if there's actual content
        const hasContent = !!(parsed.response ?? parsed.message?.content);
        return { hasContent, preview: line.slice(0, 100) };
      } catch {
        // Not valid JSON, continue
      }
    }
    return { hasContent: text.length > 0, preview: text.slice(0, 100) };
  } catch {
    return { hasContent: chunk.length > 0 };
  }
}

/**
 * Stream a response from upstream server to client
 */
export async function streamResponse(
  upstreamResponse: globalThis.Response,
  clientResponse: Response,
  onFirstToken?: () => void,
  onComplete?: (duration: number, tokensGenerated: number, tokensPrompt: number) => void,
  onChunk?: () => void,
  ttftOptions?: TTFTOptions
): Promise<void> {
  const ttftTracker = new TTFTTracker(ttftOptions);
  const startTime = Date.now();
  let firstTokenTime: number | undefined;
  let firstContentTime: number | undefined;
  let tokenCount = 0;
  let chunkCount = 0;
  let totalBytes = 0;
  let lastChunkTime = startTime;
  let maxChunkGap = 0;
  let lastLogTime = startTime;
  let doneChunkReceived = false;
  let lastChunkPreview = '';
  const LOG_INTERVAL = 30000; // Log progress every 30 seconds

  try {
    // Set SSE headers
    clientResponse.setHeader('Content-Type', 'text/event-stream');
    clientResponse.setHeader('Cache-Control', 'no-cache');
    clientResponse.setHeader('Connection', 'keep-alive');
    clientResponse.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Get reader from upstream response body
    const reader = upstreamResponse.body?.getReader();
    if (!reader) {
      throw new Error('No response body to stream');
    }

    logger.debug('Stream started', {
      upstreamStatus: upstreamResponse.status,
      upstreamHeaders: Object.fromEntries(upstreamResponse.headers.entries()),
    });

    // Read and forward chunks
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        logger.debug('Upstream reader signaled done (stream closed)', {
          chunkCount,
          totalBytes,
          duration: Date.now() - startTime,
          doneChunkReceived,
          lastChunkPreview,
        });
        break;
      }

      const now = Date.now();
      const chunkGap = now - lastChunkTime;
      if (chunkGap > maxChunkGap) {
        maxChunkGap = chunkGap;
      }
      lastChunkTime = now;

      // Reset activity timeout on each chunk received
      onChunk?.();

      chunkCount++;
      totalBytes += value.length;

      // Parse chunk to understand content
      const chunkInfo = parseStreamChunk(value);
      lastChunkPreview = chunkInfo.preview ?? '';

      if (chunkInfo.done) {
        doneChunkReceived = true;
        logger.debug('Received done:true in stream chunk', {
          chunkCount,
          totalBytes,
          duration: now - startTime,
          preview: chunkInfo.preview,
        });
      }

      if (chunkInfo.error) {
        logger.warn('Received error in stream chunk', {
          error: chunkInfo.error,
          chunkCount,
          totalBytes,
          duration: now - startTime,
        });
      }

      // Track first token timing
      if (!firstTokenTime) {
        firstTokenTime = Date.now();
        onFirstToken?.();

        // Track with TTFTTracker
        ttftTracker.markFirstChunk(value.length);

        logger.debug('First chunk received', {
          timeToFirstChunk: firstTokenTime - startTime,
          chunkSize: value.length,
          hasContent: chunkInfo.hasContent,
          preview: chunkInfo.preview,
        });
      }

      // Track first actual content
      if (!firstContentTime && chunkInfo.hasContent) {
        firstContentTime = Date.now();

        // Track with TTFTTracker
        ttftTracker.markFirstContent(chunkInfo.preview);

        logger.debug('First content chunk received', {
          timeToFirstContent: firstContentTime - startTime,
          chunkNumber: chunkCount,
        });
      }

      // Increment chunk counter in tracker
      if (firstTokenTime) {
        ttftTracker.incrementChunk();
      }

      // Log progress periodically for long streams
      if (now - lastLogTime >= LOG_INTERVAL) {
        logger.debug('Stream progress', {
          chunkCount,
          totalBytes,
          duration: now - startTime,
          avgChunkSize: Math.round(totalBytes / chunkCount),
          maxChunkGap,
          clientConnected: !clientResponse.writableEnded,
        });
        lastLogTime = now;
      }

      // Count tokens (rough estimate based on chunk size)
      tokenCount += value.length / 4; // Approximate

      // Forward chunk to client
      const writeResult = clientResponse.write(value);
      if (!writeResult) {
        // Buffer is full, wait for drain
        logger.debug('Client buffer full, waiting for drain', { chunkCount, totalBytes });
        await new Promise<void>(resolve => clientResponse.once('drain', resolve));
      }

      // Check if client disconnected
      if (clientResponse.writableEnded) {
        logger.info('Client disconnected from stream', {
          chunkCount,
          totalBytes,
          duration: Date.now() - startTime,
        });
        void reader.cancel();
        break;
      }
    }

    // End the response
    clientResponse.end();

    // Get the final chunk to extract token counts
    let tokensGenerated = Math.floor(tokenCount);
    let tokensPrompt = 0;

    if (doneChunkReceived && lastChunkPreview) {
      try {
        const lastChunk = safeJsonParse(lastChunkPreview) as OllamaStreamChunk;
        if (lastChunk.eval_count !== undefined) {
          tokensGenerated = lastChunk.eval_count;
        }
        if (lastChunk.prompt_eval_count !== undefined) {
          tokensPrompt = lastChunk.prompt_eval_count;
        }
      } catch {
        // Keep the estimated values if parsing fails
      }
    }

    const duration = Date.now() - startTime;

    // Get TTFT metrics from tracker if enabled
    const ttftMetrics = ttftTracker.getMetrics();

    onComplete?.(duration, tokensGenerated, tokensPrompt);

    logger.info('Stream completed', {
      chunkCount,
      totalBytes,
      estimatedTokens: Math.floor(tokenCount),
      duration,
      timeToFirstToken:
        ttftMetrics?.ttft ?? (firstTokenTime ? firstTokenTime - startTime : undefined),
      timeToFirstContent:
        ttftMetrics?.timeToFirstContent ??
        (firstContentTime ? firstContentTime - startTime : undefined),
      maxChunkGap,
      avgChunkSize: chunkCount > 0 ? Math.round(totalBytes / chunkCount) : 0,
      doneChunkReceived,
      lastChunkPreview: lastChunkPreview.slice(0, 100),
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Streaming error:', {
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : 'Unknown',
      chunkCount,
      totalBytes,
      duration,
      maxChunkGap,
      doneChunkReceived,
      lastChunkPreview: lastChunkPreview.slice(0, 100),
      clientWritableEnded: clientResponse.writableEnded,
      clientHeadersSent: clientResponse.headersSent,
    });

    // If we haven't sent headers yet, send error
    if (!clientResponse.headersSent) {
      clientResponse.status(500).json({
        error: 'Streaming failed',
        details: error instanceof Error ? error.message : String(error),
      });
    } else {
      // Otherwise just end the stream
      clientResponse.end();
    }
  }
}

/**
 * Parse SSE data from buffer
 */
export function parseSSEData(buffer: Uint8Array): Array<{ done: boolean; data?: unknown }> {
  const text = new TextDecoder().decode(buffer);
  const events: Array<{ done: boolean; data?: unknown }> = [];

  const lines = text.split('\n');
  let currentEvent: { done: boolean; data?: unknown } = { done: false };

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6);

      if (data === '[DONE]') {
        currentEvent.done = true;
      } else {
        const parsed = safeJsonParse(data);
        if (parsed === null && data !== 'null') {
          currentEvent.data = data;
        } else {
          currentEvent.data = parsed;
        }
      }

      events.push(currentEvent);
      currentEvent = { done: false };
    }
  }

  return events;
}

/**
 * Check if request should use streaming
 */
export function isStreamingRequest(body: { stream?: boolean }): boolean {
  return body.stream === true;
}

/**
 * Handle streaming errors with retry logic
 */
export async function handleStreamWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  onRetry?: (attempt: number, error: Error) => void
): Promise<T> {
  let lastError: Error = new Error('All retries failed');

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        onRetry?.(attempt, lastError);
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
      }
    }
  }

  throw lastError;
}
