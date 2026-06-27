/**
 * probe-to-request-context.test.ts
 * Tests for buildProbeRequestContext
 */

import { describe, it, expect } from 'vitest';

import type { ProbeRunResult } from '../../src/types/perf-probe.types.js';

import { buildProbeRequestContext } from '../../src/utils/probe-to-request-context.js';

describe('buildProbeRequestContext', () => {
  const taskId = 'probe-task-001';
  const serverId = 'server-1';
  const model = 'llama3:latest';

  describe('id format', () => {
    it('should generate synthetic id in probe-serverId-model format', () => {
      const result = makeResult({ serverId, model });
      const ctx = buildProbeRequestContext(result, taskId);
      expect(ctx.id).toBe(`probe-${taskId}-${serverId}-${model}`);
    });
  });

  describe('isProbe flag', () => {
    it('should set isProbe to true on success', () => {
      const ctx = buildProbeRequestContext(makeResult({ success: true }), taskId);
      expect(ctx.isProbe).toBe(true);
    });

    it('should set isProbe to true on failure', () => {
      const ctx = buildProbeRequestContext(makeResult({ success: false }), taskId);
      expect(ctx.isProbe).toBe(true);
    });
  });

  describe('successful probe', () => {
    it('should populate all success fields', () => {
      const result = makeResult({
        success: true,
        serverId,
        model,
        totalDurationMs: 1500,
        ttftMs: 120,
        tokensPerSec: 42.5,
        evalCount: 63,
        evalDuration: 1_500_000_000,
        promptEvalDuration: 200_000_000,
        totalDuration: 1_700_000_000,
        loadDuration: 50_000_000,
        chunkCount: 10,
        totalBytes: 4096,
      });
      const now = Date.now();
      const ctx = buildProbeRequestContext(result, taskId);

      expect(ctx.success).toBe(true);
      expect(ctx.endpoint).toBe('generate');
      expect(ctx.streaming).toBe(true);
      expect(ctx.serverId).toBe(serverId);
      expect(ctx.model).toBe(model);
      expect(ctx.duration).toBe(1500);
      expect(ctx.startTime).toBe(now - 1500);
      expect(ctx.endTime).toBe(now);
      expect(ctx.ttft).toBe(120);
      expect(ctx.firstTokenTime).toBe(ctx.startTime + 120);
      expect(ctx.tokensPerSecond).toBe(42.5);
      expect(ctx.tokensGenerated).toBe(63);
      expect(ctx.evalDuration).toBe(1_500_000_000);
      expect(ctx.promptEvalDuration).toBe(200_000_000);
      expect(ctx.totalDuration).toBe(1_700_000_000);
      expect(ctx.loadDuration).toBe(50_000_000);
      expect(ctx.chunkCount).toBe(10);
      expect(ctx.totalBytes).toBe(4096);
      expect(ctx.error).toBeUndefined();
      expect(ctx.errorType).toBeUndefined();
    });
  });

  describe('failed probe', () => {
    it('should set error and errorType on failure', () => {
      const result = makeResult({
        success: false,
        error: 'connection refused',
        errorType: 'network',
      });
      const ctx = buildProbeRequestContext(result, taskId);

      expect(ctx.success).toBe(false);
      expect(ctx.error).toBeInstanceOf(Error);
      expect(ctx.error!.message).toBe('connection refused');
      expect(ctx.errorType).toBe('network');
    });

    it('should not set ttft, tokensPerSecond, evalDuration on failure', () => {
      const result = makeResult({
        success: false,
        ttftMs: 120,
        tokensPerSec: 42.5,
        evalDuration: 1_500_000_000,
      });
      const ctx = buildProbeRequestContext(result, taskId);

      expect(ctx.ttft).toBeUndefined();
      expect(ctx.tokensPerSecond).toBeUndefined();
      expect(ctx.evalDuration).toBeUndefined();
    });

    it('should use default error message when error string is missing', () => {
      const result = makeResult({ success: false });
      const ctx = buildProbeRequestContext(result, taskId);
      expect(ctx.error!.message).toBe('probe failed');
    });
  });

  describe('cold start detection', () => {
    it('should set isColdStart true when loadDuration > 100ms', () => {
      const result = makeResult({
        loadDuration: 200_000_000, // 200ms
      });
      const ctx = buildProbeRequestContext(result, taskId);
      expect(ctx.isColdStart).toBe(true);
    });

    it('should set isColdStart false when loadDuration <= 100ms', () => {
      const result = makeResult({
        loadDuration: 50_000_000, // 50ms
      });
      const ctx = buildProbeRequestContext(result, taskId);
      expect(ctx.isColdStart).toBe(false);
    });

    it('should not set isColdStart when loadDuration is undefined', () => {
      const result = makeResult({});
      const ctx = buildProbeRequestContext(result, taskId);
      expect(ctx.isColdStart).toBeUndefined();
    });
  });

  describe('optional fields undefined', () => {
    it('should only set required fields when all optionals are undefined', () => {
      const result = makeResult({ success: true });
      const ctx = buildProbeRequestContext(result, taskId);

      expect(ctx.id).toBeDefined();
      expect(ctx.serverId).toBe(serverId);
      expect(ctx.model).toBe(model);
      expect(ctx.endpoint).toBe('generate');
      expect(ctx.streaming).toBe(true);
      expect(ctx.isProbe).toBe(true);
      expect(ctx.success).toBe(true);
      expect(ctx.duration).toBe(100);
      expect(ctx.ttft).toBeUndefined();
      expect(ctx.tokensPerSecond).toBeUndefined();
      expect(ctx.firstTokenTime).toBeUndefined();
      expect(ctx.tokensGenerated).toBeUndefined();
      expect(ctx.evalDuration).toBeUndefined();
      expect(ctx.promptEvalDuration).toBeUndefined();
      expect(ctx.totalDuration).toBeUndefined();
      expect(ctx.loadDuration).toBeUndefined();
      expect(ctx.isColdStart).toBeUndefined();
      expect(ctx.chunkCount).toBeUndefined();
      expect(ctx.totalBytes).toBeUndefined();
      expect(ctx.error).toBeUndefined();
      expect(ctx.errorType).toBeUndefined();
    });
  });
});

function makeResult(overrides: Partial<ProbeRunResult> = {}): ProbeRunResult {
  return {
    serverId: 'server-1',
    model: 'llama3:latest',
    success: true,
    totalDurationMs: 100,
    ...overrides,
  };
}
