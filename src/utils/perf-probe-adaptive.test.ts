import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  selectAdaptiveProbes,
  runAdaptiveRound,
  MAX_ADAPTIVE_PER_ROUND,
  type CanServeFn,
  type PerfProbeTaskState,
} from './perf-probe-adaptive.js';
import type { ProbeRunResult } from '../types/perf-probe.types.js';

describe('perf-probe-adaptive', () => {
  describe('selectAdaptiveProbes', () => {
    const alwaysCanServe: CanServeFn = () => true;

    it('returns empty map when failedServers is empty', () => {
      const result = selectAdaptiveProbes(
        [],
        { srv1: ['llama3'] },
        { llama3: ['srv1'] },
        new Set(),
        alwaysCanServe
      );
      expect(result.size).toBe(0);
    });

    it('returns empty map when failed server has no models', () => {
      const result = selectAdaptiveProbes(['srv1'], { srv1: [] }, {}, new Set(), alwaysCanServe);
      expect(result.size).toBe(0);
    });

    it('returns empty map when failed server has only cloud models', () => {
      const result = selectAdaptiveProbes(
        ['srv1'],
        { srv1: ['llama3:cloud', 'cloud-gpt4', 'meta-cloud'] },
        {},
        new Set(),
        alwaysCanServe
      );
      expect(result.size).toBe(0);
    });

    it('returns empty map when failed server has model but no overlap servers', () => {
      const result = selectAdaptiveProbes(
        ['srv1'],
        { srv1: ['llama3'] },
        { llama3: ['srv1'] },
        new Set(),
        alwaysCanServe
      );
      expect(result.size).toBe(0);
    });

    it('picks the overlap model when failed server has only one candidate', () => {
      const serverToModels = {
        srv1: ['llama3'],
        srv2: ['llama3'],
      };
      const allModelToServers = {
        llama3: ['srv1', 'srv2'],
      };

      const result = selectAdaptiveProbes(
        ['srv1'],
        serverToModels,
        allModelToServers,
        new Set(),
        alwaysCanServe
      );

      expect(result.size).toBe(1);
      expect(result.get('srv1')).toEqual({
        model: 'llama3',
        overlapServers: ['srv2'],
      });
    });

    it('picks highest-overlap model when multiple candidates exist', () => {
      const serverToModels = {
        srv1: ['llama3', 'mixtral'],
        srv2: ['llama3'],
        srv3: ['llama3'],
        srv4: ['mixtral'],
      };
      const allModelToServers = {
        llama3: ['srv1', 'srv2', 'srv3'],
        mixtral: ['srv1', 'srv4'],
      };

      const result = selectAdaptiveProbes(
        ['srv1'],
        serverToModels,
        allModelToServers,
        new Set(),
        alwaysCanServe
      );

      expect(result.size).toBe(1);
      expect(result.get('srv1')).toEqual({
        model: 'llama3',
        overlapServers: ['srv2', 'srv3'],
      });
    });

    it('excludes models already in triedPairs', () => {
      const serverToModels = {
        srv1: ['llama3', 'mixtral'],
        srv2: ['llama3', 'mixtral'],
      };
      const allModelToServers = {
        llama3: ['srv1', 'srv2'],
        mixtral: ['srv1', 'srv2'],
      };
      const triedPairs = new Set(['srv1:llama3']);

      const result = selectAdaptiveProbes(
        ['srv1'],
        serverToModels,
        allModelToServers,
        triedPairs,
        alwaysCanServe
      );

      expect(result.size).toBe(1);
      expect(result.get('srv1')).toEqual({
        model: 'mixtral',
        overlapServers: ['srv2'],
      });
    });

    it('excludes failed server model when canServe returns false for that tuple', () => {
      const serverToModels = {
        srv1: ['llama3'],
        srv2: ['llama3'],
      };
      const allModelToServers = {
        llama3: ['srv1', 'srv2'],
      };
      const canServe: CanServeFn = tuple => {
        if (tuple.serverId === 'srv1' && tuple.model === 'llama3') {
          return false;
        }
        return true;
      };

      const result = selectAdaptiveProbes(
        ['srv1'],
        serverToModels,
        allModelToServers,
        new Set(),
        canServe
      );

      expect(result.size).toBe(0);
    });

    it('excludes overlap servers where canServe returns false', () => {
      const serverToModels = {
        srv1: ['llama3'],
        srv2: ['llama3'],
        srv3: ['llama3'],
      };
      const allModelToServers = {
        llama3: ['srv1', 'srv2', 'srv3'],
      };
      const canServe: CanServeFn = tuple => {
        if (tuple.serverId === 'srv2') {
          return false;
        }
        return true;
      };

      const result = selectAdaptiveProbes(
        ['srv1'],
        serverToModels,
        allModelToServers,
        new Set(),
        canServe
      );

      expect(result.size).toBe(1);
      expect(result.get('srv1')).toEqual({
        model: 'llama3',
        overlapServers: ['srv3'],
      });
    });

    it('excludes overlap servers already in triedPairs', () => {
      const serverToModels = {
        srv1: ['llama3'],
        srv2: ['llama3'],
        srv3: ['llama3'],
      };
      const allModelToServers = {
        llama3: ['srv1', 'srv2', 'srv3'],
      };
      const triedPairs = new Set(['srv2:llama3']);

      const result = selectAdaptiveProbes(
        ['srv1'],
        serverToModels,
        allModelToServers,
        triedPairs,
        alwaysCanServe
      );

      expect(result.size).toBe(1);
      expect(result.get('srv1')).toEqual({
        model: 'llama3',
        overlapServers: ['srv3'],
      });
    });

    it('handles multiple failed servers', () => {
      const serverToModels = {
        srv1: ['llama3'],
        srv2: ['mixtral'],
        srv3: ['llama3', 'mixtral'],
      };
      const allModelToServers = {
        llama3: ['srv1', 'srv3'],
        mixtral: ['srv2', 'srv3'],
      };

      const result = selectAdaptiveProbes(
        ['srv1', 'srv2'],
        serverToModels,
        allModelToServers,
        new Set(),
        alwaysCanServe
      );

      expect(result.size).toBe(2);
      expect(result.get('srv1')).toEqual({
        model: 'llama3',
        overlapServers: ['srv3'],
      });
      expect(result.get('srv2')).toEqual({
        model: 'mixtral',
        overlapServers: ['srv3'],
      });
    });

    it('caps at MAX_ADAPTIVE_PER_ROUND results', () => {
      const serverToModels: Record<string, string[]> = {};
      const allModelToServers: Record<string, string[]> = {};

      for (let i = 1; i <= 60; i++) {
        const srvId = `srv${i}`;
        serverToModels[srvId] = [`model-${i % 5}`];
        const serversWithModel = [];
        for (let j = 1; j <= 60; j++) {
          if (i !== j) {
            serversWithModel.push(`srv${j}`);
          }
        }
        allModelToServers[`model-${i % 5}`] = serversWithModel;
      }

      const failedServers = Object.keys(serverToModels);
      const result = selectAdaptiveProbes(
        failedServers,
        serverToModels,
        allModelToServers,
        new Set(),
        alwaysCanServe
      );

      expect(result.size).toBeLessThanOrEqual(MAX_ADAPTIVE_PER_ROUND);
    });

    it('sorts by overlap count desc, then model name asc for tie-breaking', () => {
      const serverToModels = {
        srv1: ['aaa-model', 'zzz-model'],
        srv2: ['aaa-model'],
        srv3: ['zzz-model'],
      };
      const allModelToServers = {
        'aaa-model': ['srv1', 'srv2'],
        'zzz-model': ['srv1', 'srv3'],
      };

      const result = selectAdaptiveProbes(
        ['srv1'],
        serverToModels,
        allModelToServers,
        new Set(),
        alwaysCanServe
      );

      expect(result.size).toBe(1);
      expect(result.get('srv1')).toEqual({
        model: 'aaa-model',
        overlapServers: ['srv2'],
      });
    });
  });

  describe('runAdaptiveRound', () => {
    const createMockTask = (overrides?: Partial<PerfProbeTaskState>): PerfProbeTaskState => ({
      failedServers: [],
      triedPairs: new Set(),
      adaptiveRound: 0,
      results: [],
      ...overrides,
    });

    const createMockProbeFn = (results: ProbeRunResult[]) => {
      return vi.fn().mockImplementation(async (serverId: string, model: string) => {
        const result = results.shift();
        if (!result) {
          return {
            serverId,
            model,
            success: false,
            totalDurationMs: 0,
            error: 'No mock result available',
          };
        }
        return result;
      });
    };

    it('returns empty array when maxRounds is 0', async () => {
      const task = createMockTask({ failedServers: ['srv1'] });
      const probeFn = vi.fn();

      const results = await runAdaptiveRound(task, probeFn, () => true, 0);

      expect(results).toEqual([]);
      expect(probeFn).not.toHaveBeenCalled();
    });

    it('returns empty array when adaptiveRound >= maxRounds', async () => {
      const task = createMockTask({ failedServers: ['srv1'], adaptiveRound: 3 });
      const probeFn = vi.fn();

      const results = await runAdaptiveRound(task, probeFn, () => true, 3);

      expect(results).toEqual([]);
      expect(probeFn).not.toHaveBeenCalled();
    });

    it('returns empty array when no failed servers', async () => {
      const task = createMockTask({ failedServers: [] });
      const probeFn = vi.fn();

      const results = await runAdaptiveRound(task, probeFn, () => true, 5);

      expect(results).toEqual([]);
      expect(probeFn).not.toHaveBeenCalled();
    });

    it('returns empty array when no adaptive candidates', async () => {
      const task = createMockTask({
        failedServers: ['srv1'],
        results: [{ serverId: 'srv1', model: 'llama3', success: true, totalDurationMs: 100 }],
      });
      const probeFn = vi.fn();

      const results = await runAdaptiveRound(task, probeFn, () => true, 5);

      expect(results).toEqual([]);
      expect(probeFn).not.toHaveBeenCalled();
    });

    it('runs probes and updates task state', async () => {
      const mockResults: ProbeRunResult[] = [
        {
          serverId: 'srv1',
          model: 'llama3',
          success: true,
          totalDurationMs: 100,
          ttftMs: 50,
          tokensPerSec: 10,
        },
      ];
      const probeFn = createMockProbeFn([...mockResults]);

      const task = createMockTask({
        failedServers: ['srv1'],
        results: [
          { serverId: 'srv1', model: 'llama3', success: true, totalDurationMs: 100 },
          { serverId: 'srv2', model: 'llama3', success: true, totalDurationMs: 100 },
        ],
      });

      const results = await runAdaptiveRound(task, probeFn, () => true, 5);

      expect(results.length).toBe(1);
      expect(probeFn).toHaveBeenCalledWith('srv1', 'llama3');
      expect(task.triedPairs.has('srv1:llama3')).toBe(true);
      expect(task.adaptiveRound).toBe(1);
      expect(task.results.length).toBe(3);
    });

    it('handles probe throws gracefully', async () => {
      const probeFn = vi.fn().mockRejectedValue(new Error('Network failure'));

      const task = createMockTask({
        failedServers: ['srv1'],
        results: [
          { serverId: 'srv1', model: 'llama3', success: true, totalDurationMs: 100 },
          { serverId: 'srv2', model: 'llama3', success: true, totalDurationMs: 100 },
        ],
      });

      const results = await runAdaptiveRound(task, probeFn, () => true, 5);

      expect(results.length).toBe(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('Network failure');
      expect(task.triedPairs.has('srv1:llama3')).toBe(true);
    });

    it('calls onProgress callback after each result', async () => {
      const mockResults: ProbeRunResult[] = [
        { serverId: 'srv1', model: 'llama3', success: true, totalDurationMs: 100 },
      ];
      const probeFn = createMockProbeFn([...mockResults]);
      const onProgress = vi.fn();

      const task = createMockTask({
        failedServers: ['srv1'],
        results: [
          { serverId: 'srv1', model: 'llama3', success: true, totalDurationMs: 100 },
          { serverId: 'srv2', model: 'llama3', success: true, totalDurationMs: 100 },
        ],
      });

      await runAdaptiveRound(task, probeFn, () => true, 5, onProgress);

      expect(onProgress).toHaveBeenCalledTimes(1);
      expect(onProgress).toHaveBeenCalledWith(mockResults[0]);
    });

    it('filters by canServe for both failed server and overlap servers', async () => {
      const probeFn = vi.fn().mockResolvedValue({
        serverId: 'srv1',
        model: 'llama3',
        success: true,
        totalDurationMs: 100,
      });

      const canServe: CanServeFn = tuple => {
        if (tuple.serverId === 'srv1' && tuple.model === 'llama3') {
          return false;
        }
        return true;
      };

      const task = createMockTask({
        failedServers: ['srv1'],
        results: [
          { serverId: 'srv1', model: 'llama3', success: true, totalDurationMs: 100 },
          { serverId: 'srv2', model: 'llama3', success: true, totalDurationMs: 100 },
        ],
      });

      const results = await runAdaptiveRound(task, probeFn, canServe, 5);

      expect(results).toEqual([]);
      expect(probeFn).not.toHaveBeenCalled();
    });

    it('correctly builds serverToModels and allModelToServers from task results', async () => {
      const probeFn = vi.fn().mockResolvedValue({
        serverId: 'srv1',
        model: 'mixtral',
        success: true,
        totalDurationMs: 100,
      });

      const task = createMockTask({
        failedServers: ['srv1'],
        results: [
          { serverId: 'srv1', model: 'llama3', success: true, totalDurationMs: 100 },
          { serverId: 'srv1', model: 'mixtral', success: true, totalDurationMs: 100 },
          { serverId: 'srv2', model: 'llama3', success: true, totalDurationMs: 100 },
          { serverId: 'srv2', model: 'mixtral', success: true, totalDurationMs: 100 },
          { serverId: 'srv3', model: 'llama3', success: true, totalDurationMs: 100 },
          { serverId: 'srv3', model: 'mixtral', success: true, totalDurationMs: 100 },
        ],
      });

      const results = await runAdaptiveRound(task, probeFn, () => true, 5);

      expect(results.length).toBe(1);
      expect(probeFn).toHaveBeenCalledWith('srv1', 'llama3');
      expect(task.triedPairs.has('srv1:llama3')).toBe(true);
    });
  });
});
