import type { Request } from 'express';

import { logger } from './logger.js';

const NO_REQUEST_ID = '<no-request-id>';

function getRequestId(req: Request): string {
  return ((req as unknown as Record<string, unknown>).requestId as string) ?? NO_REQUEST_ID;
}

export function setRequestId(req: Request, requestId: string): void {
  (req as unknown as Record<string, unknown>).requestId = requestId;
}

export const lifecycle = {
  received(
    req: Request,
    meta: { endpoint: string; method: string; model?: string; stream?: boolean }
  ): void {
    logger.info('LIFECYCLE_RECEIVED', { requestId: getRequestId(req), ...meta });
  },

  validated(req: Request, meta: { schemaFields: string[] }): void {
    logger.info('LIFECYCLE_VALIDATED', { requestId: getRequestId(req), ...meta });
  },

  validationFailed(req: Request, meta: { field: string; reason: string; value?: unknown }): void {
    logger.warn('LIFECYCLE_VALIDATION_FAILED', { requestId: getRequestId(req), ...meta });
  },

  serverSelected(
    req: Request,
    meta: {
      algorithm: string;
      selectedServer: string;
      candidates: string[];
      excludedServers?: string[];
      serverScores?: Record<string, number>;
      circuitBreakerState?: string;
      timeoutMs?: number;
    }
  ): void {
    logger.info('LIFECYCLE_SERVER_SELECTED', { requestId: getRequestId(req), ...meta });
  },

  started(
    req: Request,
    meta: { serverId: string; model: string; attempt: number; phase: string }
  ): void {
    logger.info('LIFECYCLE_UPSTREAM_STARTED', { requestId: getRequestId(req), ...meta });
  },

  finished(
    req: Request,
    meta: {
      serverId: string;
      model: string;
      durationMs: number;
      status: string;
      promptTokens?: number;
      generatedTokens?: number;
      chunkCount?: number;
      totalBytes?: number;
      ttftMs?: number;
    }
  ): void {
    logger.info('LIFECYCLE_UPSTREAM_FINISHED', { requestId: getRequestId(req), ...meta });
  },

  error(
    req: Request,
    meta: {
      serverId?: string;
      model?: string;
      errorType: string;
      errorMessage: string;
      retryable: boolean;
      status?: number;
    }
  ): void {
    logger.error('LIFECYCLE_ERROR', { requestId: getRequestId(req), ...meta });
  },

  streamAborted(
    req: Request,
    meta: { serverId: string; model: string; chunkCount: number; reason: string }
  ): void {
    logger.warn('LIFECYCLE_STREAM_ABORTED', { requestId: getRequestId(req), ...meta });
  },
};
