/**
 * statistics.ts
 * Centralized statistical calculations
 * Replaces duplicated percentile and average implementations
 */

import { featureFlags } from '../config/feature-flags.js';

export interface PercentileResult {
  p50: number;
  p95: number;
  p99: number;
  [key: string]: number;
}

export class Statistics {
  /**
   * Calculate a single percentile from sorted values
   */
  static calculatePercentile(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) return 0;
    if (sortedValues.length === 1) return sortedValues[0];

    const index = Math.ceil(sortedValues.length * percentile) - 1;
    return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
  }

  /**
   * Calculate multiple percentiles at once
   */
  static calculatePercentiles(
    values: number[],
    percentiles: number[] = [0.5, 0.95, 0.99]
  ): PercentileResult {
    if (values.length === 0) {
      const emptyResult: PercentileResult = { p50: 0, p95: 0, p99: 0 };
      percentiles.forEach(p => {
        if (p !== 0.5 && p !== 0.95 && p !== 0.99) {
          emptyResult[`p${Math.round(p * 100)}`] = 0;
        }
      });
      return emptyResult;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const result: PercentileResult = { p50: 0, p95: 0, p99: 0 };

    percentiles.forEach(percentile => {
      const value = this.calculatePercentile(sorted, percentile);
      const key = `p${Math.round(percentile * 100)}`;
      result[key] = value;
    });

    return result;
  }

  /**
   * Calculate arithmetic mean
   */
  static calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  /**
   * Calculate weighted average
   */
  static calculateWeightedAverage(values: number[], weights: number[]): number {
    if (values.length !== weights.length) {
      throw new Error('Values and weights arrays must have same length');
    }
    if (values.length === 0) return 0;

    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    if (totalWeight === 0) return 0;

    const weightedSum = values.reduce((sum, v, i) => sum + v * weights[i], 0);
    return weightedSum / totalWeight;
  }

  /**
   * Calculate standard deviation
   */
  static calculateStandardDeviation(values: number[]): number {
    if (values.length < 2) return 0;
    const avg = this.calculateAverage(values);
    const squaredDiffs = values.map(v => Math.pow(v - avg, 2));
    return Math.sqrt(this.calculateAverage(squaredDiffs));
  }

  /**
   * Calculate median (alias for p50)
   */
  static calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return this.calculatePercentile(sorted, 0.5);
  }

  /**
   * Calculate min and max
   */
  static calculateRange(values: number[]): { min: number; max: number } {
    if (values.length === 0) return { min: 0, max: 0 };
    return {
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }

  /**
   * Calculate success rate
   */
  static calculateSuccessRate(successes: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((successes / total) * 1000) / 1000;
  }

  /**
   * Calculate rate per time period
   */
  static calculateRate(count: number, timeMs: number): number {
    if (timeMs <= 0) return 0;
    return (count / timeMs) * 1000; // per second
  }

  /**
   * Calculate percentiles using feature flag
   * If flag is disabled, returns default zeros
   */
  static calculatePercentilesWithFlag(
    values: number[],
    percentiles: number[] = [0.5, 0.95, 0.99]
  ): PercentileResult {
    if (!featureFlags.get('useStatisticsUtility')) {
      return { p50: 0, p95: 0, p99: 0 };
    }
    return this.calculatePercentiles(values, percentiles);
  }
}
