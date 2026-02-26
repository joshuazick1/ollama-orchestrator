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
});
