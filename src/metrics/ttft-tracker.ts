/**
 * ttft-tracker.ts
 * Centralized Time to First Token tracking
 * Ensures consistent TTFT measurement across all streaming endpoints
 */

import { logger } from '../utils/logger.js';

export interface TTFTOptions {
  /** Track when first chunk is received (default: true) */
  trackFirstChunk?: boolean;
  /** Track when first content-bearing chunk arrives (default: true) */
  trackFirstContent?: boolean;
  /** Track when first token is decoded (default: false) */
  trackFirstToken?: boolean;
  /** Server ID for logging */
  serverId?: string;
  /** Model name for logging */
  model?: string;
  /** Request ID for correlation */
  requestId?: string;
}

export interface TTFTMetrics {
  /** Time to first chunk (any data) in ms */
  timeToFirstChunk?: number;
  /** Time to first content (actual response text) in ms */
  timeToFirstContent?: number;
  /** Time to first token (if tokenizable) in ms */
  timeToFirstToken?: number;
  /** Primary TTFT metric - uses timeToFirstContent if available, falls back to timeToFirstChunk */
  ttft?: number;
  /** Whether content was detected */
  hasContent: boolean;
  /** Total chunks received */
  chunkCount: number;
}

export class TTFTTracker {
  private startTime: number;
  private firstChunkTime?: number;
  private firstContentTime?: number;
  private firstTokenTime?: number;
  private chunkCount = 0;
  private options: Required<
    Pick<TTFTOptions, 'trackFirstChunk' | 'trackFirstContent' | 'trackFirstToken'>
  > &
    Pick<TTFTOptions, 'serverId' | 'model' | 'requestId'>;

  constructor(options: TTFTOptions = {}) {
    this.startTime = performance.now();
    this.options = {
      trackFirstChunk: true,
      trackFirstContent: true,
      trackFirstToken: false,
      serverId: options.serverId,
      model: options.model,
      requestId: options.requestId,
    };
  }

  /**
   * Mark first chunk received
   * Call when first data arrives from upstream
   */
  markFirstChunk(chunkSize: number): void {
    if (this.options.trackFirstChunk && !this.firstChunkTime) {
      this.firstChunkTime = performance.now();
      logger.debug('TTFT: First chunk received', {
        serverId: this.options.serverId,
        model: this.options.model,
        requestId: this.options.requestId,
        chunkSize,
        elapsed: this.getElapsed(this.firstChunkTime),
      });
    }
    this.chunkCount++;
  }

  /**
   * Mark first content chunk received
   * Call when chunk contains actual response content
   */
  markFirstContent(contentPreview?: string): void {
    if (this.options.trackFirstContent && !this.firstContentTime) {
      this.firstContentTime = performance.now();
      logger.debug('TTFT: First content received', {
        serverId: this.options.serverId,
        model: this.options.model,
        requestId: this.options.requestId,
        contentPreview: contentPreview?.slice(0, 50),
        elapsed: this.getElapsed(this.firstContentTime),
      });
    }
    this.chunkCount++;
  }

  /**
   * Mark first token decoded
   * Call when first token is identified in stream
   */
  markFirstToken(tokenPreview?: string): void {
    if (this.options.trackFirstToken && !this.firstTokenTime) {
      this.firstTokenTime = performance.now();
      logger.debug('TTFT: First token decoded', {
        serverId: this.options.serverId,
        model: this.options.model,
        requestId: this.options.requestId,
        tokenPreview: tokenPreview?.slice(0, 50),
        elapsed: this.getElapsed(this.firstTokenTime),
      });
    }
  }

  /**
   * Increment chunk counter for non-TTFT chunks
   */
  incrementChunk(): void {
    this.chunkCount++;
  }

  /**
   * Get all TTFT metrics
   */
  getMetrics(): TTFTMetrics {
    const timeToFirstChunk = this.firstChunkTime
      ? Math.round(this.firstChunkTime - this.startTime)
      : undefined;

    const timeToFirstContent = this.firstContentTime
      ? Math.round(this.firstContentTime - this.startTime)
      : undefined;

    const timeToFirstToken = this.firstTokenTime
      ? Math.round(this.firstTokenTime - this.startTime)
      : undefined;

    // Primary TTFT uses content time if available, falls back to chunk time
    const ttft = timeToFirstContent ?? timeToFirstChunk;

    return {
      timeToFirstChunk,
      timeToFirstContent,
      timeToFirstToken,
      ttft,
      hasContent: !!this.firstContentTime,
      chunkCount: this.chunkCount,
    };
  }

  /**
   * Get current elapsed time
   */
  getCurrentElapsed(): number {
    return Math.round(performance.now() - this.startTime);
  }

  private getElapsed(timestamp: number): number {
    return Math.round(timestamp - this.startTime);
  }
}
