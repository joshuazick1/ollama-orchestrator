/**
 * prometheus-probe.test.ts
 * Tests for Prometheus probe state metrics
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { MetricsAggregator } from '../../src/metrics/metrics-aggregator.js';
import { PrometheusExporter } from '../../src/metrics/prometheus-exporter.js';
import type { ProbeOrchestrator, TupleState } from '../../src/probe/probe-orchestrator.js';
import type { Tuple, ProbeState } from '../../src/probe/types.js';

function makeMockAggregator(): MetricsAggregator {
  return {
    getAllMetrics: vi.fn().mockReturnValue(new Map()),
    getGlobalMetrics: vi.fn().mockReturnValue({
      totalRequests: 0,
      totalErrors: 0,
      totalTokens: 0,
      requestsPerSecond: 0,
      avgLatency: 0,
      errorRate: 0,
    }),
    getMetrics: vi.fn().mockReturnValue(undefined),
  } as unknown as MetricsAggregator;
}

function makeTuple(serverId: string, model: string, endpoint: string): Tuple {
  return { serverId, model, endpoint: endpoint as Tuple['endpoint'] };
}

describe('PrometheusExporter probe metrics', () => {
  describe('without ProbeOrchestrator', () => {
    it('should export empty probe metrics when no orchestrator provided', () => {
      const aggregator = makeMockAggregator();
      const exporter = new PrometheusExporter(aggregator);

      const result = exporter.export();

      expect(result).toContain('# HELP probe_state_transitions_total Probe state transitions');
      expect(result).toContain('# TYPE probe_state_transitions_total counter');
      expect(result).toContain('# HELP probe_state_current Current state of each probe tuple');
      expect(result).toContain('# TYPE probe_state_current gauge');
      expect(result).toContain('# HELP probe_health_tuples Count of tuples in each state');
      expect(result).toContain('# TYPE probe_health_tuples gauge');
      expect(result).toContain('# HELP probe_recovery_attempts_total Recovery attempts');
      expect(result).toContain('# TYPE probe_recovery_attempts_total counter');
    });

    it('should have zero values for all probe metrics without orchestrator', () => {
      const aggregator = makeMockAggregator();
      const exporter = new PrometheusExporter(aggregator);

      const result = exporter.export();

      // No transition lines should be present
      expect(result).not.toContain('probe_state_transitions_total{tuple_key=');
      expect(result).not.toContain('probe_state_current{tuple_key=');
      expect(result).not.toContain('probe_health_tuples{state=');
      expect(result).not.toContain('probe_recovery_attempts_total{tuple_key=');
    });
  });

  describe('recordRecoveryAttempt', () => {
    it('should track recovery attempts by tuple and result', () => {
      const aggregator = makeMockAggregator();
      const exporter = new PrometheusExporter(aggregator);

      exporter.recordRecoveryAttempt('server1:llama3:generate', true);
      exporter.recordRecoveryAttempt('server1:llama3:generate', true);
      exporter.recordRecoveryAttempt('server1:llama3:generate', false);
      exporter.recordRecoveryAttempt('server2:embedding:embed', false);

      const result = exporter.export();

      expect(result).toContain(
        'probe_recovery_attempts_total{tuple_key="server1:llama3:generate",result="success"} 2'
      );
      expect(result).toContain(
        'probe_recovery_attempts_total{tuple_key="server1:llama3:generate",result="failure"} 1'
      );
      expect(result).toContain(
        'probe_recovery_attempts_total{tuple_key="server2:embedding:embed",result="failure"} 1'
      );
    });
  });

  describe('with ProbeOrchestrator', () => {
    it('should export current states from getAllStates on refresh', () => {
      const aggregator = makeMockAggregator();

      const mockStates = new Map<string, TupleState>();
      mockStates.set('server1:llama3:generate', {
        state: 'HEALTHY' as ProbeState,
        consecutiveSuccesses: 5,
        consecutiveFailures: 0,
        errorWindow: [],
        lastTransition: Date.now(),
        lastProbeAt: 0,
        nextProbeAt: 0,
        recoveryAttempts: 0,
        lastErrorKind: undefined,
      });
      mockStates.set('server2:embedding:embed', {
        state: 'UNHEALTHY' as ProbeState,
        consecutiveSuccesses: 0,
        consecutiveFailures: 3,
        errorWindow: [],
        lastTransition: Date.now(),
        lastProbeAt: 0,
        nextProbeAt: 0,
        recoveryAttempts: 1,
        lastErrorKind: 'transient',
      });

      const mockOrchestrator: ProbeOrchestrator = {
        getAllStates: vi.fn().mockReturnValue(mockStates),
        onStateChange: vi.fn().mockReturnValue(() => {}),
      } as unknown as ProbeOrchestrator;

      const exporter = new PrometheusExporter(aggregator, mockOrchestrator);
      exporter.refreshProbeStates();

      const result = exporter.export();

      expect(result).toContain(
        'probe_state_current{tuple_key="server1:llama3:generate",state="HEALTHY"} 1'
      );
      expect(result).toContain(
        'probe_state_current{tuple_key="server2:embedding:embed",state="UNHEALTHY"} 1'
      );
    });

    it('should aggregate tuples by state in probe_health_tuples', () => {
      const aggregator = makeMockAggregator();

      const mockStates = new Map<string, TupleState>();
      mockStates.set('s1:m1:e1', {
        state: 'HEALTHY' as ProbeState,
        consecutiveSuccesses: 1,
        consecutiveFailures: 0,
        errorWindow: [],
        lastTransition: 0,
        lastProbeAt: 0,
        nextProbeAt: 0,
        recoveryAttempts: 0,
        lastErrorKind: undefined,
      });
      mockStates.set('s2:m1:e1', {
        state: 'HEALTHY' as ProbeState,
        consecutiveSuccesses: 1,
        consecutiveFailures: 0,
        errorWindow: [],
        lastTransition: 0,
        lastProbeAt: 0,
        nextProbeAt: 0,
        recoveryAttempts: 0,
        lastErrorKind: undefined,
      });
      mockStates.set('s3:m1:e1', {
        state: 'SUSPECT' as ProbeState,
        consecutiveSuccesses: 0,
        consecutiveFailures: 1,
        errorWindow: [],
        lastTransition: 0,
        lastProbeAt: 0,
        nextProbeAt: 0,
        recoveryAttempts: 0,
        lastErrorKind: undefined,
      });
      mockStates.set('s4:m1:e1', {
        state: 'UNHEALTHY' as ProbeState,
        consecutiveSuccesses: 0,
        consecutiveFailures: 3,
        errorWindow: [],
        lastTransition: 0,
        lastProbeAt: 0,
        nextProbeAt: 0,
        recoveryAttempts: 1,
        lastErrorKind: undefined,
      });
      mockStates.set('s5:m1:e1', {
        state: 'UNHEALTHY' as ProbeState,
        consecutiveSuccesses: 0,
        consecutiveFailures: 2,
        errorWindow: [],
        lastTransition: 0,
        lastProbeAt: 0,
        nextProbeAt: 0,
        recoveryAttempts: 0,
        lastErrorKind: undefined,
      });
      mockStates.set('s6:m1:e1', {
        state: 'RECOVERING' as ProbeState,
        consecutiveSuccesses: 2,
        consecutiveFailures: 0,
        errorWindow: [],
        lastTransition: 0,
        lastProbeAt: 0,
        nextProbeAt: 0,
        recoveryAttempts: 0,
        lastErrorKind: undefined,
      });

      const mockOrchestrator: ProbeOrchestrator = {
        getAllStates: vi.fn().mockReturnValue(mockStates),
        onStateChange: vi.fn().mockReturnValue(() => {}),
      } as unknown as ProbeOrchestrator;

      const exporter = new PrometheusExporter(aggregator, mockOrchestrator);
      exporter.refreshProbeStates();

      const result = exporter.export();

      expect(result).toContain('probe_health_tuples{state="HEALTHY"} 2');
      expect(result).toContain('probe_health_tuples{state="SUSPECT"} 1');
      expect(result).toContain('probe_health_tuples{state="UNHEALTHY"} 2');
      expect(result).toContain('probe_health_tuples{state="RECOVERING"} 1');
    });

    it('should subscribe to onStateChange and increment transition counter', () => {
      const aggregator = makeMockAggregator();

      const unsubscribe = vi.fn();
      const mockOrchestrator: ProbeOrchestrator = {
        getAllStates: vi.fn().mockReturnValue(new Map()),
        onStateChange: vi.fn().mockReturnValue(unsubscribe),
      } as unknown as ProbeOrchestrator;

      const exporter = new PrometheusExporter(aggregator, mockOrchestrator);

      const stateChangeCallback = (mockOrchestrator.onStateChange as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      stateChangeCallback(
        makeTuple('s1', 'm1', 'generate'),
        'HEALTHY',
        'SUSPECT',
        'HEALTHY + failure(transient)'
      );
      stateChangeCallback(
        makeTuple('s1', 'm1', 'generate'),
        'SUSPECT',
        'UNHEALTHY',
        'SUSPECT + failure(permanent)'
      );
      stateChangeCallback(
        makeTuple('s1', 'm1', 'generate'),
        'HEALTHY',
        'SUSPECT',
        'HEALTHY + failure(transient)'
      );

      const result = exporter.export();

      expect(result).toContain(
        'probe_state_transitions_total{tuple_key="s1:m1:generate",from_state="HEALTHY",to_state="SUSPECT",reason="HEALTHY + failure(transient)"} 2'
      );
      expect(result).toContain(
        'probe_state_transitions_total{tuple_key="s1:m1:generate",from_state="SUSPECT",to_state="UNHEALTHY",reason="SUSPECT + failure(permanent)"} 1'
      );
    });

    it('should call unsubscribe when destroy is called', () => {
      const aggregator = makeMockAggregator();

      const unsubscribe = vi.fn();
      const mockOrchestrator: ProbeOrchestrator = {
        getAllStates: vi.fn().mockReturnValue(new Map()),
        onStateChange: vi.fn().mockReturnValue(unsubscribe),
      } as unknown as ProbeOrchestrator;

      const exporter = new PrometheusExporter(aggregator, mockOrchestrator);
      exporter.destroy();

      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('should handle reason strings with colons correctly', () => {
      const aggregator = makeMockAggregator();

      const unsubscribe = vi.fn();
      const mockOrchestrator: ProbeOrchestrator = {
        getAllStates: vi.fn().mockReturnValue(new Map()),
        onStateChange: vi.fn().mockReturnValue(unsubscribe),
      } as unknown as ProbeOrchestrator;

      const exporter = new PrometheusExporter(aggregator, mockOrchestrator);

      const stateChangeCallback = (mockOrchestrator.onStateChange as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      stateChangeCallback(
        makeTuple('s1', 'm1', 'generate'),
        'SUSPECT',
        'UNHEALTHY',
        'SUSPECT + failure(permanent: timeout)'
      );

      const result = exporter.export();

      expect(result).toContain(
        'probe_state_transitions_total{tuple_key="s1:m1:generate",from_state="SUSPECT",to_state="UNHEALTHY",reason="SUSPECT + failure(permanent: timeout)"} 1'
      );
    });

    it('should include both probe and orchestrator metrics in export', () => {
      const aggregator = makeMockAggregator();

      const mockStates = new Map<string, TupleState>();
      mockStates.set('server1:llama3:generate', {
        state: 'HEALTHY' as ProbeState,
        consecutiveSuccesses: 5,
        consecutiveFailures: 0,
        errorWindow: [],
        lastTransition: Date.now(),
        lastProbeAt: 0,
        nextProbeAt: 0,
        recoveryAttempts: 0,
        lastErrorKind: undefined,
      });

      const mockOrchestrator: ProbeOrchestrator = {
        getAllStates: vi.fn().mockReturnValue(mockStates),
        onStateChange: vi.fn().mockReturnValue(() => {}),
      } as unknown as ProbeOrchestrator;

      const exporter = new PrometheusExporter(aggregator, mockOrchestrator);
      exporter.refreshProbeStates();

      const result = exporter.export();

      expect(result).toContain('orchestrator_requests_total 0');
      expect(result).toContain(
        'probe_state_current{tuple_key="server1:llama3:generate",state="HEALTHY"} 1'
      );
    });
  });
});
