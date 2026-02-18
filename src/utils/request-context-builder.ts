/**
 * request-context-builder.ts
 * Builder pattern for creating consistent RequestContext objects
 * Ensures all required fields are set and provides a fluent API
 */

import { randomUUID } from 'crypto';
import type { RequestContext } from '../orchestrator.types.js';
import { Timer } from './timer.js';
import { featureFlags } from '../config/feature-flags.js';

export class RequestContextBuilder {
  private context: Partial<RequestContext> = {};
  private timer: Timer | null = null;

  /**
   * Start building a new request context
   */
  static create(serverId: string, model: string): RequestContextBuilder {
    const builder = new RequestContextBuilder();
    const useTimer = featureFlags.get('useTimerUtility');

    if (useTimer) {
      builder.timer = new Timer();
    }

    const startTime = builder.timer ? builder.timer.elapsed() : Date.now();

    builder.context = {
      id: randomUUID(),
      startTime,
      serverId,
      model,
      success: false,
    };
    return builder;
  }

  /**
   * Set the endpoint type
   */
  withEndpoint(endpoint: RequestContext['endpoint']): this {
    this.context.endpoint = endpoint;
    return this;
  }

  /**
   * Set whether this is a streaming request
   */
  withStreaming(streaming: boolean): this {
    this.context.streaming = streaming;
    return this;
  }

  /**
   * Set initial metadata
   */
  withMetadata(metadata: Record<string, unknown>): this {
    (this.context as Record<string, unknown>).metadata = metadata;
    return this;
  }

  /**
   * Build the context (immutable)
   */
  build(): RequestContext {
    if (!this.context.serverId || !this.context.model) {
      throw new Error('RequestContext must have serverId and model');
    }
    return this.context as RequestContext;
  }

  /**
   * Complete the request and finalize metrics
   */
  complete(context: RequestContext, success: boolean): RequestContext {
    const endTime = this.timer ? this.timer.elapsed() : Date.now();
    return {
      ...context,
      success,
      endTime,
      duration: Math.round(endTime - context.startTime),
    };
  }

  /**
   * Complete with error
   */
  completeWithError(context: RequestContext, error: Error): RequestContext {
    const endTime = this.timer ? this.timer.elapsed() : Date.now();
    return {
      ...context,
      success: false,
      endTime,
      duration: Math.round(endTime - context.startTime),
      error,
    };
  }

  /**
   * Add streaming metrics
   */
  withStreamingMetrics(
    context: RequestContext,
    metrics: { ttft?: number; streamingDuration?: number }
  ): RequestContext {
    return {
      ...context,
      ttft: metrics.ttft,
      streamingDuration: metrics.streamingDuration,
    };
  }

  /**
   * Add token metrics
   */
  withTokenMetrics(
    context: RequestContext,
    metrics: { tokensGenerated?: number; tokensPrompt?: number }
  ): RequestContext {
    return {
      ...context,
      tokensGenerated: metrics.tokensGenerated,
      tokensPrompt: metrics.tokensPrompt,
    };
  }
}

/**
 * Convenience function for quick context creation
 */
export function createRequestContext(
  serverId: string,
  model: string,
  endpoint: RequestContext['endpoint'],
  streaming: boolean
): RequestContext {
  return RequestContextBuilder.create(serverId, model)
    .withEndpoint(endpoint)
    .withStreaming(streaming)
    .build();
}
