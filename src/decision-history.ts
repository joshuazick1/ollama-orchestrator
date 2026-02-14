/**
 * decision-history.ts
 * Track load balancer decisions and scoring over time
 */

import type { ServerScore } from './load-balancer.js';
import type { AIServer } from './orchestrator.types.js';
import { logger } from './utils/logger.js';

/**
 * A single decision event when the load balancer selects a server
 */
export interface DecisionEvent {
  timestamp: number;
  model: string;
  selectedServerId: string;
  algorithm: string;
  candidates: Array<{
    serverId: string;
    totalScore: number;
    breakdown: {
      latencyScore: number;
      successRateScore: number;
      loadScore: number;
      capacityScore: number;
    };
    metrics?: {
      p95Latency: number;
      successRate: number;
      inFlight: number;
      throughput: number;
    };
  }>;
  selectionReason: string;
}

/**
 * Historical trends for a specific server:model combination
 */
export interface ServerModelTrend {
  serverId: string;
  model: string;
  timestamps: number[];
  scores: number[];
  latencyScores: number[];
  successRateScores: number[];
  loadScores: number[];
  capacityScores: number[];
  selectionCount: number;
  avgPosition: number;
}

/**
 * Configuration for decision history tracking
 */
export interface DecisionHistoryConfig {
  maxEvents: number; // Maximum events to keep in memory
  persistenceEnabled: boolean; // Whether to persist to disk
  persistenceIntervalMs: number; // How often to persist
  retentionHours: number; // How long to keep events
}

export const DEFAULT_DECISION_HISTORY_CONFIG: DecisionHistoryConfig = {
  maxEvents: 10000,
  persistenceEnabled: true,
  persistenceIntervalMs: 60000, // 1 minute
  retentionHours: 24,
};

/**
 * Tracks load balancer decisions and provides historical analysis
 */
export class DecisionHistory {
  private events: DecisionEvent[] = [];
  private config: DecisionHistoryConfig;
  private persistenceTimer?: NodeJS.Timeout;

  constructor(config: Partial<DecisionHistoryConfig> = {}) {
    this.config = { ...DEFAULT_DECISION_HISTORY_CONFIG, ...config };

    if (this.config.persistenceEnabled) {
      this.startPersistence();
    }
  }

  /**
   * Record a load balancer decision
   */
  recordDecision(
    model: string,
    selectedServer: AIServer,
    algorithm: string,
    scores: ServerScore[],
    selectionReason: string = 'best_score'
  ): void {
    const event: DecisionEvent = {
      timestamp: Date.now(),
      model,
      selectedServerId: selectedServer.id,
      algorithm,
      candidates: scores.map(score => ({
        serverId: score.server.id,
        totalScore: Math.round(score.totalScore * 100) / 100,
        breakdown: {
          latencyScore: Math.round(score.breakdown.latencyScore * 100) / 100,
          successRateScore: Math.round(score.breakdown.successRateScore * 100) / 100,
          loadScore: Math.round(score.breakdown.loadScore * 100) / 100,
          capacityScore: Math.round(score.breakdown.capacityScore * 100) / 100,
        },
        metrics: score.metrics
          ? {
              p95Latency: score.metrics.percentiles.p95,
              successRate: Math.round(score.metrics.successRate * 1000) / 1000,
              inFlight: score.metrics.inFlight,
              throughput: Math.round(score.metrics.throughput * 100) / 100,
            }
          : undefined,
      })),
      selectionReason,
    };

    this.events.push(event);

    // Prune old events if exceeded max
    if (this.events.length > this.config.maxEvents) {
      this.events = this.events.slice(-this.config.maxEvents);
    }

    // Also prune by age
    this.pruneOldEvents();
  }

