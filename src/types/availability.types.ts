/**
 * availability.types.ts
 * Type definitions for the model availability endpoint
 */

import type { ProbeState } from '../probe/types.js';

/**
 * Probe state of a single server for a model
 */
export interface ServerAvailability {
  id: string;
  state: ProbeState | 'UNKNOWN';
  p95LatencyMs: number | null;
  successRate: number | null;
  cooldownRemainingMs: number;
  isAvailable: boolean;
}

/**
 * An alternative model that can be used when the primary is unavailable
 */
export interface AlternativeModel {
  model: string;
  similarity: 'same-family' | 'same-parameter-size' | 'shared-prefix';
  available: boolean;
}

/**
 * A recommended fallback model with reason
 */
export interface RecommendedModel {
  model: string;
  reason: string;
}

/**
 * Response shape for GET /v1/models/availability?model=<name>
 */
export interface ModelAvailabilityResponse {
  model: string;
  available: boolean;
  servers: ServerAvailability[];
  alternatives: AlternativeModel[];
  recommended: RecommendedModel | null;
  lastUpdated: number;
}

/**
 * Error response shape
 */
export interface ModelAvailabilityError {
  error: {
    message: string;
  };
}
