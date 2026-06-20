/**
 * prometheus-exporter.ts
 * Export metrics in Prometheus/OpenMetrics format
 */

import type { TimeWindow } from '../orchestrator/orchestrator.types.js';
import type { ProbeOrchestrator } from '../probe/probe-orchestrator.js';
import type { TupleKey, ProbeState } from '../probe/types.js';
import { tupleKey } from '../probe/types.js';
import { getInFlightManager } from '../utils/in-flight-manager.js';

import type { MetricsAggregator } from './metrics-aggregator.js';

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
    if (!this.probeOrchestrator) {
      return;
    }
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

      // TTFT metrics if available
      if (metric.streamingMetrics) {
        lines.push(
          `orchestrator_ttft_seconds_avg{${labels}} ${(metric.streamingMetrics.avgTTFT / 1000).toFixed(4)}`
        );
        lines.push(
          `orchestrator_ttft_seconds_p50{${labels}} ${(metric.streamingMetrics.ttftPercentiles.p50 / 1000).toFixed(4)}`
        );
        lines.push(
          `orchestrator_ttft_seconds_p95{${labels}} ${(metric.streamingMetrics.ttftPercentiles.p95 / 1000).toFixed(4)}`
        );
        lines.push(
          `orchestrator_ttft_seconds_p99{${labels}} ${(metric.streamingMetrics.ttftPercentiles.p99 / 1000).toFixed(4)}`
        );
      }

      // ITL (inter-token latency) from streaming gap tracking
      if (metric.streamingMetrics?.chunkGapPercentiles) {
        const itl = metric.streamingMetrics.chunkGapPercentiles;
        const itlLabels = `${labels},statistic="p50"`;
        lines.push(`# HELP orchestrator_itl_ms Inter-token latency (streaming chunk gap) in ms`);
        lines.push(`# TYPE orchestrator_itl_ms gauge`);
        lines.push(`orchestrator_itl_ms${itlLabels} ${itl.p50.toFixed(2)}`);
        lines.push(`orchestrator_itl_ms{${labels},statistic="p95"} ${itl.p95.toFixed(2)}`);
        lines.push(`orchestrator_itl_ms{${labels},statistic="p99"} ${itl.p99.toFixed(2)}`);
      }

      if (metric.streamingMetrics?.recentChunkCounts) {
        const totalChunks = metric.streamingMetrics.recentChunkCounts.reduce((a, b) => a + b, 0);
        if (totalChunks > 0) {
          lines.push('# HELP orchestrator_stream_chunks_total Total streaming chunks received');
          lines.push('# TYPE orchestrator_stream_chunks_total counter');
          lines.push(`orchestrator_stream_chunks_total{${labels}} ${totalChunks}`);
        }
      }

      if (metric.streamingMetrics?.recentMaxChunkGaps) {
        const gaps = metric.streamingMetrics.recentMaxChunkGaps;
        if (gaps.length > 0) {
          lines.push(
            '# HELP orchestrator_stream_max_chunk_gap_ms Maximum chunk gap in milliseconds'
          );
          lines.push('# TYPE orchestrator_stream_max_chunk_gap_ms gauge');
          lines.push(
            `orchestrator_stream_max_chunk_gap_ms{${labels}} ${gaps[gaps.length - 1].toFixed(2)}`
          );
        }
      }

      if (metric.streamingMetrics?.recentChunkSizes) {
        const totalBytes = metric.streamingMetrics.recentChunkSizes.reduce((a, b) => a + b, 0);
        if (totalBytes > 0) {
          lines.push('# HELP orchestrator_stream_total_bytes Total bytes from streaming responses');
          lines.push('# TYPE orchestrator_stream_total_bytes counter');
          lines.push(`orchestrator_stream_total_bytes{${labels}} ${totalBytes}`);
        }
      }

      if (metric.avgQueueWaitTimeMs !== undefined && metric.avgQueueWaitTimeMs > 0) {
        lines.push('# HELP orchestrator_queue_wait_seconds Queue wait time in seconds');
        lines.push('# TYPE orchestrator_queue_wait_seconds gauge');
        lines.push(
          `orchestrator_queue_wait_seconds{${labels}} ${(metric.avgQueueWaitTimeMs / 1000).toFixed(4)}`
        );
      }

      // Cold-start magnitude
      if (metric.coldStartCount > 0 || metric.coldStartMagnitudeMs !== undefined) {
        lines.push('# HELP orchestrator_cold_start_count Total cold-start events');
        lines.push('# TYPE orchestrator_cold_start_count counter');
        lines.push(`orchestrator_cold_start_count{${labels}} ${metric.coldStartCount}`);
        if (metric.coldStartMagnitudeMs !== undefined) {
          lines.push('# HELP orchestrator_cold_start_magnitude_ms Last cold-start load duration');
          lines.push('# TYPE orchestrator_cold_start_magnitude_ms gauge');
          lines.push(
            `orchestrator_cold_start_magnitude_ms{${labels}} ${metric.coldStartMagnitudeMs.toFixed(2)}`
          );
        }
      }

      // Cache hit rate
      if (metric.cacheHitRate !== undefined) {
        lines.push('# HELP orchestrator_cache_hit_rate Cache hit rate (0-1)');
        lines.push('# TYPE orchestrator_cache_hit_rate gauge');
        lines.push(`orchestrator_cache_hit_rate{${labels}} ${metric.cacheHitRate.toFixed(4)}`);
      }

      // Error type histogram
      if (metric.errorTypeHistogram && metric.errorTypeHistogram.size > 0) {
        lines.push('# HELP orchestrator_errors_by_type Total errors by type');
        lines.push('# TYPE orchestrator_errors_by_type counter');
        for (const [errorType, count] of metric.errorTypeHistogram) {
          const errLabels = `${labels},error_type="${errorType}"`;
          lines.push(`orchestrator_errors_by_type{${errLabels}} ${count}`);
        }
      }

      // Token-weighted load (B16/B21 mitigation)
      if (metric.tokenWeightedLoad !== undefined) {
        lines.push('# HELP orchestrator_token_weighted_load Current token-weighted in-flight load');
        lines.push('# TYPE orchestrator_token_weighted_load gauge');
        lines.push(
          `orchestrator_token_weighted_load{${labels}} ${metric.tokenWeightedLoad.toFixed(2)}`
        );
      }
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
