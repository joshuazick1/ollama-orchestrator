/**
 * prometheus-exporter.ts
 * Export metrics in Prometheus/OpenMetrics format
 */

import type { TimeWindow } from '../orchestrator.types.js';

import type { MetricsAggregator } from './metrics-aggregator.js';

/**
 * Formats metrics for Prometheus scraping
 */
export class PrometheusExporter {
  private aggregator: MetricsAggregator;

  constructor(aggregator: MetricsAggregator) {
    this.aggregator = aggregator;
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

    // Define metric types and helps for per-server metrics
    lines.unshift('# HELP orchestrator_in_flight_requests Current in-flight requests');
    lines.unshift('# TYPE orchestrator_in_flight_requests gauge');

    lines.unshift('# HELP orchestrator_success_rate Success rate (0-1)');
    lines.unshift('# TYPE orchestrator_success_rate gauge');

    lines.unshift('# HELP orchestrator_throughput_per_min Throughput (requests per minute)');
    lines.unshift('# TYPE orchestrator_throughput_per_min gauge');

    lines.unshift('# HELP orchestrator_avg_tokens_per_request Average tokens per request');
    lines.unshift('# TYPE orchestrator_avg_tokens_per_request gauge');

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
