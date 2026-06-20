/**
 * metricsController.ts
 * API controllers for metrics endpoints
 */

import type { Request, Response } from 'express';

import type { MetricsAggregator } from '../metrics/metrics-aggregator.js';
import { PrometheusExporter } from '../metrics/prometheus-exporter.js';
import { getOrchestratorInstance } from '../orchestrator/orchestrator-instance.js';
import { WALStore } from '../probe/wal-store.js';
import { getOperationalStore } from '../storage/operational-store.js';
import { getInFlightManager } from '../utils/in-flight-manager.js';

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
  // Model may contain slashes and therefore might be captured as a wildcard segment
  // on the route (e.g. '/metrics/:serverId/*'). Prefer explicit param if present,
  // otherwise fall back to the wildcard capture at req.params[0]. Decode to be safe.
  const rawModel = (req.params.model as string) || req.params[0] || '';
  const model = rawModel ? decodeURIComponent(rawModel) : '';

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

/**
 * Get recovery test metrics and statistics
 * GET /api/orchestrator/metrics/recovery-tests
 *
 * Queries WAL events for recovery-related state transitions:
 * - UNHEALTHY → RECOVERING: recovery attempt started
 * - RECOVERING → HEALTHY: recovery succeeded
 * - RECOVERING → UNHEALTHY: recovery failed
 */
