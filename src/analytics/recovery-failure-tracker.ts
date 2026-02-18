/**
 * Recovery Failure Tracker
 * Tracks and analyzes repeat and persistent recovery failures for servers
 * Includes circuit breaker state transition tracking
 */

import { JsonFileHandler } from '../config/jsonFileHandler.js';
import { logger } from '../utils/logger.js';

export interface RecoveryFailureRecord {
  timestamp: number;
  serverId: string;
  error: string;
  errorType: 'timeout' | 'connection_refused' | 'http_error' | 'model_not_found' | 'unknown';
  responseTime?: number;
  attemptNumber: number;
  consecutiveFailures: number;
  source: 'health_check' | 'circuit_breaker' | 'request';
  circuitBreakerState?: 'open' | 'closed' | 'half-open';
  model?: string;
  metadata?: Record<string, unknown>;
}

export interface ServerRecoveryStats {
  serverId: string;
  totalRecoveryAttempts: number;
  successfulRecoveries: number;
  failedRecoveries: number;
  currentConsecutiveFailures: number;
  lastRecoveryAttempt: number;
  lastSuccessfulRecovery?: number;
  lastFailureReason?: string;
  failureRate: number;
  averageTimeBetweenFailures: number;
  firstRecordedFailure?: number;
  pattern: 'stable' | 'degrading' | 'flapping' | 'persistent';
  circuitBreakerImpact: {
    totalTransitions: number;
    openStateContributions: number;
    lastTransition: number;
    lastOpenReason?: string;
  };
}

export interface CircuitBreakerTransitionRecord {
  timestamp: number;
  serverId: string;
  model?: string;
  previousState: 'open' | 'closed' | 'half-open';
  newState: 'open' | 'closed' | 'half-open';
  reason: string;
  failureCount?: number;
  errorRate?: number;
}

export interface FailurePatternAnalysis {
  serverId: string;
  pattern: 'stable' | 'degrading' | 'flapping' | 'persistent';
  trend: 'improving' | 'stable' | 'worsening';
  confidence: number;
  predictedNextFailure?: number;
  recommendations: string[];
}

export interface GlobalFailureSummary {
  totalServers: number;
  serversWithFailures: number;
  serversWithPersistentFailures: number;
  totalRecoveryAttempts: number;
  totalFailures: number;
  overallFailureRate: number;
  topFailingServers: Array<{ serverId: string; failureCount: number }>;
  commonErrorTypes: Record<string, number>;
  timeRange: { start: number; end: number };
}

export interface PersistenceData {
  version: number;
  timestamp: number;
  records: RecoveryFailureRecord[];
  serverStats: Record<string, Partial<ServerRecoveryStats>>;
  circuitBreakerTransitions: CircuitBreakerTransitionRecord[];
}

const DEFAULT_CONFIG = {
  persistencePath: './data/recovery-failures.json' as string,
  maxRecordsPerServer: 1000 as number,
  persistentFailureThreshold: 5 as number,
  flappingDetectionWindow: 600000 as number, // 10 minutes
  degradationDetectionWindow: 3600000 as number, // 1 hour
  persistenceEnabled: true as boolean,
};

export type RecoveryFailureTrackerConfig = Partial<typeof DEFAULT_CONFIG>;

export class RecoveryFailureTracker {
  private records: RecoveryFailureRecord[] = [];
  private serverStats: Map<string, ServerRecoveryStats> = new Map();
  private circuitBreakerTransitions: CircuitBreakerTransitionRecord[] = [];
  private config: typeof DEFAULT_CONFIG;
  private lastPersistenceTime = 0;
  private persistenceDirty = false;
  private fileHandler?: JsonFileHandler;

  constructor(config?: RecoveryFailureTrackerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.persistenceEnabled) {
      this.fileHandler = new JsonFileHandler(this.config.persistencePath, {
        createBackups: true,
        maxBackups: 3,
      });
    }

