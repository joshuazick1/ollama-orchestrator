/**
 * streaming.ts
 * Server-Sent Events (SSE) streaming support for Ollama
 */

import type { Response } from 'express';

import { TTFTTracker, type TTFTOptions } from './metrics/ttft-tracker.js';
import { getInFlightManager } from './utils/in-flight-manager.js';
import { safeJsonParse } from './utils/json-utils.js';
import { logger } from './utils/logger.js';

export interface StreamResponseOptions {
  /** Callback when first token is received */
  onFirstToken?: () => void;
  /** Callback when streaming is complete */
  onComplete?: (duration: number, tokens: number, chunkData?: ChunkData) => void;
  /** Callback on each chunk received (receives current chunk count) */
  onChunk?: (chunkCount: number) => void;
  /** TTFT tracking options */
  ttftOptions?: TTFTOptions;
  /** Existing TTFTTracker instance to use (for sharing with caller) */
  ttftTracker?: TTFTTracker;
  /** Callback when stream is detected as stalled (no chunks for threshold period after first chunk)
   * Handler should accept the authoritative streamingRequestId (may be undefined) and may
   * return a StallHandlerResult to indicate whether it handled continuation. */
  onStall?: (
    abortController: AbortController,
    streamingRequestId?: string
  ) => Promise<StallHandlerResult | void> | void;
  /** Stall detection threshold in ms (default: 5 minutes) */
  stallThresholdMs?: number;
  /** How often to check for stall (default: 10 seconds) */
  stallCheckIntervalMs?: number;
}

/**
 * Chunk data collected during streaming
 */
