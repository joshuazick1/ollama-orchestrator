/**
 * prometheus-exporter.ts
 * Export metrics in Prometheus/OpenMetrics format
 */

import type { TimeWindow } from '../orchestrator/orchestrator.types.js';
import { getInFlightManager } from '../utils/in-flight-manager.js';

import type { MetricsAggregator } from './metrics-aggregator.js';
import type { ProbeOrchestrator } from '../probe/probe-orchestrator.js';
import type { TupleKey, ProbeState } from '../probe/types.js';
import { tupleKey } from '../probe/types.js';

interface ProbeMetrics {
  transitions: Map<string, number>;
  currentStates: Map<TupleKey, ProbeState>;
  recoveryAttempts: Map<string, number>;
}

/**
 * Formats metrics for Prometheus scraping
 */
export class PrometheusExporter {
  private aggregator: MetricsAggregator;
  private probeOrchestrator: ProbeOrchestrator | undefined;
  private probeMetrics: ProbeMetrics = {
    transitions: new Map(),
    currentStates: new Map(),
    recoveryAttempts: new Map(),
  };
  private unsubscribeProbe: (() => void) | undefined;

  constructor(aggregator: MetricsAggregator, probeOrchestrator?: ProbeOrchestrator) {
    this.aggregator = aggregator;
    this.probeOrchestrator = probeOrchestrator;
    if (probeOrchestrator) {
      this.unsubscribeProbe = probeOrchestrator.onStateChange((tuple, from, to, reason) => {
        const key = tupleKey(tuple);
        this.#handleStateChange(key, from, to, reason);
      });
    }
  }

