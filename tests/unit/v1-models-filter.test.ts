import { describe, it, expect, vi } from 'vitest';
import { filterValidModels } from '../../src/utils/model-validator.js';

vi.mock('../src/storage/metrics-store.js');

describe('v1-models filter (B17)', () => {
  it('should filter suspicious models from getAggregatedOpenAIModels', async () => {
    const mod = await import('../src/orchestrator/orchestrator.js');
    const src = mod.Orchestrator?.prototype?.getAggregatedOpenAIModels?.toString() ?? '';
    const usesFilter = src.includes('filterValidModels');
    expect(usesFilter).toBe(true);
  });

  it('filterValidModels removes attack/cloud patterns', () => {
    const clean = ['llama3', 'mistral'];
    const dirty = ['http://evil.com', '192.168.1.1', 'payload:cloud', 'exploit-kit'];
    const result = filterValidModels([...clean, ...dirty]);
    expect(result).toEqual(clean);
  });
});