export interface ChunkData {
  chunkCount: number;
  totalBytes: number;
  maxChunkGapMs: number;
  avgChunkSizeBytes: number;
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
 * Extract text content from a streaming chunk
 */
function extractChunkText(chunk: Uint8Array): string {
  try {
    const text = new TextDecoder().decode(chunk);
    const lines = text.split('\n').filter(l => l.trim());

    for (const line of lines) {
      try {
        const parsed = safeJsonParse(line) as OllamaStreamChunk;
        if (parsed.response) {
          return parsed.response;
        }
        if (parsed.message?.content) {
          return parsed.message.content;
        }
      } catch {
        // Not valid JSON, continue
      }
    }
  } catch {
    // Ignore decode errors
  }
  return '';
}

/**
 * Extract context array from a streaming chunk (Ollama specific)
 * Returns context only from the final chunk (done: true)
 */
function extractChunkContext(chunk: Uint8Array): { context?: number[] } {
  try {
    const text = new TextDecoder().decode(chunk);
    const lines = text.split('\n').filter(l => l.trim());

    for (const line of lines) {
      try {
        const parsed = safeJsonParse(line) as OllamaStreamChunk & { context?: number[] };
        if (parsed.done && parsed.context) {
          return { context: parsed.context };
        }
      } catch {
        // Not valid JSON, continue
      }
    }
  } catch {
    // Ignore decode errors
  }
  return {};
}

export interface StallHandlerResult {
  success: boolean;
  error?: string;
}

/**
 * Stream a response from upstream server to client
 */
export async function streamResponse(
  upstreamResponse: globalThis.Response,
  clientResponse: Response,
  onFirstToken?: () => void,
  onComplete?: (
    duration: number,
    tokensGenerated: number,
    tokensPrompt: number,
    chunkData?: ChunkData
  ) => void,
  onChunk?: (chunkCount: number) => void,
  ttftOptions?: TTFTOptions,
  streamingRequestId?: string,
  existingTtftTracker?: TTFTTracker,
  onStall?: (
    abortController: AbortController,
    streamingRequestId?: string
  ) => Promise<StallHandlerResult | void>,
  stallThresholdMs?: number,
  stallCheckIntervalMs?: number
): Promise<void> {
  const ttftTracker = existingTtftTracker ?? new TTFTTracker(ttftOptions);
  const startTime = Date.now();
  let firstTokenTime: number | undefined;
  let firstContentTime: number | undefined;
  let tokenCount = 0;
  let chunkCount = 0;
  let totalBytes = 0;
  let lastChunkTime = startTime;
  let stallCheckInterval: ReturnType<typeof setInterval> | undefined;
  let stallTriggered = false;
  let hasReceivedFirstChunk = false;
  let maxChunkGap = 0;
  let lastLogTime = startTime;
  let doneChunkReceived = false;
  let lastChunkPreview = '';
  let accumulatedText = '';
  let lastContext: number[] | undefined;
  const LOG_INTERVAL = 30000; // Log progress every 30 seconds
  const effectiveStallThreshold = stallThresholdMs ?? 300000; // Default 5 minutes
  const effectiveStallCheckInterval = stallCheckIntervalMs ?? 10000; // Default 10 seconds

  const abortController = new AbortController();

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

      chunkCount++;
      totalBytes += value.length;

      // Parse chunk to extract content and context
      const chunkText = extractChunkText(value);
      if (chunkText) {
        accumulatedText += chunkText;
      }

      // Extract context from done chunk (Ollama specific)
      const parsedChunk = extractChunkContext(value);
      if (parsedChunk?.context) {
        lastContext = parsedChunk.context;
      }

      // Update InFlightManager directly if streamingRequestId is provided
      if (streamingRequestId) {
        try {
          logger.debug('streaming.ts calling updateChunkProgress', {
            streamingRequestId,
            chunkCount,
            accumulatedLength: accumulatedText.length,
          });
          getInFlightManager().updateChunkProgress(
            streamingRequestId,
            chunkCount,
            accumulatedText,
            lastContext
          );
        } catch (e) {
          logger.error('Failed to update chunk progress', { error: e });
        }
      } else {
        logger.debug('streaming.ts no streamingRequestId provided for chunk update', {
          chunkCount,
        });
      }

      // Call onChunk callback AFTER incrementing chunkCount so it receives correct count
      onChunk?.(chunkCount);

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

        // Start stall detection after first chunk
        if (!hasReceivedFirstChunk && onStall) {
          hasReceivedFirstChunk = true;
          lastChunkTime = now; // Reset lastChunkTime to now since we just received a chunk

          logger.info('STALL_DETECTION_STARTED', {
            streamingRequestId,
            stallThreshold: effectiveStallThreshold,
            stallCheckInterval: effectiveStallCheckInterval,
            chunkCount,
          });

          // Log current InFlightManager state for this request to help debug mismatches
          try {
            const progress = streamingRequestId
              ? getInFlightManager().getStreamingRequestProgress(streamingRequestId)
              : undefined;
            const allTracked = getInFlightManager().getAllStreamingRequests();
            logger.debug('STALL_DETECTION_STATE', {
              streamingRequestId,
              progressFound: !!progress,
              progressSummary: progress
                ? {
                    chunkCount: progress.chunkCount,
                    accumulatedLength: progress.accumulatedText.length,
                  }
                : undefined,
              trackedRequestCount: allTracked.length,
              trackedRequestIds: allTracked.slice(0, 20).map(r => r.id),
            });
          } catch (e) {
            logger.debug('STALL_DETECTION_STATE_ERROR', {
              error: e instanceof Error ? e.message : String(e),
            });
          }

          // Start periodic stall checking in the background
          stallCheckInterval = setInterval(async () => {
            if (stallTriggered) {
              return;
            }

            const timeSinceLastChunk = Date.now() - lastChunkTime;
            logger.debug('STALL_CHECK', {
              streamingRequestId,
              timeSinceLastChunk,
              stallThreshold: effectiveStallThreshold,
              chunkCount,
              wouldTrigger: timeSinceLastChunk > effectiveStallThreshold,
            });

            if (timeSinceLastChunk > effectiveStallThreshold) {
              logger.warn('Stream stall detected', {
                streamingRequestId,
                timeSinceLastChunk,
                stallThreshold: effectiveStallThreshold,
                chunkCount,
              });
              stallTriggered = true;

              // Clear the interval since we've triggered stall handling
              if (stallCheckInterval) {
                clearInterval(stallCheckInterval);
                stallCheckInterval = undefined;
              }

              // Try to handle the stall - call the async handler
              try {
                // Log InFlightManager state right before invoking handler
                try {
                  const progressBefore = streamingRequestId
                    ? getInFlightManager().getStreamingRequestProgress(streamingRequestId)
                    : undefined;
                  logger.debug('ON_STALL_INVOKE', {
                    streamingRequestId,
                    progressFound: !!progressBefore,
                    progressChunkCount: progressBefore?.chunkCount,
                  });
                } catch (e) {
                  logger.debug('ON_STALL_INVOKE_ERROR', {
                    error: e instanceof Error ? e.message : String(e),
                  });
                }

                const result = await onStall(abortController, streamingRequestId);

                // If handler says it handled the handoff successfully, we're done
                // The handoff has already started streaming to clientResponse
                // Just return gracefully without canceling the reader
                if (result?.success) {
                  logger.info('Stall handled successfully via handoff, exiting stream gracefully', {
                    streamingRequestId,
                    handoffError: result.error,
                  });
                  return;
                }
              } catch (stallError) {
                logger.error('Stall handler threw error', {
                  streamingRequestId,
                  error: stallError instanceof Error ? stallError.message : String(stallError),
                });
              }

              // If we get here, handoff didn't work - abort the stream
              try {
                reader.cancel();
              } catch (e) {
                // Ignore cancel errors
              }
            }
          }, effectiveStallCheckInterval);
        }
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

      // Note: We don't call incrementChunk() here because markFirstChunk and markFirstContent
      // already handle chunk counting internally. Calling incrementChunk would double-count.

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

    // Prepare chunk data for callback
    const chunkData: ChunkData = {
      chunkCount,
      totalBytes,
      maxChunkGapMs: maxChunkGap,
      avgChunkSizeBytes: chunkCount > 0 ? Math.round(totalBytes / chunkCount) : 0,
    };

    onComplete?.(duration, tokensGenerated, tokensPrompt, chunkData);

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
  } finally {
    // Always clean up stall detection interval
    if (stallCheckInterval) {
      clearInterval(stallCheckInterval);
      stallCheckInterval = undefined;
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