    void this.loadFromDisk();
  }

  /**
   * Record a circuit breaker state transition
   */
  recordCircuitBreakerTransition(
    serverId: string,
    model: string | undefined,
    previousState: 'open' | 'closed' | 'half-open',
    newState: 'open' | 'closed' | 'half-open',
    reason: string,
    failureCount?: number,
    errorRate?: number
  ): void {
    const record: CircuitBreakerTransitionRecord = {
      timestamp: Date.now(),
      serverId,
      model,
      previousState,
      newState,
      reason,
      failureCount,
      errorRate,
    };

    this.circuitBreakerTransitions.push(record);

    // Limit transition history
    const maxTransitions = 10000;
    if (this.circuitBreakerTransitions.length > maxTransitions) {
      this.circuitBreakerTransitions = this.circuitBreakerTransitions.slice(-maxTransitions);
    }

    const stats = this.getOrCreateServerStats(serverId);

    if (newState === 'open') {
      stats.circuitBreakerImpact.openStateContributions++;
      stats.circuitBreakerImpact.lastOpenReason = reason;
    }

    stats.circuitBreakerImpact.totalTransitions++;
    stats.circuitBreakerImpact.lastTransition = Date.now();
    this.serverStats.set(serverId, stats);
    this.markDirty();

    logger.debug(`Circuit breaker transition recorded`, {
      serverId,
      model,
      previousState,
      newState,
      reason,
    });
  }

  /**
   * Get circuit breaker transitions for a server
   */
  getCircuitBreakerTransitions(
    serverId: string,
    model?: string,
    limit = 100
  ): CircuitBreakerTransitionRecord[] {
    let transitions = this.circuitBreakerTransitions.filter(t => t.serverId === serverId);
    if (model !== undefined) {
      transitions = transitions.filter(t => t.model === model);
    }
    return transitions.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  /**
   * Analyze if circuit breakers are causing server health issues
   */
  analyzeCircuitBreakerImpact(serverId: string): {
    isImpacted: boolean;
    totalTransitions: number;
    openTransitions: number;
    openToHealthyRatio: number;
    averageTimeInOpenState: number;
    modelLevelIssues: number;
    recommendations: string[];
  } {
    const stats = this.serverStats.get(serverId);
    if (!stats) {
      return {
        isImpacted: false,
        totalTransitions: 0,
        openTransitions: 0,
        openToHealthyRatio: 0,
        averageTimeInOpenState: 0,
        modelLevelIssues: 0,
        recommendations: ['No circuit breaker data recorded'],
      };
    }

    const transitions = this.circuitBreakerTransitions.filter(t => t.serverId === serverId);
    const openTransitions = transitions.filter(t => t.newState === 'open').length;
    const closedTransitions = transitions.filter(t => t.newState === 'closed').length;

    const isImpacted = stats.circuitBreakerImpact.openStateContributions >= 3;
    const openToHealthyRatio =
      closedTransitions > 0 ? openTransitions / closedTransitions : openTransitions;

    // Count model-level circuit breaker issues (serverId:model format)
    const modelLevelTransitions = transitions.filter(t => t.model !== undefined);
    const modelLevelIssues = modelLevelTransitions.filter(t => t.newState === 'open').length;

    const recommendations: string[] = [];
    if (isImpacted) {
      recommendations.push('Server is frequently impacted by circuit breakers');
      recommendations.push(
        `Last open reason: ${stats.circuitBreakerImpact.lastOpenReason ?? 'unknown'}`
      );
    }
    if (modelLevelIssues > 0) {
      recommendations.push(`${modelLevelIssues} model-specific circuit breaker openings detected`);
      recommendations.push('Model-level issues should NOT mark servers unhealthy');
    }
    if (openToHealthyRatio > 2) {
      recommendations.push(
        'High circuit breaker flapping detected - consider increasing recovery thresholds'
      );
    }

    return {
      isImpacted,
      totalTransitions: stats.circuitBreakerImpact.totalTransitions,
      openTransitions,
      openToHealthyRatio: Math.round(openToHealthyRatio * 100) / 100,
      averageTimeInOpenState: 0,
      modelLevelIssues,
      recommendations,
    };
  }

  /**
   * Record a recovery failure for a server
   */
  recordRecoveryFailure(
    serverId: string,
    error: string,
    errorType: RecoveryFailureRecord['errorType'],
    responseTime?: number,
    metadata?: Record<string, unknown>
  ): void {
    const stats = this.getOrCreateServerStats(serverId);
    stats.currentConsecutiveFailures++;
    stats.failedRecoveries++;
    stats.lastRecoveryAttempt = Date.now();
    stats.lastFailureReason = error;
    stats.totalRecoveryAttempts++;

    if (!stats.firstRecordedFailure) {
      stats.firstRecordedFailure = Date.now();
    }

    this.updateFailureRate(stats);
    this.updateAverageTimeBetweenFailures(serverId, stats);

    const record: RecoveryFailureRecord = {
      timestamp: Date.now(),
      serverId,
      error,
      errorType,
      responseTime,
      attemptNumber: stats.totalRecoveryAttempts,
      consecutiveFailures: stats.currentConsecutiveFailures,
      source: 'health_check',
      circuitBreakerState: metadata?.circuitBreakerState as
        | 'open'
        | 'closed'
        | 'half-open'
        | undefined,
      model: metadata?.model as string | undefined,
      metadata,
    };

    this.records.push(record);
    this.serverStats.set(serverId, stats);
    this.markDirty();

    logger.warn(`Recovery failure recorded for ${serverId}`, {
      consecutiveFailures: stats.currentConsecutiveFailures,
      errorType,
      error: error.substring(0, 100),
    });

    this.pruneOldRecords(serverId);
  }

  /**
   * Record a successful recovery for a server
   */
  recordRecoverySuccess(serverId: string, responseTime?: number): void {
    const stats = this.getOrCreateServerStats(serverId);
    stats.currentConsecutiveFailures = 0;
    stats.successfulRecoveries++;
    stats.lastRecoveryAttempt = Date.now();
    stats.lastSuccessfulRecovery = Date.now();
    stats.totalRecoveryAttempts++;

    this.updateFailureRate(stats);

    this.serverStats.set(serverId, stats);
    this.markDirty();

    logger.info(`Recovery success recorded for ${serverId}`, {
      totalSuccessfulRecoveries: stats.successfulRecoveries,
      responseTime,
    });
  }

  /**
   * Get recovery statistics for a specific server
   */
  getServerRecoveryStats(serverId: string): ServerRecoveryStats | undefined {
    const stats = this.serverStats.get(serverId);
    if (!stats) {
      return undefined;
    }
    return {
      ...stats,
      pattern: this.detectPattern(serverId, stats),
    };
  }

  /**
   * Get all server recovery statistics
   */
  getAllServerStats(): ServerRecoveryStats[] {
    const results: ServerRecoveryStats[] = [];
    for (const [serverId, stats] of this.serverStats.entries()) {
      results.push({
        ...stats,
        pattern: this.detectPattern(serverId, stats),
      });
    }
    return results.sort((a, b) => b.failedRecoveries - a.failedRecoveries);
  }

  /**
   * Analyze failure patterns for a server
   */
  analyzeFailurePattern(serverId: string, windowMs = 3600000): FailurePatternAnalysis {
    const stats = this.serverStats.get(serverId);
    if (!stats) {
      return {
        serverId,
        pattern: 'stable',
        trend: 'stable',
        confidence: 1,
        recommendations: ['No failure history recorded for this server'],
      };
    }

    const now = Date.now();
    const windowStart = now - windowMs;
    const recentRecords = this.records.filter(
      r => r.serverId === serverId && r.timestamp >= windowStart
    );

    const previousWindowStart = windowStart - windowMs;
    const previousRecords = this.records.filter(
      r =>
        r.serverId === serverId && r.timestamp >= previousWindowStart && r.timestamp < windowStart
    );

    const recentFailureCount = recentRecords.length;
    const previousFailureCount = previousRecords.length;

    let trend: 'improving' | 'stable' | 'worsening' = 'stable';
    if (recentFailureCount > previousFailureCount * 1.5) {
      trend = 'worsening';
    } else if (recentFailureCount < previousFailureCount * 0.5) {
      trend = 'improving';
    }

    const pattern = this.detectPattern(serverId, stats);
    const confidence = this.calculateConfidence(recentRecords.length);

    const recommendations: string[] = [];
    if (pattern === 'persistent') {
      recommendations.push(
        'Consider removing this server from the cluster - persistent failures detected'
      );
      recommendations.push('Investigate underlying infrastructure issues');
    } else if (pattern === 'flapping') {
      recommendations.push('Server is unstable - check for resource contention');
      recommendations.push('Consider implementing longer cooldown periods');
    } else if (pattern === 'degrading') {
      recommendations.push('Server health is declining - monitor closely');
      recommendations.push('Check for memory leaks or resource exhaustion');
    }

    let predictedNextFailure: number | undefined;
    if (recentRecords.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < recentRecords.length; i++) {
        intervals.push(recentRecords[i].timestamp - recentRecords[i - 1].timestamp);
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      if (avgInterval > 0) {
        predictedNextFailure = now + avgInterval;
      }
    }

    return {
      serverId,
      pattern,
      trend,
      confidence,
      predictedNextFailure,
      recommendations,
    };
  }

  /**
   * Get global failure summary
   */
  getGlobalSummary(windowMs = 86400000): GlobalFailureSummary {
    const now = Date.now();
    const windowStart = now - windowMs;
    const recentRecords = this.records.filter(r => r.timestamp >= windowStart);

    const serversWithFailures = new Set(recentRecords.map(r => r.serverId)).size;
    const serversWithPersistentFailures = Array.from(this.serverStats.values()).filter(
      s => s.currentConsecutiveFailures >= this.config.persistentFailureThreshold
    ).length;

    const errorTypes: Record<string, number> = {};
    for (const record of recentRecords) {
      errorTypes[record.errorType] = (errorTypes[record.errorType] ?? 0) + 1;
    }

    const topFailingServers: Array<{ serverId: string; failureCount: number }> = [];
    const serverFailureCounts = new Map<string, number>();
    for (const record of recentRecords) {
      serverFailureCounts.set(record.serverId, (serverFailureCounts.get(record.serverId) ?? 0) + 1);
    }
    for (const [serverId, count] of serverFailureCounts.entries()) {
      topFailingServers.push({ serverId, failureCount: count });
    }
    topFailingServers.sort((a, b) => b.failureCount - a.failureCount);
    topFailingServers.splice(10);

    let totalAttempts = 0;
    for (const stats of this.serverStats.values()) {
      totalAttempts += stats.totalRecoveryAttempts;
    }

    const totalFailures = recentRecords.length;
    const overallFailureRate = totalAttempts > 0 ? totalFailures / totalAttempts : 0;

    return {
      totalServers: this.serverStats.size,
      serversWithFailures,
      serversWithPersistentFailures,
      totalRecoveryAttempts: totalAttempts,
      totalFailures,
      overallFailureRate,
      topFailingServers,
      commonErrorTypes: errorTypes,
      timeRange: { start: windowStart, end: now },
    };
  }

  /**
   * Get failure history for a server
   */
  getServerFailureHistory(serverId: string, limit = 100, offset = 0): RecoveryFailureRecord[] {
    const serverRecords = this.records
      .filter(r => r.serverId === serverId)
      .sort((a, b) => b.timestamp - a.timestamp);
    return serverRecords.slice(offset, offset + limit);
  }

  /**
   * Get recent failure records across all servers
   */
  getRecentRecords(limit = 100): RecoveryFailureRecord[] {
    return this.records.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  /**
   * Detect if a server is exhibiting a specific failure pattern
   */
  private detectPattern(
    serverId: string,
    stats: ServerRecoveryStats
  ): ServerRecoveryStats['pattern'] {
    if (stats.totalRecoveryAttempts < 3) {
      return 'stable';
    }

    const recentRecords = this.records
      .filter(r => r.serverId === serverId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 20);

    if (recentRecords.length < 3) {
      return 'stable';
    }

    const now = Date.now();
    const flappingWindowStart = now - this.config.flappingDetectionWindow;
    const recentFlappingRecords = recentRecords.filter(r => r.timestamp >= flappingWindowStart);

    if (recentFlappingRecords.length >= 5) {
      const transitions = this.detectStateTransitions(recentFlappingRecords);
      if (transitions >= 4) {
        return 'flapping';
      }
    }

    const degradationWindowStart = now - this.config.degradationDetectionWindow;
    const recentDegradationRecords = recentRecords.filter(
      r => r.timestamp >= degradationWindowStart
    );

    if (stats.currentConsecutiveFailures >= this.config.persistentFailureThreshold) {
      return 'persistent';
    }

    const halfWindowStart = now - this.config.degradationDetectionWindow / 2;
    const firstHalfFailures = recentDegradationRecords.filter(
      r => r.timestamp < halfWindowStart
    ).length;
    const secondHalfFailures = recentDegradationRecords.filter(
      r => r.timestamp >= halfWindowStart
    ).length;

    if (secondHalfFailures > firstHalfFailures * 2 && secondHalfFailures >= 3) {
      return 'degrading';
    }

    return 'stable';
  }

  /**
   * Detect state transitions (success/failure pattern changes)
   */
  private detectStateTransitions(records: RecoveryFailureRecord[]): number {
    if (records.length < 2) {
      return 0;
    }
    let transitions = 0;
    for (let i = 1; i < records.length; i++) {
      if (records[i].consecutiveFailures === 1 && records[i - 1].consecutiveFailures > 1) {
        transitions++;
      }
    }
    return transitions;
  }

  /**
   * Calculate confidence level based on sample size
   */
  private calculateConfidence(sampleSize: number): number {
    if (sampleSize >= 20) {
      return 0.9;
    } else if (sampleSize >= 10) {
      return 0.7;
    } else if (sampleSize >= 5) {
      return 0.5;
    }
    return 0.3;
  }

  /**
   * Update failure rate for a server
   */
  private updateFailureRate(stats: ServerRecoveryStats): void {
    if (stats.totalRecoveryAttempts > 0) {
      stats.failureRate = stats.failedRecoveries / stats.totalRecoveryAttempts;
    }
  }

  /**
   * Update average time between failures
   */
  private updateAverageTimeBetweenFailures(serverId: string, stats: ServerRecoveryStats): void {
    const serverRecords = this.records
      .filter(r => r.serverId === serverId)
      .sort((a, b) => b.timestamp - a.timestamp);

    if (serverRecords.length < 2) {
      return;
    }

    let totalInterval = 0;
    let count = 0;
    for (let i = 1; i < Math.min(serverRecords.length, 10); i++) {
      totalInterval += serverRecords[i - 1].timestamp - serverRecords[i].timestamp;
      count++;
    }

    if (count > 0) {
      stats.averageTimeBetweenFailures = totalInterval / count;
    }
  }

  /**
   * Get or create server stats
   */
  private getOrCreateServerStats(serverId: string): ServerRecoveryStats {
    const existing = this.serverStats.get(serverId);
    if (existing) {
      return existing;
    }

    const newStats: ServerRecoveryStats = {
      serverId,
      totalRecoveryAttempts: 0,
      successfulRecoveries: 0,
      failedRecoveries: 0,
      currentConsecutiveFailures: 0,
      lastRecoveryAttempt: 0,
      failureRate: 0,
      averageTimeBetweenFailures: 0,
      pattern: 'stable',
      circuitBreakerImpact: {
        totalTransitions: 0,
        openStateContributions: 0,
        lastTransition: 0,
      },
    };

    this.serverStats.set(serverId, newStats);
    return newStats;
  }

  /**
   * Prune old records for a server
   */
  private pruneOldRecords(serverId: string): void {
    const serverRecords = this.records.filter(r => r.serverId === serverId);
    if (serverRecords.length <= this.config.maxRecordsPerServer) {
      return;
    }

    const keepCount = Math.floor(this.config.maxRecordsPerServer * 0.8);
    const oldestRecords = serverRecords
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, serverRecords.length - keepCount);

    const oldestTimestamps = new Set(oldestRecords.map(r => r.timestamp));
    this.records = this.records.filter(r => !oldestTimestamps.has(r.timestamp));
  }

  /**
   * Mark data as dirty for persistence
   */
  private markDirty(): void {
    this.persistenceDirty = true;
  }

  /**
   * Persist data to disk
   */
  async persistToDisk(): Promise<void> {
    if (!this.config.persistenceEnabled) {
      return Promise.resolve();
    }

    const now = Date.now();
    if (now - this.lastPersistenceTime < 30000 && !this.persistenceDirty) {
      return Promise.resolve();
    }

    this.lastPersistenceTime = now;
    this.persistenceDirty = false;

    const data: PersistenceData = {
      version: 1,
      timestamp: now,
      records: this.records.slice(-this.config.maxRecordsPerServer * 10),
      serverStats: Object.fromEntries(
        Array.from(this.serverStats.entries()).map(([id, stats]) => [id, stats])
      ),
      circuitBreakerTransitions: this.circuitBreakerTransitions.slice(-5000),
    };

    try {
      const success = this.fileHandler?.write(data);

      if (!success) {
        logger.error('Failed to persist recovery failure data');
      } else {
        logger.debug(`Persisted recovery failure data to ${this.config.persistencePath}`);
      }
    } catch (error) {
      logger.error('Failed to persist recovery failure data', { error });
    }
  }

  /**
   * Load data from disk
   */
  private async loadFromDisk(): Promise<void> {
    if (!this.config.persistenceEnabled || !this.fileHandler) {
      return Promise.resolve();
    }

    try {
      const data = this.fileHandler.read<PersistenceData>();

      if (data?.records) {
        this.records = data.records;
      }
      if (data?.serverStats) {
        for (const [id, stats] of Object.entries(data.serverStats)) {
          this.serverStats.set(id, stats as ServerRecoveryStats);
        }
      }
      if (data?.circuitBreakerTransitions) {
        this.circuitBreakerTransitions = data.circuitBreakerTransitions;
      }

      logger.info(`Loaded ${this.records.length} recovery failure records from disk`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error('Failed to load recovery failure data', { error });
      }
    }
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.records = [];
    this.serverStats.clear();
    this.circuitBreakerTransitions = [];
    this.markDirty();
    logger.info('Recovery failure tracker cleared');
  }

  /**
   * Reset stats for a specific server
   */
  resetServerStats(serverId: string): void {
    this.serverStats.delete(serverId);
    this.records = this.records.filter(r => r.serverId !== serverId);
    this.circuitBreakerTransitions = this.circuitBreakerTransitions.filter(
      t => t.serverId !== serverId
    );
    this.markDirty();
    logger.info(`Reset recovery failure stats for ${serverId}`);
  }

  /**
   * Get count of records
   */
  getRecordCount(): number {
    return this.records.length;
  }

  /**
   * Get count of tracked servers
   */
  getServerCount(): number {
    return this.serverStats.size;
  }
}

let globalTracker: RecoveryFailureTracker | null = null;

export function getRecoveryFailureTracker(): RecoveryFailureTracker {
  if (!globalTracker) {
    globalTracker = new RecoveryFailureTracker();
  }
  return globalTracker;
}

export function setRecoveryFailureTracker(tracker: RecoveryFailureTracker): void {
  globalTracker = tracker;
}
