import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG, setConfigManager, ConfigManager } from '../../../src/config/config.js';
import { calculateServerScore } from '../../../src/load-balancer/load-balancer.js';
import { MetricsAggregator } from '../../../src/metrics/metrics-aggregator.js';
import type { RequestContext } from '../../../src/orchestrator/orchestrator.types.js';
import type { ModelAvailabilityProvider } from '../../../src/probe/model-availability-provider.js';
import { createServer } from '../../fixtures/factories.js';

const MODEL = 'llama3:latest';
const SERVER_ID = 'probe-source-server';

function requestContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    id: 'request-1',
    startTime: Date.now() - 100,
    serverId: SERVER_ID,
    model: MODEL,
    endpoint: 'ollama_generate',
    streaming: false,
    success: true,
    duration: 100,
    ...overrides,
  };
}

function configureProbeScoring(includeProbeInLiveScoring: boolean): void {
  const manager = new ConfigManager();
  manager.updateConfig({
    metrics: {
      ...DEFAULT_CONFIG.metrics,
      includeProbeInLiveScoring,
    },
  });
  setConfigManager(manager);
}

function calculateScore(aggregator: MetricsAggregator) {
  return calculateServerScore(
    createServer({
      id: SERVER_ID,
      models: [MODEL],
      lastResponseTime: 900,
    }),
    MODEL,
    0,
    0,
    aggregator.getMetricsWithFallback(SERVER_ID, MODEL)
  );
}

describe('probe metrics as the live load-balancer source', () => {
  let aggregator: MetricsAggregator;

  beforeEach(() => {
    aggregator = new MetricsAggregator();
  });

  afterEach(async () => {
    setConfigManager(new ConfigManager());
    await aggregator.shutdown();
  });

  it('uses a fresh probe outcome for live scoring without changing organic metrics', async () => {
    configureProbeScoring(true);
    aggregator.recordRequest(requestContext({ id: 'organic', duration: 900 }));

    const organicScore = calculateScore(aggregator);
    const organicExportedBeforeProbe = aggregator.exportMetrics().servers[SERVER_ID]?.models[MODEL];

    aggregator.recordProbeRequest(
      requestContext({
        id: 'probe',
        isProbe: true,
        duration: 50,
        ttft: 25,
        tokensGenerated: 10,
        tokensPrompt: 10,
      })
    );

    const probeScore = calculateScore(aggregator);
    const organicExportedAfterProbe = aggregator.exportMetrics().servers[SERVER_ID]?.models[MODEL];

    expect(probeScore.totalScore).toBeGreaterThan(organicScore.totalScore);
    expect(probeScore.breakdown.latencyScore).toBeGreaterThan(organicScore.breakdown.latencyScore);
    expect(organicExportedAfterProbe).toEqual(organicExportedBeforeProbe);
    expect(organicExportedAfterProbe?.windows['5m'].count).toBe(1);
  });

  it('keeps the conservative organic score when probe scoring is disabled', async () => {
    configureProbeScoring(false);
    aggregator.recordRequest(requestContext({ id: 'organic', duration: 900 }));
    aggregator.recordProbeRequest(
      requestContext({
        id: 'probe',
        isProbe: true,
        duration: 50,
      })
    );

    const organicScore = calculateServerScore(
      createServer({ id: SERVER_ID, models: [MODEL], lastResponseTime: 900 }),
      MODEL,
      0,
      0,
      aggregator.getMetrics(SERVER_ID, MODEL)
    );
    const liveScore = calculateScore(aggregator);

    expect(liveScore.totalScore).toBe(organicScore.totalScore);
    expect(liveScore.breakdown.latencyScore).toBe(organicScore.breakdown.latencyScore);
  });

  it('does not make an unknown server hot from a stale probe snapshot', async () => {
    configureProbeScoring(true);
    aggregator.recordProbeRequest(
      requestContext({
        id: 'stale-probe',
        isProbe: true,
        duration: 10,
      })
    );
    const staleProbe = aggregator.getRawMetrics(SERVER_ID, MODEL, 'probe');
    if (staleProbe) {
      staleProbe.lastUpdated = Date.now() - DEFAULT_CONFIG.metrics.decay.staleThresholdMs - 1;
    }

    expect(aggregator.getMetricsWithFallback(SERVER_ID, MODEL)).toBeUndefined();
  });

  it('applies a slightly worse cold-start penalty when provider returns source=fallback', async () => {
    const freshProvider: ModelAvailabilityProvider = {
      getLoadedSnapshot: vi.fn().mockReturnValue({
        serverId: SERVER_ID,
        model: MODEL,
        loadedAt: Date.now(),
        sizeVram: 0,
        expiresAt: 0,
        lastPolledAt: Date.now(),
        source: 'psPoll',
      }),
      getLoadedModels: vi.fn().mockReturnValue(new Set([MODEL])),
    };

    const staleProvider: ModelAvailabilityProvider = {
      getLoadedSnapshot: vi.fn().mockReturnValue({
        serverId: SERVER_ID,
        model: MODEL,
        loadedAt: Date.now(),
        sizeVram: 0,
        expiresAt: 0,
        lastPolledAt: Date.now() - 99999,
        source: 'fallback',
      }),
      getLoadedModels: vi.fn().mockReturnValue(new Set([MODEL])),
    };

    const server = createServer({ id: SERVER_ID, models: [MODEL], lastResponseTime: 900 });
    const freshScore = calculateServerScore(
      server,
      MODEL,
      0,
      0,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      freshProvider
    );
    const staleScore = calculateServerScore(
      server,
      MODEL,
      0,
      0,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      staleProvider
    );

    // Fresh provider: model is hot, no cold-start penalty → higher latency score
    // Stale provider: model is treated as cold-ish, cold-start penalty applied → lower latency score
    expect(freshScore.breakdown.latencyScore).toBeGreaterThan(staleScore.breakdown.latencyScore);
    // But stale is not as bad as completely absent (which would get 0.85 coldPenalty)
    // Stale fallback gets 0.80 coldPenalty vs hot gets no penalty
    expect(staleScore.breakdown.latencyScore).toBeLessThan(100); // penalty was applied
  });
});
