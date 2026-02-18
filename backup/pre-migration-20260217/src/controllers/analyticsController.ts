/**
 * analyticsController.ts
 * Analytics API endpoints for reporting and insights
 */

import type { Request, Response } from 'express';

import type { AnalyticsTimeRange } from '../analytics/analytics-engine.js';
import { getAnalyticsEngine } from '../analytics-instance.js';
import { getOrchestratorInstance } from '../orchestrator-instance.js';

/**
 * Get top models by usage
 * GET /api/orchestrator/analytics/top-models
 */
export function getTopModels(req: Request, res: Response): void {
  const { limit = '10', timeRange = '24h' } = req.query;

  const analytics = getAnalyticsEngine();
  const orchestrator = getOrchestratorInstance();

  // Update analytics with current metrics
  analytics.updateMetrics(orchestrator.getAllDetailedMetrics());

  try {
    const topModels = analytics.getTopModels(
      parseInt(limit as string, 10) || 10,
      timeRange as AnalyticsTimeRange
    );

    res.status(200).json({
      success: true,
      timeRange: timeRange as string,
      models: topModels.map(model => ({
        model: model.model,
        requests: model.requests,
        percentage: Math.round(model.percentage * 100) / 100,
        avgLatency: model.avgLatency,
        errorRate: model.errorRate,
      })),
      count: topModels.length,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get top models',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get server performance comparison
 * GET /api/orchestrator/analytics/server-performance
 */
export function getServerPerformance(req: Request, res: Response): void {
  const { timeRange = '1h' } = req.query;

  const analytics = getAnalyticsEngine();
  const orchestrator = getOrchestratorInstance();

  // Update analytics with current metrics
  analytics.updateMetrics(orchestrator.getAllDetailedMetrics());

  try {
    const performance = analytics.getServerPerformance(timeRange as AnalyticsTimeRange);

    res.status(200).json({
      success: true,
      timeRange: timeRange as string,
      servers: performance.map(server => ({
        id: server.id,
        requests: server.requests,
        avgLatency: server.avgLatency,
        p95Latency: server.p95Latency,
        p99Latency: server.p99Latency,
        errorRate: server.errorRate,
        throughput: server.throughput,
        utilization: server.utilization,
        score: server.score,
      })),
      count: performance.length,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get server performance',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get error analysis
 * GET /api/orchestrator/analytics/errors
 */
export function getErrorAnalysis(req: Request, res: Response): void {
  const { timeRange = '24h', includeRecent = 'true' } = req.query;

  const analytics = getAnalyticsEngine();
  const orchestrator = getOrchestratorInstance();

  // Update analytics with current metrics
  analytics.updateMetrics(orchestrator.getAllDetailedMetrics());

  try {
    const analysis = analytics.getErrorAnalysis(timeRange as AnalyticsTimeRange);

    const response: Record<string, unknown> = {
      success: true,
      timeRange: timeRange as string,
      totalErrors: analysis.totalErrors,
      byType: analysis.byType,
      byServer: analysis.byServer,
      byModel: analysis.byModel,
      trend: analysis.trend,
    };

    // Include recent errors if requested
    if (includeRecent === 'true') {
      response.recentErrors = analysis.recentErrors.slice(0, 20).map(err => ({
        timestamp: err.timestamp,
        serverId: err.serverId,
        model: err.model,
        errorType: err.errorType,
        message: err.message,
      }));
    }

    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get error analysis',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get capacity planning data
 * GET /api/orchestrator/analytics/capacity
 */
export function getCapacityAnalysis(req: Request, res: Response): void {
  const { timeRange = '24h' } = req.query;

  const analytics = getAnalyticsEngine();
  const orchestrator = getOrchestratorInstance();

  // Update analytics with current metrics
  analytics.updateMetrics(orchestrator.getAllDetailedMetrics());

  try {
    const queueStats = orchestrator.getQueueStats();
    const capacity = analytics.getCapacityAnalysis(
      queueStats.currentSize,
      timeRange as AnalyticsTimeRange
    );

    res.status(200).json({
      success: true,
      current: capacity.current,
      forecast: capacity.forecast,
      trends: {
        requestsPerHour: capacity.trends.requestsPerHour,
        saturationLevels: capacity.trends.saturationLevels.map(s => Math.round(s * 100) / 100),
        timestamps: capacity.trends.timestamps,
      },
      recommendations: capacity.recommendations,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get capacity analysis',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get trend analysis for a specific metric
 * GET /api/orchestrator/analytics/trends/:metric
 */
export function getTrendAnalysis(req: Request, res: Response): void {
  const { metric } = req.params;
  const { serverId, model, timeRange = '24h' } = req.query;

  const metricValue = Array.isArray(metric) ? metric[0] : metric;
  if (!['latency', 'errors', 'throughput'].includes(metricValue)) {
    res.status(400).json({
      error: 'Invalid metric. Must be one of: latency, errors, throughput',
    });
    return;
  }

  const analytics = getAnalyticsEngine();
  const orchestrator = getOrchestratorInstance();

  // Update analytics with current metrics
  analytics.updateMetrics(orchestrator.getAllDetailedMetrics());

  try {
    const trend = analytics.analyzeTrend(
      metricValue as 'latency' | 'errors' | 'throughput',
      serverId as string | undefined,
      model as string | undefined,
      timeRange as AnalyticsTimeRange
    );

    res.status(200).json({
      success: true,
      metric,
      analysis: {
        direction: trend.direction,
        slope: Math.round(trend.slope * 1000) / 1000,
        confidence: Math.round(trend.confidence * 100) / 100,
      },
      timeRange: timeRange as string,
      ...(serverId && { serverId }),
      ...(model && { model }),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to analyze trend',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get analytics summary
 * GET /api/orchestrator/analytics/summary
 */
export function getAnalyticsSummary(req: Request, res: Response): void {
  const analytics = getAnalyticsEngine();
  const orchestrator = getOrchestratorInstance();

  // Update analytics with current metrics
  analytics.updateMetrics(orchestrator.getAllDetailedMetrics());

  try {
    const summary = analytics.getSummary();
    const globalMetrics = orchestrator.getGlobalMetrics();

    res.status(200).json({
      success: true,
      summary: {
        ...summary,
        requestsPerSecond: Math.round(globalMetrics.requestsPerSecond * 100) / 100,
        errorRate: globalMetrics.errorRate,
      },
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get analytics summary',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get load balancer decision history
 * GET /api/orchestrator/analytics/decisions
 */
export function getDecisionHistory(req: Request, res: Response): void {
  const { limit = '100', model, serverId } = req.query;

  const analytics = getAnalyticsEngine();

  try {
    const events = analytics.getDecisionEvents(
      parseInt(limit as string, 10),
      model as string | undefined,
      serverId as string | undefined
    );

    res.status(200).json({
      success: true,
      count: events.length,
      events: events.map(event => ({
        timestamp: event.timestamp,
        model: event.model,
        selectedServerId: event.selectedServerId,
        algorithm: event.algorithm,
        candidates: event.candidates,
        selectionReason: event.selectionReason,
      })),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get decision history',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get server model decision trends
 * GET /api/orchestrator/analytics/decisions/trends/:serverId/:model
 */
export function getServerModelDecisionTrend(req: Request, res: Response): void {
  const { serverId, model } = req.params;
  const { hours = '24' } = req.query;

  const analytics = getAnalyticsEngine();

  try {
    const trend = analytics.getServerModelDecisionTrend(
      Array.isArray(serverId) ? serverId[0] : serverId,
      Array.isArray(model) ? model[0] : model,
      parseInt(hours as string, 10)
    );

    res.status(200).json({
      success: true,
      serverId,
      model,
      hours: parseInt(hours as string, 10),
      trend: {
        timestamps: trend.timestamps,
        scores: trend.scores,
        latencyScores: trend.latencyScores,
        successRateScores: trend.successRateScores,
        loadScores: trend.loadScores,
        capacityScores: trend.capacityScores,
        selectionCount: trend.selectionCount,
        avgPosition: Math.round(trend.avgPosition * 100) / 100,
      },
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get decision trend',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get server selection statistics
 * GET /api/orchestrator/analytics/selection-stats
 */
export function getSelectionStats(req: Request, res: Response): void {
  const { hours = '24' } = req.query;

  const analytics = getAnalyticsEngine();

  try {
    const stats = analytics.getServerSelectionStats(parseInt(hours as string, 10));

    res.status(200).json({
      success: true,
      hours: parseInt(hours as string, 10),
      stats: stats.map(stat => ({
        serverId: stat.serverId,
        totalSelections: stat.totalSelections,
        byModel: stat.byModel,
        avgScore: Math.round(stat.avgScore * 100) / 100,
      })),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get selection statistics',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get load balancer algorithm usage
 * GET /api/orchestrator/analytics/algorithms
 */
export function getAlgorithmStats(req: Request, res: Response): void {
  const { hours = '24' } = req.query;

  const analytics = getAnalyticsEngine();

  try {
    const stats = analytics.getAlgorithmStats(parseInt(hours as string, 10));

    res.status(200).json({
      success: true,
      hours: parseInt(hours as string, 10),
      algorithms: stats,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get algorithm statistics',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get score timeline
 * GET /api/orchestrator/analytics/score-timeline
 */
export function getScoreTimeline(req: Request, res: Response): void {
  const { hours = '24', interval = '15' } = req.query;

  const analytics = getAnalyticsEngine();

  try {
    const timeline = analytics.getScoreTimeline(
      parseInt(hours as string, 10),
      parseInt(interval as string, 10)
    );

    res.status(200).json({
      success: true,
      hours: parseInt(hours as string, 10),
      intervalMinutes: parseInt(interval as string, 10),
      dataPoints: timeline,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get score timeline',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get metrics impact analysis
 * GET /api/orchestrator/analytics/metrics-impact
 */
export function getMetricsImpact(req: Request, res: Response): void {
  const { hours = '24' } = req.query;

  const analytics = getAnalyticsEngine();

  try {
    const impact = analytics.getMetricsImpact(parseInt(hours as string, 10));

    res.status(200).json({
      success: true,
      hours: parseInt(hours as string, 10),
      impact: {
        latency: {
          correlation: Math.round(impact.latency.correlation * 1000) / 1000,
          weight: impact.latency.weight,
        },
        successRate: {
          correlation: Math.round(impact.successRate.correlation * 1000) / 1000,
          weight: impact.successRate.weight,
        },
        load: {
          correlation: Math.round(impact.load.correlation * 1000) / 1000,
          weight: impact.load.weight,
        },
        capacity: {
          correlation: Math.round(impact.capacity.correlation * 1000) / 1000,
          weight: impact.capacity.weight,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get metrics impact',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get request history for a server
 * GET /api/orchestrator/analytics/requests/:serverId
 */
export function getServerRequestHistory(req: Request, res: Response): void {
  const { serverId } = req.params;
  const { limit = '100', offset = '0' } = req.query;

  const analytics = getAnalyticsEngine();

  try {
    const requests = analytics.getServerRequestHistory(
      Array.isArray(serverId) ? serverId[0] : serverId,
      parseInt(limit as string, 10),
      parseInt(offset as string, 10)
    );

    res.status(200).json({
      success: true,
      serverId,
      count: requests.length,
      requests: requests.map(req => ({
        id: req.id,
        timestamp: req.timestamp,
        model: req.model,
        endpoint: req.endpoint,
        streaming: req.streaming,
        duration: req.duration,
        success: req.success,
        tokensGenerated: req.tokensGenerated,
        tokensPrompt: req.tokensPrompt,
        errorType: req.errorType,
        ttft: req.ttft,
        streamingDuration: req.streamingDuration,
        queueWaitTime: req.queueWaitTime,
      })),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get request history',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get request statistics for a server
 * GET /api/orchestrator/analytics/request-stats/:serverId
 */
export function getServerRequestStats(req: Request, res: Response): void {
  const { serverId } = req.params;
  const { hours = '24' } = req.query;

  const analytics = getAnalyticsEngine();

  try {
    const stats = analytics.getServerRequestStats(
      Array.isArray(serverId) ? serverId[0] : serverId,
      parseInt(hours as string, 10)
    );

    res.status(200).json({
      success: true,
      serverId,
      hours: parseInt(hours as string, 10),
      stats: {
        totalRequests: stats.totalRequests,
        successfulRequests: stats.successfulRequests,
        failedRequests: stats.failedRequests,
        avgDuration: stats.avgDuration,
        p50Latency: stats.p50Latency,
        p95Latency: stats.p95Latency,
        p99Latency: stats.p99Latency,
        avgTokensGenerated: stats.avgTokensGenerated,
        avgTokensPrompt: stats.avgTokensPrompt,
        requestsPerMinute: stats.requestsPerMinute,
        errorRate: stats.errorRate,
        byModel: stats.byModel,
        byEndpoint: stats.byEndpoint,
      },
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get request statistics',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get request timeline
 * GET /api/orchestrator/analytics/request-timeline
 */
export function getRequestTimeline(req: Request, res: Response): void {
  const { serverId, hours = '24', interval = '15' } = req.query;

  const analytics = getAnalyticsEngine();

  try {
    const timeline = analytics.getRequestTimeline(
      serverId as string | undefined,
      parseInt(hours as string, 10),
      parseInt(interval as string, 10)
    );

    res.status(200).json({
      success: true,
      serverId: serverId ?? 'all',
      hours: parseInt(hours as string, 10),
      intervalMinutes: parseInt(interval as string, 10),
      dataPoints: timeline,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get request timeline',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Search requests
 * GET /api/orchestrator/analytics/requests/search
 */
export function searchRequests(req: Request, res: Response): void {
  const { serverId, model, endpoint, success, startTime, endTime, limit = '100' } = req.query;

  const analytics = getAnalyticsEngine();

  try {
    const requests = analytics.searchRequests({
      serverId: serverId as string | undefined,
      model: model as string | undefined,
      endpoint: endpoint as string | undefined,
      success: success !== undefined ? success === 'true' : undefined,
      startTime: startTime ? parseInt(startTime as string, 10) : undefined,
      endTime: endTime ? parseInt(endTime as string, 10) : undefined,
      limit: parseInt(limit as string, 10),
    });

    res.status(200).json({
      success: true,
      count: requests.length,
      requests: requests.map(req => ({
        id: req.id,
        timestamp: req.timestamp,
        serverId: req.serverId,
        model: req.model,
        endpoint: req.endpoint,
        streaming: req.streaming,
        duration: req.duration,
        success: req.success,
        tokensGenerated: req.tokensGenerated,
        tokensPrompt: req.tokensPrompt,
        errorType: req.errorType,
        errorMessage: req.errorMessage,
        ttft: req.ttft,
        streamingDuration: req.streamingDuration,
        queueWaitTime: req.queueWaitTime,
      })),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to search requests',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get servers with request history
 * GET /api/orchestrator/analytics/servers-with-history
 */
export function getServersWithHistory(req: Request, res: Response): void {
  const analytics = getAnalyticsEngine();

  try {
    const serverIds = analytics.getServersWithHistory();

    res.status(200).json({
      success: true,
      count: serverIds.length,
      serverIds,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get servers with history',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
