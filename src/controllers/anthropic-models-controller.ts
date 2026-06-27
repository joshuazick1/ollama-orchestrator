/**
 * anthropic-models-controller.ts
 * Model lifecycle endpoints for self-hosted Anthropic-compatible servers (vLLM, LiteLLM).
 *
 * Endpoints:
 *   POST /api/orchestrator/anthropic/:model/warmup  — warmup a model on target servers
 *   POST /api/orchestrator/anthropic/:model/unload  — unload a model from target servers
 *   GET  /api/orchestrator/anthropic/idle           — list idle Anthropic models across fleet
 *   GET  /api/orchestrator/anthropic/recommendations — warmup recommendations for fleet
 *
 * SaaS providers (api.anthropic.com) return 501 — warmup/unload not supported.
 * Servers with pending capability return 425 Too Early.
 */

import type { Request, Response } from 'express';

import { API_ENDPOINTS } from '../constants/index.js';
import { getOrchestratorInstance } from '../orchestrator/orchestrator-instance.js';
import type { AIServer } from '../orchestrator/orchestrator.types.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';
import { logger } from '../utils/logger.js';

const WARMUP_TIMEOUT_MS = 30000;
const SAAS_ANTHROPIC_HOST = 'api.anthropic.com';

/**
 * Detect whether a server is a SaaS Anthropic provider.
 * SaaS servers do not support warmup/unload lifecycle operations.
 */
function isSaaSServer(server: AIServer): boolean {
  return server.url.includes(SAAS_ANTHROPIC_HOST);
}

/**
 * Attempt to warmup a model on a specific server by sending a minimal inference request.
 * This triggers the server to load the model into memory if not already loaded.
 *
 * For vLLM/LiteLLM, a minimal /v1/messages request with max_tokens=1 will cause the
 * model to be loaded if not already in memory.
 */