  /**
   * Get recent decision events
   */
  getRecentEvents(limit = 100, model?: string, serverId?: string): DecisionEvent[] {
    let events = [...this.events];

    if (model) {
      events = events.filter(e => e.model === model);
    }

    if (serverId) {
      events = events.filter(
        e => e.selectedServerId === serverId || e.candidates.some(c => c.serverId === serverId)
      );
    }

    // Sort by timestamp descending (most recent first) and return the most recent N
    return events.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  /**
   * Get decision trends for a specific server:model
   */
  getServerModelTrend(serverId: string, model: string, hours = 24): ServerModelTrend {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const relevantEvents = this.events.filter(
      e =>
        e.timestamp >= cutoff &&
        e.model === model &&
        e.candidates.some(c => c.serverId === serverId)
    );

    const timestamps: number[] = [];
    const scores: number[] = [];
    const latencyScores: number[] = [];
    const successRateScores: number[] = [];
    const loadScores: number[] = [];
    const capacityScores: number[] = [];
    let selectionCount = 0;
    let totalPosition = 0;

    for (const event of relevantEvents) {
      const candidateIndex = event.candidates.findIndex(c => c.serverId === serverId);
      if (candidateIndex === -1) {
        continue;
      }

      const candidate = event.candidates[candidateIndex];
      timestamps.push(event.timestamp);
      scores.push(candidate.totalScore);
      latencyScores.push(candidate.breakdown.latencyScore);
      successRateScores.push(candidate.breakdown.successRateScore);
      loadScores.push(candidate.breakdown.loadScore);
      capacityScores.push(candidate.breakdown.capacityScore);

      if (event.selectedServerId === serverId) {
        selectionCount++;
      }
      totalPosition += candidateIndex + 1;
    }

    return {
      serverId,
      model,
      timestamps,
      scores,
      latencyScores,
      successRateScores,
      loadScores,
      capacityScores,
      selectionCount,
      avgPosition: timestamps.length > 0 ? totalPosition / timestamps.length : 0,
    };
  }

  /**
   * Get selection statistics for all servers
   */
  getSelectionStats(hours = 24): Array<{
    serverId: string;
    totalSelections: number;
    byModel: Record<string, number>;
    avgScore: number;
  }> {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const stats: Map<
      string,
      {
        selections: number;
        byModel: Map<string, number>;
        totalScore: number;
        scoreCount: number;
      }
    > = new Map();

    for (const event of this.events) {
      if (event.timestamp < cutoff) {
        continue;
      }

      // Count selection
      if (!stats.has(event.selectedServerId)) {
        stats.set(event.selectedServerId, {
          selections: 0,
          byModel: new Map(),
          totalScore: 0,
          scoreCount: 0,
        });
      }
      const serverStats = stats.get(event.selectedServerId)!;
      serverStats.selections++;
      serverStats.byModel.set(event.model, (serverStats.byModel.get(event.model) ?? 0) + 1);

      // Track scores for all candidates
      for (const candidate of event.candidates) {
        if (!stats.has(candidate.serverId)) {
          stats.set(candidate.serverId, {
            selections: 0,
            byModel: new Map(),
            totalScore: 0,
            scoreCount: 0,
          });
        }
        const candidateStats = stats.get(candidate.serverId)!;
        candidateStats.totalScore += candidate.totalScore;
        candidateStats.scoreCount++;
      }
    }

    return Array.from(stats.entries()).map(([serverId, data]) => ({
      serverId,
      totalSelections: data.selections,
      byModel: Object.fromEntries(data.byModel),
      avgScore: data.scoreCount > 0 ? data.totalScore / data.scoreCount : 0,
    }));
  }

  /**
   * Get algorithm usage statistics
   */
  getAlgorithmStats(hours = 24): Record<
    string,
    {
      count: number;
      percentage: number;
    }
  > {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const counts: Record<string, number> = {};
    let total = 0;

    for (const event of this.events) {
      if (event.timestamp < cutoff) {
        continue;
      }
      counts[event.algorithm] = (counts[event.algorithm] || 0) + 1;
      total++;
    }

    const result: Record<string, { count: number; percentage: number }> = {};
    for (const [algorithm, count] of Object.entries(counts)) {
      result[algorithm] = {
        count,
        percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
      };
    }

    return result;
  }

  /**
   * Get score distribution over time
   */
  getScoreTimeline(
    hours = 24,
    intervalMinutes = 15
  ): Array<{
    timestamp: number;
    avgScore: number;
    minScore: number;
    maxScore: number;
    serverCount: number;
  }> {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const intervalMs = intervalMinutes * 60 * 1000;
    const buckets = new Map<number, number[]>();

    // Group scores into time buckets
    for (const event of this.events) {
      if (event.timestamp < cutoff) {
        continue;
      }

      const bucketTime = Math.floor(event.timestamp / intervalMs) * intervalMs;
      if (!buckets.has(bucketTime)) {
        buckets.set(bucketTime, []);
      }

      for (const candidate of event.candidates) {
        buckets.get(bucketTime)!.push(candidate.totalScore);
      }
    }

    // Calculate statistics per bucket
    const result: Array<{
      timestamp: number;
      avgScore: number;
      minScore: number;
      maxScore: number;
      serverCount: number;
    }> = [];

    for (const [timestamp, scores] of buckets) {
      if (scores.length === 0) {
        continue;
      }

      const sum = scores.reduce((a, b) => a + b, 0);
      result.push({
        timestamp,
        avgScore: Math.round((sum / scores.length) * 100) / 100,
        minScore: Math.round(Math.min(...scores) * 100) / 100,
        maxScore: Math.round(Math.max(...scores) * 100) / 100,
        serverCount: scores.length,
      });
    }

    return result.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get metrics impact analysis - how metrics influenced decisions
   */
  getMetricsImpact(hours = 24): {
    latency: { correlation: number; weight: number };
    successRate: { correlation: number; weight: number };
    load: { correlation: number; weight: number };
    capacity: { correlation: number; weight: number };
  } {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;

    let latencyCorrelation = 0;
    let successRateCorrelation = 0;
    let loadCorrelation = 0;
    let capacityCorrelation = 0;
    let count = 0;

    for (const event of this.events) {
      if (event.timestamp < cutoff) {
        continue;
      }
      if (event.candidates.length < 2) {
        continue;
      }

      // Calculate correlation between each metric and selection
      for (const candidate of event.candidates) {
        const wasSelected = candidate.serverId === event.selectedServerId;
        const score = wasSelected ? 1 : 0;

        // Normalize scores to 0-1 range for correlation
        const latencyNorm = candidate.breakdown.latencyScore / 100;
        const successRateNorm = candidate.breakdown.successRateScore / 100;
        const loadNorm = candidate.breakdown.loadScore / 100;
        const capacityNorm = candidate.breakdown.capacityScore / 100;

        latencyCorrelation += (latencyNorm - 0.5) * (score - 0.5);
        successRateCorrelation += (successRateNorm - 0.5) * (score - 0.5);
        loadCorrelation += (loadNorm - 0.5) * (score - 0.5);
        capacityCorrelation += (capacityNorm - 0.5) * (score - 0.5);
        count++;
      }
    }

    if (count === 0) {
      return {
        latency: { correlation: 0, weight: 0.35 },
        successRate: { correlation: 0, weight: 0.3 },
        load: { correlation: 0, weight: 0.2 },
        capacity: { correlation: 0, weight: 0.15 },
      };
    }

    // Normalize correlations
    const normalize = (val: number) => Math.max(-1, Math.min(1, (val / count) * 4));

    return {
      latency: { correlation: normalize(latencyCorrelation), weight: 0.35 },
      successRate: { correlation: normalize(successRateCorrelation), weight: 0.3 },
      load: { correlation: normalize(loadCorrelation), weight: 0.2 },
      capacity: { correlation: normalize(capacityCorrelation), weight: 0.15 },
    };
  }

  /**
   * Prune events older than retention period
   */
  private pruneOldEvents(): void {
    const cutoff = Date.now() - this.config.retentionHours * 60 * 60 * 1000;
    this.events = this.events.filter(e => e.timestamp >= cutoff);
  }

  /**
   * Start periodic persistence
   */
  private startPersistence(): void {
    this.persistenceTimer = setInterval(() => {
      void this.persist();
    }, this.config.persistenceIntervalMs);
  }

  /**
   * Persist events to storage
   */
  async persist(): Promise<void> {
    this.pruneOldEvents();

    if (this.config.persistenceEnabled) {
      try {
        const fs = await import('fs/promises');
        const path = await import('path');
        const filePath = path.join(process.cwd(), 'data', 'decision-history.json');

        // Ensure directory exists
        await fs.mkdir(path.dirname(filePath), { recursive: true });

        // Save events
        const data = {
          timestamp: Date.now(),
          events: this.events,
        };
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
        logger.debug('Decision history persisted', { eventCount: this.events.length });
      } catch (error) {
        logger.error('Failed to persist decision history:', { error });
      }
    }
  }

  /**
   * Load persisted decision history
   */
  async load(): Promise<void> {
    if (!this.config.persistenceEnabled) {
      return;
    }

    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const filePath = path.join(process.cwd(), 'data', 'decision-history.json');

      const json = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(json) as { events?: DecisionEvent[] };

      if (data.events && Array.isArray(data.events)) {
        this.events = data.events;
        logger.info('Decision history loaded', { eventCount: this.events.length });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error('Failed to load decision history:', { error });
      }
    }
  }

  /**
   * Stop persistence timer
   */
  stop(): void {
    if (this.persistenceTimer) {
      clearInterval(this.persistenceTimer);
    }
  }

  /**
   * Get total event count
   */
  getEventCount(): number {
    return this.events.length;
  }

  /**
   * Clear all history
   */
  clear(): void {
    this.events = [];
  }
}

// Singleton instance
let decisionHistoryInstance: DecisionHistory | null = null;

export function getDecisionHistory(): DecisionHistory {
  if (!decisionHistoryInstance) {
    decisionHistoryInstance = new DecisionHistory();
  }
  return decisionHistoryInstance;
}

export function resetDecisionHistory(): void {
  decisionHistoryInstance = null;
}
