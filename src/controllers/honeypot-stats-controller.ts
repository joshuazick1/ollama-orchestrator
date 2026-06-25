import type { Request, Response } from 'express';

import { HONEYPOT_STATS } from '../constants/api-endpoints.js';
import { getConfigManager } from '../config/config.js';
import { logger } from '../utils/logger.js';

import type { HoneypotProbeResult } from '../utils/honeypot-probes.js';
import { getHoneypotProbeScheduler } from '../probe/honeypot-probe-scheduler.js';

interface HoneypotStatsResponse {
  enabled: boolean;
  intervalMs: number;
  summary: {
    totalServers: number;
    scored: number;
    clean: number;
    suspicious: number;
    flagged: number;
  };
  tier1Probes: string[];
  results: HoneypotServerResult[];
}

interface HoneypotServerResult {
  serverId: string;
  url: string;
  schemaScore: number;
  coldStartScore: number;
  watermarkScore: number;
  compositeScore: number;
  verdict: 'clean' | 'suspicious' | 'flagged';
  evidence: HoneypotProbeResult['evidence'];
  lastProbed: string;
}

export function getHoneypotStats(req: Request, res: Response): void {
  const config = getConfigManager().getConfig();
  const honeypotConfig = config.honeypotProbes ?? {
    enabled: true,
    intervalMs: 21600000,
    batchSize: 50,
    timeoutMs: 10000,
    scoreThreshold: { suspicious: 30, flagged: 70 },
  };

  const scheduler = getHoneypotProbeScheduler();
  const results = scheduler.getResults();

  const tier1Probes = ['schemaConformance', 'coldStartTiming', 'watermark'];

  let clean = 0;
  let suspicious = 0;
  let flagged = 0;

  for (const result of results.values()) {
    if (result.verdict === 'clean') {
      clean++;
    } else if (result.verdict === 'suspicious') {
      suspicious++;
    } else if (result.verdict === 'flagged') {
      flagged++;
    }
  }

  const serverResults: HoneypotServerResult[] = [];
  for (const [serverId, result] of results) {
    serverResults.push({
      serverId,
      url: result.serverUrl,
      schemaScore: result.schemaScore,
      coldStartScore: result.coldStartScore,
      watermarkScore: result.watermarkScore,
      compositeScore: result.compositeScore,
      verdict: result.verdict,
      evidence: result.evidence,
      lastProbed: new Date(result.timestamp).toISOString(),
    });
  }

  serverResults.sort((a, b) => b.compositeScore - a.compositeScore);

  const limit = Math.min(Math.max(1, parseInt(String(req.query.limit ?? '100'), 10)) || 100, 5000);
  const statusFilter = req.query.status as string | undefined;
  let filtered = serverResults;
  if (statusFilter === 'clean' || statusFilter === 'suspicious' || statusFilter === 'flagged') {
    filtered = serverResults.filter(r => r.verdict === statusFilter);
  }
  const paginated = filtered.slice(0, limit);

  logger.debug('[HoneypotStats] stats retrieved', {
    totalResults: results.size,
    returned: paginated.length,
    filter: statusFilter ?? 'none',
  });

  const response: HoneypotStatsResponse = {
    enabled: honeypotConfig.enabled,
    intervalMs: honeypotConfig.intervalMs,
    summary: {
      totalServers: results.size,
      scored: results.size,
      clean,
      suspicious,
      flagged,
    },
    tier1Probes,
    results: paginated,
  };

  res.status(200).json(response);
}