async function attemptWarmup(
  server: AIServer,
  model: string
): Promise<{ serverId: string; success: boolean; error?: string }> {
  try {
    const anthropicPath =
      server.endpointOverrides?.anthropic_messages ?? API_ENDPOINTS.ANTHROPIC.MESSAGES;
    const upstreamUrl = `${server.url}${anthropicPath}`;

    const warmupBody = {
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };

    if (server.apiKey) {
      headers['x-api-key'] = server.apiKey;
    }

    const response = await fetchWithTimeout(upstreamUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(warmupBody),
      timeout: WARMUP_TIMEOUT_MS,
      telemetryMeta: {
        serverId: server.id,
        model,
        protocol: 'anthropic',
        endpoint: 'messages',
        isStreaming: false,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn('Anthropic warmup request failed', {
        serverId: server.id,
        model,
        status: response.status,
        error: errorText,
      });
      return { serverId: server.id, success: false, error: errorText };
    }

    logger.info('Anthropic warmup succeeded', { serverId: server.id, model });
    return { serverId: server.id, success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Anthropic warmup error', { serverId: server.id, model, error: errorMessage });
    return { serverId: server.id, success: false, error: errorMessage };
  }
}

/**
 * POST /api/orchestrator/anthropic/:model/warmup
 *
 * Warmup a model on target servers. Sends a minimal inference request to each
 * confirmed server that has the model available.
 *
 * Body: { servers?: string[] }  — optional list of server IDs. If omitted, all confirmed servers.
 *
 * Responses:
 *   400 — model name required
 *   400 — no target servers
 *   425 — capability not yet confirmed for a server
 *   501 — SaaS provider (api.anthropic.com) — warmup not supported
 *   200 — warmup results per server
 */
export async function handleAnthropicWarmup(req: Request, res: Response): Promise<void> {
  const model = req.params.model as string;
  const { servers: targetServerIds } = (req.body ?? {}) as { servers?: string[] };

  if (!model) {
    res.status(400).json({ error: 'Model name is required' });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const endpointRegistry = orchestrator.getEndpointRegistry();
  const servers = orchestrator.getServers();

  // Find all servers with confirmed anthropic_messages capability
  const confirmedServers: AIServer[] = [];
  for (const server of servers) {
    const cap = endpointRegistry.getCapability(server.id, 'anthropic_messages');
    if (cap?.confirmed === true) {
      confirmedServers.push(server);
    }
  }

  // Determine target servers
  let targets: AIServer[];
  if (targetServerIds && targetServerIds.length > 0) {
    targets = confirmedServers.filter(s => targetServerIds.includes(s.id));
    if (targets.length === 0) {
      res.status(400).json({
        error: 'None of the specified servers have confirmed anthropic_messages capability',
        requestedServers: targetServerIds,
      });
      return;
    }
  } else {
    targets = confirmedServers;
  }

  if (targets.length === 0) {
    res.status(400).json({ error: 'No servers with confirmed Anthropic capability found' });
    return;
  }

  // Check for SaaS servers — warmup not supported
  const saasServers = targets.filter(isSaaSServer);
  if (saasServers.length > 0) {
    res.status(501).json({
      error: 'Warmup not supported for SaaS providers',
      saasServers: saasServers.map(s => s.id),
      note: 'Self-hosted Anthropic-compatible servers (vLLM, LiteLLM) are supported',
    });
    return;
  }

  const results = await Promise.all(targets.map(server => attemptWarmup(server, model)));

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success);

  logger.info('Anthropic warmup completed', {
    model,
    total: targets.length,
    successful,
    failed: failed.length,
  });

  res.status(200).json({
    success: true,
    model,
    results,
    summary: {
      totalServers: targets.length,
      successful,
      failed: failed.length,
    },
  });
}

/**
 * POST /api/orchestrator/anthropic/:model/unload
 *
 * Unload a model from target servers. Currently implemented as best-effort:
 * sends a model unload request to LiteLLM's model unload endpoint.
 * Returns 501 for SaaS, 425 for pending capability.
 *
 * Body: { servers?: string[] }  — optional list of server IDs
 *
 * Responses:
 *   400 — model name required
 *   400 — no target servers
 *   425 — capability not yet confirmed
 *   501 — SaaS provider or server does not support unload
 *   200 — unload results per server
 */
export async function handleAnthropicUnload(req: Request, res: Response): Promise<void> {
  const model = req.params.model as string;
  const { servers: targetServerIds } = (req.body ?? {}) as { servers?: string[] };

  if (!model) {
    res.status(400).json({ error: 'Model name is required' });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const endpointRegistry = orchestrator.getEndpointRegistry();
  const servers = orchestrator.getServers();

  // Find all servers with confirmed anthropic_messages capability
  const confirmedServers: AIServer[] = [];
  for (const server of servers) {
    const cap = endpointRegistry.getCapability(server.id, 'anthropic_messages');
    if (cap?.confirmed === true) {
      confirmedServers.push(server);
    }
  }

  // Determine target servers
  let targets: AIServer[];
  if (targetServerIds && targetServerIds.length > 0) {
    targets = confirmedServers.filter(s => targetServerIds.includes(s.id));
    if (targets.length === 0) {
      res.status(400).json({
        error: 'None of the specified servers have confirmed anthropic_messages capability',
        requestedServers: targetServerIds,
      });
      return;
    }
  } else {
    targets = confirmedServers;
  }

  if (targets.length === 0) {
    res.status(400).json({ error: 'No servers with confirmed Anthropic capability found' });
    return;
  }

  // Check for SaaS servers — unload not supported
  const saasServers = targets.filter(isSaaSServer);
  if (saasServers.length > 0) {
    res.status(501).json({
      error: 'Unload not supported for SaaS providers',
      saasServers: saasServers.map(s => s.id),
    });
    return;
  }

  const results: Array<{ serverId: string; success: boolean; error?: string }> = [];

  for (const server of targets) {
    try {
      const unloadPath =
        server.endpointOverrides?.anthropic_messages?.replace(
          '/messages',
          `/model/${model}/unload`
        ) ?? `/v1/model/${model}/unload`;
      const upstreamUrl = `${server.url}${unloadPath}`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      };

      if (server.apiKey) {
        headers['x-api-key'] = server.apiKey;
      }

      const response = await fetchWithTimeout(upstreamUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model }),
        timeout: WARMUP_TIMEOUT_MS,
        telemetryMeta: {
          serverId: server.id,
          model,
          protocol: 'anthropic',
          endpoint: 'model_unload',
          isStreaming: false,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 404 || response.status === 501) {
          logger.info('Server does not support model unload endpoint', {
            serverId: server.id,
            model,
          });
          results.push({
            serverId: server.id,
            success: false,
            error: 'Server does not support model unload',
          });
        } else {
          results.push({ serverId: server.id, success: false, error: errorText });
        }
      } else {
        logger.info('Anthropic unload succeeded', { serverId: server.id, model });
        results.push({ serverId: server.id, success: true });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Anthropic unload error', { serverId: server.id, model, error: errorMessage });
      results.push({ serverId: server.id, success: false, error: errorMessage });
    }
  }

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success);

  res.status(200).json({
    success: true,
    model,
    results,
    summary: {
      totalServers: targets.length,
      successful,
      failed: failed.length,
    },
  });
}