export function getRecoveryTestMetrics(req: Request, res: Response): void {
  try {
    const wal = new WALStore(getOperationalStore());

    const allEvents = wal.getEventsAfter(0);

    const recoveryAttempts = { count: 0, byTuple: new Map<string, number>() };
    const recoverySuccesses = { count: 0, byTuple: new Map<string, number>() };
    const recoveryFailures = { count: 0, byTuple: new Map<string, number>() };
    const allTuples = new Set<string>();

    for (const event of allEvents) {
      const { tupleKey, fromState, toState } = event;
      allTuples.add(tupleKey);

      if (fromState === 'UNHEALTHY' && toState === 'RECOVERING') {
        recoveryAttempts.count++;
        recoveryAttempts.byTuple.set(tupleKey, (recoveryAttempts.byTuple.get(tupleKey) ?? 0) + 1);
      }

      if (fromState === 'RECOVERING' && toState === 'HEALTHY') {
        recoverySuccesses.count++;
        recoverySuccesses.byTuple.set(tupleKey, (recoverySuccesses.byTuple.get(tupleKey) ?? 0) + 1);
      }

      if (fromState === 'RECOVERING' && toState === 'UNHEALTHY') {
        recoveryFailures.count++;
        recoveryFailures.byTuple.set(tupleKey, (recoveryFailures.byTuple.get(tupleKey) ?? 0) + 1);
      }
    }

    const recoveryProbabilities: Record<string, number> = {};
    for (const tupleKey of allTuples) {
      const attempts = recoveryAttempts.byTuple.get(tupleKey) ?? 0;
      const successes = recoverySuccesses.byTuple.get(tupleKey) ?? 0;
      recoveryProbabilities[tupleKey] = attempts > 0 ? successes / attempts : -1;
    }

    const totalRecoveryAttempts = recoveryAttempts.count;
    const totalRecoverySuccesses = recoverySuccesses.count;
    const totalRecoveryFailures = recoveryFailures.count;

    res.status(200).json({
      success: true,
      timestamp: Date.now(),
      aggregate: {
        totalRecoveryAttempts,
        totalRecoverySuccesses,
        totalRecoveryFailures,
        successRate: totalRecoveryAttempts > 0 ? totalRecoverySuccesses / totalRecoveryAttempts : 0,
      },
      recoveryProbabilities,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get recovery test metrics',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get recovery test metrics for a specific breaker
 * GET /api/orchestrator/metrics/recovery-tests/:breakerName
 *
 * Queries WAL events for the specific tuple and returns chronological
 * list of recovery events with timestamps.
 */
export function getBreakerRecoveryMetrics(req: Request, res: Response): void {
  try {
    const breakerName = decodeURIComponent(req.params.breakerName as string);
    const wal = new WALStore(getOperationalStore());

    const events = wal.getEventsForTuple(breakerName);

    const recoveryEvents: Array<{
      timestamp: number;
      fromState: string;
      toState: string;
      eventType: string;
      reason: string | null;
    }> = [];

    for (const event of events) {
      const isRecoveryTransition =
        (event.fromState === 'UNHEALTHY' && event.toState === 'RECOVERING') ||
        (event.fromState === 'RECOVERING' && event.toState === 'HEALTHY') ||
        (event.fromState === 'RECOVERING' && event.toState === 'UNHEALTHY');

      if (isRecoveryTransition) {
        recoveryEvents.push({
          timestamp: event.createdAt,
          fromState: event.fromState ?? '',
          toState: event.toState ?? '',
          eventType: event.eventType,
          reason: event.reason,
        });
      }
    }

    const attempts = events.filter(
      e => e.fromState === 'UNHEALTHY' && e.toState === 'RECOVERING'
    ).length;
    const successes = events.filter(
      e => e.fromState === 'RECOVERING' && e.toState === 'HEALTHY'
    ).length;
    const probability = attempts > 0 ? successes / attempts : -1;

    res.status(200).json({
      success: true,
      timestamp: Date.now(),
      breakerName,
      recoveryEvents,
      recoveryProbability: probability,
      totalRecoveryAttempts: attempts,
      totalRecoverySuccesses: successes,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get breaker recovery metrics',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get in-flight requests grouped by server
 * GET /api/orchestrator/in-flight
 */
export function getInFlight(req: Request, res: Response): void {
  try {
    const orchestrator = getOrchestratorInstance();
    const inFlightManager = getInFlightManager();

    const detailed = inFlightManager.getInFlightDetailed();
    const streamingByServer = inFlightManager.getStreamingRequestsByServer();
    const servers = orchestrator.getServers();

    // Build a map of serverId -> server metadata for quick lookup
    const serverMap = new Map(servers.map(s => [s.id, s]));

    // Collect all active server IDs (from in-flight + streaming)
    const activeServerIds = new Set<string>([
      ...Object.keys(detailed),
      ...Object.keys(streamingByServer),
    ]);

    let total = 0;
    const inFlight = Array.from(activeServerIds).map(serverId => {
      const serverInfo = serverMap.get(serverId);
      const perServer = detailed[serverId] ?? { total: 0, byModel: {} };
      const streaming = streamingByServer[serverId] ?? [];
      total += perServer.total;
      return {
        serverId,
        serverUrl: serverInfo?.url,
        healthy: serverInfo?.healthy ?? false,
        total: perServer.total,
        byModel: perServer.byModel,
        streamingRequests: streaming,
      };
    });

    res.status(200).json({ total, inFlight });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get in-flight requests',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

export function streamMetrics(req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders(); // Flush headers immediately to establish SSE connection

  const orchestrator = getOrchestratorInstance();
  const inFlightManager = getInFlightManager();
  let isClosed = false;

  const sendUpdate = () => {
    if (isClosed) {
      return;
    }

    try {
      const stats = orchestrator.getStats();
      const metrics = orchestrator.exportMetrics();
      const circuitBreakers = orchestrator.getCircuitBreakerStats();

      const servers = orchestrator.getServers();
      const serversData = servers.map(s => ({
        id: s.id,
        url: s.url,
        healthy: s.healthy,
        lastResponseTime: s.lastResponseTime,
        models: s.models,
        maxConcurrency: s.maxConcurrency,
        version: s.version,
        supportsOllama: s.supportsOllama,
        supportsV1: s.supportsV1,
        v1Models: s.v1Models,
      }));

      const modelMap = orchestrator.getModelMap();
      const serverToModels: Record<string, string[]> = {};
      for (const server of servers) {
        serverToModels[server.id] = [...server.models];
      }

      const inFlightDetailed = inFlightManager.getInFlightDetailed();
      const streamingByServer = inFlightManager.getStreamingRequestsByServer();

      const serverMap = new Map(servers.map(s => [s.id, s]));

      const activeServerIds = new Set<string>([
        ...Object.keys(inFlightDetailed),
        ...Object.keys(streamingByServer),
      ]);

      let totalInFlight = 0;
      const inFlight = Array.from(activeServerIds).map(serverId => {
        const serverInfo = serverMap.get(serverId);
        const perServer = inFlightDetailed[serverId] ?? { total: 0, byModel: {} };
        const streaming = streamingByServer[serverId] ?? [];
        totalInFlight += perServer.total;
        return {
          serverId,
          serverUrl: serverInfo?.url,
          healthy: serverInfo?.healthy ?? false,
          total: perServer.total,
          byModel: perServer.byModel,
          streamingRequests: streaming,
        };
      });

      const data = JSON.stringify({
        type: 'metrics',
        timestamp: Date.now(),
        stats,
        metrics: { timestamp: metrics.timestamp, global: metrics.global },
        circuitBreakers: Object.keys(circuitBreakers).length,
        servers: serversData,
        modelMap: { modelToServers: modelMap, serverToModels },
        inFlight: { total: totalInFlight, inFlight },
      });

      res.write(`data: ${data}\n\n`);
    } catch (error) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to get metrics' })}\n\n`);
    }
  };

  const interval = setInterval(sendUpdate, 5000);
  sendUpdate();

  req.on('close', () => {
    isClosed = true;
    clearInterval(interval);
  });
}
