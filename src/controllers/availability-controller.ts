/**
 * availability-controller.ts
 * Model availability endpoint for informing LLMClient fallback decisions
 */

import type { Request, Response } from 'express';

import { getOrchestratorInstance } from '../orchestrator/orchestrator-instance.js';
import { parseTupleKey } from '../probe/types.js';
import type { ModelAvailabilityResponse, RecommendedModel, ServerAvailability } from '../types/availability.types.js';
import { findAlternatives } from '../utils/alternative-model-resolver.js';

const STALE_THRESHOLD_MS = 5 * 60 * 1000;

function isServerAvailable(
  state: string | undefined,
  cooldownRemainingMs: number
): boolean {
  if (cooldownRemainingMs > 0) return false;
  if (!state) return false;
  return state === 'HEALTHY' || state === 'SUSPECT' || state === 'RECOVERING';
}

export function getModelAvailability(req: Request, res: Response): void {
  const model = req.query.model as string;
  const strictOnly = req.query.strictOnly === 'true';

  if (!model) {
    res.status(400).json({ error: { message: 'Model name is required' } });
    return;
  }

  try {
    const orchestrator = getOrchestratorInstance();
    const modelMap = orchestrator.getModelMap();
    const allStates = orchestrator.getProbeOrchestrator().getAllStates();
    const servers = orchestrator.getServers();
    const banManager = orchestrator.getBanManager();
    const metricsAggregator = orchestrator.getMetricsAggregator();

    const serverIds = modelMap[model];

    if (!serverIds || serverIds.length === 0) {
      res.status(404).json({ error: { message: `Model '${model}' not registered` } });
      return;
    }

    const now = Date.now();
    const serverAvailabilities: ServerAvailability[] = [];
    let hasHealthyServer = false;
    let hasAvailableServer = false;

    for (const serverId of serverIds) {
      let tupleState = undefined;
      let state: string = 'UNKNOWN';
      let cooldownRemainingMs = 0;

      for (const [tupleKey, ts] of allStates.entries()) {
        try {
          const parsed = parseTupleKey(tupleKey);
          if (parsed.model === model && parsed.serverId === serverId) {
            tupleState = ts;
            state = ts.state;
            const isStale = ts.lastProbeAt > 0 && now - ts.lastProbeAt > STALE_THRESHOLD_MS;
            if (isStale) {
              state = 'UNKNOWN';
            }
            break;
          }
        } catch {
          // Malformed tuple keys are skipped
        }
      }

      const cooldownStatus = banManager.getCooldownStatus(serverId, model);
      cooldownRemainingMs = cooldownStatus.remainingMs;

      const isAvailable = isServerAvailable(state, cooldownRemainingMs);

      if (state === 'HEALTHY' || state === 'RECOVERING') {
        hasHealthyServer = true;
      }
      if (isAvailable) {
        hasAvailableServer = true;
      }

      const metrics = metricsAggregator.getMetrics(serverId, model);
      const p95LatencyMs = metrics?.percentiles?.p95 ?? null;
      const successRate = metrics?.successRate ?? null;

      serverAvailabilities.push({
        id: serverId,
        state: state as ServerAvailability['state'],
        p95LatencyMs,
        successRate,
        cooldownRemainingMs,
        isAvailable,
      });
    }

    const allModelNames = Object.keys(modelMap);
    const availableModelNames = new Set<string>();
    for (const [m, srvIds] of Object.entries(modelMap)) {
      let isModelAvailable = false;
      for (const srvId of srvIds) {
        const cooldownStatus = banManager.getCooldownStatus(srvId, m);
        if (cooldownStatus.remainingMs === 0) {
          isModelAvailable = true;
          break;
        }
      }
      if (isModelAvailable) {
        availableModelNames.add(m);
      }
    }

    const alternatives = findAlternatives(model, allModelNames, availableModelNames);

    let available = hasAvailableServer;
    let recommended: RecommendedModel | null = null;

    if (strictOnly && !hasHealthyServer) {
      res.status(503).json({
        error: { message: `No healthy servers available for model '${model}'` },
      });
      return;
    }

    if (!hasAvailableServer && alternatives.length > 0) {
      const firstAvailable = alternatives.find(a => a.available);
      if (firstAvailable) {
        recommended = {
          model: firstAvailable.model,
          reason: `Primary model has all servers in cooldown`,
        };
      } else {
        recommended = null;
      }
      available = false;
    }

    const response: ModelAvailabilityResponse = {
      model,
      available,
      servers: serverAvailabilities,
      alternatives,
      recommended,
      lastUpdated: now,
    };

    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to retrieve model availability' },
    });
  }
}
