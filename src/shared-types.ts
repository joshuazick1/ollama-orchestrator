/**
 * shared-types.ts
 * Types shared between backend and frontend
 * This file can be used directly by frontend via TypeScript project references
 * or the types can be extracted/generated for the frontend
 *
 * Usage in frontend:
 * 1. Option A: Use TypeScript project references (recommended for full type safety)
 * 2. Option B: Copy this file to frontend/src/types/ and keep in sync
 * 3. Option C: Use a build script to generate types from backend
 */

export type {
  AIServer,
  LoadedModel,
  ServerModelMetrics,
  MetricsWindow,
  LatencyPercentiles,
  TimeWindow,
  GlobalMetrics,
  MetricsExport,
  ServerMetricsExport,
  ModelMetricsExport,
  RequestContext,
  CircuitBreakerState,
  ServerModelBenchmark,
  StreamingMetrics,
  PrometheusMetric,
} from './orchestrator.types.js';
