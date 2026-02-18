/**
 * math-helpers.ts
 * Mathematical utility functions
 */

import { featureFlags } from '../config/feature-flags.js';

/**
 * Clamp value between min and max (inclusive)
 * Replaces Math.max(min, Math.min(max, value)) pattern
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Linear interpolation between start and end
 */
export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * clamp(t, 0, 1);
}

/**
 * Calculate exponential backoff delay
 */
export function calculateBackoff(
  attempt: number,
  baseDelay: number,
  multiplier: number,
  maxDelay: number
): number {
  const delay = baseDelay * Math.pow(multiplier, attempt);
  return Math.min(delay, maxDelay);
}

/**
 * Round to specified decimal places
 */
export function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Check if value is within range
 */
export function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

/**
 * Clamp with feature flag support
 */
export function clampWithFlag(value: number, min: number, max: number): number {
  if (!featureFlags.get('useMathHelpers')) {
    return clamp(value, min, max);
  }
  return clamp(value, min, max);
}
