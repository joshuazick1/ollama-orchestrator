/**
 * debug-output.test.ts
 * Tests for REC-55 routing-reasoning fields in getDebugInfo()
 */

import { describe, it, expect } from 'vitest';

import type { RoutingContext } from '../../src/orchestrator-instance.js';
import { getDebugInfo } from '../../src/utils/debug-headers.js';

describe('getDebugInfo – REC-55 routing reasoning fields', () => {
  describe('algorithm field', () => {
    it('should include algorithm when set', () => {
      const context: RoutingContext = { algorithm: 'weighted' };
      const result = getDebugInfo(context);
      expect(result).toBeDefined();
      expect(result?.algorithm).toBe('weighted');
    });

    it('should include algorithm = least-connections', () => {
      const context: RoutingContext = { algorithm: 'least-connections' };
      const result = getDebugInfo(context);
      expect(result?.algorithm).toBe('least-connections');
    });

    it('should include algorithm = round-robin', () => {
      const context: RoutingContext = { algorithm: 'round-robin' };
      const result = getDebugInfo(context);
      expect(result?.algorithm).toBe('round-robin');
    });

    it('should NOT include algorithm when not set', () => {
      const context: RoutingContext = { selectedServerId: 'server-1' };
      const result = getDebugInfo(context);
      expect(result?.algorithm).toBeUndefined();
    });
  });

  describe('protocol field', () => {
    it('should include protocol = ollama when set', () => {
      const context: RoutingContext = { protocol: 'ollama' };
      const result = getDebugInfo(context);
      expect(result).toBeDefined();
      expect(result?.protocol).toBe('ollama');
    });

    it('should include protocol = openai when set', () => {
      const context: RoutingContext = { protocol: 'openai' };
      const result = getDebugInfo(context);
      expect(result?.protocol).toBe('openai');
    });

    it('should NOT include protocol when not set', () => {
      const context: RoutingContext = { selectedServerId: 'server-1' };
      const result = getDebugInfo(context);
      expect(result?.protocol).toBeUndefined();
    });
  });

  describe('excludedServers field', () => {
    it('should include excludedServers when non-empty', () => {
      const context: RoutingContext = {
        selectedServerId: 'server-2',
        excludedServers: ['server-1'],
      };
      const result = getDebugInfo(context);
      expect(result?.excludedServers).toEqual(['server-1']);
    });

    it('should include multiple excluded servers', () => {
      const context: RoutingContext = {
        selectedServerId: 'server-3',
        excludedServers: ['server-1', 'server-2'],
      };
      const result = getDebugInfo(context);
      expect(result?.excludedServers).toEqual(['server-1', 'server-2']);
    });

    it('should NOT include excludedServers when empty array', () => {
      const context: RoutingContext = {
        selectedServerId: 'server-1',
        excludedServers: [],
      };
      const result = getDebugInfo(context);
      expect(result?.excludedServers).toBeUndefined();
    });

    it('should NOT include excludedServers when not set', () => {
      const context: RoutingContext = { selectedServerId: 'server-1' };
      const result = getDebugInfo(context);
      expect(result?.excludedServers).toBeUndefined();
    });

    it('should trigger hasDebugInfo from excludedServers alone', () => {
      const context: RoutingContext = { excludedServers: ['server-1'] };
      const result = getDebugInfo(context);
      expect(result).toBeDefined();
      expect(result?.excludedServers).toEqual(['server-1']);
    });
  });

  describe('serverScores field', () => {
    it('should include serverScores when non-empty', () => {
      const context: RoutingContext = {
        selectedServerId: 'server-1',
        serverScores: [
          { serverId: 'server-1', totalScore: 0.85 },
          { serverId: 'server-2', totalScore: 0.72 },
        ],
      };
      const result = getDebugInfo(context);
      expect(result?.serverScores).toEqual([
        { serverId: 'server-1', totalScore: 0.85 },
        { serverId: 'server-2', totalScore: 0.72 },
      ]);
    });

    it('should NOT include serverScores when empty array', () => {
      const context: RoutingContext = {
        selectedServerId: 'server-1',
        serverScores: [],
      };
      const result = getDebugInfo(context);
      expect(result?.serverScores).toBeUndefined();
    });

    it('should NOT include serverScores when not set', () => {
      const context: RoutingContext = { selectedServerId: 'server-1' };
      const result = getDebugInfo(context);
      expect(result?.serverScores).toBeUndefined();
    });

    it('should trigger hasDebugInfo from serverScores alone', () => {
      const context: RoutingContext = {
        serverScores: [{ serverId: 'server-1', totalScore: 0.9 }],
      };
      const result = getDebugInfo(context);
      expect(result).toBeDefined();
      expect(result?.serverScores).toEqual([{ serverId: 'server-1', totalScore: 0.9 }]);
    });
  });

  describe('timeoutMs field', () => {
    it('should include timeoutMs when set', () => {
      const context: RoutingContext = {
        selectedServerId: 'server-1',
        timeoutMs: 5000,
      };
      const result = getDebugInfo(context);
      expect(result?.timeoutMs).toBe(5000);
    });

    it('should include timeoutMs = 0', () => {
      const context: RoutingContext = { timeoutMs: 0 };
      const result = getDebugInfo(context);
      expect(result).toBeDefined();
      expect(result?.timeoutMs).toBe(0);
    });

    it('should NOT include timeoutMs when not set', () => {
      const context: RoutingContext = { selectedServerId: 'server-1' };
      const result = getDebugInfo(context);
      expect(result?.timeoutMs).toBeUndefined();
    });

    it('should trigger hasDebugInfo from timeoutMs alone', () => {
      const context: RoutingContext = { timeoutMs: 30000 };
      const result = getDebugInfo(context);
      expect(result).toBeDefined();
      expect(result?.timeoutMs).toBe(30000);
    });
  });

  describe('all REC-55 fields combined', () => {
    it('should include all new fields together', () => {
      const context: RoutingContext = {
        selectedServerId: 'server-1',
        algorithm: 'weighted',
        protocol: 'ollama',
        excludedServers: ['server-3'],
        serverScores: [
          { serverId: 'server-1', totalScore: 0.91 },
          { serverId: 'server-2', totalScore: 0.78 },
        ],
        timeoutMs: 10000,
      };
      const result = getDebugInfo(context);
      expect(result).toEqual({
        selectedServerId: 'server-1',
        algorithm: 'weighted',
        protocol: 'ollama',
        excludedServers: ['server-3'],
        serverScores: [
          { serverId: 'server-1', totalScore: 0.91 },
          { serverId: 'server-2', totalScore: 0.78 },
        ],
        timeoutMs: 10000,
      });
    });

    it('should combine REC-55 fields with existing routing fields', () => {
      const context: RoutingContext = {
        selectedServerId: 'server-2',
        serverCircuitState: 'closed',
        modelCircuitState: 'closed',
        availableServerCount: 3,
        retryCount: 1,
        serversTried: ['server-1'],
        algorithm: 'weighted',
        protocol: 'openai',
        excludedServers: ['server-1'],
        serverScores: [{ serverId: 'server-2', totalScore: 0.88 }],
        timeoutMs: 8000,
      };
      const result = getDebugInfo(context, {
        timeToFirstToken: 200,
        streamingDuration: 4000,
        tokensGenerated: 350,
        tokensPrompt: 50,
      });
      expect(result).toEqual({
        selectedServerId: 'server-2',
        serverCircuitState: 'closed',
        modelCircuitState: 'closed',
        availableServerCount: 3,
        retryCount: 1,
        serversTried: ['server-1'],
        algorithm: 'weighted',
        protocol: 'openai',
        excludedServers: ['server-1'],
        serverScores: [{ serverId: 'server-2', totalScore: 0.88 }],
        timeoutMs: 8000,
        timeToFirstToken: 200,
        streamingDuration: 4000,
        tokensGenerated: 350,
        tokensPrompt: 50,
      });
    });
  });
});

describe('getDebugInfo – no addDebugHeaders export (REC-58)', () => {
  it('should NOT export addDebugHeaders', async () => {
    const mod = await import('../../src/utils/debug-headers.js');
    expect((mod as Record<string, unknown>)['addDebugHeaders']).toBeUndefined();
  });

  it('should export getDebugInfo', async () => {
    const mod = await import('../../src/utils/debug-headers.js');
    expect(typeof mod.getDebugInfo).toBe('function');
  });
});
