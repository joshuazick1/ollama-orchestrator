/**
 * metricsController.ts
 * API controllers for metrics endpoints
 */

import type { Request, Response } from 'express';

import type { MetricsAggregator } from '../metrics/metrics-aggregator.js';
import { PrometheusExporter } from '../metrics/prometheus-exporter.js';
import { getOrchestratorInstance } from '../orchestrator-instance.js';

/**
 * Get comprehensive metrics for all server:model combinations
 * GET /api/orchestrator/metrics
 */
export function getMetrics(req: Request, res: Response): void {
  const orchestrator = getOrchestratorInstance();

  try {
    const metrics = orchestrator.exportMetrics();

    res.status(200).json({
      success: true,
      timestamp: metrics.timestamp,
      global: metrics.global,
      servers: metrics.servers,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get metrics',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get detailed metrics for a specific server:model
 * GET /api/orchestrator/metrics/:serverId/:model
 */
export function getServerModelMetrics(req: Request, res: Response): void {
  const orchestrator = getOrchestratorInstance();
  const serverId = req.params.serverId as string;
  const model = req.params.model as string;

  try {
    const metrics = orchestrator.getDetailedMetrics(serverId, model);

    if (!metrics) {
      res.status(404).json({
        error: `No metrics found for server '${serverId}' and model '${model}'`,
      });
      return;
    }

    res.status(200).json({
      success: true,
      serverId,
      model,
      metrics: {
        realtime: {
          inFlight: metrics.inFlight,
          queued: metrics.queued,
        },
        historical: metrics.windows,
        percentiles: metrics.percentiles,
        derived: {
          successRate: metrics.successRate,
          throughput: metrics.throughput,
          avgTokensPerRequest: metrics.avgTokensPerRequest,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get metrics',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get Prometheus-formatted metrics
 * GET /metrics
 */
export function getPrometheusMetrics(req: Request, res: Response): void {
  const orchestrator = getOrchestratorInstance();

  try {
    const allMetrics = orchestrator.getAllDetailedMetrics();
    const exporter = new PrometheusExporter({
      getAllMetrics: () => allMetrics,
      getGlobalMetrics: () => orchestrator.getGlobalMetrics(),
    } as unknown as MetricsAggregator);

    const output = exporter.export();

    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.status(200).send(output);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to export metrics',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
