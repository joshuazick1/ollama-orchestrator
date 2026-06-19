import type { Request, Response } from 'express';

import { getInFlightManager } from './in-flight-manager.js';
import { logger } from './logger.js';

export interface ActiveStreamState {
  serverId?: string;
  model?: string;
  streamingRequestId?: string;
  activityController?: { controller: AbortController };
}

function attachCloseListener(target: unknown, handler: () => void): void {
  if (!target || typeof target !== 'object') {
    return;
  }
  const candidate = target as {
    once?: (event: string, listener: () => void) => unknown;
    on?: (event: string, listener: () => void) => unknown;
  };
  if (typeof candidate.once === 'function') {
    candidate.once('close', handler);
  } else if (typeof candidate.on === 'function') {
    candidate.on('close', handler);
  }
}

export function setupStreamingClientDisconnectCleanup(
  req: Request,
  res: Response,
  getActiveState: () => ActiveStreamState
): void {
  let cleaned = false;
  const onClose = (): void => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    const state = getActiveState();
    if (!state.serverId || !state.model) {
      return;
    }
    try {
      const result = getInFlightManager().cleanupInFlightTracking(
        state.serverId,
        state.model,
        state.streamingRequestId,
        state.activityController?.controller,
        'client_disconnect'
      );
      logger.info('Streaming client disconnect: in-flight tracking cleaned up', {
        serverId: state.serverId,
        model: state.model,
        streamingRequestId: state.streamingRequestId,
        ...result,
      });
    } catch (e) {
      logger.error('Failed to clean up in-flight tracking on client disconnect', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };
  attachCloseListener(req, onClose);
  attachCloseListener(res, onClose);
}