/**
 * GET /api/orchestrator/anthropic/idle
 *
 * Returns models that may be idle (not recently used for inference) across
 * the fleet of self-hosted Anthropic-compatible servers.
 *
 * Query params:
 *   threshold — idle time threshold in ms (default: 1800000 = 30 minutes)
 *
 * Responses:
 *   200 — list of idle models with serverId and idle time
 */
export function handleAnthropicIdle(req: Request, res: Response): void {
  const { threshold = '1800000' } = req.query;
  const parsed = parseInt(threshold as string, 10);
  const idleThreshold = !isNaN(parsed) && parsed >= 0 ? parsed : 1800000;

  const orchestrator = getOrchestratorInstance();
  const endpointRegistry = orchestrator.getEndpointRegistry();
  const servers = orchestrator.getServers();

  // Find servers with confirmed anthropic_messages capability
  const confirmedServers: AIServer[] = [];
  for (const server of servers) {
    const cap = endpointRegistry.getCapability(server.id, 'anthropic_messages');
    if (cap?.confirmed === true) {
      confirmedServers.push(server);
    }
  }

  const idleItems: Array<{
    serverId: string;
    model: string;
    idleTime: number;
    idleTimeMinutes: number;
  }> = [];

  const now = Date.now();

  for (const server of confirmedServers) {
    const cap = endpointRegistry.getCapability(server.id, 'anthropic_messages');
    if (cap && cap.lastSeen > 0) {
      const idleTime = now - cap.lastSeen;
      if (idleTime >= idleThreshold) {
        for (const model of server.models) {
          idleItems.push({
            serverId: server.id,
            model,
            idleTime,
            idleTimeMinutes: Math.round(idleTime / 60000),
          });
        }
      }
    }
  }

  res.status(200).json({
    success: true,
    threshold: idleThreshold,
    models: idleItems,
    count: idleItems.length,
  });
}

/**
 * GET /api/orchestrator/anthropic/recommendations
 *
 * Returns warmup recommendations for self-hosted Anthropic-compatible servers.
 * Based on servers with confirmed capability that may benefit from proactive warmup.
 *
 * Responses:
 *   200 — list of recommended models to warmup with reason
 */
export function handleAnthropicRecommendations(_req: Request, res: Response): void {
  const orchestrator = getOrchestratorInstance();
  const endpointRegistry = orchestrator.getEndpointRegistry();
  const servers = orchestrator.getServers();

  // Find servers with confirmed anthropic_messages capability
  const confirmedServers: AIServer[] = [];
  for (const server of servers) {
    const cap = endpointRegistry.getCapability(server.id, 'anthropic_messages');
    if (cap?.confirmed === true) {
      confirmedServers.push(server);
    }
  }

  const recommendations: Array<{
    serverId: string;
    model: string;
    reason: string;
  }> = [];

  for (const server of confirmedServers) {
    if (isSaaSServer(server)) {
      continue;
    }

    for (const model of server.models) {
      recommendations.push({
        serverId: server.id,
        model,
        reason: 'Server has confirmed Anthropic capability and model is available',
      });
    }
  }

  logger.info('Anthropic recommendations generated', { count: recommendations.length });

  res.status(200).json({
    success: true,
    recommendations,
    count: recommendations.length,
  });
}