  #handleStateChange(tupleKey: string, from: ProbeState, to: ProbeState, reason: string): void {
    const transKey = `${tupleKey}:${from}:${to}:${reason}`;
    this.probeMetrics.transitions.set(
      transKey,
      (this.probeMetrics.transitions.get(transKey) ?? 0) + 1
    );
    this.probeMetrics.currentStates.set(tupleKey, to);
  }

  /**
   * Record a recovery attempt (success or failure) for a tuple.
   * Call this when a recovery probe completes.
   */
  recordRecoveryAttempt(tupleKey: string, success: boolean): void {
    const result = success ? 'success' : 'failure';
    const key = `${tupleKey}:${result}`;
    this.probeMetrics.recoveryAttempts.set(
      key,
      (this.probeMetrics.recoveryAttempts.get(key) ?? 0) + 1
    );
  }

  /**
   * Refresh current probe states from the orchestrator.
   * Call this before export() if you want to capture latest state.
   */
  refreshProbeStates(): void {
    if (!this.probeOrchestrator) return;
    const states = this.probeOrchestrator.getAllStates();
    for (const [key, ts] of states) {
      this.probeMetrics.currentStates.set(key, ts.state);
    }
  }

  /**
   * Stop listening to probe state changes (for cleanup).
   */
  destroy(): void {
    this.unsubscribeProbe?.();
    this.unsubscribeProbe = undefined;
  }

  /**
   * Export all metrics in Prometheus format
   */
  export(): string {
    const lines: string[] = [];
    const metrics = this.aggregator.getAllMetrics();
    const globalMetrics = this.aggregator.getGlobalMetrics();

    // Global counters
    lines.push('# HELP orchestrator_requests_total Total requests processed');
    lines.push('# TYPE orchestrator_requests_total counter');
    lines.push(`orchestrator_requests_total ${globalMetrics.totalRequests}`);

    lines.push('# HELP orchestrator_errors_total Total errors');
    lines.push('# TYPE orchestrator_errors_total counter');
    lines.push(`orchestrator_errors_total ${globalMetrics.totalErrors}`);

    lines.push('# HELP orchestrator_tokens_generated_total Total tokens generated');
    lines.push('# TYPE orchestrator_tokens_generated_total counter');
    lines.push(`orchestrator_tokens_generated_total ${globalMetrics.totalTokens}`);

    // Global gauges
    lines.push('# HELP orchestrator_requests_per_second Current request rate');
    lines.push('# TYPE orchestrator_requests_per_second gauge');
    lines.push(`orchestrator_requests_per_second ${globalMetrics.requestsPerSecond.toFixed(2)}`);

    lines.push('# HELP orchestrator_avg_latency_ms Average latency in milliseconds');
    lines.push('# TYPE orchestrator_avg_latency_ms gauge');
    lines.push(`orchestrator_avg_latency_ms ${globalMetrics.avgLatency.toFixed(2)}`);

    lines.push('# HELP orchestrator_error_rate Current error rate');
    lines.push('# TYPE orchestrator_error_rate gauge');
    lines.push(`orchestrator_error_rate ${globalMetrics.errorRate.toFixed(4)}`);

    // Per-server:model metrics
    lines.push('# HELP orchestrator_in_flight_requests Current in-flight requests');
    lines.push('# TYPE orchestrator_in_flight_requests gauge');
    lines.push('# HELP orchestrator_success_rate Success rate (0-1)');
    lines.push('# TYPE orchestrator_success_rate gauge');
    lines.push('# HELP orchestrator_throughput_per_min Throughput (requests per minute)');
    lines.push('# TYPE orchestrator_throughput_per_min gauge');
    lines.push('# HELP orchestrator_avg_tokens_per_request Average tokens per request');
    lines.push('# TYPE orchestrator_avg_tokens_per_request gauge');

    for (const [, metric] of metrics.entries()) {
      const labels = `server="${metric.serverId}",model="${metric.model}"`;

      // In-flight requests
      lines.push(`orchestrator_in_flight_requests{${labels}} ${metric.inFlight}`);

      // Request counts per window
      (['1m', '5m', '15m', '1h'] as TimeWindow[]).forEach(window => {
        const windowLabels = `${labels},window="${window}"`;
        const windowMetric = metric.windows[window];

        lines.push(`orchestrator_window_requests{${windowLabels}} ${windowMetric.count}`);
        lines.push(`orchestrator_window_errors{${windowLabels}} ${windowMetric.errors}`);
        lines.push(
          `orchestrator_window_latency_sum_ms{${windowLabels}} ${windowMetric.latencySum.toFixed(2)}`
        );
        lines.push(`orchestrator_window_latency_count{${windowLabels}} ${windowMetric.count}`);
      });

      // Percentiles
      lines.push(`orchestrator_latency_p50_ms{${labels}} ${metric.percentiles.p50.toFixed(2)}`);
      lines.push(`orchestrator_latency_p95_ms{${labels}} ${metric.percentiles.p95.toFixed(2)}`);
      lines.push(`orchestrator_latency_p99_ms{${labels}} ${metric.percentiles.p99.toFixed(2)}`);

      // Derived metrics
      lines.push(`orchestrator_success_rate{${labels}} ${metric.successRate.toFixed(4)}`);
      lines.push(`orchestrator_throughput_per_min{${labels}} ${metric.throughput.toFixed(2)}`);
      lines.push(
        `orchestrator_avg_tokens_per_request{${labels}} ${metric.avgTokensPerRequest.toFixed(2)}`
      );
    }

    // Probe metrics
    lines.push('# HELP orchestrator_in_flight_cleanups_total In-flight tracking cleanups');
    lines.push('# TYPE orchestrator_in_flight_cleanups_total counter');
    try {
      const cleanupStats = getInFlightManager().getCleanupStats();
      const reasonCounts: Record<string, number> = {
        client_disconnect: 0,
        stale_sweep: 0,
        normal_completion: 0,
        ...cleanupStats.cleanupsByReason,
      };
      for (const reason of ['client_disconnect', 'stale_sweep', 'normal_completion']) {
        const count = reasonCounts[reason] ?? 0;
        lines.push(`orchestrator_in_flight_cleanups_total{reason="${reason}"} ${count}`);
      }
      lines.push(
        '# HELP orchestrator_in_flight_leaks_prevented_total Leaks prevented by stale sweep'
      );
      lines.push('# TYPE orchestrator_in_flight_leaks_prevented_total counter');
      lines.push(`orchestrator_in_flight_leaks_prevented_total ${cleanupStats.leaksPrevented}`);
    } catch (e) {
      lines.push(
        `# WARN in-flight cleanup metrics unavailable: ${e instanceof Error ? e.message : String(e)}`
      );
    }

    lines.push('# HELP probe_state_transitions_total Probe state transitions');
    lines.push('# TYPE probe_state_transitions_total counter');
    for (const [key, count] of this.probeMetrics.transitions) {
      const parts = key.split(':');
      const tupleKey = parts.slice(0, 3).join(':');
      const fromState = parts[3];
      const toState = parts[4];
      const reason = parts.slice(5).join(':');
      lines.push(
        `probe_state_transitions_total{tuple_key="${tupleKey}",from_state="${fromState}",to_state="${toState}",reason="${reason}"} ${count}`
      );
    }

    lines.push('# HELP probe_state_current Current state of each probe tuple');
    lines.push('# TYPE probe_state_current gauge');
    for (const [key, state] of this.probeMetrics.currentStates) {
      lines.push(`probe_state_current{tuple_key="${key}",state="${state}"} 1`);
    }

    lines.push('# HELP probe_health_tuples Count of tuples in each state');
    lines.push('# TYPE probe_health_tuples gauge');
    const stateCounts: Record<string, number> = {};
    for (const [, state] of this.probeMetrics.currentStates) {
      stateCounts[state] = (stateCounts[state] ?? 0) + 1;
    }
    for (const [state, count] of Object.entries(stateCounts)) {
      lines.push(`probe_health_tuples{state="${state}"} ${count}`);
    }

    lines.push('# HELP probe_recovery_attempts_total Recovery attempts');
    lines.push('# TYPE probe_recovery_attempts_total counter');
    for (const [key, count] of this.probeMetrics.recoveryAttempts) {
      const lastColon = key.lastIndexOf(':');
      const tupleKey = key.substring(0, lastColon);
      const result = key.substring(lastColon + 1);
      lines.push(
        `probe_recovery_attempts_total{tuple_key="${tupleKey}",result="${result}"} ${count}`
      );
    }

    return lines.join('\n');
  }

  /**
   * Export histogram data for latency distribution
   */
  exportLatencyHistogram(
    serverId: string,
    model: string,
    buckets: number[] = [50, 100, 250, 500, 1000, 2500, 5000, 10000]
  ): string {
    const metric = this.aggregator.getMetrics(serverId, model);
    if (!metric) {
      return '';
    }

    const lines: string[] = [];
    const labels = `server="${serverId}",model="${model}"`;

    lines.push('# HELP orchestrator_request_duration_ms Request duration histogram');
    lines.push('# TYPE orchestrator_request_duration_ms histogram');

    // Count requests in each bucket
    const sortedLatencies = [...metric.recentLatencies].sort((a, b) => a - b);
    let cumulativeCount = 0;

    for (const bucket of buckets) {
      const count = sortedLatencies.filter(l => l <= bucket).length;
      cumulativeCount = Math.max(cumulativeCount, count);
      lines.push(
        `orchestrator_request_duration_ms_bucket{${labels},le="${bucket}"} ${cumulativeCount}`
      );
    }

    // +Inf bucket
    lines.push(
      `orchestrator_request_duration_ms_bucket{${labels},le="+Inf"} ${sortedLatencies.length}`
    );

    // Sum and count
    const sum = sortedLatencies.reduce((a, b) => a + b, 0);
    lines.push(`orchestrator_request_duration_ms_sum{${labels}} ${sum.toFixed(2)}`);
    lines.push(`orchestrator_request_duration_ms_count{${labels}} ${sortedLatencies.length}`);

    return lines.join('\n');
  }
}
