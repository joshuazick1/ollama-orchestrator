/**
 * debug-info.test.ts
 * Tests for debug info in JSON responses
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';

import { getDebugInfo } from '../../src/utils/debug-headers.js';
import type { RoutingContext } from '../../src/orchestrator-instance.js';

describe('getDebugInfo', () => {
  it('should return undefined when context is empty', () => {
    const context: RoutingContext = {};
    const result = getDebugInfo(context);
    expect(result).toBeUndefined();
  });

  it('should return undefined when only undefined values are present', () => {
    const context: RoutingContext = {
      selectedServerId: undefined,
      serverCircuitState: undefined,
      modelCircuitState: undefined,
      availableServerCount: undefined,
      routedToOpenCircuit: undefined,
      retryCount: undefined,
    };
    const result = getDebugInfo(context);
    expect(result).toBeUndefined();
  });

  it('should return debug info with all fields populated', () => {
    const context: RoutingContext = {
      selectedServerId: 'server-1',
      serverCircuitState: 'closed',
      modelCircuitState: 'open',
      availableServerCount: 5,
      routedToOpenCircuit: true,
      retryCount: 3,
    };
    const result = getDebugInfo(context);
    expect(result).toEqual({
      selectedServerId: 'server-1',
      serverCircuitState: 'closed',
      modelCircuitState: 'open',
      availableServerCount: 5,
      routedToOpenCircuit: true,
      retryCount: 3,
    });
  });

  it('should return debug info with only selectedServerId', () => {
    const context: RoutingContext = {
      selectedServerId: 'server-1',
    };
    const result = getDebugInfo(context);
    expect(result).toEqual({
      selectedServerId: 'server-1',
    });
  });

  it('should return debug info with circuit breaker states', () => {
    const context: RoutingContext = {
      serverCircuitState: 'half-open',
      modelCircuitState: 'closed',
    };
    const result = getDebugInfo(context);
    expect(result).toEqual({
      serverCircuitState: 'half-open',
      modelCircuitState: 'closed',
    });
  });

  it('should return debug info with availableServerCount', () => {
    const context: RoutingContext = {
      availableServerCount: 0,
    };
    const result = getDebugInfo(context);
    expect(result).toEqual({
      availableServerCount: 0,
    });
  });

  it('should return debug info with routedToOpenCircuit only when true', () => {
    const context: RoutingContext = {
      routedToOpenCircuit: true,
    };
    const result = getDebugInfo(context);
    expect(result).toEqual({
      routedToOpenCircuit: true,
    });
  });

  it('should NOT include routedToOpenCircuit when false', () => {
    const context: RoutingContext = {
      selectedServerId: 'server-1',
      routedToOpenCircuit: false,
    };
    const result = getDebugInfo(context);
    expect(result).toEqual({
      selectedServerId: 'server-1',
    });
    expect(result?.routedToOpenCircuit).toBeUndefined();
  });

  it('should NOT include retryCount when retryCount is 0', () => {
    const context: RoutingContext = {
      selectedServerId: 'server-1',
      retryCount: 0,
    };
    const result = getDebugInfo(context);
    expect(result).toEqual({
      selectedServerId: 'server-1',
    });
    expect(result?.retryCount).toBeUndefined();
  });

  it('should NOT include retryCount when retryCount is undefined', () => {
    const context: RoutingContext = {
      selectedServerId: 'server-1',
      retryCount: undefined,
    };
    const result = getDebugInfo(context);
    expect(result).toEqual({
      selectedServerId: 'server-1',
    });
    expect(result?.retryCount).toBeUndefined();
  });

  it('should include retryCount when retryCount is greater than 0', () => {
    const context: RoutingContext = {
      selectedServerId: 'server-1',
      retryCount: 1,
    };
    const result = getDebugInfo(context);
    expect(result).toEqual({
      selectedServerId: 'server-1',
      retryCount: 1,
    });
  });

  it('should NOT include availableServerCount when undefined', () => {
    const context: RoutingContext = {
      availableServerCount: undefined,
    };
    const result = getDebugInfo(context);
    expect(result).toBeUndefined();
  });

  it('should handle all circuit breaker states', () => {
    const states = ['closed', 'open', 'half-open'] as const;

    for (const serverState of states) {
      for (const modelState of states) {
        const context: RoutingContext = {
          serverCircuitState: serverState,
          modelCircuitState: modelState,
        };
        const result = getDebugInfo(context);
        expect(result?.serverCircuitState).toBe(serverState);
        expect(result?.modelCircuitState).toBe(modelState);
      }
    }
  });
});

describe('Debug info edge cases', () => {
  it('should handle context with only routedToOpenCircuit set to true', () => {
    const context: RoutingContext = {
      routedToOpenCircuit: true,
    };
    const result = getDebugInfo(context);
    expect(result).toEqual({
      routedToOpenCircuit: true,
    });
  });

  it('should handle large retry count', () => {
    const context: RoutingContext = {
      selectedServerId: 'server-1',
      retryCount: 999,
    };
    const result = getDebugInfo(context);
    expect(result?.retryCount).toBe(999);
  });

  it('should handle maximum available servers', () => {
    const context: RoutingContext = {
      availableServerCount: Number.MAX_SAFE_INTEGER,
    };
    const result = getDebugInfo(context);
    expect(result?.availableServerCount).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('should handle zero available servers', () => {
    const context: RoutingContext = {
      availableServerCount: 0,
    };
    const result = getDebugInfo(context);
    expect(result?.availableServerCount).toBe(0);
  });

  // New fields tests
  it('should include serversTried when provided', () => {
    const context: RoutingContext = {
      selectedServerId: 'server-2',
      serversTried: ['server-1', 'server-2'],
    };
    const result = getDebugInfo(context);
    expect(result).toEqual({
      selectedServerId: 'server-2',
      serversTried: ['server-1', 'server-2'],
    });
  });

  it('should include totalCandidates', () => {
    const context: RoutingContext = {
      selectedServerId: 'server-1',
      totalCandidates: 5,
    };
    const result = getDebugInfo(context);
    expect(result).toEqual({
      selectedServerId: 'server-1',
      totalCandidates: 5,
    });
  });

  it('should include serverLoad', () => {
    const context: RoutingContext = {
      selectedServerId: 'server-1',
      serverLoad: 3,
    };
    const result = getDebugInfo(context);
    expect(result).toEqual({
      selectedServerId: 'server-1',
      serverLoad: 3,
    });
  });

  it('should include maxConcurrency', () => {
    const context: RoutingContext = {
      selectedServerId: 'server-1',
      maxConcurrency: 10,
    };
    const result = getDebugInfo(context);
    expect(result).toEqual({
      selectedServerId: 'server-1',
      maxConcurrency: 10,
    });
  });

  it('should include timing metrics from options', () => {
    const context: RoutingContext = {
      selectedServerId: 'server-1',
    };
    const result = getDebugInfo(context, {
      timeToFirstToken: 150,
      streamingDuration: 3000,
    });
    expect(result).toEqual({
      selectedServerId: 'server-1',
      timeToFirstToken: 150,
      streamingDuration: 3000,
    });
  });

  it('should include token metrics from options', () => {
    const context: RoutingContext = {
      selectedServerId: 'server-1',
    };
    const result = getDebugInfo(context, {
      tokensGenerated: 150,
      tokensPrompt: 20,
    });
    expect(result).toEqual({
      selectedServerId: 'server-1',
      tokensGenerated: 150,
      tokensPrompt: 20,
    });
  });

  it('should include lastError from options', () => {
    const context: RoutingContext = {
      selectedServerId: 'server-1',
    };
    const result = getDebugInfo(context, {
      lastError: 'Connection timeout',
    });
    expect(result).toEqual({
      selectedServerId: 'server-1',
      lastError: 'Connection timeout',
    });
  });

  it('should include all enhanced fields together', () => {
    const context: RoutingContext = {
      selectedServerId: 'server-2',
      serverCircuitState: 'closed',
      modelCircuitState: 'closed',
      availableServerCount: 5,
      routedToOpenCircuit: false,
      retryCount: 1,
      serversTried: ['server-1', 'server-2'],
      totalCandidates: 5,
      serverLoad: 2,
      maxConcurrency: 10,
    };
    const result = getDebugInfo(context, {
      timeToFirstToken: 100,
      streamingDuration: 2500,
      tokensGenerated: 200,
      tokensPrompt: 30,
    });
    expect(result).toEqual({
      selectedServerId: 'server-2',
      serverCircuitState: 'closed',
      modelCircuitState: 'closed',
      availableServerCount: 5,
      retryCount: 1,
      serversTried: ['server-1', 'server-2'],
      totalCandidates: 5,
      serverLoad: 2,
      maxConcurrency: 10,
      timeToFirstToken: 100,
      streamingDuration: 2500,
      tokensGenerated: 200,
      tokensPrompt: 30,
    });
  });

  it('should NOT include serversTried when empty array', () => {
    const context: RoutingContext = {
      selectedServerId: 'server-1',
      serversTried: [],
    };
    const result = getDebugInfo(context);
    expect(result).toEqual({
      selectedServerId: 'server-1',
    });
    expect(result?.serversTried).toBeUndefined();
  });

  // REC-55: new RoutingContext fields
  it('should include algorithm from context', () => {
    const context: RoutingContext = {
      selectedServerId: 'server-1',
      algorithm: 'weighted',
    };
    const result = getDebugInfo(context);
    expect(result?.algorithm).toBe('weighted');
  });

  it('should include protocol from context', () => {
    const context: RoutingContext = {
      selectedServerId: 'server-1',
      protocol: 'ollama',
    };
    const result = getDebugInfo(context);
    expect(result?.protocol).toBe('ollama');
  });

  it('should include excludedServers from context', () => {
    const context: RoutingContext = {
      selectedServerId: 'server-2',
      excludedServers: ['server-1'],
    };
    const result = getDebugInfo(context);
    expect(result?.excludedServers).toEqual(['server-1']);
  });

  it('should include serverScores from context', () => {
    const context: RoutingContext = {
      selectedServerId: 'server-1',
      serverScores: [{ serverId: 'server-1', totalScore: 0.9 }],
    };
    const result = getDebugInfo(context);
    expect(result?.serverScores).toEqual([{ serverId: 'server-1', totalScore: 0.9 }]);
  });

  it('should include timeoutMs from context', () => {
    const context: RoutingContext = {
      selectedServerId: 'server-1',
      timeoutMs: 5000,
    };
    const result = getDebugInfo(context);
    expect(result?.timeoutMs).toBe(5000);
  });
});

describe('addDebugHeaders removed (REC-58)', () => {
  it('should NOT export addDebugHeaders from debug-headers module', async () => {
    const mod = await import('../../src/utils/debug-headers.js');
    expect((mod as Record<string, unknown>)['addDebugHeaders']).toBeUndefined();
  });

  it('should NOT export ExtendedRoutingContext from debug-headers module', async () => {
    // ExtendedRoutingContext was a type — we verify no runtime export with that name
    const mod = await import('../../src/utils/debug-headers.js');
    expect((mod as Record<string, unknown>)['ExtendedRoutingContext']).toBeUndefined();
  });
});
