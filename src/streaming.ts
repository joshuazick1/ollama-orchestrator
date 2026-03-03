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
export interface OllamaToolCall {
  index?: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface OllamaStreamChunk {
  done?: boolean;
  error?: string;
  response?: string;
  message?: {
    content?: string;
    role?: string;
    tool_calls?: OllamaToolCall[];
  };
  eval_count?: number;
  prompt_eval_count?: number;
  /** Time spent on token generation (nanoseconds) */
  eval_duration?: number;
  /** Time spent evaluating the prompt (nanoseconds) */
  prompt_eval_duration?: number;
  /** Total end-to-end time including load (nanoseconds) */
  total_duration?: number;
  /** Time spent loading the model into memory (nanoseconds); > 0 indicates a cold start */
  load_duration?: number;
  /** Set to true in the final chunk when truncated due to max_tokens */
  truncated?: boolean;
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

/**
 * Ollama-specific duration fields from the final streaming chunk (all in nanoseconds)
 */
export interface OllamaDurations {
  evalDuration?: number;
  promptEvalDuration?: number;
  totalDuration?: number;
  loadDuration?: number;
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
    chunkData?: ChunkData,
    ollamaDurations?: OllamaDurations
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
  stallCheckIntervalMs?: number,
  onStreamEnd?: () => void,
  activityController?: {
    resetTimeout: () => void;
    controller: AbortController;
  }
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
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined = undefined;
  let abortHandler: (() => void) | undefined;
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
    reader = upstreamResponse.body?.getReader();
    if (!reader) {
      throw new Error('No response body to stream');
    }

    logger.debug('Stream started', {
      upstreamStatus: upstreamResponse.status,
      upstreamHeaders: Object.fromEntries(upstreamResponse.headers.entries()),
    });

    // Set up abort listener for more reliable timeout detection
    const abortPromise = new Promise<void>(resolve => {
      abortHandler = () => {
        logger.warn('Abort signal received in stream', { streamingRequestId, chunkCount });
        // Ensure reader.read() settles by cancelling the reader if present.
        try {
          void reader?.cancel();
        } catch (e) {
          logger.error('Error while cancelling reader in abortHandler', {
            streamingRequestId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        resolve();
      };
    });
    const abortSignal = activityController?.controller.signal;
    if (abortSignal && abortHandler) {
      try {
        if (typeof (abortSignal as any).addEventListener === 'function') {
          (abortSignal as any).addEventListener('abort', abortHandler);
        } else if ('onabort' in (abortSignal as any)) {
          // Some test mocks provide an `onabort` handler instead of addEventListener.
          (abortSignal as any).onabort = abortHandler;
        }
      } catch (e) {
        logger.debug('Failed to attach abort listener to activityController.signal', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Read and forward chunks
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Check if abort was triggered before reading
      if (activityController?.controller.signal.aborted) {
        logger.warn('Stream aborted before read (activity timeout)', {
          streamingRequestId,
          chunkCount,
          duration: Date.now() - startTime,
        });
        throw new Error('Activity timeout - stream aborted');
      }

      let readResult: { done: boolean; value?: Uint8Array };

      try {
        // Use Promise.race to break out of read() when abort fires
        readResult = await Promise.race([
          reader.read(),
          abortPromise.then(
            () => ({ done: true, value: undefined }) as { done: boolean; value?: Uint8Array }
          ),
        ]);
      } catch (readError) {
        // Check if this is an abort error
        if (readError instanceof Error && readError.name === 'AbortError') {
          logger.warn('Stream reader aborted (activity timeout)', {
            streamingRequestId,
            chunkCount,
            duration: Date.now() - startTime,
          });
          // Re-throw to trigger error handling
          throw readError;
        }
        // Re-throw other errors
        throw readError;
      }

      const { done, value } = readResult;

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

      // If value is undefined (shouldn't happen but TypeScript doesn't know), skip this chunk
      if (!value) {
        continue;
      }

      const now = Date.now();
      const chunkGap = now - lastChunkTime;
      if (chunkGap > maxChunkGap) {
        maxChunkGap = chunkGap;
      }
      lastChunkTime = now;

      chunkCount++;
      totalBytes += value.length;

      // Reset activity timeout on each chunk (this is the key to making streaming timeouts work!)
      activityController?.resetTimeout();

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
        logger.info('Received done:true in stream chunk', {
          chunkCount,
          totalBytes,
        });
      }

      if (chunkInfo.error) {
        logger.warn('Received error in stream chunk', { error: chunkInfo.error, chunkCount });
      }

      // Track first token timing
      if (!firstTokenTime) {
        firstTokenTime = Date.now();
        onFirstToken?.();

        // Track with TTFTTracker
        ttftTracker.markFirstChunk(value.length);

        logger.info('First chunk received', { timeToFirstChunk: firstTokenTime - startTime });

        // Start stall detection after first chunk
        if (!hasReceivedFirstChunk) {
          if (!onStall) {
            logger.error('STALL_DETECTION_SKIPPED_NO_CALLBACK', {
              streamingRequestId,
              chunkCount,
            });
          }
        }

        if (!hasReceivedFirstChunk && onStall) {
          hasReceivedFirstChunk = true;
          lastChunkTime = now; // Reset lastChunkTime to now since we just received a chunk

          logger.info('STALL_DETECTION_STARTED', {
            streamingRequestId,
            stallThreshold: effectiveStallThreshold,
            stallCheckInterval: effectiveStallCheckInterval,
            chunkCount,
          });

          // Start periodic stall checking in the background
          stallCheckInterval = setInterval(() => {
            if (stallTriggered) {
              return;
            }

            const timeSinceLastChunk = Date.now() - lastChunkTime;

            if (timeSinceLastChunk > effectiveStallThreshold) {
              logger.warn('Stream stall detected - attempting handoff', {
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
              onStall(abortController, streamingRequestId)
                .then(result => {
                  // If handler says it handled the handoff successfully, cancel the stalled
                  // reader so the original stream loop exits cleanly and no further chunks
                  // from the old upstream reach clientResponse (which would interleave with
                  // the already-started handoff stream).
                  // NOTE: do NOT call onStreamEnd() here — the finally block does it after
                  // the loop exits from the cancelled read, preventing a double-call.
                  if (result?.success) {
                    logger.info(
                      'Stall handled successfully via handoff, cancelling stalled reader',
                      {
                        streamingRequestId,
                        handoffError: result.error,
                      }
                    );
                    try {
                      void reader?.cancel();
                    } catch (e) {
                      logger.debug('Error cancelling stalled reader after handoff', {
                        streamingRequestId,
                        error: e instanceof Error ? e.message : String(e),
                      });
                    }
                    return;
                  }

                  // If we get here, handoff didn't work - abort the stream
                  logger.warn('Handoff did not succeed, cancelling reader to abort stream', {
                    streamingRequestId,
                    chunkCount,
                  });
                  void reader?.cancel();
                })
                .catch((stallError: unknown) => {
                  logger.error('Stall handler threw error', {
                    streamingRequestId,
                    error: stallError instanceof Error ? stallError.message : String(stallError),
                  });

                  // Handoff failed with error - abort the stream
                  logger.warn('Handoff did not succeed, cancelling reader to abort stream', {
                    streamingRequestId,
                    chunkCount,
                  });
                  void reader?.cancel();
                });
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
      logger.debug('Forwarding chunk to client', {
        streamingRequestId,
        chunkCount,
        bytes: value.length,
      });
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
        try {
          logger.debug('Cancelling reader due to client disconnect', {
            streamingRequestId,
            chunkCount,
          });
          void reader.cancel();
        } catch (e) {
          logger.error('Error cancelling reader on client disconnect', {
            streamingRequestId,
            error: String(e),
          });
        }
        break;
      }
    }

    // End the response
    clientResponse.end();

    // Get the final chunk to extract token counts
    let tokensGenerated = Math.floor(tokenCount);
    let tokensPrompt = 0;
    let ollamaDurations: OllamaDurations | undefined;

    if (doneChunkReceived && lastChunkPreview) {
      try {
        const lastChunk = safeJsonParse(lastChunkPreview) as OllamaStreamChunk;
        if (lastChunk.eval_count !== undefined) {
          tokensGenerated = lastChunk.eval_count;
        }
        if (lastChunk.prompt_eval_count !== undefined) {
          tokensPrompt = lastChunk.prompt_eval_count;
        }
        // Extract Ollama duration fields (nanoseconds) if present
        if (
          lastChunk.eval_duration !== undefined ||
          lastChunk.prompt_eval_duration !== undefined ||
          lastChunk.total_duration !== undefined ||
          lastChunk.load_duration !== undefined
        ) {
          ollamaDurations = {
            evalDuration: lastChunk.eval_duration,
            promptEvalDuration: lastChunk.prompt_eval_duration,
            totalDuration: lastChunk.total_duration,
            loadDuration: lastChunk.load_duration,
          };
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

    onComplete?.(duration, tokensGenerated, tokensPrompt, chunkData, ollamaDurations);

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
    // Remove abort listener if we added one
    try {
      const abortSignal = activityController?.controller.signal;
      if (abortSignal && abortHandler) {
        try {
          if (typeof (abortSignal as any).removeEventListener === 'function') {
            abortSignal.removeEventListener('abort', abortHandler);
            logger.debug('Removed abort listener via removeEventListener', { streamingRequestId });
          } else if ('onabort' in (abortSignal as any)) {
            // If test-mock set onabort, clear it
            try {
              (abortSignal as any).onabort = undefined;
              logger.debug('Cleared onabort property on abortSignal (test-mock path)', {
                streamingRequestId,
              });
            } catch (e) {
              logger.debug('Failed to clear onabort property', {
                streamingRequestId,
                error: String(e),
              });
            }
          }
        } catch (e) {
          logger.debug('Error while removing abort listener', {
            streamingRequestId,
            error: String(e),
          });
        }
      }
    } catch (e) {
      // Ignore removal errors
    }

    // Call onStreamEnd callback for cleanup (e.g., remove from InFlightManager)
    onStreamEnd?.();
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
