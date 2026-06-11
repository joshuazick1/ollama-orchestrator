/**
 * streaming-response-handler.ts
 * Shared streaming stall detection and failover handler for all controllers.
 */

import type { Response } from 'express';

import { getOrchestratorInstance } from '../orchestrator/orchestrator-instance.js';
import type { AIServer } from '../orchestrator/orchestrator.types.js';

import { getInFlightManager } from './in-flight-manager.js';
import { logger } from './logger.js';
import { performStreamHandoff } from './stream-handoff.js';

export interface StallHandlerResult {
  success: boolean;
  error?: string;
}

export interface StreamingResponseContext {
  server: AIServer;
  requestId: string;
  model: string;
  protocol: 'ollama' | 'openai' | 'anthropic';
  endpoint: 'generate' | 'chat';
  clientResponse: Response;
  originalRequestBody: Record<string, unknown>;
  stallThreshold: number;
  stallCheckInterval: number;
}

export function createStreamingStallHandler(ctx: StreamingResponseContext): {
  onStall: (
    abortController: AbortController,
    streamingRequestId?: string
  ) => Promise<StallHandlerResult>;
  cleanup: () => void;
} {
  let called = false;
  const cleanupFns: Array<() => void> = [];

  const onStall = async (
    _abortController: AbortController,
    passedRequestId?: string
  ): Promise<StallHandlerResult> => {
    if (called) {
      return { success: false, error: 'already invoked' };
    }
    called = true;

    const requestId = passedRequestId ?? ctx.requestId;

    logger.warn('STREAM_STALL_DETECTED', {
      requestId,
      serverId: ctx.server.id,
      model: ctx.model,
      endpoint: ctx.endpoint,
      protocol: ctx.protocol,
      message: 'Stall detected - attempting seamless handoff',
    });

    const progress = requestId
      ? getInFlightManager().getStreamingRequestProgress(requestId)
      : undefined;

    if (!progress) {
      logger.warn('No streaming progress found for handoff', { requestId });
      return { success: false, error: 'No progress tracked' };
    }

    const orchestrator = getOrchestratorInstance();
    const allServers = orchestrator.getServers();

    const requestProtocol = ctx.protocol;
    const newServer = allServers.find(s => {
      if (s.id === ctx.server.id) {return false;}
      if (!s.healthy) {return false;}
      if (!s.models.includes(ctx.model)) {return false;}
      if (!orchestrator.isCircuitAllowed(s.id)) {return false;}

      if (requestProtocol === 'ollama') {
        return s.supportsOllama !== false;
      }
      return s.supportsV1 !== false;
    });

    if (!newServer) {
      logger.warn('No eligible servers for handoff', {
        requestId,
        currentServer: ctx.server.id,
        model: ctx.model,
        requestProtocol,
      });
      return { success: false, error: 'No alternative servers with closed circuit' };
    }

    logger.info('Attempting seamless handoff to new server', {
      requestId,
      fromServer: ctx.server.id,
      toServer: newServer.id,
      accumulatedTextLength: progress.accumulatedText.length,
    });

    try {
      const result = await performStreamHandoff({
        originalRequest: progress,
        newServer,
        clientResponse: ctx.clientResponse,
        originalRequestBody: ctx.originalRequestBody,
        stallThresholdMs: ctx.stallThreshold,
        stallCheckIntervalMs: ctx.stallCheckInterval,
      });

      return { success: result.success, error: result.error };
    } catch (handoffError) {
      logger.error('Handoff failed with exception', {
        requestId,
        error: handoffError instanceof Error ? handoffError.message : String(handoffError),
      });
      return { success: false, error: 'Handoff failed' };
    }
  };

  const cleanup = () => {
    for (const fn of cleanupFns) {
      try {
        fn();
      } catch {
        // ignore cleanup errors
      }
    }
    cleanupFns.length = 0;
  };

  return { onStall, cleanup };
}

export function createSharedStallDetector(
  ctx: StreamingResponseContext,
  onStallTriggered?: () => void
): {
  onStall: (
    abortController: AbortController,
    streamingRequestId?: string
  ) => Promise<StallHandlerResult>;
  stop: () => void;
  onChunk: () => void;
} {
  let lastChunkTime = Date.now();
  let stallTriggered = false;
  const abortController = new AbortController();
  let intervalId: ReturnType<typeof setInterval> | undefined;

  const { onStall } = createStreamingStallHandler(ctx);

  const checkForStall = () => {
    if (stallTriggered) {return;}

    const timeSinceLastChunk = Date.now() - lastChunkTime;
    if (timeSinceLastChunk > ctx.stallThreshold) {
      stallTriggered = true;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
      onStallTriggered?.();
      void onStall(abortController, ctx.requestId);
    }
  };

  intervalId = setInterval(checkForStall, ctx.stallCheckInterval);

  return {
    onStall,
    stop: () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
    },
    onChunk: () => {
      lastChunkTime = Date.now();
    },
  };
}
