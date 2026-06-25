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
    tier1Signals: number;
    tier2Signals: number;
    tier3Signals: number;
  };
  tier1Probes: string[];
  tier2Probes: string[];
  tier3Probes: string[];
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
  tier1Score?: number;
  tier2Score?: number;
  tier3Score?: number;
  headerScore?: number;
  entropyScore?: number;
  tlsScore?: number;
  ipAsnScore?: number;
  callbackScore?: number;
  headerEvidence?: HttpHeaderEvidence;
  entropyEvidence?: OutputEntropyEvidence;
  tlsEvidence?: TlsFingerprintEvidence;
  tier3Evidence?: Tier3Evidence;
}

type HttpHeaderEvidence = import('../utils/honeypot-probes.js').HttpHeaderEvidence;
type OutputEntropyEvidence = import('../utils/honeypot-probes.js').OutputEntropyEvidence;
type TlsFingerprintEvidence = import('../utils/honeypot-probes.js').TlsFingerprintEvidence;
type Tier3Evidence = import('../utils/honeypot-probes.js').Tier3Evidence;

export function getHoneypotStats(req: Request, res: Response): void {
  const config = getConfigManager().getConfig();
  const honeypotConfig = config.honeypotProbes ?? {
    enabled: true,
    intervalMs: 21600000,
    batchSize: 50,
    timeoutMs: 10000,
    scoreThreshold: { suspicious: 30, flagged: 70 },
    tier2: {
      enabled: true,
      entropySampleCount: 5,
      tlsTimeoutMs: 5000,
    },
    tier3: {
      enabled: true,
      rdapTimeoutMs: 5000,
      rdapCacheTtlMs: 86400000,
      callbackSampleRate: 0.01,
      callbackTimeoutMs: 10000,
      intervalMs: 604800000,
    },
  };

  const scheduler = getHoneypotProbeScheduler();
  const results = scheduler.getResults();
  const tier2Results = scheduler.getTier2Results();
  const tier3Results = scheduler.getTier3Results();

  const tier1Probes = ['schemaConformance', 'coldStartTiming', 'watermark'];
  const tier2Probes = ['httpHeaderConsistency', 'outputEntropy', 'tlsFingerprint'];
  const tier3Probes = ['ipAsnReputation', 'recursiveCallback'];

  let clean = 0;
  let suspicious = 0;
  let flagged = 0;
  let tier1Signals = 0;
  let tier2Signals = 0;
  let tier3Signals = 0;

  for (const result of results.values()) {
    if (result.verdict === 'clean') {
      clean++;
    } else if (result.verdict === 'suspicious') {
      suspicious++;
      if (result.tier1Score && result.tier1Score >= 30) tier1Signals++;
    } else if (result.verdict === 'flagged') {
      flagged++;
      if (result.tier1Score && result.tier1Score >= 30) tier1Signals++;
    }
  }

  for (const result of tier2Results.values()) {
    if (result.tier2Score && result.tier2Score >= 30) tier2Signals++;
  }

  for (const result of tier3Results.values()) {
    if (result.tier3Score && result.tier3Score >= 30) tier3Signals++;
  }

  const serverResults: HoneypotServerResult[] = [];
  for (const [serverId, result] of results) {
    const tier2Result = tier2Results.get(serverId);
    const tier3Result = tier3Results.get(serverId);
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
      tier1Score: result.tier1Score,
      tier2Score: tier2Result?.tier2Score,
      tier3Score: tier3Result?.tier3Score,
      headerScore: tier2Result?.headerScore,
      entropyScore: tier2Result?.entropyScore,
      tlsScore: tier2Result?.tlsScore,
      ipAsnScore: tier3Result?.ipAsnScore,
      callbackScore: tier3Result?.callbackScore,
      headerEvidence: tier2Result?.headerEvidence,
      entropyEvidence: tier2Result?.entropyEvidence,
      tlsEvidence: tier2Result?.tlsEvidence,
      tier3Evidence: tier3Result
        ? { ipAsn: tier3Result.ipAsnEvidence, callback: tier3Result.callbackEvidence }
        : undefined,
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
    tier2Results: tier2Results.size,
    tier3Results: tier3Results.size,
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
      tier1Signals,
      tier2Signals,
      tier3Signals,
    },
    tier1Probes,
    tier2Probes,
    tier3Probes,
    results: paginated,
  };

  res.status(200).json(response);
}
