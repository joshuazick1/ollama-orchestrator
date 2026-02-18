/**
 * Background Request Tracker
 * Tracks timed-out requests to learn actual response times
 * When a request times out, we continue listening in background for up to 30 minutes
 * This helps us learn if servers are actually slow vs completely down
 */

import { logger } from './utils/logger.js';

export interface TrackedRequest {
  id: string;
  serverId: string;
  model: string;
  startTime: number;
  abortController: AbortController;
  onComplete?: (duration: number, hadResponse: boolean) => void;
}

export class BackgroundRequestTracker {
  private requests: Map<string, TrackedRequest> = new Map();
  private maxListenTimeMs: number = 30 * 60 * 1000; // 30 minutes
  private cleanupInterval?: NodeJS.Timeout;

  constructor() {
    this.startCleanupInterval();
  }

  /**
   * Track a request that has timed out from user perspective
   * Continue listening to learn actual response time
   */
  trackTimedOutRequest(
    id: string,
    serverId: string,
    model: string,
    fetchPromise: Promise<Response>,
    onComplete?: (duration: number, hadResponse: boolean) => void
  ): void {
    // Don't track if already tracking this request
    if (this.requests.has(id)) {
      return;
    }

    const abortController = new AbortController();
    const request: TrackedRequest = {
      id,
      serverId,
      model,
      startTime: Date.now(),
      abortController,
      onComplete,
    };

    this.requests.set(id, request);

    logger.info(`Tracking timed-out request ${id} in background`, {
      serverId,
      model,
      maxListenTimeMs: this.maxListenTimeMs,
    });

    // Set up max listen time timeout
    const maxTimeoutId = setTimeout(() => {
      this.completeRequest(id, false);
    }, this.maxListenTimeMs);

    // Listen for the response
    fetchPromise
      .then(response => {
        clearTimeout(maxTimeoutId);
        const duration = Date.now() - request.startTime;

        // Even if we got a response, it might be an error
        const hadResponse = response.ok;

        logger.info(`Background request ${id} completed after ${duration}ms`, {
          serverId,
          model,
          duration,
          status: response.status,
          hadResponse,
        });

        this.completeRequest(id, hadResponse, duration);
      })
      .catch(error => {
        clearTimeout(maxTimeoutId);

        // Request failed or was cancelled
        const duration = Date.now() - request.startTime;

        logger.debug(`Background request ${id} failed after ${duration}ms`, {
          serverId,
          model,
          duration,
          error: error instanceof Error ? error.message : String(error),
        });

        this.completeRequest(id, false, duration);
      });
  }

  /**
   * Complete a tracked request and notify callback
   */
  private completeRequest(id: string, hadResponse: boolean, duration?: number): void {
    const request = this.requests.get(id);
    if (!request) {
      return;
    }

    const actualDuration = duration ?? Date.now() - request.startTime;

    // Remove from tracking
    this.requests.delete(id);

    // Notify callback
    request.onComplete?.(actualDuration, hadResponse);
  }

  /**
   * Get stats about tracked requests
   */
  getStats(): {
    totalTracked: number;
    byServer: Record<string, number>;
    byModel: Record<string, number>;
    avgAgeMs: number;
    oldestAgeMs: number;
  } {
    const now = Date.now();
    const byServer: Record<string, number> = {};
    const byModel: Record<string, number> = {};
    let totalAge = 0;
    let oldestAge = 0;

    for (const request of this.requests.values()) {
      byServer[request.serverId] = (byServer[request.serverId] || 0) + 1;
      byModel[request.model] = (byModel[request.model] || 0) + 1;
      const age = now - request.startTime;
      totalAge += age;
      oldestAge = Math.max(oldestAge, age);
    }

    const count = this.requests.size;
    return {
      totalTracked: count,
      byServer,
      byModel,
      avgAgeMs: count > 0 ? totalAge / count : 0,
      oldestAgeMs: oldestAge,
    };
  }

  /**
   * Clean up expired tracked requests
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let cleaned = 0;

      for (const [id, request] of this.requests) {
        const age = now - request.startTime;
        if (age > this.maxListenTimeMs) {
          logger.debug(`Cleaning up expired background request ${id} (age: ${age}ms)`);
          request.abortController.abort();
          this.completeRequest(id, false, age);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        logger.debug(`Cleaned up ${cleaned} expired background requests`);
      }
    }, 60000); // Run every minute
  }

  /**
   * Stop tracking all requests
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    // Cancel all pending requests
    for (const request of this.requests.values()) {
      request.abortController.abort();
    }
    this.requests.clear();

    logger.info('Background request tracker shut down');
  }
}

// Singleton instance
let tracker: BackgroundRequestTracker | null = null;

export function getBackgroundRequestTracker(): BackgroundRequestTracker {
  if (!tracker) {
    tracker = new BackgroundRequestTracker();
  }
  return tracker;
}

export function resetBackgroundRequestTracker(): void {
  tracker?.shutdown();
  tracker = null;
}
