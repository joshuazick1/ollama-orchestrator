/**
 * sse-stream-base.ts
 * Shared SSE streaming infrastructure
 */

import { logger } from './logger.js';

export interface SSECopy {
  setHeader(name: string, value: string): void;
  write(chunk?: string | Uint8Array): boolean;
  end(...args: unknown[]): void;
  writableEnded: boolean;
  removeListener(event: string, handler: () => void): void;
  once(event: string, handler: () => void): void;
  on(event: string, handler: () => void): void;
  addListener(event: string, handler: () => void): void;
}

export interface UpstreamReader {
  getReader(): ReadableStreamDefaultReader<Uint8Array>;
}

export interface StallHandlerResult {
  success: boolean;
  error?: string;
}

export interface KeepaliveConfig {
  intervalMs: number;
  comment: string;
}

const DEFAULT_KEEPALIVE_INTERVAL_MS = 30000;
const DEFAULT_KEEPALIVE_COMMENT = ': keepalive';

export function setSSEHeaders(clientResponse: SSECopy): void {
  clientResponse.setHeader('Content-Type', 'text/event-stream');
  clientResponse.setHeader('Cache-Control', 'no-cache');
  clientResponse.setHeader('Connection', 'keep-alive');
  clientResponse.setHeader('X-Accel-Buffering', 'no');
}

export async function waitForDrain(
  clientResponse: SSECopy,
  abortSignal?: AbortSignal
): Promise<void> {
  return new Promise<void>(resolve => {
    let settled = false;
    const cleanup = () => {
      if (settled) {
        return;
      }
      settled = true;
      clientResponse.removeListener('drain', onDrain);
      clientResponse.removeListener('close', onClose);
      clientResponse.removeListener('finish', onClose);
      abortSignal?.removeEventListener('abort', onAbort);
    };

    const onDrain = () => {
      cleanup();
      resolve();
    };

    const onClose = () => {
      cleanup();
      resolve();
    };

    const onAbort = () => {
      cleanup();
      resolve();
    };

    clientResponse.once('drain', onDrain);
    clientResponse.once('close', onClose);
    clientResponse.once('finish', onClose);
    abortSignal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function writeWithDrain(clientResponse: SSECopy, chunk: string | Uint8Array): boolean {
  return clientResponse.write(chunk);
}

export function startKeepalive(
  clientResponse: SSECopy,
  intervalMs: number = DEFAULT_KEEPALIVE_INTERVAL_MS,
  comment: string = DEFAULT_KEEPALIVE_COMMENT
): ReturnType<typeof setInterval> {
  const keepaliveLine = `${comment}\n\n`;
  return setInterval(() => {
    if (!clientResponse.writableEnded) {
      clientResponse.write(keepaliveLine);
    }
  }, intervalMs);
}

export function stopKeepalive(intervalId: ReturnType<typeof setInterval>): void {
  clearInterval(intervalId);
}

export function createAbortPromise(abortSignal: AbortSignal, onAbort?: () => void): Promise<void> {
  return new Promise<void>(resolve => {
    const handler = () => {
      onAbort?.();
      resolve();
    };

    if (abortSignal.aborted) {
      handler();
      return;
    }

    abortSignal.addEventListener('abort', handler, { once: true });
  });
}

export function createAbortPromiseWithCleanup(
  abortSignal: AbortSignal,
  reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
  onAbort?: () => void
): Promise<void> {
  return new Promise<void>(resolve => {
    const handler = () => {
      onAbort?.();
      try {
        void reader?.cancel();
      } catch (e) {
        logger.debug('Error cancelling reader in abort handler', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
      resolve();
    };

    if (abortSignal.aborted) {
      handler();
      return;
    }

    abortSignal.addEventListener('abort', handler, { once: true });
  });
}

export interface StallDetectionState {
  lastChunkTime: number;
  stallCheckInterval?: ReturnType<typeof setInterval>;
  stallTriggered: boolean;
  hasReceivedFirstChunk: boolean;
}

export function startStallDetection(
  state: StallDetectionState,
  effectiveStallThreshold: number,
  effectiveStallCheckInterval: number,
  onStall: () => void,
  onStart?: () => void
): () => void {
  if (state.hasReceivedFirstChunk) {
    return () => {};
  }

  state.hasReceivedFirstChunk = true;
  onStart?.();

  state.lastChunkTime = Date.now();
  state.stallTriggered = false;

  state.stallCheckInterval = setInterval(() => {
    if (state.stallTriggered) {
      return;
    }

    const timeSinceLastChunk = Date.now() - state.lastChunkTime;
    if (timeSinceLastChunk > effectiveStallThreshold) {
      state.stallTriggered = true;

      if (state.stallCheckInterval) {
        clearInterval(state.stallCheckInterval);
        state.stallCheckInterval = undefined;
      }

      onStall();
    }
  }, effectiveStallCheckInterval);

  return () => {
    if (state.stallCheckInterval) {
      clearInterval(state.stallCheckInterval);
      state.stallCheckInterval = undefined;
    }
  };
}

export function updateChunkTime(state: StallDetectionState): void {
  state.lastChunkTime = Date.now();
}

export function isClientDisconnected(clientResponse: SSECopy): boolean {
  return clientResponse.writableEnded;
}
